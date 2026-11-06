"""Meta Pixel + Conversions API: which events the server sends, with what, and when.

Nothing reaches Meta: ``meta_capi._post`` is replaced by a recorder and the
background thread by a direct call.
"""

from __future__ import annotations

import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import meta_capi
from app.config import settings
from app.main import app
from tests.test_volet import (  # noqa: F401 - fixtures
    STATUS_PATH,
    _checkout,
    _database,
    _notification,
    _order,
    _reset_limiter,
    _volet,
    address,
    volet_env,
)

PASSWORD = "correct-horse-battery"


@pytest.fixture
def sent(monkeypatch):
    events: list[dict] = []
    monkeypatch.setattr(settings, "meta_pixel_id", "1234567890")
    monkeypatch.setattr(settings, "meta_capi_token", SecretStr("capi-token-placeholder"))

    def record(event, *, consent):
        if consent and meta_capi.enabled():
            events.append(event)

    monkeypatch.setattr(meta_capi, "send", record)

    # The Purchase goes through its own retrying sender; run it inline.
    def purchase_now(order_id, event):
        events.append(event)
        meta_capi._record_purchase(order_id, "sent")

    class InlineThread:
        def __init__(self, target, args, **_kw):
            self.target, self.args = target, args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr(meta_capi, "_send_purchase", purchase_now)
    monkeypatch.setattr(meta_capi.threading, "Thread", InlineThread)
    return events


def _client(consent: bool) -> TestClient:
    client = TestClient(app, headers={"user-agent": "pytest-browser", "x-forwarded-for": "198.51.100.7, 10.0.0.1"})
    if consent:
        client.cookies.set(meta_capi.CONSENT_COOKIE, meta_capi.GRANTED)
        client.cookies.set("_fbp", "fb.1.1700000000.111")
        client.cookies.set("_fbc", "fb.1.1700000000.AbCdEf")
    return client


def _register(client: TestClient, email: str) -> dict:
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


def test_config_exposes_only_the_pixel_id(sent):
    body = TestClient(app).get("/api/v1/meta/config").json()
    assert body == {"pixel_id": "1234567890"}


def test_signup_sends_complete_registration_with_hashed_email(sent):
    email = address("meta-signup")
    profile = _register(_client(consent=True), email)
    [event] = [e for e in sent if e["event_name"] == "CompleteRegistration"]
    assert event["event_id"] == f"signup-{profile['id']}"
    assert event["action_source"] == "website"
    user = event["user_data"]
    assert user["em"] == [hashlib.sha256(email.lower().encode()).hexdigest()]
    assert user["client_ip_address"] == "198.51.100.7"
    assert user["client_user_agent"] == "pytest-browser"
    assert user["fbp"] == "fb.1.1700000000.111" and user["fbc"] == "fb.1.1700000000.AbCdEf"
    assert email not in json.dumps(event)


def test_nothing_is_sent_without_cookie_consent(sent, volet_env):
    client = _client(consent=False)
    _register(client, address("meta-noconsent"))
    order_id = _checkout(client, "starter")["order_id"]
    _volet().post(STATUS_PATH, data=_notification(order_id))
    assert sent == []


def test_purchase_is_sent_once_and_only_when_the_payment_is_confirmed(sent, volet_env):
    client = _client(consent=True)
    _register(client, address("meta-buy"))
    order_id = _checkout(client, "starter")["order_id"]

    checkout = [e for e in sent if e["event_name"] == "InitiateCheckout"]
    assert len(checkout) == 1 and checkout[0]["event_id"] == f"checkout-{order_id}"
    assert checkout[0]["custom_data"]["value"] == 37.5
    assert not [e for e in sent if e["event_name"] == "Purchase"]
    assert json.loads(_order(order_id).tracking)["consent"] == meta_capi.GRANTED

    # A pending notification is not a sale.
    _volet().post(STATUS_PATH, data=_notification(order_id, state="PENDING"))
    assert not [e for e in sent if e["event_name"] == "Purchase"]

    fields = _notification(order_id)
    _volet().post(STATUS_PATH, data=fields)
    _volet().post(STATUS_PATH, data=fields)  # delivered twice
    purchases = [e for e in sent if e["event_name"] == "Purchase"]
    assert len(purchases) == 1
    purchase = purchases[0]
    assert purchase["event_id"] == f"purchase-{order_id}"
    assert purchase["custom_data"]["value"] == 37.5
    assert purchase["custom_data"]["currency"]
    # Matched to the buyer's browser, not to Volet's server that sent the notification.
    assert purchase["user_data"]["client_ip_address"] == "198.51.100.7"
    assert purchase["user_data"]["fbp"] == "fb.1.1700000000.111"


