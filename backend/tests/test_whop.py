"""Whop Embedded Checkout & webhook verification: checkout, plan map, signatures, settlement."""

from __future__ import annotations

import base64
import builtins
import hashlib
import hmac
import importlib.util
import json
import logging
import sys
import time
import types
import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import whop
from app.auth_routes import login_limiter
from app.config import Settings, settings
from app.db import ActivityEvent, Order, User, get_session_factory, init_db
from app.main import app
from app.tokens import activate_period, balances, get_token_plans

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"
API_KEY = "whop-api-key-placeholder"
WEBHOOK_SECRET = "ws_webhook-secret-placeholder"
PUBLIC_URL = "https://app.example.test"
CHECKOUT = "/api/v1/billing/checkout"
WEBHOOK_PATH = "/api/v1/billing/whop/webhook"
PAID_STARTER = "Paid $37 for Starter period (Whop)"

SUB_PLANS = {"starter": "plan_starter", "pro": "plan_pro", "max": "plan_max"}
TOPUP_PLANS = {
    "20": "plan_top20",
    "40": "plan_top40",
    "80": "plan_top80",
    "160": "plan_top160",
    "240": "plan_top240",
}


def address(name: str) -> str:
    return f"whop-{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


def _install_standardwebhooks_stub_if_missing(monkeypatch) -> None:
    """When running in a bare environment without `whop-sdk`, verify with Standard Webhooks HMAC-SHA256."""

    if importlib.util.find_spec("whop_sdk") is not None:
        return

    def _unwrap(payload: bytes | str, *, headers: dict[str, str], key: str | bytes):
        if not key:
            raise ValueError("Missing key")
        lowered = {str(k).lower(): str(v) for k, v in headers.items()}
        msg_id = lowered.get("webhook-id", "")
        ts = lowered.get("webhook-timestamp", "")
        sig_header = lowered.get("webhook-signature", "")
        if not (msg_id and ts and sig_header):
            raise ValueError("Missing required webhook headers")
        ts_int = int(ts)
        if abs(int(time.time()) - ts_int) > 300:
            raise ValueError("Webhook timestamp outside tolerance")
        raw = payload.encode("utf-8") if isinstance(payload, str) else payload
        secret_bytes = key.encode("utf-8") if isinstance(key, str) else key
        expected = hmac.new(secret_bytes, f"{msg_id}.{ts}.".encode("utf-8") + raw, hashlib.sha256).digest()
        matched = False
        for part in sig_header.split(" "):
            version, _, b64 = part.partition(",")
            if version == "v1" and b64:
                if hmac.compare_digest(base64.b64decode(b64), expected):
                    matched = True
                    break
        if not matched:
            raise ValueError("No matching webhook signature")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Webhook body must be a JSON object")
        return parsed

    pkg = types.ModuleType("whop_sdk")
    lib = types.ModuleType("whop_sdk.lib")
    mod = types.ModuleType("whop_sdk.lib.verify_webhook")
    mod.unwrap = _unwrap  # type: ignore[attr-defined]
    lib.verify_webhook = mod  # type: ignore[attr-defined]
    pkg.lib = lib  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "whop_sdk", pkg)
    monkeypatch.setitem(sys.modules, "whop_sdk.lib", lib)
    monkeypatch.setitem(sys.modules, "whop_sdk.lib.verify_webhook", mod)


@pytest.fixture
def whop_env(monkeypatch):
    """Whop configured with placeholder secrets & plan maps; no network calls."""

    _install_standardwebhooks_stub_if_missing(monkeypatch)
    monkeypatch.setattr(settings, "whop_api_key", SecretStr(API_KEY))
    monkeypatch.setattr(settings, "whop_webhook_secret", SecretStr(WEBHOOK_SECRET))
    monkeypatch.setattr(settings, "whop_plan_subscription", dict(SUB_PLANS))
    monkeypatch.setattr(settings, "whop_plan_topup", dict(TOPUP_PLANS))
    monkeypatch.setattr(settings, "public_url", PUBLIC_URL)
    yield


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


# --------------------------------------------------------------------------
# helpers (also imported by test_notify, test_telegram_approve, test_meta_capi, test_emails, test_group_emails)
# --------------------------------------------------------------------------


def _signed_in(email: str) -> TestClient:
    """A signed-in account on token billing (the default for new sign-ups)."""

    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    if response.status_code in (202, 403):
        # Email is switched on, so the account opens with the emailed code.
        response = client.post("/api/v1/auth/verify-email", json={"email": email, "code": _fresh_code(email)})
    assert response.status_code in (200, 201), response.text
    return client


