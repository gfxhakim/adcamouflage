"""Admin > Users plan tools: cancel (end of period / now), resume, extend days, bonus tokens, audit trail."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth_routes import login_limiter
from app.config import settings
from app.db import AdminAudit, User, get_session_factory, init_db
from app.main import app
from app.plans import aware
from app.tokens import activate_period, balances, get_token_plans

from .conftest import make_legacy

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"


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
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


@pytest.fixture
def admin(monkeypatch):
    email = address("plan-tools-boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    client = _signed_in(email)
    make_legacy(email)
    return client


def _with_user(email: str, fn):
    with get_session_factory()() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        result = fn(db, user)
        db.commit()
        return result


def _customer(name: str, plan: str | None = "pro") -> tuple[TestClient, int, str]:
    email = address(name)
    client = _signed_in(email)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    if plan:
        _with_user(email, lambda db, user: activate_period(db, user, get_token_plans(db)[plan]))
    return client, user_id, email


def _audit(user_id: int) -> list[AdminAudit]:
    with get_session_factory()() as db:
        return (
            db.execute(select(AdminAudit).where(AdminAudit.user_id == user_id).order_by(AdminAudit.id))
            .scalars()
            .all()
        )


def _url(user_id: int, action: str) -> str:
    return f"/api/v1/admin/users/{user_id}/billing/{action}"


# --------------------------------------------------------------------------
# cancel
# --------------------------------------------------------------------------


def test_cancel_at_period_end_keeps_access_and_blocks_rollover(admin):
    client, user_id, email = _customer("cancel-end")
    before = client.get("/api/v1/auth/subscription").json()["subscription"]["period_end"]

    response = admin.post(_url(user_id, "cancel"), json={"mode": "end_of_period", "reason": "asked by email"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subscription"]["cancelled"] is True and body["subscription"]["active"] is True
    assert body["balance"]["subscription_tokens"] == 4500  # nothing written off yet
    assert body["subscription"]["period_end"] == before
    assert body["audit"][0]["action"] == "cancel_end" and "asked by email" in body["audit"][0]["detail"]

    # Cancelling again at the end is refused; the customer sees the same state.
    assert admin.post(_url(user_id, "cancel"), json={"mode": "end_of_period"}).status_code == 409
    assert client.get("/api/v1/auth/subscription").json()["subscription"]["cancelled"] is True

    # The existing loss-on-cancel rule: the next purchase gets no rollover.
    result = _with_user(email, lambda db, user: activate_period(db, user, get_token_plans(db)["pro"]))
    assert result["rollover"] == 0 and result["expired"] == 4500


def test_cancel_now_ends_period_writes_off_subscription_and_freezes_topups(admin):
    client, user_id, email = _customer("cancel-now")
    assert admin.post(_url(user_id, "bonus"), json={"amount": 300}).status_code == 200

    response = admin.post(_url(user_id, "cancel"), json={"mode": "now", "reason": "refunded $89"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subscription"]["active"] is False and body["subscription"]["cancelled"] is True
    assert body["balance"]["subscription_tokens"] == 0
    assert body["balance"]["topup_tokens"] == 300 and body["balance"]["frozen_topup"] is True
    assert body["balance"]["usable_tokens"] == 0
    assert body["ledger"][0]["kind"] == "expire" and body["ledger"][0]["amount"] == -4500
    assert "refunded $89" in body["ledger"][0]["note"]
    assert aware(_with_user(email, lambda db, user: user.sub_period_end)) <= datetime.now(timezone.utc)

    # The customer can no longer generate.
    sub = client.get("/api/v1/auth/subscription").json()
    assert sub["balance"]["usable_tokens"] == 0

    # Nothing left to cancel or resume.
    assert admin.post(_url(user_id, "cancel"), json={"mode": "now"}).status_code == 409
    assert admin.post(_url(user_id, "resume")).status_code == 409

    rows = _audit(user_id)
    assert [r.action for r in rows] == ["bonus_tokens", "cancel_now"]
    assert rows[-1].admin_email == address("plan-tools-boss") and rows[-1].user_email == email
    assert "4500 subscription tokens written off" in rows[-1].detail


def test_cancel_validation(admin):
    _client, user_id, _email = _customer("cancel-none", plan=None)
    assert admin.post(_url(user_id, "cancel"), json={"mode": "now"}).status_code == 409
    assert admin.post(_url(user_id, "cancel"), json={"mode": "later"}).status_code == 422
    assert admin.post("/api/v1/admin/users/999999999/billing/cancel", json={"mode": "now"}).status_code == 404


def test_resume_undoes_end_of_period_cancel(admin):
    _client, user_id, _email = _customer("resume")
    admin.post(_url(user_id, "cancel"), json={"mode": "end_of_period"})
    response = admin.post(_url(user_id, "resume"))
    assert response.status_code == 200, response.text
    assert response.json()["subscription"]["cancelled"] is False
    assert admin.post(_url(user_id, "resume")).status_code == 409
    assert [r.action for r in _audit(user_id)] == ["cancel_end", "resume"]


# --------------------------------------------------------------------------
# extend
# --------------------------------------------------------------------------


def test_extend_adds_days_from_period_end_without_tokens(admin):
    _client, user_id, email = _customer("extend")
    old_end = aware(_with_user(email, lambda db, user: user.sub_period_end))

    response = admin.post(_url(user_id, "extend"), json={"days": 7, "reason": "outage"})
    assert response.status_code == 200, response.text
    body = response.json()
    new_end = aware(_with_user(email, lambda db, user: user.sub_period_end))
    assert new_end - old_end == timedelta(days=7)
    assert body["subscription"]["days_left"] == 37
    assert body["balance"]["subscription_tokens"] == 4500  # no tokens added
    row = _audit(user_id)[-1]
    assert row.action == "extend_period" and "by 7 days" in row.detail and "outage" in row.detail


def test_extend_a_lapsed_period_counts_from_today(admin):
    _client, user_id, email = _customer("extend-lapsed")

    def lapse(db, user):
        user.sub_period_end = datetime.now(timezone.utc) - timedelta(days=3)

    _with_user(email, lapse)
    response = admin.post(_url(user_id, "extend"), json={"days": 10})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subscription"]["active"] is True and body["subscription"]["days_left"] == 10
    # The tokens were never written off, so they are usable again.
    assert body["balance"]["usable_tokens"] == 4500


def test_extend_validation(admin):
    _client, user_id, _email = _customer("extend-none", plan=None)
    assert admin.post(_url(user_id, "extend"), json={"days": 5}).status_code == 409
    _client, user_id, _email = _customer("extend-bad")
    assert admin.post(_url(user_id, "extend"), json={"days": 0}).status_code == 422
    assert admin.post(_url(user_id, "extend"), json={"days": 366}).status_code == 422


# --------------------------------------------------------------------------
# bonus tokens
# --------------------------------------------------------------------------


def test_bonus_tokens_go_to_topup_bucket(admin):
    _client, user_id, email = _customer("bonus")
    response = admin.post(_url(user_id, "bonus"), json={"amount": 250, "note": "  sorry   for the wait "})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["balance"]["topup_tokens"] == 250
    assert body["balance"]["usable_tokens"] == 4500 + 250
    assert body["ledger"][0]["kind"] == "bonus" and body["ledger"][0]["note"] == "Admin bonus: sorry for the wait"
    assert _with_user(email, lambda db, user: balances(db, user)) == (4500, 250)
    row = _audit(user_id)[-1]
    assert row.action == "bonus_tokens" and row.detail == "+250 bonus tokens: sorry for the wait"

    assert admin.post(_url(user_id, "bonus"), json={"amount": 0}).status_code == 422
    assert admin.post(_url(user_id, "bonus"), json={"amount": -5}).status_code == 422


# --------------------------------------------------------------------------
# audit trail
# --------------------------------------------------------------------------


def test_audit_endpoint_lists_actions_and_is_admin_only(admin):
    customer, user_id, _email = _customer("audit")
    admin.post(_url(user_id, "bonus"), json={"amount": 10})
    admin.post(_url(user_id, "extend"), json={"days": 1})
    admin.post(_url(user_id, "grant"), json={"plan_id": "max", "months": 1})
    admin.post(_url(user_id, "tokens"), json={"amount": -5, "note": "fix"})

    rows = admin.get("/api/v1/admin/audit", params={"user_id": user_id}).json()
    assert [r["action"] for r in rows] == ["adjust_tokens", "grant_period", "extend_period", "bonus_tokens"]
    assert all(r["admin_email"] == address("plan-tools-boss") for r in rows)
    assert all(r["created_at"] for r in rows)
    assert admin.get("/api/v1/admin/audit").status_code == 200

    # Customers never see the admin API.
    assert customer.get("/api/v1/admin/audit").status_code == 404
    assert customer.post(_url(user_id, "bonus"), json={"amount": 1000}).status_code == 404


def test_audit_survives_account_delete(admin):
    _client, user_id, email = _customer("audit-delete")
    admin.post(_url(user_id, "bonus"), json={"amount": 5})
    assert admin.delete(f"/api/v1/admin/users/{user_id}").status_code == 204
    rows = _audit(user_id)
    assert len(rows) == 1 and rows[0].user_email == email