def test_browser_relay_accepts_only_page_events(sent):
    client = _client(consent=True)
    ok = client.post("/api/v1/meta/event", json={"event_name": "PageView", "event_id": "pv-abcdef123", "url": "https://x.test/"})
    assert ok.status_code == 202 and ok.json() == {"sent": True}
    refused = client.post("/api/v1/meta/event", json={"event_name": "Purchase", "event_id": "purchase-abcdef12"})
    assert refused.json() == {"sent": False}
    assert [e["event_name"] for e in sent] == ["PageView"]


def test_disabled_without_token(monkeypatch):
    monkeypatch.setattr(settings, "meta_pixel_id", "1234567890")
    monkeypatch.setattr(settings, "meta_capi_token", None)
    assert meta_capi.enabled() is False


def test_checkout_also_sends_add_payment_info_and_keeps_event_ids(sent, volet_env):
    client = _client(consent=True)
    _register(client, address("meta-payinfo"))
    order_id = _checkout(client, "starter")["order_id"]
    [payinfo] = [e for e in sent if e["event_name"] == "AddPaymentInfo"]
    assert payinfo["event_id"] == f"payinfo-{order_id}"
    assert payinfo["custom_data"]["payment_method"] == "volet"
    tracking = json.loads(_order(order_id).tracking)
    assert tracking["purchase_event_id"] == f"purchase-{order_id}"
    assert tracking["fbc"] == "fb.1.1700000000.AbCdEf"
    assert tracking["captured_at"] > 0


def test_delayed_purchase_uses_checkout_browser_data_and_records_outcome(sent, volet_env):
    client = _client(consent=True)
    _register(client, address("meta-late"))
    order_id = _checkout(client, "starter")["order_id"]
    # Confirmed later from Volet's server: no cookies, different IP.
    _volet().post(STATUS_PATH, data=_notification(order_id))
    [purchase] = [e for e in sent if e["event_name"] == "Purchase"]
    assert purchase["user_data"]["fbc"] == "fb.1.1700000000.AbCdEf"
    assert purchase["user_data"]["client_user_agent"] == "pytest-browser"
    assert purchase["custom_data"]["order_id"] == order_id
    tracking = json.loads(_order(order_id).tracking)
    assert tracking["purchase"] == "sent"
    assert meta_capi.purchase_status(_order(order_id)) == "sent"


def test_reused_order_picks_up_consent_given_later(sent, volet_env):
    client = _client(consent=False)
    _register(client, address("meta-later-consent"))
    order_id = _checkout(client, "starter")["order_id"]
    assert sent == []
    client.cookies.set(meta_capi.CONSENT_COOKIE, meta_capi.GRANTED)
    client.cookies.set("_fbc", "fb.1.1700000000.Later")
    assert _checkout(client, "starter")["order_id"] == order_id  # same pending order
    _volet().post(STATUS_PATH, data=_notification(order_id))
    [purchase] = [e for e in sent if e["event_name"] == "Purchase"]
    assert purchase["user_data"]["fbc"] == "fb.1.1700000000.Later"


def test_no_consent_is_recorded_and_nothing_sent(sent, volet_env):
    client = _client(consent=False)
    _register(client, address("meta-noconsent-status"))
    order_id = _checkout(client, "starter")["order_id"]
    _volet().post(STATUS_PATH, data=_notification(order_id))
    assert sent == []
    assert meta_capi.purchase_status(_order(order_id)) == "no consent"


def test_purchase_is_retried_then_marked_failed(monkeypatch, volet_env):
    monkeypatch.setattr(settings, "meta_pixel_id", "1234567890")
    monkeypatch.setattr(settings, "meta_capi_token", SecretStr("capi-token-placeholder"))
    monkeypatch.setattr(meta_capi, "PURCHASE_RETRY_DELAYS", (0, 0))
    calls: list[int] = []
    outcomes: list[tuple[str, str]] = []
    monkeypatch.setattr(meta_capi, "_post", lambda events: calls.append(1) or False)
    monkeypatch.setattr(meta_capi, "_record_purchase", lambda oid, outcome: outcomes.append((oid, outcome)))
    meta_capi._send_purchase("order-x", {"event_name": "Purchase", "event_id": "purchase-order-x"})
    assert len(calls) == 3
    assert outcomes == [("order-x", "failed")]