def _fresh_code(email: str) -> str:
    """A new sign-up code for ``email``, as if read from the email."""

    from app import account_security

    with _session() as db:
        user = db.query(User).filter(User.email == email.strip().lower()).one()
        return account_security.issue(db, user, account_security.VERIFY)


def _session():
    return get_session_factory()()


def _load(email: str) -> User:
    with _session() as db:
        return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def _with_user(email: str, fn):
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
    with _session() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        rows = db.execute(
            select(ActivityEvent.detail)
            .where(ActivityEvent.user_id == user.id, ActivityEvent.kind == kind)
            .order_by(ActivityEvent.id)
        )
        return list(rows.scalars().all())


def _order(order_id: str) -> Order:
    with _session() as db:
        return db.get(Order, order_id)


def _checkout(client: TestClient, plan_id: str = "starter", provider: str | None = None) -> dict:
    body: dict = {"kind": "subscription", "plan_id": plan_id}
    if provider is not None:
        body["provider"] = provider
    response = client.post(CHECKOUT, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _whop_event(
    order_id: str,
    *,
    event_type: str = "payment.succeeded",
    payment_id: str | None = None,
    variant_id: str | None = None,
    extra_data: dict | None = None,
) -> dict:
    data: dict = {
        "id": payment_id or f"pay_{order_id[:12]}",
        "metadata": {"order_id": order_id} if order_id else {},
    }
    if variant_id is not None:
        data["variant_id"] = variant_id
    if extra_data:
        data.update(extra_data)
    return {
        "id": f"msg_{uuid.uuid4().hex[:16]}",
        "type": event_type,
        "api_version": "v1",
        "data": data,
    }


def _signed_whop(
    body: dict,
    *,
    secret: str = WEBHOOK_SECRET,
    msg_id: str | None = None,
    timestamp: int | None = None,
) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode("utf-8")
    mid = msg_id or str(body.get("id") or f"msg_{uuid.uuid4().hex[:12]}")
    ts = str(timestamp if timestamp is not None else int(time.time()))
    digest = hmac.new(secret.encode("utf-8"), f"{mid}.{ts}.".encode("utf-8") + raw, hashlib.sha256).digest()
    sig = f"v1,{base64.b64encode(digest).decode('ascii')}"
    headers = {
        "webhook-id": mid,
        "webhook-timestamp": ts,
        "webhook-signature": sig,
        "Content-Type": "application/json",
    }
    return raw, headers


def _post_whop(event: dict, *, secret: str = WEBHOOK_SECRET):
    raw, headers = _signed_whop(event, secret=secret)
    return TestClient(app).post(WEBHOOK_PATH, content=raw, headers=headers)


# --------------------------------------------------------------------------
# config & plan maps
# --------------------------------------------------------------------------


def test_whop_plan_map_parser_accepts_json_and_pairs():
    s = Settings(
        whop_plan_subscription='{"Starter": "plan_s1", "pro": "plan_p1", "max": "plan_m1"}',
        whop_plan_topup="20=plan_t20, 40=plan_t40",
    )
    assert s.whop_plan_subscription == {"starter": "plan_s1", "pro": "plan_p1", "max": "plan_m1"}
    assert s.whop_plan_topup == {"20": "plan_t20", "40": "plan_t40"}
    assert Settings(whop_plan_subscription="").whop_plan_subscription == {}


def test_configured_requires_api_key_and_webhook_secret(monkeypatch):
    monkeypatch.setattr(settings, "whop_api_key", None)
    monkeypatch.setattr(settings, "whop_webhook_secret", SecretStr(WEBHOOK_SECRET))
    assert whop.configured() is False

    monkeypatch.setattr(settings, "whop_api_key", SecretStr(API_KEY))
    monkeypatch.setattr(settings, "whop_webhook_secret", None)
    assert whop.configured() is False

    monkeypatch.setattr(settings, "whop_webhook_secret", SecretStr(WEBHOOK_SECRET))
    assert whop.configured() is True


def test_missing_whop_plan_mapping_returns_503_without_creating_order(whop_env, monkeypatch):
    monkeypatch.setattr(settings, "whop_plan_subscription", {"starter": "plan_starter"})
    client = _signed_in(address("missing-map"))
    response = client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 503
    assert "pro" in response.json()["detail"]
    assert client.get("/api/v1/billing/orders").json() == []


# --------------------------------------------------------------------------
# checkout & provider resolution
# --------------------------------------------------------------------------


def test_nothing_is_offered_until_whop_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "whop_api_key", None)
    monkeypatch.setattr(settings, "whop_webhook_secret", None)
    client = _signed_in(address("unconfigured"))
    data = client.get("/api/v1/auth/subscription").json()
    assert data["payments_enabled"] is False and data["payment_providers"] == []
    response = client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 503 and response.json()["detail"] == "Payments are not set up yet."


