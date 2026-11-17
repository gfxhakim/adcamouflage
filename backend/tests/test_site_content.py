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


def test_old_brand_names_are_replaced_for_editor_site_and_storage(admin):
    """Text saved before the rename shows the new name everywhere and is stored with it."""

    from app.app_settings import get_setting, set_setting
    from app.db import get_session_factory

    old = {
        "text": {"hero.badge": "Welcome to BluEditor"},
        "meta": {"title": "BluEditor — Creative Variation & Batch Video Studio", "description": "BluCloacking studio"},
        "link": {"hero.cta": {"label": "Open BluEditor", "href": "https://blucloack.online/app"}},
    }
    new = {
        "text": {"hero.badge": "Welcome to ProteusFlow"},
        "meta": {"title": "ProteusFlow — Creative Variation & Batch Video Studio", "description": "ProteusFlow studio"},
        "link": {"hero.cta": {"label": "Open ProteusFlow", "href": "https://blucloack.online/app"}},
    }
    # A row written before the rename: the old name is in the database itself.
    with get_session_factory()() as db:
        set_setting(db, "site_content:workspace", {"draft": old, "published": old, "draft_updated_at": None, "published_at": "2026-11-01T00:00:00+00:00"})
        db.commit()

    assert TestClient(app).get("/api/v1/site-content/workspace").json()["content"] == new
    record = admin.get("/api/v1/admin/site-content/workspace").json()
    assert record["draft"] == new and record["published"] == new

    # An editor tab opened before the rename saves its stale copy: stored clean.
    saved = admin.put("/api/v1/admin/site-content/workspace/draft", json=old)
    assert saved.status_code == 200 and saved.json()["draft"] == new
    admin.post("/api/v1/admin/site-content/workspace/publish")
    with get_session_factory()() as db:
        stored = get_setting(db, "site_content:workspace", None)
    assert stored["draft"] == new and stored["published"] == new

    admin.put("/api/v1/admin/site-content/workspace/draft", json={})
    admin.post("/api/v1/admin/site-content/workspace/publish")


def test_renaming_never_brings_a_hidden_text_back(admin):
    """A saved text the public filter hides stays hidden: its old name is not replaced."""

    document = {
        "text": {"hero.old": "BluCloak hides your ads", "hero.fine": "Made by BluEditor"},
        "meta": {"title": "Ad Camouflage studio", "description": "BluEditor studio"},
    }
    saved = admin.put("/api/v1/admin/site-content/workspace/draft", json=document)
    assert saved.status_code == 200, saved.text
    # The editor still shows the hidden entries as saved; the rest carries the current name.
    assert saved.json()["draft"] == {
        "text": {"hero.old": "BluCloak hides your ads", "hero.fine": "Made by ProteusFlow"},
        "meta": {"title": "Ad Camouflage studio", "description": "ProteusFlow studio"},
    }
    admin.post("/api/v1/admin/site-content/workspace/publish")
    live = TestClient(app).get("/api/v1/site-content/workspace").json()["content"]
    assert live == {"text": {"hero.fine": "Made by ProteusFlow"}, "meta": {"description": "ProteusFlow studio"}}

    admin.put("/api/v1/admin/site-content/workspace/draft", json={})
    admin.post("/api/v1/admin/site-content/workspace/publish")


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
