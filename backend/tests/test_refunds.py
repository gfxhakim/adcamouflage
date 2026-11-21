"""Customer cancel + refund requests, and the admin's approve / reject."""

from __future__ import annotations

import itertools
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import mailer, notify, refunds, whop
from app.auth_routes import login_limiter
from app.config import settings
from app.db import Order, RefundRequest, User, get_session_factory, init_db
from app.main import app
from app.tokens import balances, bucket_totals, consume, settle_order, TOPUP

from .conftest import make_legacy

RUN_ID = uuid.uuid4().hex[:10]
PASSWORD = "correct-horse-battery"
_counter = itertools.count()


def address(name: str) -> str:
    return f"{name}{next(_counter)}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    login_limiter._hits.clear()
    monkeypatch.setattr(settings, "whop_api_key", SecretStr("whop-api-key-placeholder"), raising=False)
    monkeypatch.setattr(settings, "whop_webhook_secret", SecretStr("ws_webhook-secret-placeholder"), raising=False)
    monkeypatch.setattr(settings, "whop_plan_subscription", {"starter": "plan_s", "pro": "plan_p", "max": "plan_m"}, raising=False)
    monkeypatch.setattr(settings, "whop_plan_topup", {"20": "plan_t20", "40": "plan_t40"}, raising=False)
    monkeypatch.setattr(settings, "public_url", "https://app.example.test")
    with get_session_factory()() as db:
        refunds.set_setting(db, refunds.SETTING, {})
        db.commit()
    yield


@pytest.fixture
def sent(monkeypatch):
    """Capture account emails and phone alerts instead of sending them."""

    mails: list[tuple[str, dict]] = []
    alerts: list[tuple[str, str]] = []
    monkeypatch.setattr(mailer, "send_kind", lambda db, user, kind, values=None, **kw: mails.append((kind, values or {})) or True)
    monkeypatch.setattr(notify, "alert", lambda event, title, lines, **kw: alerts.append((event, title)) or True)
    return {"mails": mails, "alerts": alerts}


def client_for(email: str) -> TestClient:
    client = TestClient(app)
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    client = client_for(email)
    make_legacy(email)
    return client


def session():
    return get_session_factory()()


def user_of(db, email: str) -> User:
    return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def buy(client: TestClient, email: str, kind: str = "subscription", plan_id: str = "pro", amount: float | None = None) -> str:
    body = {"kind": kind, "plan_id": plan_id, "provider": "whop"}
    if amount:
        body["amount"] = amount
    response = client.post("/api/v1/billing/checkout", json=body)
    assert response.status_code == 201, response.text
    order_id = response.json()["order_id"]
    with session() as db:
        assert settle_order(db, db.get(Order, order_id), source="test")
    return order_id


def spend(email: str, generations: int) -> None:
    with session() as db:
        consume(db, user_of(db, email), generations, f"batch-{uuid.uuid4().hex[:8]}")


def test_customer_cancel_sends_email_and_alert(sent):
    email = address("cancel")
    client = client_for(email)
    buy(client, email)
    response = client.post("/api/v1/billing/cancel", json={"reason": "Too expensive"})
    assert response.status_code == 200 and response.json()["cancelled"] is True
    assert [kind for kind, _ in sent["mails"]] == ["cancelled"]
    assert any(event == "cancel" for event, _ in sent["alerts"])
    # Cancelling twice changes nothing and sends nothing more.
    assert client.post("/api/v1/billing/cancel").status_code == 200
    assert len(sent["mails"]) == 1


