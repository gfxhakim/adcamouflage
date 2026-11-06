"""Support tickets reach the owner's phone through the same Telegram / ntfy alerts."""

from __future__ import annotations

import pytest
from pydantic import SecretStr

from app import notify
from app.config import settings
from tests.test_support import (  # noqa: F401 - fixtures
    _age_thread,
    _admin_ticket,
    _database,
    _reset_limiter,
    _signed_in,
    address,
    admin,
)

MESSAGE = "/api/v1/support/thread/message"


@pytest.fixture
def alerts(monkeypatch):
    sent: list[dict] = []
    notify.reset()
    monkeypatch.setattr(settings, "notify_telegram_bot_token", SecretStr("123:bot-token-placeholder"))
    monkeypatch.setattr(settings, "notify_telegram_chat_id", "42")
    monkeypatch.setattr(settings, "notify_events", [])
    monkeypatch.setattr(settings, "public_url", "https://blucloack.example")
    monkeypatch.setattr(
        notify,
        "_dispatch",
        lambda title, lines, priority, buttons=None: sent.append(
            {"title": title, "lines": lines, "priority": priority, "buttons": buttons}
        ),
    )
    yield sent
    notify.reset()


def _ticket_alerts(sent: list[dict]) -> list[dict]:
    return [a for a in sent if a["title"].startswith("🆘")]


def test_asking_for_agent_sends_one_ticket_alert(alerts, admin):
    email = address("phone-asker")
    customer = _signed_in(email)
    customer.post(MESSAGE, json={"body": "my export is stuck at 90%"})
    r = customer.post(MESSAGE, json={"body": "I want to talk to a real agent"})
    tid = r.json()["id"]

    found = _ticket_alerts(alerts)
    assert len(found) == 1
    alert = found[0]
    text = "\n".join(alert["lines"])
    assert f"#{tid}" in alert["title"]
    assert email in text
    assert "First message: my export is stuck at 90%" in text
    assert "Latest: I want to talk to a real agent" in text
    assert "https://blucloack.example/admin#support" in text
    assert alert["priority"] == "high"
    assert alert["buttons"][0][0]["url"] == "https://blucloack.example/admin#support"


def test_contact_agent_button_sends_ticket_alert(alerts, admin):
    customer = _signed_in(address("phone-button"))
    for i in range(5):
        customer.post(MESSAGE, json={"body": f"render failed {i}"})
    customer.post("/api/v1/support/thread/escalate", json={"note": "please help"})
    found = _ticket_alerts(alerts)
    assert len(found) == 1
    assert "Why: pressed Contact Live Agent" in found[0]["lines"]


def test_waited_ticket_sends_alert(alerts, admin):
    customer = _signed_in(address("phone-stuck"))
    for i in range(5):
        customer.post(MESSAGE, json={"body": f"upload broken {i}"})
    tid = customer.get("/api/v1/support/thread").json()["id"]
    assert _ticket_alerts(alerts) == []
    _age_thread(tid, 31)
    _admin_ticket(admin, tid)
    found = _ticket_alerts(alerts)
    assert len(found) == 1 and "Why: waited 30 min in the bot" in found[0]["lines"]


def test_customer_reply_in_open_ticket_alerts_once_per_window(alerts, admin):
    customer = _signed_in(address("phone-reply"))
    customer.post(MESSAGE, json={"body": "I need a human"})
    customer.post(MESSAGE, json={"body": "here is a screenshot", "attachment_name": "shot.png"})
    customer.post(MESSAGE, json={"body": "hello?"})
    replies = [a for a in alerts if a["title"].startswith("💬")]
    assert len(replies) == 1  # the second one is deduped
    assert "Message: here is a screenshot 📎 shot.png" in replies[0]["lines"]


def test_bot_chat_sends_nothing(alerts, admin):
    customer = _signed_in(address("phone-casual"))
    customer.post(MESSAGE, json={"body": "how do tokens work"})
    assert alerts == []


def test_support_events_can_be_turned_off(alerts, admin, monkeypatch):
    monkeypatch.setattr(settings, "notify_events", ["paid"])
    customer = _signed_in(address("phone-off"))
    customer.post(MESSAGE, json={"body": "I want to talk to a real agent"})
    customer.post(MESSAGE, json={"body": "still there?"})
    assert alerts == []


def test_no_button_without_https_public_url(alerts, admin, monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    customer = _signed_in(address("phone-nourl"))
    customer.post(MESSAGE, json={"body": "I want to talk to a real agent"})
    found = _ticket_alerts(alerts)
    assert len(found) == 1
    assert found[0]["buttons"] is None
    assert "Answer in Admin > Support" in found[0]["lines"]
