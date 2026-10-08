"""The client's own plan page: usage, history and plan requests."""

from __future__ import annotations

from app.auth_routes import login_limiter
from tests.test_admin import _signed_in, _upload, _user_id, address  # noqa: F401

import pytest

from app.config import settings
from app.db import init_db


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


@pytest.fixture
def admin(monkeypatch):
    email = address("sub-boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


def test_subscription_needs_a_session():
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/v1/auth/subscription").status_code == 401


def test_subscription_reports_usage_and_history(admin, sample_image):
    client = _signed_in(address("sub-client"))
    admin.patch(f"/api/v1/admin/users/{_user_id(client)}", json={"plan": "starter"})
    assert _upload(client, sample_image, 2).status_code == 202

    data = client.get("/api/v1/auth/subscription").json()
    assert data["plan"]["id"] == "starter" and data["plan"]["price"] == 19
    assert data["monthly_quota"] == 100
    assert data["used_this_month"] == 2 and data["left_this_month"] == 98
    assert data["files_total"] == 2 and data["batches_total"] == 1
    assert len(data["daily"]) == 30 and data["daily"][-1]["value"] == 2
    assert len(data["monthly"]) == 6 and data["monthly"][-1]["files"] == 2
    assert {p["id"] for p in data["plans"]} >= {"free", "starter", "pro", "unlimited"}
    assert data["pending_request"] is None


def test_plan_request_is_logged_once_for_the_admin(admin):
    client = _signed_in(address("sub-asker"))
    user_id = _user_id(client)

    assert client.post("/api/v1/auth/plan-request", json={"plan_id": "nope"}).status_code == 422
    first = client.post("/api/v1/auth/plan-request", json={"plan_id": "pro", "note": "need more"})
    assert first.status_code == 201, first.text
    again = client.post("/api/v1/auth/plan-request", json={"plan_id": "pro"})
    assert again.status_code == 201

    assert client.get("/api/v1/auth/subscription").json()["pending_request"]["plan_id"] == "pro"
    feed = admin.get("/api/v1/admin/activity", params={"kind": "plan_request"}).json()
    mine = [e for e in feed if e["user_id"] == user_id]
    assert len(mine) == 1 and "Pro" in mine[0]["detail"] and "need more" in mine[0]["detail"]

    # Once the admin moves them, the request is settled.
    admin.patch(f"/api/v1/admin/users/{user_id}", json={"plan": "pro"})
    assert client.get("/api/v1/auth/subscription").json()["pending_request"] is None
    assert client.post("/api/v1/auth/plan-request", json={"plan_id": "pro"}).status_code == 409