def test_refund_request_stops_account_then_approve_refunds_via_whop(admin, sent, monkeypatch):
    email = address("refund")
    client = client_for(email)
    order_id = buy(client, email)
    with session() as db:
        order = db.get(Order, order_id)
        order.provider_ref = "pay_whop_refund_1"
        order.whop_membership_id = "mem_whop_refund_1"
        db.commit()

    cancel_calls: list[tuple[str, bool]] = []
    refund_calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        whop,
        "cancel_membership",
        lambda mem_id, *, at_period_end=True, reason="": cancel_calls.append((mem_id, at_period_end)) or {},
    )
    monkeypatch.setattr(
        whop,
        "refund_payment",
        lambda payment_id, *, amount=None, metadata=None: refund_calls.append((payment_id, amount, metadata or {})) or {"refund_id": "re_whop_1", "status": "pending"},
    )

    listed = client.get("/api/v1/billing/refunds").json()
    row = next(o for o in listed["orders"] if o["order_id"] == order_id)
    assert row["can_request"] is True and row["tokens_used"] == 0 and row["provider"] == "whop"
    assert row["tokens_remaining"] == 4500 and row["refundable_amount"] == pytest.approx(89.0)

    # Submitting a Whop refund request needs no crypto address and stops plan & account immediately.
    asked = client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "mistake", "details": "wrong plan"})
    assert asked.status_code == 201, asked.text
    body = asked.json()
    assert body["status"] == "pending" and body["account_stopped"] is True
    assert cancel_calls == [("mem_whop_refund_1", True)]
    assert ("refund_requested" in [k for k, _ in sent["mails"]]) and any(e == "refund" for e, _ in sent["alerts"])

    # Account is immediately paused and cannot call authenticated endpoints or render.
    assert client.get("/api/v1/auth/me").status_code == 401
    with session() as db:
        stopped_user = user_of(db, email)
        assert stopped_user.is_active is False
        assert stopped_user.sub_cancelled_at is not None
        assert stopped_user.sub_period_end <= datetime.now(timezone.utc).replace(tzinfo=stopped_user.sub_period_end.tzinfo)

    pending = admin.get("/api/v1/admin/refunds").json()
    mine = next(r for r in pending["requests"] if r["order"]["id"] == order_id)
    assert mine["status"] == "pending" and mine["in_rules"] is True and mine["user_is_active"] is False

    approved = admin.post(f"/api/v1/admin/refunds/{mine['id']}/approve", json={"note": "Refunded to card"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved" and approved.json()["tokens_removed"] == 4500
    assert approved.json()["refund_tx"] == "re_whop_1"
    assert len(refund_calls) == 1 and refund_calls[0][0] == "pay_whop_refund_1" and refund_calls[0][1] is None
    assert "refund_approved" in [k for k, _ in sent["mails"]]
    with session() as db:
        user = user_of(db, email)
        assert db.get(Order, order_id).status == "refunded"
        assert balances(db, user)[0] == 0
        assert user.is_active is False
        assert user.sub_cancelled_at is not None
        assert user.sub_period_end <= datetime.now(timezone.utc).replace(tzinfo=user.sub_period_end.tzinfo)
    assert admin.post(f"/api/v1/admin/refunds/{mine['id']}/reject", json={}).status_code == 409


def test_topup_refund_takes_back_only_whats_left(admin, sent):
    email = address("topup")
    client = client_for(email)
    buy(client, email)
    top = buy(client, email, kind="topup", amount=20)
    with session() as db:
        before = bucket_totals(db, user_of(db, email))[TOPUP]
    asked = client.post("/api/v1/billing/refunds", json={"order_id": top, "reason": "duplicate"})
    assert asked.status_code == 201, asked.text
    rid = asked.json()["id"]
    assert admin.post(f"/api/v1/admin/refunds/{rid}/approve", json={}).status_code == 200
    with session() as db:
        user = user_of(db, email)
        assert bucket_totals(db, user)[TOPUP] == 0 and before > 0
        assert user.is_active is False


def test_rules_block_late_or_used_orders_and_reject_sends_note_and_can_reactivate(admin, sent):
    email = address("rules")
    client = client_for(email)
    order_id = buy(client, email)
    spend(email, 15)  # 15 x 90 = 1,350 of 4,500 tokens = 30% used
    row = next(o for o in client.get("/api/v1/billing/refunds").json()["orders"] if o["order_id"] == order_id)
    assert row["can_request"] is False and "20%" in row["why_not"]
    assert client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "other"}).status_code == 409

    saved = admin.put(
        "/api/v1/admin/refunds/rules",
        json={"enabled": True, "window_days": 7, "max_used_percent": 50, "allow_subscriptions": True, "allow_topups": True},
    )
    assert saved.status_code == 200 and saved.json()["max_used_percent"] == 50
    asked = client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "quality"})
    assert asked.status_code == 201 and asked.json()["account_stopped"] is True
    rejected = admin.post(
        f"/api/v1/admin/refunds/{asked.json()['id']}/reject",
        json={"note": "Most tokens were used.", "reactivate_account": True},
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    assert rejected.json()["user_is_active"] is True
    kind, values = sent["mails"][-1]
    assert kind == "refund_rejected" and values["note"] == "Most tokens were used."
    with session() as db:
        assert db.get(Order, order_id).status == "paid"
        assert user_of(db, email).is_active is True

    # Log back in now that admin reactivated the account and check order status.
    assert client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 200
    row = next(o for o in client.get("/api/v1/billing/refunds").json()["orders"] if o["order_id"] == order_id)
    assert row["request"]["status"] == "rejected" and row["request"]["admin_note"] == "Most tokens were used."

    # Outside the window.
    with session() as db:
        order = db.get(Order, order_id)
        order.paid_at = datetime.now(timezone.utc) - timedelta(days=10)
        ok, why, _ = refunds.eligibility(db, order, refunds.get_rules(db))
        assert ok is False and "7 days" in why


def test_refund_stops_customer_and_other_cannot_touch_request(sent):
    email = address("withdraw")
    client = client_for(email)
    order_id = buy(client, email)
    rid = client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "not_needed"}).json()["id"]
    other = client_for(address("other"))
    assert other.post(f"/api/v1/billing/refunds/{rid}/withdraw").status_code == 404
    assert other.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "other"}).status_code == 404
    # Customer cannot self-serve withdraw or sign in after submitting while account is paused.
    assert client.post(f"/api/v1/billing/refunds/{rid}/withdraw").status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401


