"""Team seats: a Max owner adds members who share the owner's token balance."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth_routes import login_limiter
from app.db import TeamMember, User, get_session_factory, init_db
from app.main import app
from app.teams import billing_account
from app.tokens import balances, consume, get_token_plans, save_token_plans

from .conftest import grant_max_period

RUN_ID = uuid.uuid4().hex[:10]
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


def signed_in(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def load(db, email: str) -> User:
    return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def test_plans_carry_seats():
    with get_session_factory()() as db:
        plans = get_token_plans(db)
    assert plans["starter"].seats == 1
    assert plans["pro"].seats == 1
    assert plans["max"].seats == 5
    response = TestClient(app).get("/api/v1/plans")
    seats = {p["id"]: p["seats"] for p in response.json()["plans"]}
    assert seats == {"starter": 1, "pro": 1, "max": 5}


def test_single_user_plan_cannot_add_members():
    email = address("solo")
    client = signed_in(email)
    grant_max_period(email, "pro")
    team = client.get("/api/v1/team").json()
    assert team["role"] == "none" and team["seats"] == 1
    response = client.post("/api/v1/team/members", json={"email": address("friend")})
    assert response.status_code == 403


def test_max_owner_adds_member_who_spends_shared_tokens():
    owner_email, member_email = address("owner"), address("member")
    owner = signed_in(owner_email)
    grant_max_period(owner_email)

    # The seat can be filled before the person signs up.
    response = owner.post("/api/v1/team/members", json={"email": member_email.upper()})
    assert response.status_code == 201, response.text
    team = response.json()
    assert team["role"] == "owner" and team["seats"] == 5 and team["seats_used"] == 2
    assert team["members"][0]["email"] == member_email and team["members"][0]["joined"] is False

    member = signed_in(member_email)
    me = member.get("/api/v1/auth/me").json()
    assert me["subscription_active"] is True and me["tokens_usable"] == 9600
    sub = member.get("/api/v1/auth/subscription").json()
    assert sub["team"]["role"] == "member" and sub["team"]["owner_email"] == owner_email
    assert sub["team"]["sharing"] is True
    assert sub["subscription"]["plan_id"] == "max"
    assert sub["balance"]["usable_tokens"] == 9600

    with get_session_factory()() as db:
        member_user = load(db, member_email)
        payer = billing_account(db, member_user)
        assert payer.email == owner_email
        consume(db, payer, 2, "batch_team_test")
        assert balances(db, load(db, owner_email)) == (9600 - 160, 0)
        assert balances(db, member_user) == (0, 0)

    assert owner.get("/api/v1/team").json()["members"][0]["joined"] is True

    # Members cannot buy their own plan while on the team.
    checkout = member.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"})
    assert checkout.status_code == 409

    # Removing the member stops the sharing.
    response = owner.delete(f"/api/v1/team/members/{member_email}")
    assert response.status_code == 200 and response.json()["members"] == []
    assert member.get("/api/v1/auth/me").json()["tokens_usable"] == 0


def test_seat_limit_and_conflicts():
    owner_email = address("full")
    owner = signed_in(owner_email)
    grant_max_period(owner_email)
    for index in range(4):
        assert owner.post("/api/v1/team/members", json={"email": address(f"seat{index}")}).status_code == 201
    response = owner.post("/api/v1/team/members", json={"email": address("seat-extra")})
    assert response.status_code == 409 and "seats" in response.json()["detail"]

    assert owner.post("/api/v1/team/members", json={"email": address("seat0")}).status_code == 409
    assert owner.post("/api/v1/team/members", json={"email": owner_email}).status_code == 422
    assert owner.post("/api/v1/team/members", json={"email": "not-an-email"}).status_code == 422

    # Someone on another team cannot be added.
    other_email = address("other-owner")
    other = signed_in(other_email)
    grant_max_period(other_email)
    assert other.post("/api/v1/team/members", json={"email": address("seat1")}).status_code == 409

    # An account with its own live plan cannot be added.
    paying = address("paying")
    signed_in(paying)
    grant_max_period(paying, "starter")
    assert other.post("/api/v1/team/members", json={"email": paying}).status_code == 409


def test_fewer_seats_keeps_earliest_members():
    owner_email = address("shrink")
    owner = signed_in(owner_email)
    grant_max_period(owner_email)
    first, second = address("shrink-a"), address("shrink-b")
    owner.post("/api/v1/team/members", json={"email": first})
    owner.post("/api/v1/team/members", json={"email": second})
    signed_in(first)
    second_client = signed_in(second)

    with get_session_factory()() as db:
        save_token_plans(db, {"max": {"seats": 2}})
        db.commit()
    try:
        team = owner.get("/api/v1/team").json()
        assert [m["sharing"] for m in team["members"]] == [True, False]
        with get_session_factory()() as db:
            assert billing_account(db, load(db, first)).email == owner_email
            assert billing_account(db, load(db, second)).email == second
        assert second_client.get("/api/v1/team").json()["sharing"] is False
        # Leaving drops the seat entirely.
        assert second_client.post("/api/v1/team/leave").json()["role"] == "none"
        with get_session_factory()() as db:
            assert db.execute(select(TeamMember).where(TeamMember.email == second)).scalar_one_or_none() is None
    finally:
        with get_session_factory()() as db:
            save_token_plans(db, {"max": {"seats": 5}})
            db.commit()


def test_admin_can_edit_seats(monkeypatch):
    from app.config import settings
    from .conftest import make_legacy

    email = address("seat-admin")
    monkeypatch.setattr(settings, "admin_emails", [email])
    admin = signed_in(email)
    make_legacy(email)
    config = admin.get("/api/v1/admin/billing/config").json()
    assert config["plans"]["max"]["seats"] == 5
    plan = dict(config["plans"]["max"])
    edit = {k: plan[k] for k in ("label", "price", "tokens", "tokens_per_generation", "rollover_months", "topup_rate")}
    try:
        response = admin.put("/api/v1/admin/billing/config", json={"plans": {"max": {**edit, "seats": 8}}})
        assert response.status_code == 200, response.text
        assert response.json()["plans"]["max"]["seats"] == 8
        # Saving without seats keeps the stored value.
        response = admin.put("/api/v1/admin/billing/config", json={"plans": {"max": edit}})
        assert response.json()["plans"]["max"]["seats"] == 8
    finally:
        admin.put("/api/v1/admin/billing/config", json={"plans": {"max": {**edit, "seats": 5}}})
