"""Admin 'Delete all users': keeps admins, removes everyone else and their data.

Named to run last: it wipes every non-admin account in the shared test DB.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import purge as purge_mod
from app.auth_routes import login_limiter
from app.config import settings
from app.db import ActivityEvent, Order, SupportThread, TeamMember, TokenLedger, User, get_session_factory, init_db
from app.main import app

RUN = uuid.uuid4().hex[:8]


def _client(email: str) -> TestClient:
    login_limiter._hits.clear()
    c = TestClient(app)
    r = c.post("/api/v1/auth/register", json={"email": email, "password": "correct-horse-battery"})
    assert r.status_code in (200, 201), r.text
    return c


def _seed_customer(email: str) -> int:
    _client(email)
    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == email))
        db.add(TokenLedger(user_id=user.id, bucket="sub", kind="grant", amount=100))
        db.add(Order(id=f"o-{uuid.uuid4().hex[:10]}", user_id=user.id, kind="subscription", plan_id="pro", amount_usd=89))
        db.add(SupportThread(user_id=user.id))
        db.add(TeamMember(owner_id=user.id, email=f"seat-{uuid.uuid4().hex[:6]}@example.com"))
        db.commit()
        return user.id


@pytest.fixture
def boss(monkeypatch):
    init_db()
    email = f"boss-{RUN}@example.com"
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _client(email), email


def test_preview_then_purge_keeps_admins(boss):
    admin, admin_email = boss
    flagged = f"flagged-admin-{RUN}@example.com"
    _client(flagged)
    with get_session_factory()() as db:
        db.scalar(select(User).where(User.email == flagged)).is_admin = True
        db.commit()
    ids = [_seed_customer(f"cust{i}-{RUN}@example.com") for i in range(3)]

    preview = admin.get("/api/v1/admin/purge-users").json()
    assert preview["users"] >= 3
    assert preview["orders"] >= 3 and preview["support_threads"] >= 3
    assert admin_email in preview["kept"] and flagged in preview["kept"]
    assert preview["confirm_phrase"] == purge_mod.CONFIRM_PHRASE

    # Wrong phrase and stale count are both refused, nothing deleted.
    bad = admin.post("/api/v1/admin/purge-users", json={"confirm": "yes", "expected_users": preview["users"]})
    assert bad.status_code == 400
    stale = admin.post(
        "/api/v1/admin/purge-users",
        json={"confirm": purge_mod.CONFIRM_PHRASE, "expected_users": preview["users"] + 1},
    )
    assert stale.status_code == 409

    done = admin.post(
        "/api/v1/admin/purge-users",
        json={"confirm": purge_mod.CONFIRM_PHRASE, "expected_users": preview["users"]},
    )
    assert done.status_code == 200, done.text
    assert done.json()["users"] == preview["users"]

    with get_session_factory()() as db:
        emails = set(db.scalars(select(User.email)).all())
        assert emails == {admin_email, flagged}
        for model in (TokenLedger, Order, SupportThread):
            assert db.scalar(select(func.count()).select_from(model).where(model.user_id.in_(ids))) == 0
        assert db.scalar(select(func.count()).select_from(TeamMember).where(TeamMember.owner_id.in_(ids))) == 0
        assert db.scalar(select(func.count()).select_from(ActivityEvent).where(ActivityEvent.user_id.in_(ids))) == 0

    # The admin is still signed in and the panel still works.
    assert admin.get("/api/v1/admin/purge-users").json()["users"] == 0


def test_purge_is_admin_only():
    init_db()
    customer = _client(f"nosy-{RUN}@example.com")
    assert customer.get("/api/v1/admin/purge-users").status_code in (401, 403, 404)
    assert customer.post(
        "/api/v1/admin/purge-users", json={"confirm": purge_mod.CONFIRM_PHRASE, "expected_users": 0}
    ).status_code in (401, 403, 404)


def test_cli_dry_run_changes_nothing_and_yes_deletes(capsys, monkeypatch):
    init_db()
    keep = f"keeper-{RUN}@example.com"
    monkeypatch.setattr(settings, "admin_emails", [])
    _client(keep)
    _seed_customer(f"cli-cust-{RUN}@example.com")

    assert purge_mod.main(["--keep", keep]) == 0
    assert "Would delete" in capsys.readouterr().out
    with get_session_factory()() as db:
        assert db.scalar(select(User).where(User.email == f"cli-cust-{RUN}@example.com")) is not None

    assert purge_mod.main(["--keep", keep, "--yes"]) == 0
    with get_session_factory()() as db:
        assert db.scalar(select(User).where(User.email == f"cli-cust-{RUN}@example.com")) is None
        assert db.scalar(select(User).where(User.email == keep)) is not None