def test_legacy_crypto_wallet_checked_when_non_whop_or_provided(sent):
    email = address("wallet")
    client = client_for(email)
    order_id = buy(client, email)
    with session() as db:
        order = db.get(Order, order_id)
        order.provider = "btcpay"
        db.commit()
    missing = client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "other"})
    assert missing.status_code == 422
    wrong = client.post(
        "/api/v1/billing/refunds",
        json={"order_id": order_id, "reason": "other", "network": "usdc_eth", "address": "TXk3fJq8uK1e7P4m9yWbN2cR5sD6vH8gZa"},
    )
    assert wrong.status_code == 422 and "Ethereum" in wrong.json()["detail"]
    ok = client.post(
        "/api/v1/billing/refunds",
        json={"order_id": order_id, "reason": "other", "network": "usdc_eth", "address": " 0x52908400098527886E0F7030069857D2E4169EE7 "},
    )
    assert ok.status_code == 201 and ok.json()["address"] == "0x52908400098527886E0F7030069857D2E4169EE7"


def test_refund_emails_render():
    with session() as db:
        for kind in ("cancelled", "refund_requested", "refund_approved", "refund_rejected"):
            rendered = mailer.render(db, kind, {"name": "Sam", "plan": "the Pro plan", "amount": "$89", "order_id": "#1",
                                                "method": "Whop", "reason": "x", "note": "", "end_date": "1 Dec 2026",
                                                "plan_url": "https://x/app/plan"})
            assert rendered is not None and "{" not in rendered[0]


def test_refund_is_prorated_to_remaining_tokens_and_rejects_zero_balance(admin, sent, monkeypatch):
    email = address("prorated")
    client = client_for(email)
    order_id = buy(client, email)  # Pro = 4,500 tokens for $89
    with session() as db:
        order = db.get(Order, order_id)
        order.provider_ref = "pay_whop_partial_1"
        db.commit()

    # Use 15 generations (1,350 of 4,500 = 30% spent, 3,150 = 70% remaining -> $62.30 refundable).
    spend(email, 15)
    admin.put(
        "/api/v1/admin/refunds/rules",
        json={"enabled": True, "window_days": 7, "max_used_percent": 100, "allow_subscriptions": True, "allow_topups": True},
    )
    listed = client.get("/api/v1/billing/refunds").json()
    row = next(o for o in listed["orders"] if o["order_id"] == order_id)
    assert row["can_request"] is True
    assert row["tokens_used"] == 1350
    assert row["tokens_remaining"] == 3150
    assert row["refundable_amount"] == pytest.approx(62.30)

    refund_calls: list[tuple[str, float | None, dict]] = []
    monkeypatch.setattr(
        whop,
        "refund_payment",
        lambda payment_id, *, amount=None, metadata=None: refund_calls.append((payment_id, amount, metadata or {}))
        or {"refund_id": "re_whop_partial_1", "status": "succeeded"},
    )
    asked = client.post("/api/v1/billing/refunds", json={"order_id": order_id, "reason": "not_needed"})
    assert asked.status_code == 201, asked.text
    assert asked.json()["tokens_remaining"] == 3150
    assert asked.json()["refund_amount"] == pytest.approx(62.30)
    assert sent["mails"][-1][1]["amount"] == "$62.30"

    pending = admin.get("/api/v1/admin/refunds").json()
    mine = next(r for r in pending["requests"] if r["order"]["id"] == order_id)
    assert mine["in_rules"] is True
    assert mine["tokens_remaining"] == 3150
    assert mine["refund_amount"] == pytest.approx(62.30)

    approved = admin.post(f"/api/v1/admin/refunds/{mine['id']}/approve", json={})
    assert approved.status_code == 200, approved.text
    assert approved.json()["refund_amount"] == pytest.approx(62.30)
    assert len(refund_calls) == 1
    assert refund_calls[0][0] == "pay_whop_partial_1"
    assert refund_calls[0][1] == pytest.approx(62.30)
    assert sent["mails"][-1][0] == "refund_approved" and sent["mails"][-1][1]["amount"] == "$62.30"

    # Zero remaining tokens cannot be refunded even when max_used_percent is 100.
    empty_email = address("spentall")
    empty_client = client_for(empty_email)
    spent_order_id = buy(empty_client, empty_email)
    spend(empty_email, 50)  # 50 x 90 = 4,500 tokens -> 0 remaining
    empty_row = next(o for o in empty_client.get("/api/v1/billing/refunds").json()["orders"] if o["order_id"] == spent_order_id)
    assert empty_row["tokens_remaining"] == 0 and empty_row["refundable_amount"] == 0.0
    assert empty_row["can_request"] is False and "No unused tokens" in empty_row["why_not"]
    blocked = empty_client.post("/api/v1/billing/refunds", json={"order_id": spent_order_id, "reason": "other"})
    assert blocked.status_code == 409 and "No unused tokens" in blocked.json()["detail"]


def test_signup_rejects_unaccepted_policy():
    client = TestClient(app)
    res = client.post(
        "/api/v1/auth/register",
        json={"email": address("nopolicy"), "password": PASSWORD, "accepted_policy": False},
    )
    assert res.status_code == 422
    assert "Refund Policy" in res.json()["detail"]