def test_only_whop_is_accepted_as_provider(whop_env):
    client = _signed_in(address("provider-check"))
    data = client.get("/api/v1/auth/subscription").json()
    assert data["payments_enabled"] is True
    assert data["payment_providers"] == [{"id": "whop", "label": "Whop"}]

    for old in ("btcpay", "volet", "paypal"):
        assert client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "pro", "provider": old}).status_code == 422

    body = _checkout(client, "starter")
    assert body["provider"] == "whop" and body["whop_plan"] == "plan_starter"
    assert body["amount"] == 37.0 and body["tokens"] == 1500
    assert _balances(address("provider-check")) == (0, 0)


def test_topup_checkout_returns_mapped_whop_plan(whop_env):
    email = address("topup-checkout")
    client = _signed_in(email)
    assert client.post(CHECKOUT, json={"kind": "topup", "amount": 80}).status_code == 402
    _grant(email, "pro")
    res = client.post(CHECKOUT, json={"kind": "topup", "amount": 80, "provider": "whop"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["whop_plan"] == "plan_top80" and body["tokens"] == 4400 and body["amount"] == 80


def test_orders_list_carries_whop_and_reuses_open_order(whop_env, admin):
    email = address("reuse")
    client = _signed_in(email)
    first = _checkout(client, "max")
    assert _checkout(client, "max") == first
    other = _checkout(client, "pro")
    assert other["order_id"] != first["order_id"]

    rows = client.get("/api/v1/billing/orders").json()
    assert [(r["id"], r["provider"], r["status"]) for r in rows] == [
        (other["order_id"], "whop", "pending"),
        (first["order_id"], "whop", "pending"),
    ]
    user_id = client.get("/api/v1/auth/me").json()["id"]
    billing = admin.get(f"/api/v1/admin/users/{user_id}/billing").json()
    assert [o["provider"] for o in billing["orders"]] == ["whop", "whop"]


# --------------------------------------------------------------------------
# webhook verification & settlement
# --------------------------------------------------------------------------


def test_verify_webhook_fails_closed_when_sdk_missing(whop_env, monkeypatch):
    real_import = builtins.__import__

    def no_whop(name, *args, **kwargs):
        if name.startswith("whop"):
            raise ImportError("simulated missing sdk")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_whop)
    with pytest.raises(whop.WhopError, match="not installed"):
        whop.verify_webhook(b"{}", {})


def test_webhook_rejects_bad_or_missing_signature(whop_env):
    email = address("bad-sig")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    event = _whop_event(order_id, variant_id="plan_starter")

    wrong = _post_whop(event, secret="ws_wrong")
    assert wrong.status_code == 401
    assert TestClient(app).post(WEBHOOK_PATH, content=json.dumps(event)).status_code == 401

    raw, headers = _signed_whop(event)
    assert TestClient(app).post(WEBHOOK_PATH, content=raw + b" ", headers=headers).status_code == 401
    assert _order(order_id).status == "pending"
    assert _balances(email) == (0, 0)


def test_payment_succeeded_settles_once_and_stores_provider_ref(whop_env):
    email = address("settle")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    event = _whop_event(order_id, payment_id="pay_abc123", variant_id="plan_starter")

    first = _post_whop(event)
    assert first.status_code == 200 and first.json() == {"ok": True, "applied": True}
    assert _balances(email) == (1500, 0)
    user = _load(email)
    assert user.sub_plan == "starter" and user.billing_mode == "tokens"
    order_row = _order(order_id)
    assert order_row.status == "paid" and order_row.provider_ref == "pay_abc123" and order_row.applied_at is not None
    assert _activity(email).count(PAID_STARTER) == 1

    # Re-delivery is acknowledged and ignored.
    again = _post_whop(event)
    assert again.status_code == 200 and again.json() == {"ok": True, "applied": False}
    assert _balances(email) == (1500, 0)
    assert _activity(email).count(PAID_STARTER) == 1


def test_non_settled_events_and_unknown_orders_are_ignored(whop_env):
    email = address("ignore")
    client = _signed_in(email)
    order_id = _checkout(client, "pro")["order_id"]

    for ev_type in ("payment.pending", "membership.activated"):
        res = _post_whop(_whop_event(order_id, event_type=ev_type, variant_id="plan_pro"))
        assert res.status_code == 200 and res.json() == {"ok": True, "ignored": ev_type}
        assert _order(order_id).status == "pending"

    unknown = _post_whop(_whop_event("unknown-" + RUN_ID, variant_id="plan_pro"))
    assert unknown.status_code == 200 and unknown.json() == {"ok": True, "ignored": "unknown order"}
    assert _balances(email) == (0, 0)


def test_plan_mismatch_is_flagged_and_not_settled(whop_env):
    email = address("mismatch")
    client = _signed_in(email)
    order_id = _checkout(client, "max")["order_id"]
    # Someone tries to attach a Max order_id to a Starter Whop plan payment.
    res = _post_whop(_whop_event(order_id, variant_id="plan_starter"))
    assert res.status_code == 200 and res.json() == {"ok": True, "ignored": "plan mismatch"}
    assert _order(order_id).status == "pending"
    assert _balances(email) == (0, 0)
    assert any("plan mismatch" in line for line in _activity(email))


def test_topup_webhook_credits_tokens_and_bonus(whop_env):
    email = address("topup-wh")
    client = _signed_in(email)
    _grant(email, "pro")
    order_id = client.post(CHECKOUT, json={"kind": "topup", "amount": 80}).json()["order_id"]
    res = _post_whop(_whop_event(order_id, variant_id="plan_top80"))
    assert res.status_code == 200 and res.json() == {"ok": True, "applied": True}
    assert _balances(email) == (4500, 4400)


def test_webhook_logs_and_settles_flat_metadata_shape(whop_env, caplog):
    caplog.set_level(logging.INFO, logger="app.billing_routes")
    email = address("flat")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    assert f"Whop checkout started for order {order_id}" in caplog.text

    flat_event = {"event": "payment.succeeded", "metadata": {"order_id": order_id}, "plan_id": "plan_starter"}
    assert _post_whop(flat_event).json() == {"ok": True, "applied": True}
    assert _balances(email) == (1500, 0)


# --------------------------------------------------------------------------
# subscription lifecycle, renewals, refunds & disputes (all 7 webhook events)
# --------------------------------------------------------------------------


def test_whop_renewal_cancel_resume_and_deactivated_events(whop_env, monkeypatch):
    email = address("lifecycle")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]

    # Initial payment stores membership id and payment id.
    first_evt = _whop_event(
        order_id,
        payment_id="pay_init_1",
        variant_id="plan_starter",
        extra_data={"membership": {"id": "mem_life_1"}, "billing_reason": "subscription_create"},
    )
    assert _post_whop(first_evt).json() == {"ok": True, "applied": True}
    assert _load(email).whop_membership_id == "mem_life_1"
    assert _order(order_id).whop_membership_id == "mem_life_1"

    # Cancel in app delegates cancel_at_period_end=True to Whop while keeping days & tokens.
    calls: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(
        whop,
        "cancel_membership",
        lambda mem_id, *, at_period_end=True, reason="": calls.append(("cancel", mem_id, at_period_end)) or {},
    )
    monkeypatch.setattr(
        whop,
        "resume_membership",
        lambda mem_id: calls.append(("resume", mem_id, False)) or {},
    )

    c_res = client.post("/api/v1/billing/cancel", json={"reason": "Taking a break"})
    assert c_res.status_code == 200 and c_res.json()["cancelled"] is True
    assert _balances(email) == (1500, 0)
    assert _load(email).is_active is True

    r_res = client.post("/api/v1/billing/resume")
    assert r_res.status_code == 200 and r_res.json()["cancelled"] is False
    assert calls == [("cancel", "mem_life_1", True), ("resume", "mem_life_1", False)]

    # Recurring subscription cycle payment settles a fresh renewal order.
    cycle_evt = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "payment.succeeded",
        "data": {
            "id": "pay_cycle_2",
            "membership_id": "mem_life_1",
            "billing_reason": "subscription_cycle",
            "plan": {"id": "plan_starter"},
            "final_amount": 37,
        },
    }
    res_cycle = _post_whop(cycle_evt)
    assert res_cycle.status_code == 200 and res_cycle.json() == {"ok": True, "applied": True, "renewal": True}
    # Starter has 0 rollover months, so renewal refreshes the period balance to 1500.
    assert _balances(email) == (1500, 0)
    # Re-delivering the same cycle payment id does not double-credit.
    assert _post_whop(cycle_evt).json() == {"ok": True, "applied": False}
    assert _balances(email) == (1500, 0)

    # membership.deactivated with cancel_at_period_end=True turns off auto-renewal but keeps remaining tokens.
    deact_end = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "membership.deactivated",
        "data": {"id": "mem_life_1", "cancel_at_period_end": True},
    }
    assert _post_whop(deact_end).json() == {"ok": True, "synced": "cancelled"}
    assert _load(email).sub_cancelled_at is not None and _balances(email) == (1500, 0)

    # membership.deactivated without cancel_at_period_end ends access now.
    deact_now = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "membership.deactivated",
        "data": {"id": "mem_life_1", "cancel_at_period_end": False},
    }
    assert _post_whop(deact_now).json() == {"ok": True, "synced": "deactivated"}
    assert _balances(email) == (0, 0)


