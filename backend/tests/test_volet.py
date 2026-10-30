"""Volet Hosted Checkout: form signing, the pay page and the status notification.

Volet has no sandbox, so nothing here reaches the network: the form is read
back from the pay page's HTML, and the notification is posted by hand with
a hash made from the placeholder password, from one of Volet's documented
sender addresses (``_volet()``) unless a test is about the sender check.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import btcpay, volet
from app.app_settings import currency
from app.auth_routes import login_limiter
from app.config import settings
from app.db import ActivityEvent, Order, User, get_session_factory, init_db
from app.main import app
from app.tokens import activate_period, balances, get_token_plans

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"
SCI_EMAIL = "merchant@example.test"
SCI_NAME = "shop"
SCI_SECRET = "sci-password-placeholder"
PUBLIC_URL = "https://app.example.test"
CHECKOUT = "/api/v1/billing/checkout"
STATUS_PATH = "/api/v1/billing/volet/status"
PAID_STARTER = "Paid $37.5 for Starter period (Volet)"
# One of the three sender addresses in Volet's SCI document (the app's default allow-list).
VOLET_IP = "50.7.115.5"


def address(name: str) -> str:
    return f"volet-{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


@pytest.fixture
def volet_env(monkeypatch):
    """Volet 'configured' with placeholder values and BTCPay left unset."""

    monkeypatch.setattr(settings, "btcpay_url", "")
    monkeypatch.setattr(settings, "volet_account_email", SCI_EMAIL)
    monkeypatch.setattr(settings, "volet_sci_name", SCI_NAME)
    monkeypatch.setattr(settings, "volet_sci_secret", SecretStr(SCI_SECRET))
    monkeypatch.setattr(settings, "public_url", PUBLIC_URL)
    yield


@pytest.fixture
def both_env(volet_env, monkeypatch):
    """BTCPay placeholders as well, so both providers are on offer."""

    monkeypatch.setattr(settings, "btcpay_url", "https://pay.example.test/")
    monkeypatch.setattr(settings, "btcpay_store_id", "store123")
    monkeypatch.setattr(settings, "btcpay_api_key", SecretStr("api-key-placeholder"))
    monkeypatch.setattr(settings, "btcpay_webhook_secret", SecretStr("webhook-secret-placeholder"))
    yield


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _signed_in(email: str) -> TestClient:
    """A signed-in account on token billing (the default for new sign-ups)."""

    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _volet() -> TestClient:
    """An anonymous client whose requests arrive, as far as the app can tell, from Volet.

    The proxy in front of the service writes the sender as the last entry
    of X-Forwarded-For; here the header is set by hand.
    """

    return TestClient(app, headers={"x-forwarded-for": VOLET_IP})


def _session():
    return get_session_factory()()


def _load(email: str) -> User:
    with _session() as db:
        return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def _with_user(email: str, fn):
    """Run ``fn(db, user)`` in a session and commit."""

    with _session() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        result = fn(db, user)
        db.commit()
        return result


def _grant(email: str, plan_id: str, **kwargs):
    return _with_user(email, lambda db, user: activate_period(db, user, get_token_plans(db)[plan_id], **kwargs))


def _balances(email: str) -> tuple[int, int]:
    return _with_user(email, lambda db, user: balances(db, user))


def _activity(email: str, kind: str = "payment") -> list[str]:
    """The detail lines of the user's activity of one kind, oldest first."""

    with _session() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        rows = db.execute(
            select(ActivityEvent.detail)
            .where(ActivityEvent.user_id == user.id, ActivityEvent.kind == kind)
            .order_by(ActivityEvent.id)
        )
        return list(rows.scalars().all())


def _currency() -> str:
    with _session() as db:
        return currency(db)


def _order(order_id: str) -> Order:
    with _session() as db:
        return db.get(Order, order_id)


