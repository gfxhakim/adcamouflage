"""Approve / Reject buttons under Telegram payment alerts.

No request reaches Telegram: ``telegram_approve._call`` is replaced by a
recorder, and ``notify._dispatch`` by one that keeps the buttons.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import notify, telegram_approve
from app.config import settings
from app.main import app
from tests.test_volet import (  # noqa: F401 - fixtures
    STATUS_PATH,
    _balances,
    _checkout,
    _database,
    _load,
    _notification,
    _order,
    _reset_limiter,
    _signed_in,
    _volet,
    address,
    admin,
    volet_env,
)

OWNER = 5123456789
HOOK = telegram_approve.WEBHOOK_PATH


@pytest.fixture
def tg(monkeypatch, volet_env):
    """Telegram set up for a private chat with the owner; records what would be sent."""

    sent: list[dict] = []
    calls: list[tuple[str, dict]] = []
    notify.reset()
    monkeypatch.setattr(settings, "notify_telegram_bot_token", SecretStr("123:bot-token-placeholder"))
    monkeypatch.setattr(settings, "notify_telegram_chat_id", str(OWNER))
    monkeypatch.setattr(settings, "notify_events", [])
    monkeypatch.setattr(settings, "notify_dedupe_seconds", 0)
    monkeypatch.setattr(settings, "notify_telegram_buttons", True)
    monkeypatch.setattr(settings, "notify_telegram_approver_ids", [])
    monkeypatch.setattr(settings, "notify_telegram_webhook_secret", None)
    monkeypatch.setattr(
        notify,
        "_dispatch",
        lambda title, lines, priority, buttons=None: sent.append({"title": title, "lines": lines, "buttons": buttons}),
    )

    def fake_call(method, payload):
        calls.append((method, payload))
        if method == "getWebhookInfo":
            return {"ok": True, "result": {"url": telegram_approve.webhook_url()}}
        return {"ok": True, "result": True}

    monkeypatch.setattr(telegram_approve, "_call", fake_call)
    yield sent, calls
    notify.reset()


def _hook(secret: str | None = None) -> TestClient:
    return TestClient(
        app, headers={"x-telegram-bot-api-secret-token": secret or telegram_approve.webhook_secret()}
    )


def _press(data: str, *, presser: int = OWNER, chat: int = OWNER, secret: str | None = None):
    update = {
        "update_id": 1,
        "callback_query": {
            "id": "cb1",
            "from": {"id": presser},
            "message": {"message_id": 77, "chat": {"id": chat}, "text": "🛒 Checkout started"},
            "data": data,
        },
    }
    return _hook(secret).post(HOOK, json=update)


def _buttons(alert: dict) -> dict[str, str]:
    return {b["text"]: b["callback_data"] for row in alert["buttons"] for b in row}


def _open_order(tg, name: str) -> tuple[str, str, dict[str, str]]:
    sent, _ = tg
    email = address(name)
    order_id = _checkout(_signed_in(email), "starter", provider="volet")["order_id"]
    alert = [a for a in sent if "Checkout" in a["title"]][-1]
    return email, order_id, _buttons(alert)


def _confirm_buttons(calls) -> dict[str, str]:
    _method, payload = [c for c in calls if c[0] == "editMessageReplyMarkup"][-1]
    return {b["text"]: b["callback_data"] for row in payload["reply_markup"]["inline_keyboard"] for b in row}


def test_checkout_alert_has_approve_and_reject(tg):
    _, order_id, buttons = _open_order(tg, "tg-buttons")
    assert set(buttons) == {"✅ Approve", "❌ Reject"}
    assert all(order_id in data and len(data.encode()) <= 64 for data in buttons.values())


def test_no_buttons_when_switched_off(tg, monkeypatch):
    monkeypatch.setattr(settings, "notify_telegram_buttons", False)
    sent, _ = tg
    _checkout(_signed_in(address("tg-off")), "starter", provider="volet")
    assert sent[-1]["buttons"] is None
    # And the webhook does not exist.
    assert _hook("x").post(HOOK, json={}).status_code == 404


def test_approve_asks_then_activates_once(tg):
    _, calls = tg
    email, order_id, buttons = _open_order(tg, "tg-approve")

    first = _press(buttons["✅ Approve"])
    assert first.status_code == 200 and first.json()["method"] == "answerCallbackQuery"
    assert _order(order_id).status == "pending"  # only asked
    confirm = _confirm_buttons(calls)
    assert set(confirm) == {"✅ Yes, activate", "↩️ Back"}

    done = _press(confirm["✅ Yes, activate"])
    assert done.status_code == 200 and "Activated" in done.json()["text"]
    assert _order(order_id).status == "paid"
    assert _load(email).sub_plan == "starter"
    assert _balances(email) == (1500, 0)
    edit = [c for c in calls if c[0] == "editMessageText"][-1][1]
    assert "Activated" in edit["text"] and edit["reply_markup"] == {"inline_keyboard": []}

    # A second press (or the provider confirming later) credits nothing more.
    again = _press(confirm["✅ Yes, activate"])
    assert "Already active" in again.json()["text"]
    assert _volet().post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    assert _balances(email) == (1500, 0)


def test_approval_sends_the_paid_alert_and_meta_purchase(tg, monkeypatch):
    sent, calls = tg
    purchases = []
    from app import meta_capi

    monkeypatch.setattr(meta_capi, "purchase", lambda order, email, currency: purchases.append(order.id))
    _, order_id, buttons = _open_order(tg, "tg-paid-alert")
    _press(buttons["✅ Approve"])
    _press(_confirm_buttons(calls)["✅ Yes, activate"])
    assert purchases == [order_id]
    paid = [a for a in sent if "PAID" in a["title"]]
    assert paid and "Confirmed by: approved in Telegram" in paid[-1]["lines"]
    assert paid[-1]["buttons"] is None


def test_reject_voids_a_pending_order(tg):
    _, calls = tg
    email, order_id, buttons = _open_order(tg, "tg-reject")
    _press(buttons["❌ Reject"])
    confirm = _confirm_buttons(calls)
    assert set(confirm) == {"❌ Yes, reject", "↩️ Back"}
    response = _press(confirm["❌ Yes, reject"])
    assert "Rejected" in response.json()["text"]
    assert _order(order_id).status == "invalid"
    assert _balances(email) == (0, 0)


def test_back_restores_the_first_buttons(tg):
    _, calls = tg
    _, order_id, buttons = _open_order(tg, "tg-back")
    _press(buttons["✅ Approve"])
    _press(_confirm_buttons(calls)["↩️ Back"])
    assert set(_confirm_buttons(calls)) == {"✅ Approve", "❌ Reject"}
    assert _order(order_id).status == "pending"


def test_wrong_secret_is_refused(tg):
    _, _order_id, buttons = _open_order(tg, "tg-secret")
    assert _press(buttons["✅ Approve"], secret="wrong").status_code == 401
    no_header = TestClient(app).post(HOOK, json={})
    assert no_header.status_code == 401


def test_someone_else_cannot_approve(tg):
    _, calls = tg
    _, order_id, buttons = _open_order(tg, "tg-stranger")
    _press(buttons["✅ Approve"])
    yes = _confirm_buttons(calls)["✅ Yes, activate"]
    # Another person, or the right person in another chat.
    assert _press(yes, presser=999).json()["text"] == "Not allowed."
    assert _press(yes, chat=999).json()["text"] == "Not allowed."
    assert _order(order_id).status == "pending"


def test_forged_button_data_is_refused(tg):
    _, order_id, _ = _open_order(tg, "tg-forged")
    forged = f"A:{order_id}:{'0' * telegram_approve.SIG_LEN}"
    assert "not valid" in _press(forged).json()["text"]
    # A real signature for one action does not work for another.
    real_ask = telegram_approve._data("a", order_id)
    swapped = "A" + real_ask[1:]
    assert "not valid" in _press(swapped).json()["text"]
    assert _order(order_id).status == "pending"


def test_group_chat_needs_listed_approvers(tg, monkeypatch):
    monkeypatch.setattr(settings, "notify_telegram_chat_id", "-100200300")
    assert telegram_approve.approvers() == set()
    monkeypatch.setattr(settings, "notify_telegram_approver_ids", [str(OWNER)])
    assert telegram_approve.approvers() == {str(OWNER)}


def test_mismatched_payment_alert_has_buttons(tg):
    sent, _ = tg
    client = _signed_in(address("tg-review"))
    order_id = _checkout(client, "starter", provider="volet")["order_id"]
    _volet().post(STATUS_PATH, data=_notification(order_id, amount="1.00"))
    review = [a for a in sent if "needs a look" in a["title"]][-1]
    assert set(_buttons(review)) == {"✅ Approve", "❌ Reject"}


def test_plain_messages_are_ignored(tg):
    response = _hook().post(HOOK, json={"update_id": 2, "message": {"text": "hi", "chat": {"id": OWNER}}})
    assert response.status_code == 200 and response.json() == {}


def test_admin_connect_sets_the_webhook(tg, admin):
    _, calls = tg
    response = admin.post("/api/v1/admin/notify/telegram/connect")
    assert response.status_code == 200, response.text
    assert response.json()["telegram_buttons"] == "connected"
    _method, payload = [c for c in calls if c[0] == "setWebhook"][-1]
    assert payload["url"] == telegram_approve.webhook_url() and payload["url"].endswith(HOOK)
    assert payload["secret_token"] == telegram_approve.webhook_secret()
    assert payload["allowed_updates"] == ["callback_query"]
    assert admin.get("/api/v1/admin/notify").json()["telegram_buttons"] == "connected"


def test_connect_needs_an_https_site_address(tg, admin, monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    assert admin.post("/api/v1/admin/notify/telegram/connect").status_code == 409


def test_connect_is_admin_only(tg):
    client = _signed_in(address("tg-nobody"))
    assert client.post("/api/v1/admin/notify/telegram/connect").status_code == 404
