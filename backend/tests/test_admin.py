"""Admin panel: access control, plans, quotas and the activity feed."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth_routes import login_limiter
from app.config import settings
from app.db import get_engine, init_db
from app.main import app

RUN_ID = uuid.uuid4().hex[:12]


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


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


def _signed_in(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": "correct-horse-battery"}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _user_id(client: TestClient) -> int:
    return client.get("/api/v1/auth/me").json()["id"]


def _upload(client: TestClient, image, count: int = 1):
    files = [("files", (f"a{i}.jpg", image.read_bytes(), "image/jpeg")) for i in range(count)]
    return client.post("/api/v1/batches", files=files)


def test_regular_users_cannot_open_the_admin_api():
    user = _signed_in(address("plain"))
    assert user.get("/api/v1/auth/me").json()["is_admin"] is False
    for path in ("/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/activity"):
        assert user.get(path).status_code == 403
    assert TestClient(app).get("/api/v1/admin/users").status_code == 401


def test_admin_email_setting_grants_access(admin):
    assert admin.get("/api/v1/auth/me").json()["is_admin"] is True
    overview = admin.get("/api/v1/admin/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["total_users"] >= 1
    assert len(overview.json()["daily"]) == 14


def test_admin_can_search_and_change_a_users_plan(admin):
    target_email = address("customer")
    target = _signed_in(target_email)
    target_id = _user_id(target)

    page = admin.get("/api/v1/admin/users", params={"q": target_email}).json()
    assert page["total"] == 1 and page["users"][0]["email"] == target_email

    changed = admin.patch(f"/api/v1/admin/users/{target_id}", json={"plan": "pro"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["plan"] == "pro" and changed.json()["monthly_quota"] == 500

    custom = admin.patch(f"/api/v1/admin/users/{target_id}", json={"monthly_quota": 3})
    assert custom.json()["monthly_quota"] == 3 and custom.json()["plan"] == "pro"

    unlimited = admin.patch(f"/api/v1/admin/users/{target_id}", json={"monthly_quota": None})
    assert unlimited.json()["monthly_quota"] is None

    me = target.get("/api/v1/auth/me").json()
    assert me["plan"] == "pro" and me["monthly_quota"] is None

    detail = admin.get(f"/api/v1/admin/users/{target_id}").json()
    kinds = [event["kind"] for event in detail["activity"]]
    assert "signup" in kinds and "admin" in kinds


def test_quota_blocks_batches_and_reset_gives_it_back(admin, sample_image):
    target = _signed_in(address("quota"))
    target_id = _user_id(target)
    admin.patch(f"/api/v1/admin/users/{target_id}", json={"monthly_quota": 2})

    assert _upload(target, sample_image, 1).status_code == 202
    assert target.get("/api/v1/auth/me").json()["used_this_month"] == 1

    refused = _upload(target, sample_image, 2)
    assert refused.status_code == 402
    assert "1 left" in refused.json()["detail"]

    assert _upload(target, sample_image, 1).status_code == 202
    assert _upload(target, sample_image, 1).status_code == 402

    reset = admin.post(f"/api/v1/admin/users/{target_id}/reset-usage")
    assert reset.json()["used_this_month"] == 0
    assert _upload(target, sample_image, 1).status_code == 202

    feed = admin.get("/api/v1/admin/activity", params={"limit": 200}).json()
    assert any(e["user_id"] == target_id and e["kind"] == "blocked" for e in feed)
    assert any(e["user_id"] == target_id and e["kind"] == "batch" for e in feed)


def test_expired_plan_blocks_new_batches(admin, sample_image):
    target = _signed_in(address("expired"))
    target_id = _user_id(target)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin.patch(f"/api/v1/admin/users/{target_id}", json={"plan_expires_at": yesterday})

    assert target.get("/api/v1/auth/me").json()["plan_expired"] is True
    response = _upload(target, sample_image, 1)
    assert response.status_code == 402 and "expired" in response.json()["detail"]


def test_suspending_a_user_ends_their_session(admin):
    target = _signed_in(address("suspend"))
    target_id = _user_id(target)

    assert admin.patch(f"/api/v1/admin/users/{target_id}", json={"is_active": False}).status_code == 200
    assert target.get("/api/v1/auth/me").status_code == 401

    admin.patch(f"/api/v1/admin/users/{target_id}", json={"is_active": True})
    again = TestClient(app).post(
        "/api/v1/auth/login",
        json={"email": address("suspend"), "password": "correct-horse-battery"},
    )
    assert again.status_code == 200


def test_admin_cannot_lock_themselves_out(admin):
    own_id = _user_id(admin)
    assert admin.patch(f"/api/v1/admin/users/{own_id}", json={"is_active": False}).status_code == 400
    assert admin.patch(f"/api/v1/admin/users/{own_id}", json={"is_admin": False}).status_code == 400


def test_promoted_admin_gets_access(admin):
    helper = _signed_in(address("helper"))
    helper_id = _user_id(helper)
    assert helper.get("/api/v1/admin/users").status_code == 403
    admin.patch(f"/api/v1/admin/users/{helper_id}", json={"is_admin": True})
    assert helper.get("/api/v1/admin/users").status_code == 200


def test_unknown_plan_is_rejected(admin):
    own_id = _user_id(admin)
    assert admin.patch(f"/api/v1/admin/users/{own_id}", json={"plan": "platinum"}).status_code == 422


def test_new_signups_get_the_default_plan(monkeypatch):
    monkeypatch.setattr(settings, "default_plan", "free")
    me = _signed_in(address("newbie")).get("/api/v1/auth/me").json()
    assert me["plan"] == "free" and me["monthly_quota"] == 10


def test_columns_are_added_to_an_existing_users_table():
    """Deployed databases predate the plan columns; start-up must add them."""

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS legacy_probe (id INTEGER)"))
    from app import db as db_module

    original = db_module._ADDED_COLUMNS
    try:
        db_module._ADDED_COLUMNS = [("legacy_probe", "plan", "VARCHAR(32) NOT NULL DEFAULT 'unlimited'")]
        init_db()
        init_db()  # idempotent
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO legacy_probe (id) VALUES (1)"))
            assert conn.execute(text("SELECT plan FROM legacy_probe")).scalar_one() == "unlimited"
    finally:
        db_module._ADDED_COLUMNS = original
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE legacy_probe"))
