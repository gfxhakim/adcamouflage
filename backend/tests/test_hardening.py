"""Security hardening: cross-site posts, sign-up throttle, chat attachments, API docs."""

from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth_routes import register_limiter
from app.db import init_db
from app.main import app

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"


def address(name: str) -> str:
    return f"hard-{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


def _signed_in(email: str) -> TestClient:
    client = TestClient(app)
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 0, 0)).save(out, format="PNG")
    return out.getvalue()


def test_cross_site_post_is_refused():
    client = _signed_in(address("csrf"))
    forged = client.post(
        "/api/v1/auth/password",
        json={"current_password": PASSWORD, "new_password": "another-long-password"},
        headers={"Origin": "https://evil.example"},
    )
    assert forged.status_code == 403
    same_site = client.post(
        "/api/v1/support/thread/message", json={"body": "hello"}, headers={"Origin": "http://testserver"}
    )
    assert same_site.status_code == 200


def test_payment_callbacks_still_accept_other_origins():
    response = TestClient(app, follow_redirects=False).post(
        "/api/v1/billing/r/abc", headers={"Origin": "https://account.volet.com"}
    )
    assert response.status_code == 303


def test_signups_are_throttled_per_sender():
    client = TestClient(app)
    codes = [
        client.post(
            "/api/v1/auth/register", json={"email": address(f"flood{i}"), "password": PASSWORD}
        ).status_code
        for i in range(register_limiter.limit + 1)
    ]
    assert codes[: register_limiter.limit] == [201] * register_limiter.limit
    assert codes[-1] == 429


def test_api_docs_are_hidden():
    client = TestClient(app)
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_security_headers():
    response = TestClient(app).get("/api/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"


def test_chat_attachment_must_be_our_upload():
    client = _signed_in(address("link"))
    bad = client.post(
        "/api/v1/support/thread/message",
        json={"body": "look", "attachment_url": "javascript:alert(1)", "attachment_type": "image"},
    )
    assert bad.status_code == 422


def test_chat_upload_checks_the_file_content():
    client = _signed_in(address("sniff"))
    fake = client.post("/api/v1/support/upload", files={"file": ("x.png", b"<html>hi</html>", "image/png")})
    assert fake.status_code == 415
    real = client.post("/api/v1/support/upload", files={"file": ("x.png", _png(), "image/png")})
    assert real.status_code == 201


def test_chat_media_is_private_to_its_chat():
    owner = _signed_in(address("media-owner"))
    uploaded = owner.post("/api/v1/support/upload", files={"file": ("x.png", _png(), "image/png")}).json()
    owner.post(
        "/api/v1/support/thread/message",
        json={"body": "", "attachment_url": uploaded["url"], "attachment_type": "image", "attachment_name": "x.png"},
    )
    assert owner.get(uploaded["url"]).status_code == 200
    stranger = _signed_in(address("media-peek"))
    assert stranger.get(uploaded["url"]).status_code == 404
