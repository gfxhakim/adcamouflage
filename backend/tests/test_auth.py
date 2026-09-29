"""Account, session and ownership tests.

Ownership is the part that matters most here: a signed-in user must not be able
to read, download or delete another user's assets.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.accounts import hash_password, verify_password
from app.auth_routes import login_limiter
from app.config import settings
from app.db import User, get_session_factory, init_db
from app.main import app

from .conftest import requires_ffmpeg


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield
    login_limiter._hits.clear()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _register(client: TestClient, email: str, password: str = "correct-horse-battery"):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password})


def _fresh_client(email: str, password: str = "correct-horse-battery") -> TestClient:
    """A client with its own cookie jar, signed in as `email`."""

    other = TestClient(app)
    response = other.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert response.status_code in (201, 409), response.text
    if response.status_code == 409:
        assert other.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 200
    return other


# --------------------------------------------------------------------------
# password hashing
# --------------------------------------------------------------------------


def test_password_hash_round_trip():
    stored = hash_password("correct-horse-battery")
    assert stored != "correct-horse-battery"
    assert verify_password("correct-horse-battery", stored)
    assert not verify_password("wrong", stored)


def test_hashes_are_salted():
    assert hash_password("same-password") != hash_password("same-password")


def test_malformed_hash_is_rejected_not_raised():
    assert verify_password("anything", "not-a-bcrypt-hash") is False


# --------------------------------------------------------------------------
# registration and sign-in
# --------------------------------------------------------------------------


def test_register_signs_the_user_in(client):
    response = _register(client, "alice@example.com")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert "password" not in json.dumps(body)

    assert client.cookies.get(settings.cookie_name)
    assert client.get("/api/v1/auth/me").json()["email"] == "alice@example.com"


def test_email_is_stored_lowercase_and_login_is_case_insensitive(client):
    assert _register(client, "MixedCase@Example.com").status_code == 201
    assert client.get("/api/v1/auth/me").json()["email"] == "mixedcase@example.com"

    fresh = TestClient(app)
    assert fresh.post(
        "/api/v1/auth/login",
        json={"email": "MIXEDCASE@EXAMPLE.COM", "password": "correct-horse-battery"},
    ).status_code == 200


def test_duplicate_email_is_rejected(client):
    assert _register(client, "dupe@example.com").status_code == 201
    assert _register(TestClient(app), "dupe@example.com").status_code == 409


@pytest.mark.parametrize("email", ["", "nope", "a@b", "no-at-sign.com", "spaces @x.com"])
def test_invalid_emails_are_rejected(client, email):
    assert client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct-horse-battery"}
    ).status_code == 422


def test_short_password_is_rejected(client):
    response = client.post("/api/v1/auth/register", json={"email": "short@example.com", "password": "abc"})
    assert response.status_code == 422
    assert str(settings.min_password_length) in response.json()["detail"]


def test_overlong_password_is_rejected(client):
    """bcrypt truncates past 72 bytes, which would make long passwords collide."""

    response = client.post(
        "/api/v1/auth/register", json={"email": "long@example.com", "password": "x" * 200}
    )
    assert response.status_code == 422


def test_wrong_password_and_unknown_email_give_the_same_answer(client):
    assert _register(client, "real@example.com").status_code == 201

    wrong = TestClient(app).post(
        "/api/v1/auth/login", json={"email": "real@example.com", "password": "not-the-password"}
    )
    missing = TestClient(app).post(
        "/api/v1/auth/login", json={"email": "ghost@example.com", "password": "not-the-password"}
    )
    assert wrong.status_code == missing.status_code == 401
    # Identical wording, so the response cannot be used to enumerate accounts.
    assert wrong.json()["detail"] == missing.json()["detail"]


def test_repeated_failures_are_throttled():
    fresh = TestClient(app)
    fresh.post("/api/v1/auth/register", json={"email": "brute@example.com", "password": "correct-horse-battery"})

    attacker = TestClient(app)
    statuses = [
        attacker.post("/api/v1/auth/login", json={"email": "brute@example.com", "password": f"guess{i}"}).status_code
        for i in range(12)
    ]
    assert 429 in statuses, statuses
    # The throttle must engage before all twelve guesses land.
    assert statuses.index(429) <= 9


def test_logout_clears_the_session(client):
    assert _register(client, "bye@example.com").status_code == 201
    assert client.get("/api/v1/auth/me").status_code == 200

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_requires_a_session():
    assert TestClient(app).get("/api/v1/auth/me").status_code == 401


def test_tampered_cookie_is_rejected(client):
    assert _register(client, "tamper@example.com").status_code == 201
    token = client.cookies.get(settings.cookie_name)
    client.cookies.set(settings.cookie_name, token[:-3] + "aaa")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_password_change_invalidates_other_sessions(client):
    email = "rotate@example.com"
    assert _register(client, email).status_code == 201

    # A second device signed in with the same password.
    other = TestClient(app)
    assert other.post("/api/v1/auth/login", json={"email": email, "password": "correct-horse-battery"}).status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 200

    assert client.post(
        "/api/v1/auth/password",
        json={"current_password": "correct-horse-battery", "new_password": "a-brand-new-secret"},
    ).status_code == 200

    # The device that changed it stays signed in; the other one does not.
    assert client.get("/api/v1/auth/me").status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 401


def test_password_change_requires_the_current_password(client):
    assert _register(client, "guard@example.com").status_code == 201
    assert client.post(
        "/api/v1/auth/password",
        json={"current_password": "wrong", "new_password": "another-long-secret"},
    ).status_code == 401


def test_deactivated_account_cannot_use_its_session(client):
    email = "disabled@example.com"
    assert _register(client, email).status_code == 201

    with get_session_factory()() as session:
        user = session.query(User).filter(User.email == email).one()
        user.is_active = False
        session.commit()

    assert client.get("/api/v1/auth/me").status_code == 401


# --------------------------------------------------------------------------
# ownership
# --------------------------------------------------------------------------


def test_batch_endpoints_require_a_session(sample_image):
    anonymous = TestClient(app)
    assert anonymous.post(
        "/api/v1/batches", files={"files": ("a.jpg", sample_image.read_bytes(), "image/jpeg")}
    ).status_code == 401
    assert anonymous.get("/api/v1/batches/batch_whatever").status_code == 401


def test_a_user_cannot_read_another_users_batch(sample_image):
    owner = _fresh_client("owner@example.com")
    intruder = _fresh_client("intruder@example.com")

    created = owner.post(
        "/api/v1/batches", files={"files": ("mine.jpg", sample_image.read_bytes(), "image/jpeg")}
    )
    assert created.status_code == 202, created.text
    batch_id = created.json()["batch_id"]
    asset_id = created.json()["accepted"][0]["id"]

    assert owner.get(f"/api/v1/batches/{batch_id}").status_code == 200

    # Every read path must refuse, and say "not found" rather than "forbidden"
    # so ids cannot be probed.
    assert intruder.get(f"/api/v1/batches/{batch_id}").status_code == 404
    assert intruder.get(f"/api/v1/assets/{asset_id}").status_code == 404
    assert intruder.delete(f"/api/v1/batches/{batch_id}").status_code == 404
    assert intruder.post(f"/api/v1/assets/{asset_id}/cancel").status_code == 404


def test_a_valid_download_token_does_not_bypass_ownership(sample_image):
    import time

    owner = _fresh_client("dl-owner@example.com")
    intruder = _fresh_client("dl-intruder@example.com")

    created = owner.post(
        "/api/v1/batches", files={"files": ("secret.jpg", sample_image.read_bytes(), "image/jpeg")}
    )
    batch_id = created.json()["batch_id"]

    deadline = time.time() + 120
    status = {}
    while time.time() < deadline:
        status = owner.get(f"/api/v1/batches/{batch_id}").json()
        if status["completed"] + status["failed"] >= status["total"]:
            break
        time.sleep(0.25)

    asset = status["assets"][0]
    assert asset["download_url"], status

    # The owner's own signed link, replayed by someone else, must still fail.
    assert owner.get(asset["download_url"]).status_code == 200
    assert intruder.get(asset["download_url"]).status_code == 404
    assert TestClient(app).get(asset["download_url"]).status_code == 401


def test_batch_history_lists_only_your_own(sample_image):
    owner = _fresh_client("hist@example.com")
    stranger = _fresh_client("hist-other@example.com")

    created = owner.post(
        "/api/v1/batches", files={"files": ("h.jpg", sample_image.read_bytes(), "image/jpeg")}
    )
    batch_id = created.json()["batch_id"]

    mine = owner.get("/api/v1/auth/batches").json()
    assert any(row["id"] == batch_id for row in mine)

    theirs = stranger.get("/api/v1/auth/batches").json()
    assert all(row["id"] != batch_id for row in theirs)
