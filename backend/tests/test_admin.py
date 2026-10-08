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
    # Customers must not be able to tell the admin API exists.
    assert "is_admin" not in user.get("/api/v1/auth/me").json()
    for path in ("/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/activity"):
        assert user.get(path).status_code == 404
    assert TestClient(app).get("/api/v1/admin/users").status_code == 401


def test_admin_email_setting_grants_access(admin):
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
    assert helper.get("/api/v1/admin/users").status_code == 404
    admin.patch(f"/api/v1/admin/users/{helper_id}", json={"is_admin": True})
    assert helper.get("/api/v1/admin/users").status_code == 200


def test_unknown_plan_is_rejected(admin):
    own_id = _user_id(admin)
    assert admin.patch(f"/api/v1/admin/users/{own_id}", json={"plan": "platinum"}).status_code == 422


def test_new_signups_get_the_default_plan(monkeypatch):
    _clear_setting("default_plan")
    monkeypatch.setattr(settings, "default_plan", "free")
    me = _signed_in(address("newbie")).get("/api/v1/auth/me").json()
    assert me["plan"] == "free" and me["monthly_quota"] == 10


def _clear_setting(key: str) -> None:
    from app.db import AppSetting, get_session_factory

    with get_session_factory()() as session:
        row = session.get(AppSetting, key)
        if row is not None:
            session.delete(row)
            session.commit()


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


# --------------------------------------------------------------------------
# tools, settings and analytics
# --------------------------------------------------------------------------


