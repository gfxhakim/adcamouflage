"""Admin-editable guides (the public /guides articles)."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth_routes import login_limiter
from app.config import settings
from app.db import init_db
from app.main import app

RUN_ID = uuid.uuid4().hex[:12]


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


def _client(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": "correct-horse-battery"}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


@pytest.fixture
def admin(monkeypatch):
    email = f"guides-{RUN_ID}@example.com"
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _client(email)


def test_customers_cannot_edit_guides():
    user = _client(f"guides-plain-{RUN_ID}@example.com")
    assert user.get("/api/v1/admin/guides").status_code == 404
    assert user.put("/api/v1/admin/guides/x", json={"title": "Nope"}).status_code == 404


def test_save_publish_hide_and_delete(admin):
    slug = f"test-guide-{RUN_ID}"
    body = {"title": "How to test", "description": "A short test.", "body": "## Hello\n\nText", "published": True}
    saved = admin.put(f"/api/v1/admin/guides/{slug}", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["slug"] == slug

    public = TestClient(app).get("/api/v1/guides").json()
    assert any(g["slug"] == slug for g in public["guides"])

    hidden = admin.put(f"/api/v1/admin/guides/{slug}", json={**body, "published": False})
    assert hidden.json()["created_at"] == saved.json()["created_at"]
    public = TestClient(app).get("/api/v1/guides").json()
    assert not any(g["slug"] == slug for g in public["guides"])
    assert slug in public["unpublished"]

    assert admin.delete(f"/api/v1/admin/guides/{slug}").status_code == 204
    assert admin.delete(f"/api/v1/admin/guides/{slug}").status_code == 404
    assert slug not in TestClient(app).get("/api/v1/guides").json()["unpublished"]


def test_rejects_bad_slug_and_cover(admin):
    assert admin.put("/api/v1/admin/guides/Bad Slug!", json={"title": "Title"}).status_code == 422
    bad_cover = {"title": "Title", "cover": "javascript:alert(1)"}
    assert admin.put(f"/api/v1/admin/guides/cover-{RUN_ID}", json=bad_cover).status_code == 422
