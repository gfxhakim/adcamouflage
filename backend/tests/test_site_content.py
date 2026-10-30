"""Admin-editable landing/workspace content: draft, publish, media."""

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
    email = f"editor-{RUN_ID}@example.com"
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _client(email)


def test_public_content_starts_empty():
    response = TestClient(app).get("/api/v1/site-content/workspace")
    assert response.status_code == 200
    assert isinstance(response.json()["content"], dict)
    assert TestClient(app).get("/api/v1/site-content/nope").status_code == 404


def test_customers_cannot_edit_content():
    user = _client(f"plain-{RUN_ID}@example.com")
    assert user.get("/api/v1/admin/site-content/landing").status_code == 404
    assert user.put("/api/v1/admin/site-content/landing/draft", json={"text": {}}).status_code == 404
    assert user.post("/api/v1/admin/site-content/landing/publish").status_code == 404


def test_draft_stays_private_until_published(admin):
    document = {"text": {"hero.badge": "Hello"}, "theme": {"accent": "#0866ff"}}
    saved = admin.put("/api/v1/admin/site-content/landing/draft", json=document)
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft"] == document

    public = TestClient(app).get("/api/v1/site-content/landing").json()["content"]
    assert public.get("text", {}).get("hero.badge") != "Hello"

    published = admin.post("/api/v1/admin/site-content/landing/publish")
    assert published.status_code == 200
    public = TestClient(app).get("/api/v1/site-content/landing").json()
    assert public["content"] == document and public["published_at"]

    admin.put("/api/v1/admin/site-content/landing/draft", json={"text": {}})
    reverted = admin.post("/api/v1/admin/site-content/landing/discard").json()
    assert reverted["draft"] == document


def test_rejects_non_object_and_oversized_documents(admin):
    assert admin.put("/api/v1/admin/site-content/landing/draft", json=[1, 2]).status_code == 422
    huge = {"css": "x" * (600 * 1024)}
    assert admin.put("/api/v1/admin/site-content/landing/draft", json=huge).status_code == 413


def test_media_upload_round_trip(admin):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    response = admin.post("/api/v1/admin/site-content/media", files={"file": ("logo.png", png, "image/png")})
    assert response.status_code == 201, response.text
    url = response.json()["url"]
    served = TestClient(app).get(url)
    assert served.status_code == 200 and served.content == png
    assert served.headers["content-type"] == "image/png"

    bad = admin.post("/api/v1/admin/site-content/media", files={"file": ("run.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 415
    assert TestClient(app).get("/api/v1/site-media/../../etc/passwd").status_code == 404


def test_svg_is_served_sandboxed(admin):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    url = admin.post("/api/v1/admin/site-content/media", files={"file": ("a.svg", svg, "image/svg+xml")}).json()["url"]
    served = TestClient(app).get(url)
    assert "sandbox" in served.headers["content-security-policy"]