def test_whop_payment_failed_and_refund_webhooks(whop_env):
    email = address("refundwh")
    client = _signed_in(email)

    pending_id = _checkout(client, "pro")["order_id"]
    failed_evt = _whop_event(pending_id, event_type="payment.failed", payment_id="pay_fail_1", variant_id="plan_pro")
    assert _post_whop(failed_evt).json() == {"ok": True, "failed_order": pending_id}
    assert _order(pending_id).status == "invalid"

    # Unknown test/synthetic payment.failed events acknowledge as "unknown payment", never as an unhandled event type.
    unknown_fail = _whop_event("unknown-fail-" + RUN_ID, event_type="payment.failed", payment_id="pay_test_999")
    assert _post_whop(unknown_fail).json() == {"ok": True, "ignored": "unknown payment"}

    paid_id = _checkout(client, "pro")["order_id"]
    assert _post_whop(
        _whop_event(paid_id, payment_id="pay_ok_wh_1", variant_id="plan_pro", extra_data={"membership": {"id": "mem_wh_r1"}})
    ).json() == {"ok": True, "applied": True}
    assert _balances(email) == (4500, 0)

    refund_evt = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "refund.created",
        "data": {"id": "re_wh_1", "payment": {"id": "pay_ok_wh_1"}, "status": "succeeded"},
    }
    assert _post_whop(refund_evt).json() == {"ok": True, "refunded": True}
    assert _order(paid_id).status == "refunded"
    assert _balances(email) == (0, 0)
    assert _load(email).is_active is False


