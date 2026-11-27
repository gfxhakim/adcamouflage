"""Support bot: a customer's live-agent ticket must reach the Admin panel."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth_routes import login_limiter
from app.config import settings
from app.db import SupportMessage, SupportThread, get_session_factory, init_db, utcnow
from app.main import app
from app.support_routes import wants_live_agent

RUN_ID = uuid.uuid4().hex[:12]


def address(name: str) -> str:
    return f"{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


def _signed_in(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": "correct-horse-battery"}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


def _admin_ticket(admin: TestClient, tid: int) -> dict | None:
    threads = admin.get("/api/v1/admin/support/threads")
    assert threads.status_code == 200, threads.text
    return next((t for t in threads.json() if t["id"] == tid), None)


def _age_thread(tid: int, minutes: int) -> None:
    """Pretend everything in the thread happened `minutes` ago."""

    past = utcnow() - timedelta(minutes=minutes)
    with get_session_factory()() as db:
        thread = db.get(SupportThread, tid)
        if thread.escalated_at is not None:
            thread.escalated_at = past
        for m in db.query(SupportMessage).filter(SupportMessage.thread_id == tid):
            m.created_at = past
        db.commit()


def test_agent_phrases():
    assert wants_live_agent("I want to talk to a real agent")
    assert wants_live_agent("can I open a ticket please")
    assert wants_live_agent("i need a human")
    assert not wants_live_agent("how do tokens work?")
    assert not wants_live_agent("")


def test_contact_agent_button_ticket_reaches_admin(admin):
    customer = _signed_in(address("button"))
    for i in range(5):
        r = customer.post("/api/v1/support/thread/message", json={"body": f"my render failed {i}"})
        assert r.status_code == 200, r.text
    r = customer.post("/api/v1/support/thread/escalate", json={"note": "please help"})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    ticket = _admin_ticket(admin, tid)
    assert ticket is not None and ticket["status"] == "escalated"
    assert admin.get("/api/v1/admin/support/notifications").json()["escalated_count"] >= 1


def test_asking_for_an_agent_opens_a_ticket_right_away(admin):
    customer = _signed_in(address("asker"))
    r = customer.post("/api/v1/support/thread/message", json={"body": "I want to talk to a real agent"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "escalated"
    assert "Ticket #" in body["messages"][-1]["body"]
    ticket = _admin_ticket(admin, body["id"])
    assert ticket is not None and ticket["status"] == "escalated"
    assert ticket["unread_admin"] >= 1


def test_customer_stuck_in_bot_for_30_minutes_gets_a_ticket(admin):
    customer = _signed_in(address("stuck"))
    for i in range(5):
        customer.post("/api/v1/support/thread/message", json={"body": f"upload broken step {i}"})
    tid = customer.get("/api/v1/support/thread").json()["id"]
    # Never pressed Contact Agent. Not 30 min yet: still a bot chat.
    assert customer.get("/api/v1/support/thread").json()["status"] == "bot"

    _age_thread(tid, 31)
    ticket = _admin_ticket(admin, tid)  # admin loading support runs the safety net
    assert ticket is not None and ticket["status"] == "escalated"
    msgs = customer.get("/api/v1/support/thread").json()["messages"]
    assert any("waiting 30 minutes" in m["body"] for m in msgs)


def test_short_bot_chat_does_not_become_a_ticket(admin):
    customer = _signed_in(address("casual"))
    customer.post("/api/v1/support/thread/message", json={"body": "how do tokens and refunds work"})
    tid = customer.get("/api/v1/support/thread").json()["id"]
    _age_thread(tid, 45)
    admin.get("/api/v1/admin/support/notifications")
    assert customer.get("/api/v1/support/thread").json()["status"] == "bot"


def test_unanswered_ticket_goes_overdue_until_agent_replies(admin):
    customer = _signed_in(address("overdue"))
    tid = customer.post(
        "/api/v1/support/thread/message", json={"body": "please open a ticket"}
    ).json()["id"]
    assert _admin_ticket(admin, tid)["overdue"] is False
    _age_thread(tid, 31)
    assert _admin_ticket(admin, tid)["overdue"] is True
    assert admin.get("/api/v1/admin/support/notifications").json()["overdue_count"] >= 1

    r = admin.post(f"/api/v1/admin/support/threads/{tid}/message", json={"body": "Hi, I'm here"})
    assert r.status_code == 200, r.text
    assert _admin_ticket(admin, tid)["overdue"] is False


def test_ticket_from_legacy_account_shows_in_admin(admin):
    """Accounts from before token billing are 'legacy'; their tickets must still list."""

    from .conftest import make_legacy

    email = address("legacy")
    user = _signed_in(email)
    make_legacy(email)
    r = user.post("/api/v1/support/thread/message", json={"body": "Talk to a real agent"})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    ticket = _admin_ticket(admin, tid)
    assert ticket is not None and ticket["status"] == "escalated"
    assert ticket["customer"]["billing_mode"] == "legacy"
    assert ticket["customer"]["plan_label"]
    assert admin.get("/api/v1/admin/support/notifications").status_code == 200
    detail = admin.get(f"/api/v1/admin/support/threads/{tid}")
    assert detail.status_code == 200, detail.text


def test_email_to_admins_names_old_agent_replies_with_the_new_name(admin, monkeypatch):
    """The ticket email labels an agent reply saved before the rename with the new name."""

    sent: list[str] = []
    monkeypatch.setattr("app.support_routes.send_email", lambda to, subject, body: sent.append(body))
    customer = _signed_in(address("oldagent"))
    tid = None
    for i in range(5):
        r = customer.post("/api/v1/support/thread/message", json={"body": f"my export failed {i}"})
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
    with get_session_factory()() as db:
        db.add(SupportMessage(thread_id=tid, sender_role="agent", sender_name="BluEditor Support Agent", body="BluEditor was our old name."))
        db.commit()
    r = customer.post("/api/v1/support/thread/escalate", json={"note": "please help"})
    assert r.status_code == 200, r.text
    assert sent, "no email was built"
    assert "Agent (ProteusFlow Support Agent)" in sent[0]
    # What the agent typed is never changed.
    assert "BluEditor was our old name." in sent[0]


def test_old_brand_name_in_saved_bot_messages_is_replaced(admin):
    """Chats saved before the rename show the new name; typed text is never changed."""

    customer = _signed_in(address("oldchat"))
    r = customer.post("/api/v1/support/thread/message", json={"body": "is BluEditor down?"})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    with get_session_factory()() as db:
        db.add_all(
            [
                SupportMessage(thread_id=tid, sender_role="agent", sender_name="BluEditor Support Agent", body="BluEditor was our old name."),
                SupportMessage(
                    thread_id=tid,
                    sender_role="bot",
                    sender_name="BluEditor Bot",
                    body="Welcome to BluEditor. Mail support@blucloack.online",
                    suggestions_json='["What is BluEditor?"]',
                ),
            ]
        )
        db.commit()

    messages = customer.get("/api/v1/support/thread").json()["messages"]
    typed = next(m for m in messages if m["sender_role"] == "user")
    assert typed["body"] == "is BluEditor down?"
    old_bot = next(m for m in messages if m["body"].startswith("Welcome to"))
    assert old_bot["sender_name"] == "ProteusFlow Bot"
    assert old_bot["body"] == "Welcome to ProteusFlow. Mail support@blucloack.online"
    assert old_bot["suggestions"] == ["What is ProteusFlow?"]
    agent = next(m for m in messages if m["sender_role"] == "agent")
    assert agent["sender_name"] == "ProteusFlow Support Agent"
    assert agent["body"] == "BluEditor was our old name."

    # The admin's ticket list shows the same cleaned bot text in its preview line.
    with get_session_factory()() as db:
        thread = db.get(SupportThread, tid)
        thread.status = "escalated"
        thread.escalated_at = utcnow()
        thread.issue_summary = "Customer requested a live agent from the BluEditor Bot."
        last = db.query(SupportMessage).filter(SupportMessage.thread_id == tid, SupportMessage.sender_role == "bot").order_by(SupportMessage.id.desc()).first()
        last.created_at = utcnow() + timedelta(minutes=1)
        db.commit()
    ticket = _admin_ticket(admin, tid)
    assert ticket is not None
    assert ticket["last_message_preview"] == "Welcome to ProteusFlow. Mail support@blucloack.online"
    assert ticket["issue_summary"] == "Customer requested a live agent from the ProteusFlow Bot."

    # A summary made of the customer's own words is left exactly as typed.
    with get_session_factory()() as db:
        db.get(SupportThread, tid).issue_summary = "• is BluEditor down?"
        db.commit()
    assert _admin_ticket(admin, tid)["issue_summary"] == "• is BluEditor down?"


def test_bot_never_reveals_backend_internals_or_layers():
    forbidden = (
        "ffmpeg",
        "celery",
        "redis",
        "fastapi",
        "postgres",
        "elastic_mesh_warp",
        "dct_jnd_perturbation",
        "lut_clahe_color",
        "adversarial_cnn_layer",
        "optical_flow_timewarp",
        "audio_allpass_phase",
        "formant_pitch_lfo",
        "psychoacoustic_rir",
        "authentic_atom_spoof",
        "macroblock_aq_variance",
        "micro_crop",
        "deep_scramble",
        "23 layers",
        "23/23",
        "gen-4",
        "x264",
        "moov",
        "worker queue",
    )
    customer = _signed_in(address("nosybot"))
    probing_prompts = (
        "how does your backend work?",
        "explain all 23 layers and Gen-4",
        "what does elastic_mesh_warp and dct_jnd_perturbation do?",
        "do you use ffmpeg, celery, redis, or fastapi?",
        "how does your app work under the hood?",
    )
    for prompt in probing_prompts:
        res = customer.post("/api/v1/support/thread/message", json={"body": prompt})
        assert res.status_code == 200, res.text
        reply = res.json()["messages"][-1]["body"].lower()
        assert "can't share details about our backend infrastructure" in reply
        for term in forbidden:
            assert term not in reply

    safe_prompts = (
        "How do I get started?",
        "Which profile is best for Meta?",
        "How do tokens and refunds work?",
        "My render failed",
    )
    for prompt in safe_prompts:
        res = customer.post("/api/v1/support/thread/message", json={"body": prompt})
        assert res.status_code == 200, res.text
        reply = res.json()["messages"][-1]["body"].lower()
        assert "can't share details about our backend infrastructure" not in reply
        for term in forbidden:
            assert term not in reply


def test_admin_can_delete_selected_bot_all_bot_and_all_messages(admin):
    customer = _signed_in(address("delbot"))
    customer.post("/api/v1/support/thread/message", json={"body": "How do tokens and refunds work?"})
    customer.post("/api/v1/support/thread/message", json={"body": "My render failed"})
    esc = customer.post("/api/v1/support/thread/message", json={"body": "I want to talk to a real agent"})
    assert esc.status_code == 200
    tid = esc.json()["id"]

    sent = admin.post(f"/api/v1/admin/support/threads/{tid}/message", json={"body": "Agent checking now"})
    assert sent.status_code == 200

    # Non-admin receives 404 from require_admin.
    assert (
        customer.post(
            f"/api/v1/admin/support/threads/{tid}/messages/delete",
            json={"delete_all_bot": True},
        ).status_code
        == 404
    )

    detail = admin.get(f"/api/v1/admin/support/threads/{tid}").json()["thread"]
    bot_msgs = [m for m in detail["messages"] if m["sender_role"] == "bot"]
    assert len(bot_msgs) >= 3
    one_bot_id = bot_msgs[0]["id"]

    # 1) Delete a single selected bot message.
    r1 = admin.post(
        f"/api/v1/admin/support/threads/{tid}/messages/delete",
        json={"message_ids": [one_bot_id]},
    )
    assert r1.status_code == 200, r1.text
    ids_after_one = {m["id"] for m in r1.json()["thread"]["messages"]}
    assert one_bot_id not in ids_after_one
    cust_ids = {m["id"] for m in customer.get("/api/v1/support/thread").json()["messages"]}
    assert one_bot_id not in cust_ids

    # 2) Delete all remaining bot replies while keeping user & agent messages.
    r2 = admin.post(
        f"/api/v1/admin/support/threads/{tid}/messages/delete",
        json={"delete_all_bot": True},
    )
    assert r2.status_code == 200, r2.text
    roles_after_bot = [m["sender_role"] for m in r2.json()["thread"]["messages"]]
    assert "bot" not in roles_after_bot
    assert "user" in roles_after_bot and "agent" in roles_after_bot
    assert "bot" not in [m["sender_role"] for m in customer.get("/api/v1/support/thread").json()["messages"]]

    # 3) Delete all messages in the conversation cleanly.
    r3 = admin.post(
        f"/api/v1/admin/support/threads/{tid}/messages/delete",
        json={"delete_all": True},
    )
    assert r3.status_code == 200, r3.text
    assert r3.json()["thread"]["messages"] == []
    assert r3.json()["thread"]["bot_attempts"] == 0
    assert customer.get("/api/v1/support/thread").json()["messages"] == []
