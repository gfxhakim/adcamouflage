"""Phone alerts: which events send one, with what, and that they never block billing.

Nothing reaches Telegram or ntfy: ``notify._dispatch`` is replaced by a
recorder, and the HTTP layer by ``httpx.MockTransport`` where the real
sending code is exercised.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import notify
from app.config import settings
from app.main import app
from tests.test_volet import (  # noqa: F401 - fixtures
    STATUS_PATH,
    _checkout,
    _database,
    _notification,
    _reset_limiter,
    _signed_in,
    _volet,
    address,
    admin,
    volet_env,
)

PLAN_CLICK = "/api/v1/notify/plan-click"


@pytest.fixture
def alerts(monkeypatch):
    sent: list[tuple[str, list[str], str]] = []
    notify.reset()
    monkeypatch.setattr(settings, "notify_telegram_bot_token", SecretStr("123:bot-token-placeholder"))
    monkeypatch.setattr(settings, "notify_telegram_chat_id", "42")
    monkeypatch.setattr(settings, "notify_events", [])
    monkeypatch.setattr(notify, "_dispatch", lambda title, lines, priority, buttons=None: sent.append((title, lines, priority)))
    yield sent
    notify.reset()


def test_off_by_default(monkeypatch):
    monkeypatch.setattr(settings, "notify_telegram_bot_token", None)
    monkeypatch.setattr(settings, "notify_ntfy_topic", "")
    called = []
    monkeypatch.setattr(notify, "_dispatch", lambda *a: called.append(a))
    assert not notify.enabled()
    assert TestClient(app).post(PLAN_CLICK, json={"plan_id": "pro"}).status_code == 204
    assert called == []


def test_landing_plan_click_sends_one_alert_and_dedupes(alerts):
    client = TestClient(app, headers={"x-forwarded-for": "198.51.100.9"})
    assert client.post(PLAN_CLICK, json={"plan_id": "pro"}).status_code == 204
    assert client.post(PLAN_CLICK, json={"plan_id": "pro"}).status_code == 204
    assert len(alerts) == 1
    title, lines, _ = alerts[0]
    assert "Plan click: Pro" in title
    assert any("visitor" in line for line in lines)
    assert any("198.51.100.9" in line for line in lines)


def test_unknown_plan_click_is_ignored(alerts):
    assert TestClient(app).post(PLAN_CLICK, json={"plan_id": "nope"}).status_code == 204
    assert alerts == []


def test_plan_clicks_are_rate_limited_per_address(alerts, monkeypatch):
    monkeypatch.setattr(settings, "notify_dedupe_seconds", 0)
    client = TestClient(app, headers={"x-forwarded-for": "198.51.100.77"})
    for _ in range(notify.CLICKS_PER_ADDRESS + 4):
        client.post(PLAN_CLICK, json={"plan_id": "max"})
    assert len(alerts) == notify.CLICKS_PER_ADDRESS


def test_event_filter(alerts, monkeypatch):
    monkeypatch.setattr(settings, "notify_events", ["paid"])
    TestClient(app).post(PLAN_CLICK, json={"plan_id": "pro"})
    assert alerts == []


def test_checkout_and_payment_send_alerts(alerts, volet_env):
    email = address("notify-buyer")
    client = _signed_in(email)
    order_id = _checkout(client, "starter", provider="volet")["order_id"]

    titles = [title for title, _, _ in alerts]
    assert any("Checkout started: Starter subscription" in t for t in titles)
    lines = alerts[-1][1]
    assert f"Customer: {email}" in lines
    assert any(line.startswith("Order: #") for line in lines)

    # Pressing Subscribe again reuses the order and stays quiet (deduped).
    _checkout(client, "starter", provider="volet")
    assert len(alerts) == 1

    assert _volet().post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    paid = [a for a in alerts if "PAID" in a[0]]
    assert len(paid) == 1
    assert "$37.5" in paid[0][0] and paid[0][2] == "high"
    assert "Confirmed by: Volet" in paid[0][1]

    # A repeated notification credits nothing and sends nothing.
    _volet().post(STATUS_PATH, data=_notification(order_id))
    assert len([a for a in alerts if "PAID" in a[0]]) == 1


def test_mismatched_payment_asks_for_a_look(alerts, volet_env):
    client = _signed_in(address("notify-mismatch"))
    order_id = _checkout(client, "starter", provider="volet")["order_id"]
    _volet().post(STATUS_PATH, data=_notification(order_id, amount="1.00"))
    assert any("needs a look" in title for title, _, _ in alerts)


def test_a_broken_channel_never_blocks_checkout(volet_env, monkeypatch):
    notify.reset()
    monkeypatch.setattr(settings, "notify_telegram_bot_token", SecretStr("123:bot-token-placeholder"))
    monkeypatch.setattr(settings, "notify_telegram_chat_id", "42")

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(notify, "_dispatch", explode)
    client = _signed_in(address("notify-broken"))
    assert _checkout(client, "pro", provider="volet")["order_id"]
    notify.reset()


def test_telegram_and_ntfy_payloads(monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx, "post", lambda url, **kw: httpx.Client(transport=transport).post(url, **kw)
    )
    monkeypatch.setattr(settings, "notify_telegram_bot_token", SecretStr("123:abc"))
    monkeypatch.setattr(settings, "notify_telegram_chat_id", "42")
    monkeypatch.setattr(settings, "notify_ntfy_topic", "my-topic")
    monkeypatch.setattr(settings, "notify_ntfy_url", "https://ntfy.sh")
    results = notify.deliver("✅ PAID $89: Pro <b>", ["Customer: a@b.c"], "high")
    assert results == {"telegram": "ok", "ntfy": "ok"}

    tg = json.loads(requests[0].content)
    assert str(requests[0].url) == "https://api.telegram.org/bot123:abc/sendMessage"
    assert tg["chat_id"] == "42" and "&lt;b&gt;" in tg["text"]
    nt = json.loads(requests[1].content)
    assert str(requests[1].url) == "https://ntfy.sh"
    assert nt == {"topic": "my-topic", "title": "✅ PAID $89: Pro <b>", "message": "Customer: a@b.c", "priority": 4}


def test_admin_test_button(admin, monkeypatch):
    monkeypatch.setattr(settings, "notify_telegram_bot_token", None)
    monkeypatch.setattr(settings, "notify_ntfy_topic", "")
    assert admin.post("/api/v1/admin/notify/test").status_code == 409
    assert admin.get("/api/v1/admin/notify").json()["channels"] == []

    monkeypatch.setattr(settings, "notify_ntfy_topic", "my-topic")
    monkeypatch.setattr(notify, "deliver", lambda title, lines, priority="default": {"ntfy": "ok"})
    response = admin.post("/api/v1/admin/notify/test")
    assert response.status_code == 200 and response.json() == {"results": {"ntfy": "ok"}}


def test_admin_routes_need_an_admin():
    client = _signed_in(address("notify-nobody"))
    assert client.post("/api/v1/admin/notify/test").status_code == 404