def test_whop_dispute_webhooks_stop_account_and_refund_on_loss(whop_env):
    email = address("dispute")
    client = _signed_in(email)
    order_id = _checkout(client, "starter")["order_id"]
    assert _post_whop(_whop_event(order_id, payment_id="pay_disp_1", variant_id="plan_starter")).json() == {
        "ok": True,
        "applied": True,
    }

    dispute_open = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "dispute.created",
        "data": {"id": "disp_1", "payment": {"id": "pay_disp_1"}, "status": "needs_response", "reason": "fraudulent"},
    }
    assert _post_whop(dispute_open).json() == {"ok": True, "dispute_handled": True}
    assert _load(email).is_active is False and _balances(email) == (0, 0)

    dispute_lost = {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "dispute.updated",
        "data": {"id": "disp_1", "payment": {"id": "pay_disp_1"}, "status": "lost", "reason": "fraudulent"},
    }
    assert _post_whop(dispute_lost).json() == {"ok": True, "dispute_handled": True}
    assert _order(order_id).status == "refunded"


def test_whop_promo_code_validation_and_checkout_prefill(whop_env, monkeypatch):
    from types import SimpleNamespace

    from pydantic import SecretStr

    from app import affiliates, whop
    from app.config import settings
    from app.db import AffiliateCommission, AffiliatePartner, ReferralCode, get_session_factory

    code = f"PARTNER{RUN_ID[:4].upper()}"
    aff_email = address("whopaff")
    aff_client = _signed_in(aff_email)
    applied = aff_client.post(
        "/api/v1/referrals/partner/apply",
        json={
            "full_name": "Whop Aff",
            "email": aff_email,
            "social_links": ["https://x.com/whopaff"],
            "code": code,
            "audience": "Media buyers newsletter covering paid social workflows",
        },
    )
    assert applied.status_code in (200, 201), applied.text
    with get_session_factory()() as db:
        partner = db.query(AffiliatePartner).filter(AffiliatePartner.requested_code == code).one()
        partner.status = "approved"
        db.add(ReferralCode(user_id=partner.user_id, code=code, channel="partner", status="active"))
        db.commit()
        partner_id = partner.user_id

    class _FakeVariants:
        def retrieve(self, *, id: str):
            return SimpleNamespace(
                account=SimpleNamespace(id="biz_test_1"),
                product={"id": "prod_test_1"},
                currency="usd",
            )

    class _FakePromoCodes:
        def list(self, **kwargs):
            return SimpleNamespace(
                data=[
                    SimpleNamespace(
                        id="promo_live_1",
                        code=code,
                        promo_type="percentage",
                        amount_off=20.0,
                        currency="usd",
                        status="active",
                        expires_at=None,
                        unlimited_stock=True,
                        stock=0,
                        uses=0,
                        new_users_only=True,
                        duration="once",
                        promo_duration_months=1,
                        product=SimpleNamespace(id="prod_test_1"),
                    )
                ]
            )

    monkeypatch.setattr(settings, "whop_api_key", SecretStr("whop_live_test_secret"))
    whop._VARIANT_CACHE.clear()
    whop.clear_promo_cache()
    monkeypatch.setattr(
        whop,
        "_sdk_client",
        lambda: SimpleNamespace(
            variants=_FakeVariants(),
            promo_codes=_FakePromoCodes(),
        ),
    )

    buyer_email = address("whopdisc")
    buyer_client = _signed_in(buyer_email)
    click = buyer_client.post(
        "/api/v1/referrals/click",
        json={"code": code, "landing_path": "/"},
        headers={"x-device-id": f"dev-buyer-{RUN_ID}"},
    )
    assert click.status_code == 200
    offer = click.json()["offer"]
    assert offer["discount_pct"] == 20.0
    assert offer["prices"] == {"starter": 29.60, "pro": 71.20, "max": 119.20}

    # Auto-applies the Whop-validated discount via ?ref= click without re-typing,
    # keeping the real base Whop plan and passing promoCode directly to Whop Elements.
    co_res = buyer_client.post(
        "/api/v1/billing/checkout",
        json={"kind": "subscription", "plan_id": "pro", "provider": "whop"},
    )
    assert co_res.status_code == 201, co_res.text
    co = co_res.json()
    assert co["original_amount"] == 89.0
    assert co["discount"] == 17.80
    assert co["amount"] == 71.20
    assert co["promo_code"] == code
    assert co["whop_plan"] == "plan_pro"
    assert co["whop_checkout_config"] is None
    assert co["whop_promo_to_prefill"] == code
    assert co["whop_metadata"]["promo_code"] == code
    assert co["whop_metadata"]["affiliate_channel"] == "partner"
    assert co["whop_metadata"]["referral_code"] == code

    # Settle via payment.succeeded against the base plan with Whop's discounted total.
    order_id = co["order_id"]
    paid_evt = _whop_event(
        order_id,
        payment_id="pay_disc_1",
        variant_id="plan_pro",
        extra_data={
            "usd_total": 71.20,
            "metadata": {"order_id": order_id, "coupon_code": code, "promo_code": code},
        },
    )
    assert _post_whop(paid_evt).json() == {"ok": True, "applied": True}
    order = _order(order_id)
    assert order.status == "paid"
    assert order.whop_plan_id == "plan_pro"
    assert _balances(buyer_email) == (4500, 0)
    with get_session_factory()() as db:
        comm = db.query(AffiliateCommission).filter(AffiliateCommission.order_id == order_id).one()
        assert round(float(comm.amount_usd), 2) == 71.20
        rows = [r for r in affiliates.commission_rows(db, partner_id) if r["order_id"] == order_id]
        assert len(rows) == 1
        assert rows[0]["rate_pct"] == 25.0
        assert rows[0]["commission"] == round(71.20 * 0.25, 2)

    # Also verify graceful behavior if promo_codes.list lacks promo_code:read permission (403):
    # no fake app reduction is applied locally, yet whop_promo_to_prefill still passes code to Whop.
    class _ForbiddenPromoCodes:
        def list(self, **kwargs):
            raise RuntimeError("403 Forbidden missing promo_code:read")

    whop.clear_promo_cache()
    monkeypatch.setattr(
        whop,
        "_sdk_client",
        lambda: SimpleNamespace(
            variants=_FakeVariants(),
            promo_codes=_ForbiddenPromoCodes(),
        ),
    )
    fb_buyer = _signed_in(address("whopperm"))
    fb_co = fb_buyer.post(
        "/api/v1/billing/checkout",
        json={"kind": "subscription", "plan_id": "pro", "provider": "whop", "coupon": code},
        headers={"x-device-id": f"dev-perm-{RUN_ID}"},
    ).json()
    assert fb_co["discount"] == 0.0 and fb_co["amount"] == 89.0
    assert fb_co["whop_plan"] == "plan_pro" and fb_co["whop_promo_to_prefill"] == code


