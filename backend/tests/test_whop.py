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
    assert response.status_code in (200, 201), response.text
    return client


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

    for ev_type in ("payment.failed", "payment.pending", "membership.activated"):
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