def test_admin_can_create_a_user_with_a_temporary_password(admin):
    email = address("invited")
    created = admin.post("/api/v1/admin/users", json={"email": email, "plan": "starter"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["user"]["plan"] == "starter" and body["user"]["monthly_quota"] == 100
    temporary = body["temporary_password"]
    assert temporary

    login = TestClient(app).post("/api/v1/auth/login", json={"email": email, "password": temporary})
    assert login.status_code == 200
    assert admin.post("/api/v1/admin/users", json={"email": email}).status_code == 409


def test_password_reset_signs_the_user_out_and_returns_a_new_password(admin):
    email = address("forgetful")
    target = _signed_in(email)
    target_id = _user_id(target)

    reset = admin.post(f"/api/v1/admin/users/{target_id}/reset-password")
    assert reset.status_code == 200
    assert target.get("/api/v1/auth/me").status_code == 401
    fresh = TestClient(app).post(
        "/api/v1/auth/login", json={"email": email, "password": reset.json()["temporary_password"]}
    )
    assert fresh.status_code == 200


def test_sign_out_everywhere(admin):
    target = _signed_in(address("roamer"))
    target_id = _user_id(target)
    assert admin.post(f"/api/v1/admin/users/{target_id}/sign-out").status_code == 200
    assert target.get("/api/v1/auth/me").status_code == 401


def test_extend_counts_from_the_end_date_or_from_now(admin):
    target = _signed_in(address("renewer"))
    target_id = _user_id(target)

    first = admin.post(f"/api/v1/admin/users/{target_id}/extend", json={"days": 30}).json()
    end = datetime.fromisoformat(first["plan_expires_at"].replace("Z", "+00:00"))
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    assert timedelta(days=29) < end - datetime.now(timezone.utc) <= timedelta(days=30)

    second = admin.post(f"/api/v1/admin/users/{target_id}/extend", json={"days": 30}).json()
    later = datetime.fromisoformat(second["plan_expires_at"].replace("Z", "+00:00"))
    if later.tzinfo is None:
        later = later.replace(tzinfo=timezone.utc)
    assert abs((later - end) - timedelta(days=30)) < timedelta(seconds=5)


def test_notes_are_saved(admin):
    target_id = _user_id(_signed_in(address("noted")))
    saved = admin.patch(f"/api/v1/admin/users/{target_id}", json={"admin_notes": "Paid by bank transfer"})
    assert saved.json()["admin_notes"] == "Paid by bank transfer"


def test_delete_user(admin):
    target = _signed_in(address("leaver"))
    target_id = _user_id(target)
    assert admin.delete(f"/api/v1/admin/users/{target_id}").status_code == 204
    assert admin.get(f"/api/v1/admin/users/{target_id}").status_code == 404
    assert target.get("/api/v1/auth/me").status_code == 401
    assert admin.delete(f"/api/v1/admin/users/{_user_id(admin)}").status_code == 400


def test_csv_export(admin):
    _signed_in(address("exported"))
    response = admin.get("/api/v1/admin/users/export.csv", params={"q": address("exported")})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.strip().splitlines()
    assert lines[0].startswith("id,email") and address("exported") in lines[1]


def test_settings_close_signups_and_set_the_announcement(admin):
    try:
        closed = admin.patch(
            "/api/v1/admin/settings",
            json={"registration_open": False, "announcement": "Maintenance tonight"},
        )
        assert closed.status_code == 200 and closed.json()["registration_open"] is False
        refused = TestClient(app).post(
            "/api/v1/auth/register", json={"email": address("late"), "password": "correct-horse-battery"}
        )
        assert refused.status_code == 403
        assert admin.get("/api/v1/auth/me").json()["announcement"] == "Maintenance tonight"
    finally:
        _clear_setting("registration_open")
        _clear_setting("announcement")


def test_default_plan_setting_applies_to_new_signups(admin):
    try:
        admin.patch("/api/v1/admin/settings", json={"default_plan": "starter"})
        me = _signed_in(address("starter-signup")).get("/api/v1/auth/me").json()
        assert me["plan"] == "starter" and me["monthly_quota"] == 100
    finally:
        _clear_setting("default_plan")


def test_editing_a_plan_moves_users_on_its_default_limit(admin):
    plans = {p["id"]: p for p in admin.get("/api/v1/admin/plans").json()}
    original = plans["pro"]
    regular = _user_id(_signed_in(address("pro-regular")))
    custom = _user_id(_signed_in(address("pro-custom")))
    admin.patch(f"/api/v1/admin/users/{regular}", json={"plan": "pro"})
    admin.patch(f"/api/v1/admin/users/{custom}", json={"plan": "pro", "monthly_quota": 42})
    try:
        edited = admin.put(
            "/api/v1/admin/plans/pro",
            json={"label": "Pro+", "monthly_quota": 700, "price": 59, "apply_to_users": True},
        )
        assert edited.status_code == 200, edited.text
        assert admin.get(f"/api/v1/admin/users/{regular}").json()["user"]["monthly_quota"] == 700
        assert admin.get(f"/api/v1/admin/users/{custom}").json()["user"]["monthly_quota"] == 42
        assert admin.get(f"/api/v1/admin/users/{regular}").json()["user"]["plan_label"] == "Pro+"
    finally:
        admin.put(
            "/api/v1/admin/plans/pro",
            json={
                "label": original["label"],
                "monthly_quota": original["monthly_quota"],
                "price": original["price"],
                "apply_to_users": True,
            },
        )


def test_analytics_report_revenue_and_upgrade_candidates(admin, sample_image):
    paying = _signed_in(address("payer"))
    paying_id = _user_id(paying)
    admin.patch(f"/api/v1/admin/users/{paying_id}", json={"plan": "starter", "monthly_quota": 2})
    assert _upload(paying, sample_image, 2).status_code == 202
    assert _upload(paying, sample_image, 1).status_code == 402

    report = admin.get("/api/v1/admin/analytics", params={"days": 30})
    assert report.status_code == 200, report.text
    data = report.json()
    assert data["mrr"] >= 19 and data["paying_users"] >= 1
    assert len(data["signups"]) == 30 and len(data["files"]) == 30
    assert any(u["id"] == paying_id for u in data["near_limit"])
    assert any(u["id"] == paying_id for u in data["hit_limit"])
    assert any(u["id"] == paying_id for u in data["top_users"])

    overview = admin.get("/api/v1/admin/overview").json()
    assert overview["mrr"] >= 19 and overview["hit_limit_this_month"] >= 1


def test_public_plans_follow_admin_edits(admin):
    visitor = TestClient(app)
    listed = visitor.get("/api/v1/plans")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["currency"]
    assert [p["id"] for p in body["plans"]] == ["free", "starter", "pro", "unlimited"]
    assert "users" not in body["plans"][0]

    original = next(p for p in body["plans"] if p["id"] == "starter")
    try:
        edited = admin.put(
            "/api/v1/admin/plans/starter",
            json={"label": "Starter", "monthly_quota": 150, "price": 25, "apply_to_users": False},
        )
        assert edited.status_code == 200, edited.text
        starter = next(p for p in visitor.get("/api/v1/plans").json()["plans"] if p["id"] == "starter")
        assert starter["monthly_quota"] == 150 and starter["price"] == 25
    finally:
        admin.put(
            "/api/v1/admin/plans/starter",
            json={
                "label": original["label"],
                "monthly_quota": original["monthly_quota"],
                "price": original["price"],
                "apply_to_users": False,
            },
        )