def test_whop_webhook_syncs_whop_native_promo_code_and_discounted_total(whop_env):
    from app import affiliates
    from app.db import AffiliateCommission, AffiliatePartner, Referral, ReferralCode, get_session_factory

    code = f"WHOPCD{RUN_ID[:4].upper()}"
    aff_email = address("whopnativeaff")
    aff_client = _signed_in(aff_email)
    applied = aff_client.post(
        "/api/v1/referrals/partner/apply",
        json={
            "full_name": "Whop Native Aff",
            "email": aff_email,
            "social_links": ["https://youtube.com/@whopnative"],
            "code": code,
            "audience": "Media buyers and performance ad teams creating ad campaigns",
        },
    )
    assert applied.status_code in (200, 201), applied.text
    with get_session_factory()() as db:
        partner = db.query(AffiliatePartner).filter(AffiliatePartner.requested_code == code).one()
        partner.status = "approved"
        db.add(ReferralCode(user_id=partner.user_id, code=code, channel="partner", status="active"))
        db.commit()
        partner_id = partner.user_id

    # Buyer creates checkout WITHOUT activating promo in our UI first, then enters it inside Whop Checkout.
    buyer_email = address("whopnativebuyer")
    buyer_client = _signed_in(buyer_email)
    order_id = _checkout(buyer_client, "pro")["order_id"]
    evt = _whop_event(
        order_id,
        payment_id="pay_native_promo_1",
        variant_id="plan_pro",
        extra_data={"usd_total": 75.65, "promo_code": code},
    )
    assert _post_whop(evt).json() == {"ok": True, "applied": True}
    order = _order(order_id)
    assert order.status == "paid"
    assert order.coupon_code == code
    assert float(order.amount_usd) == 75.65
    with get_session_factory()() as db:
        buyer = _load(buyer_email)
        ref = db.query(Referral).filter(Referral.referred_user_id == buyer.id).one()
        assert ref.code == code and ref.channel == "partner"
        comm = db.query(AffiliateCommission).filter(AffiliateCommission.order_id == order_id).one()
        assert round(float(comm.amount_usd), 2) == 75.65
        rows = [r for r in affiliates.commission_rows(db, partner_id) if r["order_id"] == order_id]
        assert len(rows) == 1
        assert rows[0]["commission"] == round(75.65 * 0.25, 2)


