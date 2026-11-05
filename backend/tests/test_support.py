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