def _checkout(client: TestClient, plan_id: str = "starter", provider: str | None = None) -> dict:
    body = {"kind": "subscription", "plan_id": plan_id}
    if provider is not None:
        body["provider"] = provider
    response = client.post(CHECKOUT, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _form_fields(page: str) -> dict[str, str]:
    """The hidden ``ac_*`` inputs of the pay page, unescaped."""

    return {name: html.unescape(value) for name, value in re.findall(r'name="(ac_[a-z_]+)" value="([^"]*)"', page)}


def _notification(
    order_id: str,
    *,
    amount: str = "37.50",
    merchant_currency: str | None = None,
    state: str = "COMPLETED",
    transfer: str | None = None,
    sci_name: str = SCI_NAME,
    secret: str = SCI_SECRET,
) -> dict[str, str]:
    """A status notification as Volet would send it, hashed with ``secret``."""

    code = merchant_currency or _currency()
    fields = {
        "ac_src_wallet": "U111111111111",
        "ac_dest_wallet": "U222222222222",
        "ac_amount": amount,
        "ac_merchant_amount": amount,
        "ac_merchant_currency": code,
        "ac_fee": "0.00",
        "ac_buyer_amount_without_commission": amount,
        "ac_buyer_amount_with_commission": amount,
        "ac_buyer_currency": code,
        "ac_transfer": transfer or f"tx-{order_id[:8]}",
        "ac_sci_name": sci_name,
        "ac_start_date": "2026-10-30 12:00:00",
        "ac_order_id": order_id,
        "ac_ps": "VOLET",
        "ac_transaction_status": state,
        "ac_buyer_email": "buyer@example.test",
        "ac_buyer_verified": "true",
        "ac_comments": "Starter period",
    }
    fields["ac_hash"] = volet.status_hash(fields, secret)
    return fields


def _mock_btcpay(monkeypatch, handler):
    monkeypatch.setattr(btcpay, "_transport", httpx.MockTransport(handler))


# --------------------------------------------------------------------------
# signing
# --------------------------------------------------------------------------


def test_sign_payment_follows_the_documented_formula():
    expected = hashlib.sha256(b"m@x.com:shop:37.50:USD:pw:order1").hexdigest()
    assert volet.sign_payment("m@x.com", "shop", "37.50", "USD", "order1", "pw") == expected


def test_status_hash_follows_the_documented_formula():
    fields = {
        "ac_transfer": "t1",
        "ac_start_date": "2026-10-30 12:00:00",
        "ac_sci_name": "shop",
        "ac_src_wallet": "U123",
        "ac_dest_wallet": "U456",
        "ac_order_id": "order1",
        "ac_amount": "37.50",
        "ac_merchant_currency": "USD",
        "ac_buyer_email": "not@hashed.test",  # extra fields do not take part
    }
    expected = hashlib.sha256(b"t1:2026-10-30 12:00:00:shop:U123:U456:order1:37.50:USD:pw").hexdigest()
    assert volet.status_hash(fields, "pw") == expected
    # A field Volet left out hashes as empty rather than failing.
    assert volet.status_hash({"ac_transfer": "t1"}, "pw") == hashlib.sha256(b"t1" + b":" * 8 + b"pw").hexdigest()


def test_verify_status_unit():
    fields = {
        "ac_transfer": "t1",
        "ac_start_date": "2026-10-30 12:00:00",
        "ac_sci_name": "shop",
        "ac_src_wallet": "U123",
        "ac_dest_wallet": "U456",
        "ac_order_id": "order1",
        "ac_amount": "37.50",
        "ac_merchant_currency": "USD",
    }
    fields["ac_hash"] = volet.status_hash(fields, "pw")
    assert volet.verify_status(fields, "pw") is True
    assert volet.verify_status({**fields, "ac_hash": fields["ac_hash"].upper()}, "pw") is True
    assert volet.verify_status({**fields, "ac_amount": "38.50"}, "pw") is False
    assert volet.verify_status(fields, "other") is False
    assert volet.verify_status(fields, "") is False
    assert volet.verify_status({k: v for k, v in fields.items() if k != "ac_hash"}, "pw") is False


# --------------------------------------------------------------------------
# checkout and the pay page
# --------------------------------------------------------------------------


def test_checkout_with_only_volet_serves_a_signed_pay_page(volet_env):
    email = address("checkout")
    client = _signed_in(email)
    body = _checkout(client, "starter")
    order_id = body["order_id"]
    assert body["provider"] == "volet" and body["amount"] == 37.5 and body["tokens"] == 1500
    assert body["checkout_url"] == f"/api/v1/billing/orders/{order_id}/pay"
    assert client.get("/api/v1/auth/subscription").json()["payment_providers"] == [{"id": "volet", "label": "Volet"}]

    page = client.get(body["checkout_url"])
    assert page.status_code == 200, page.text
    assert page.headers["content-type"].startswith("text/html")
    assert page.headers["cache-control"] == "no-store"
    assert f'<form method="POST" action="{settings.volet_sci_url}">' in page.text
    assert "Continue to Volet" in page.text and "document.forms[0].submit()" in page.text
    assert "37.50" in page.text and "Starter" in page.text

    code = _currency().upper()
    fields = _form_fields(page.text)
    assert fields["ac_account_email"] == SCI_EMAIL and fields["ac_sci_name"] == SCI_NAME
    assert fields["ac_amount"] == "37.50" and fields["ac_currency"] == code
    assert fields["ac_order_id"] == order_id
    signed = f"{SCI_EMAIL}:{SCI_NAME}:37.50:{code}:{SCI_SECRET}:{order_id}".encode("utf-8")
    assert fields["ac_sign"] == hashlib.sha256(signed).hexdigest()
    assert fields["ac_status_url"] == f"{PUBLIC_URL}/api/v1/billing/volet/status"
    assert fields["ac_status_url_method"] == "POST"
    assert fields["ac_success_url"] == f"{PUBLIC_URL}/app/plan?order={order_id}"
    assert fields["ac_fail_url"] == f"{PUBLIC_URL}/app/plan?order={order_id}&cancelled=1"
    assert fields["ac_success_url_method"] == "GET" and fields["ac_fail_url_method"] == "GET"
    assert fields["ac_client_lang"] == "en" and "Starter period" in fields["ac_comments"]

    # Nothing is credited until Volet says so, and the page is the buyer's alone.
    assert _balances(email) == (0, 0)
    order = client.get(f"/api/v1/billing/orders/{order_id}").json()
    assert order["status"] == "pending" and order["provider"] == "volet"
    assert _signed_in(address("nosy")).get(body["checkout_url"]).status_code == 404
    assert client.get("/api/v1/billing/orders/nope/pay").status_code == 404

    # Once paid, the page is gone.
    assert _volet().post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    assert client.get(body["checkout_url"]).status_code == 409


def test_pay_page_refuses_a_site_address_too_long_for_volet(volet_env, monkeypatch):
    client = _signed_in(address("long-url"))
    body = _checkout(client, "starter")
    monkeypatch.setattr(settings, "public_url", "https://" + "a" * 80 + ".example.test")
    response = client.get(body["checkout_url"])
    assert response.status_code == 503 and "ADCAM_PUBLIC_URL" in response.json()["detail"]
    # The order is untouched; a shorter address brings the page back.
    monkeypatch.setattr(settings, "public_url", PUBLIC_URL)
    assert client.get(body["checkout_url"]).status_code == 200


def test_pay_page_falls_back_to_the_browsers_origin(volet_env, monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    client = _signed_in(address("referer"))
    body = _checkout(client, "starter")
    page = client.get(body["checkout_url"], headers={"referer": "https://site.example.test/app/plan"})
    fields = _form_fields(page.text)
    assert fields["ac_success_url"] == f"https://site.example.test/app/plan?order={body['order_id']}"
    assert fields["ac_status_url"] == "https://site.example.test/api/v1/billing/volet/status"


def test_pay_page_refuses_to_run_without_a_site_address(volet_env, monkeypatch):
    """No ADCAM_PUBLIC_URL and no Referer (a pasted link) would send Volet bare paths it cannot call back."""

    monkeypatch.setattr(settings, "public_url", "")
    email = address("no-base")
    client = _signed_in(email)
    body = _checkout(client, "starter")
    response = client.get(body["checkout_url"])
    assert response.status_code == 503, response.text
    assert "ADCAM_PUBLIC_URL" in response.json()["detail"]
    assert "ac_status_url" not in response.text
    assert _balances(email) == (0, 0)
    assert client.get(f"/api/v1/billing/orders/{body['order_id']}").json()["status"] == "pending"
    # The page is back as soon as a site address is known, from the browser or the setting.
    page = client.get(body["checkout_url"], headers={"origin": "https://site.example.test"})
    assert page.status_code == 200 and _form_fields(page.text)["ac_status_url"].startswith("https://site.example.test/")
    monkeypatch.setattr(settings, "public_url", PUBLIC_URL)
    assert client.get(body["checkout_url"]).status_code == 200


def test_payment_fields_insist_on_absolute_links(volet_env):
    order = Order(id="a" * 32, amount_usd=37.5)
    good = {
        "success_url": f"{PUBLIC_URL}/app/plan?order={order.id}",
        "fail_url": f"{PUBLIC_URL}/app/plan?order={order.id}&cancelled=1",
        "status_url": f"{PUBLIC_URL}/api/v1/billing/volet/status",
    }
    assert volet.payment_fields(order=order, currency="usd", comment="x", **good)["ac_currency"] == "USD"
    for name in good:
        for bad in ("/api/v1/billing/volet/status", "", "ftp://x.test/s", "example.test/s"):
            with pytest.raises(volet.VoletError, match="ADCAM_PUBLIC_URL"):
                volet.payment_fields(order=order, currency="usd", comment="x", **{**good, name: bad})
    # A plain http address is still an address (a local test deployment).
    assert volet.payment_fields(order=order, currency="usd", comment="x", **{**good, "status_url": "http://x.test/s"})


# --------------------------------------------------------------------------
# provider resolution
# --------------------------------------------------------------------------


def test_a_provider_that_is_not_set_up_is_refused(volet_env):
    client = _signed_in(address("btc-only"))
    response = client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro", "provider": "btcpay"})
    assert response.status_code == 503 and response.json()["detail"] == "That payment method is not set up."
    assert client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro", "provider": "paypal"}).status_code == 422
    assert len(client.get("/api/v1/billing/orders").json()) == 0


def test_btcpay_comes_first_when_both_are_set_up(both_env, monkeypatch):
    _mock_btcpay(
        monkeypatch,
        lambda request: httpx.Response(200, json={"id": "inv_both_" + RUN_ID, "checkoutLink": "https://pay/x"}),
    )
    client = _signed_in(address("both"))
    data = client.get("/api/v1/auth/subscription").json()
    assert data["payments_enabled"] is True
    assert data["payment_providers"] == [
        {"id": "btcpay", "label": "Crypto wallet (BTCPay)"},
        {"id": "volet", "label": "Volet"},
    ]

    default = _checkout(client, "pro")
    assert default["provider"] == "btcpay" and default["checkout_url"] == "https://pay/x"
    chosen = _checkout(client, "pro", provider="volet")
    assert chosen["provider"] == "volet" and chosen["order_id"] != default["order_id"]
    assert chosen["checkout_url"] == f"/api/v1/billing/orders/{chosen['order_id']}/pay"
    # Each provider keeps its own open order for the same purchase.
    assert _checkout(client, "pro") == default
    assert _checkout(client, "pro", provider="volet") == chosen


def test_nothing_is_offered_until_a_provider_is_set_up(monkeypatch):
    monkeypatch.setattr(settings, "btcpay_url", "")
    monkeypatch.setattr(settings, "volet_sci_secret", None)
    client = _signed_in(address("none"))
    data = client.get("/api/v1/auth/subscription").json()
    assert data["payments_enabled"] is False and data["payment_providers"] == []
    response = client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro", "provider": "volet"})
    assert response.status_code == 503 and response.json()["detail"] == "Payments are not set up yet."
    assert _volet().post(STATUS_PATH, data={"ac_order_id": "x"}).status_code == 503


def test_order_poll_leaves_volet_orders_alone(both_env, monkeypatch):
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(500)

    _mock_btcpay(monkeypatch, handler)
    client = _signed_in(address("no-poll"))
    body = _checkout(client, "max", provider="volet")
    assert client.get(f"/api/v1/billing/orders/{body['order_id']}").json()["status"] == "pending"
    assert calls == []


# --------------------------------------------------------------------------
# status notification
# --------------------------------------------------------------------------


def test_completed_notification_settles_the_order_once(volet_env):
    email = address("settle")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    anonymous = _volet()
    fields = _notification(order_id, transfer="tx-settle-" + RUN_ID)

    first = anonymous.post(STATUS_PATH, data=fields)
    assert first.status_code == 200 and first.text == "OK"
    assert _balances(email) == (1500, 0)
    user = _load(email)
    assert user.sub_plan == "starter" and user.billing_mode == "tokens"
    sub = client.get("/api/v1/auth/subscription").json()["subscription"]
    assert sub["plan_id"] == "starter" and sub["active"] is True and sub["days_left"] == 30
    order = client.get(f"/api/v1/billing/orders/{order_id}").json()
    assert order["status"] == "paid" and order["paid_at"] and order["provider"] == "volet"
    row = _order(order_id)
    assert row.provider_ref == "tx-settle-" + RUN_ID and row.applied_at is not None
    assert _activity(email).count(PAID_STARTER) == 1

    # Volet may deliver the same notification again; it is applied once.
    again = anonymous.post(STATUS_PATH, data=fields)
    assert again.status_code == 200 and again.text == "OK"
    assert _balances(email) == (1500, 0)
    assert _activity(email).count(PAID_STARTER) == 1
    assert _order(order_id).provider_ref == "tx-settle-" + RUN_ID


def test_notification_by_get_settles_too(volet_env):
    email = address("get")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    fields = _notification(order_id)
    fields["ac_hash"] = fields["ac_hash"].upper()  # a sender may upper-case the hex
    response = _volet().get(STATUS_PATH, params=fields)
    assert response.status_code == 200 and response.text == "OK"
    assert _balances(email) == (1500, 0)
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"


def test_completed_notification_settles_a_topup_with_its_bonus(volet_env):
    email = address("topup")
    client = _signed_in(email)
    _grant(email, "pro")
    response = client.post(CHECKOUT, json={"kind": "topup", "amount": 80})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["provider"] == "volet" and body["tokens"] == 4400
    page = client.get(body["checkout_url"])
    assert _form_fields(page.text)["ac_amount"] == "80.00"

    assert _volet().post(STATUS_PATH, data=_notification(body["order_id"], amount="80.00")).text == "OK"
    assert _balances(email) == (4500, 4400)
    assert any("top-up" in line and "(Volet)" in line for line in _activity(email))


def test_notification_with_a_bad_hash_is_refused(volet_env):
    email = address("bad-hash")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    anonymous = _volet()

    wrong_secret = _notification(order_id, secret="not-the-password")
    response = anonymous.post(STATUS_PATH, data=wrong_secret)
    assert response.status_code == 401 and response.json()["detail"] == "Bad notification hash."

    tampered = _notification(order_id)
    tampered["ac_amount"] = "0.01"
    assert anonymous.post(STATUS_PATH, data=tampered).status_code == 401
    without = {k: v for k, v in _notification(order_id).items() if k != "ac_hash"}
    assert anonymous.post(STATUS_PATH, data=without).status_code == 401

    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _balances(email) == (0, 0)


def test_notification_for_a_different_amount_is_set_aside(volet_env):
    email = address("amount")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    response = _volet().post(STATUS_PATH, data=_notification(order_id, amount="38.50"))
    assert response.status_code == 200 and response.text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _balances(email) == (0, 0)
    assert _activity(email) == [f"Volet notification for order {order_id} ignored: amount or currency differs"]
    # Formatting differences are not a mismatch.
    assert _volet().post(STATUS_PATH, data=_notification(order_id, amount="37.5")).text == "OK"
    assert _balances(email) == (1500, 0)


def test_notification_in_another_currency_is_set_aside(volet_env):
    email = address("currency")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    other = "EUR" if _currency().upper() != "EUR" else "GBP"
    response = _volet().post(STATUS_PATH, data=_notification(order_id, merchant_currency=other))
    assert response.status_code == 200 and response.text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _balances(email) == (0, 0)
    assert _activity(email) == [f"Volet notification for order {order_id} ignored: amount or currency differs"]
    # The currency code is compared without regard to case.
    assert _volet().post(STATUS_PATH, data=_notification(order_id, merchant_currency=_currency().lower())).text == "OK"
    assert _balances(email) == (1500, 0)


def test_notification_for_another_gateway_is_set_aside(volet_env):
    email = address("gateway")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    assert _volet().post(STATUS_PATH, data=_notification(order_id, sci_name="other-shop")).text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _activity(email) == [f"Volet notification for order {order_id} ignored: the gateway name differs"]


def test_canceled_notification_expires_a_pending_order(volet_env):
    email = address("canceled")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    anonymous = _volet()
    assert anonymous.post(STATUS_PATH, data=_notification(order_id, state="CANCELED")).text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "expired"
    assert _balances(email) == (0, 0)

    # A payment Volet completes after all is still credited, once.
    assert anonymous.post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"
    assert _balances(email) == (1500, 0)
    # ...and a late cancellation cannot undo a paid order.
    assert anonymous.post(STATUS_PATH, data=_notification(order_id, state="CANCELED")).text == "OK"
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"


def test_pending_and_process_notifications_change_nothing(volet_env):
    email = address("pending")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    anonymous = _volet()
    for state in ("PENDING", "PROCESS", "SOMETHING_NEW"):
        assert anonymous.post(STATUS_PATH, data=_notification(order_id, state=state)).text == "OK"
        assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _balances(email) == (0, 0) and _activity(email) == []


def test_notification_for_an_unknown_order_is_acknowledged(volet_env):
    response = _volet().post(STATUS_PATH, data=_notification("nobody-" + RUN_ID))
    assert response.status_code == 200 and response.text == "OK"


# --------------------------------------------------------------------------
# who sent the notification
# --------------------------------------------------------------------------


def test_sender_allowed_unit(monkeypatch):
    allowed = ["50.7.115.5", " 13.53.55.89 ", "198.51.100.0/24", "", "not-an-address"]
    assert volet.sender_allowed("50.7.115.5", allowed) is True
    assert volet.sender_allowed(" 13.53.55.89", allowed) is True
    assert volet.sender_allowed("::ffff:50.7.115.5", allowed) is True  # IPv4 peer of a server bound to ::
    assert volet.sender_allowed("198.51.100.77", allowed) is True
    assert volet.sender_allowed("198.51.101.1", allowed) is False
    assert volet.sender_allowed("51.255.40.139", allowed) is False
    assert volet.sender_allowed("testclient", allowed) is False
    assert volet.sender_allowed("", allowed) is False
    # An empty list turns the check off; the default list is the one in the settings.
    assert volet.sender_allowed("203.0.113.9", []) is True
    assert volet.sender_allowed("203.0.113.9", ["", "  "]) is True
    assert settings.volet_notify_ips == ["50.7.115.5", "51.255.40.139", "13.53.55.89", "13.61.247.159"]
    assert volet.sender_allowed("51.255.40.139") is True and volet.sender_allowed("203.0.113.9") is False
    assert volet.sender_allowed("13.61.247.159") is True  # the dashboard's "notification server"
    monkeypatch.setattr(settings, "volet_notify_ips", [])
    assert volet.sender_allowed("203.0.113.9") is True
    # The variable is comma separated; empty turns it off.
    assert settings._split_notify_ips(" 50.7.115.5 ,, 13.53.55.89 ") == ["50.7.115.5", "13.53.55.89"]
    assert settings._split_notify_ips("") == []


def test_notification_from_an_address_that_is_not_volets_is_refused(volet_env):
    email = address("sender")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    fields = _notification(order_id)
    refused = "Notifications are accepted from Volet's addresses only."

    # No proxy header (the test client's own peer), another address, and
    # Volet's address only in the part of the header a sender can write
    # (the proxy appends the real peer after it).
    for headers in ({}, {"x-forwarded-for": "203.0.113.9"}, {"x-forwarded-for": f"{VOLET_IP}, 203.0.113.9"}):
        response = TestClient(app).post(STATUS_PATH, data=fields, headers=headers)
        assert response.status_code == 403 and response.json()["detail"] == refused, headers
    # Two header lines are one list; the last entry is still the proxy's.
    split = [("x-forwarded-for", VOLET_IP), ("x-forwarded-for", "203.0.113.9")]
    assert TestClient(app).post(STATUS_PATH, data=fields, headers=split).status_code == 403
    assert TestClient(app).get(STATUS_PATH, params=fields, headers={"x-forwarded-for": "203.0.113.9"}).status_code == 403
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert _balances(email) == (0, 0) and _activity(email) == []

    # Each documented sender passes, also as an IPv4-mapped peer and at the end of a chain.
    for forwarded in ("51.255.40.139", "13.53.55.89", f"::ffff:{VOLET_IP}", f"203.0.113.9, {VOLET_IP}", f" {VOLET_IP} "):
        pending = _notification(order_id, state="PENDING")
        response = TestClient(app).post(STATUS_PATH, data=pending, headers={"x-forwarded-for": forwarded})
        assert response.status_code == 200 and response.text == "OK", forwarded
    assert _volet().post(STATUS_PATH, data=fields).text == "OK"
    assert _balances(email) == (1500, 0)


def test_turning_the_sender_check_off_falls_back_to_the_hash(volet_env, monkeypatch):
    monkeypatch.setattr(settings, "volet_notify_ips", [])
    email = address("hash-only")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    direct = TestClient(app)
    assert direct.post(STATUS_PATH, data=_notification(order_id, secret="not-the-password")).status_code == 401
    assert direct.post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    assert _balances(email) == (1500, 0)


def test_a_notification_sent_again_with_its_status_changed_is_refused(volet_env):
    """``ac_hash`` does not cover ``ac_transaction_status``, so the sender check is what stops this."""

    email = address("replay")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]

    for state, expected in (("PENDING", "pending"), ("PROCESS", "pending"), ("CANCELED", "expired")):
        # Volet's genuine notification, which the buyer can have delivered to
        # a page of their own (the form's status URL is not signed) and so read.
        genuine = _notification(order_id, state=state, transfer=f"tx-{state.lower()}-{RUN_ID}")
        assert _volet().post(STATUS_PATH, data=genuine).text == "OK"
        assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == expected

        # The same fields with the status flipped still carry a valid hash...
        replay = {**genuine, "ac_transaction_status": "COMPLETED"}
        assert volet.verify_status(replay, SCI_SECRET) is True
        # ...but they are not coming from Volet.
        for headers in ({}, {"x-forwarded-for": "203.0.113.9"}, {"x-forwarded-for": f"{VOLET_IP}, 203.0.113.9"}):
            assert TestClient(app).post(STATUS_PATH, data=replay, headers=headers).status_code == 403, (state, headers)
        assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == expected
        assert _balances(email) == (0, 0)
        assert _order(order_id).provider_ref is None

    assert _activity(email) == []


def test_checkouts_and_notifications_are_logged_with_the_order_id(volet_env, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app.billing_routes")
    email = address("log")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    assert f"Volet checkout started for order {order_id}" in caplog.text

    for state in ("PENDING", "PROCESS", "CANCELED"):
        assert _volet().post(STATUS_PATH, data=_notification(order_id, state=state)).text == "OK"
        assert f"Volet notification for order {order_id}: {state}" in caplog.text
    assert TestClient(app).post(STATUS_PATH, data=_notification(order_id), headers={"x-forwarded-for": "203.0.113.9"}).status_code == 403
    assert "Volet notification from 203.0.113.9 refused: not one of Volet's addresses" in caplog.text
    assert _volet().post(STATUS_PATH, data=_notification(order_id, secret="other")).status_code == 401
    assert f"Volet notification for order {order_id} refused: bad hash" in caplog.text
    assert _volet().post(STATUS_PATH, data=_notification(order_id, amount="1.00")).text == "OK"
    assert f"Volet notification for order {order_id} ignored: amount or currency differs" in caplog.text
    assert _volet().post(STATUS_PATH, data=_notification("nobody-" + RUN_ID)).text == "OK"
    assert f"Volet notification for an unknown order nobody-{RUN_ID}" in caplog.text
    assert _volet().post(STATUS_PATH, data=_notification(order_id)).text == "OK"
    assert f"Volet notification for order {order_id}: COMPLETED" in caplog.text
    assert _balances(email) == (1500, 0)

    monkeypatch.setattr(settings, "volet_sci_secret", None)
    assert _volet().post(STATUS_PATH, data=_notification(order_id)).status_code == 503
    assert "Volet notification refused: Volet is not set up on this service" in caplog.text


# --------------------------------------------------------------------------
# orders
# --------------------------------------------------------------------------


def test_orders_list_carries_the_provider_and_reuses_the_open_order(volet_env, admin):
    email = address("reuse")
    client = _signed_in(email)
    first = _checkout(client, "max")
    assert _checkout(client, "max") == first
    other = _checkout(client, "pro")
    assert other["order_id"] != first["order_id"]

    rows = client.get("/api/v1/billing/orders").json()
    assert [(r["id"], r["provider"], r["status"]) for r in rows] == [
        (other["order_id"], "volet", "pending"),
        (first["order_id"], "volet", "pending"),
    ]
    assert rows[0]["checkout_url"] == other["checkout_url"]

    user_id = client.get("/api/v1/auth/me").json()["id"]
    billing = admin.get(f"/api/v1/admin/users/{user_id}/billing").json()
    assert [o["provider"] for o in billing["orders"]] == ["volet", "volet"]