def test_admin_approve_sets_manual_whop_code_and_affiliate_link_and_base_checkout(whop_env, monkeypatch):
    from types import SimpleNamespace

    from pydantic import SecretStr

    from app import whop
    from app.config import settings
    from app.db import AffiliatePartner, User, get_session_factory

    code = f"AUTO{RUN_ID[:4].upper()}"
    aff_link = f"https://whop.com/proteusflow?a={code.lower()}"
    partner_email = address("autoaff")
    partner_client = _signed_in(partner_email)
    # Applicant supplies full name, email, multiple social media links, and why/audience description (no code required).
    req = partner_client.post(
        "/api/v1/referrals/partner/apply",
        json={
            "full_name": "Alex Media",
            "email": "alexmedia@gmail.com",
            "social_links": ["https://youtube.com/@alexmedia", "https://tiktok.com/@alexmedia"],
            "audience": "YouTube channel with 35k media buyers running paid social ads looking for ad creative tools.",
        },
    )
    assert req.status_code in (200, 201), req.text
    body = req.json()
    assert body["status"] == "pending"
    assert body["full_name"] == "Alex Media"
    assert body["email"] == "alexmedia@gmail.com"
    assert body["social_links"] == ["https://youtube.com/@alexmedia", "https://tiktok.com/@alexmedia"]

    # While pending, the code is not active yet.
    visitor = _signed_in(address("autovis"))
    pending_click = visitor.post("/api/v1/referrals/click", json={"code": code, "landing_path": "/"})
    assert pending_click.status_code == 200 and pending_click.json()["valid"] is False

    admin_email = address("autoadmin")
    admin_client = _signed_in(admin_email)
    with get_session_factory()() as db:
        admin_user = db.query(User).filter(User.email == admin_email.strip().lower()).one()
        admin_user.is_admin = True
        partner_user = db.query(User).filter(User.email == partner_email.strip().lower()).one()
        partner_user_id = partner_user.id
        db.commit()

    promo_created: list[dict] = []
    cfg_calls: list[dict] = []

    class _FakeVariants:
        def retrieve(self, *, id: str):
            return SimpleNamespace(
                account=SimpleNamespace(id="biz_auto_1"),
                product={"id": "prod_auto_1"},
                currency="usd",
            )

    class _FakePromoCodes:
        def create(self, **kwargs):
            promo_created.append(kwargs)
            return SimpleNamespace(id="promo_auto_1", code=kwargs["code"])

    class _FakeCheckoutCfgs:
        def create(self, **kwargs):
            cfg_calls.append(kwargs)
            return SimpleNamespace(
                id="ch_auto_1",
                purchase_url="https://whop.com/checkout/ch_auto_1",
                variant=None,
            )

    monkeypatch.setattr(settings, "whop_api_key", SecretStr("whop_live_test_secret"))
    whop._VARIANT_CACHE.clear()
    monkeypatch.setattr(
        whop,
        "_sdk_client",
        lambda: SimpleNamespace(
            variants=_FakeVariants(),
            promo_codes=_FakePromoCodes(),
            checkout_configurations=_FakeCheckoutCfgs(),
        ),
    )

    # Admin sees applicant's full details and approves with the manual Whop promo code + affiliate link.
    admin_list = admin_client.get("/api/v1/admin/affiliates").json()["partners"]
    listed = next(item for item in admin_list if item["user_id"] == partner_user_id)
    assert listed["full_name"] == "Alex Media"
    assert listed["contact_email"] == "alexmedia@gmail.com"
    assert listed["social_links"] == ["https://youtube.com/@alexmedia", "https://tiktok.com/@alexmedia"]

    approved = admin_client.post(
        f"/api/v1/admin/affiliates/partners/{partner_user_id}",
        json={"action": "approve", "code": code, "affiliate_link": aff_link},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["code"] == code
    assert approved.json()["affiliate_link"] == aff_link
    # Manual workflow: approving on ProteusFlow does NOT call Whop promo_codes.create.
    assert promo_created == []

    # Partner portal immediately shows their assigned promo code and Whop affiliate link.
    me_partner = partner_client.get("/api/v1/referrals/me").json()["partner"]
    assert me_partner["status"] == "approved"
    assert me_partner["code"] == code
    assert me_partner["affiliate_link"] == aff_link

    # Buyer subscribes cleanly using the base plan (leaving Whop's promo code box open) with server redirect_url back to /app/plan.
    co = visitor.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro", "provider": "whop"}).json()
    assert co["amount"] == 89.0
    assert co["whop_plan"] == "plan_pro"
    assert co["whop_checkout_config"] == "ch_auto_1"
    assert len(cfg_calls) == 1
    assert cfg_calls[0]["variant_id"] == "plan_pro"
    assert f"/app/plan?order={co['order_id']}" in cfg_calls[0]["redirect_url"]

    # Buyer entered promo code on Whop checkout -> webhook settles discounted total and attributes partner.
    paid_evt = _whop_event(
        co["order_id"],
        payment_id="pay_auto_1",
        variant_id="plan_pro",
        extra_data={"usd_total": 75.65, "promo_code": code, "metadata": {"order_id": co["order_id"]}},
    )
    assert _post_whop(paid_evt).json() == {"ok": True, "applied": True}

    me_after = partner_client.get("/api/v1/referrals/me").json()["partner"]
    assert me_after["stats"]["paying"] == 1
    assert me_after["totals"]["pending"] == round(75.65 * 0.25, 2)

    # Suspending the partner disables their code locally.
    susp = admin_client.post(f"/api/v1/admin/affiliates/partners/{partner_user_id}", json={"action": "suspend"})
    assert susp.status_code == 200 and susp.json()["status"] == "suspended"
    with get_session_factory()() as db:
        row = db.get(AffiliatePartner, partner_user_id)
        assert row is not None and row.status == "suspended"


