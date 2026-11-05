"""Security hardening: rate limits, headers, uploads, support attachments and payment proofs."""

from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.auth_routes import login_limiter
from app.config import settings
from app.db import Order, PaymentProof, User, get_session_factory, init_db
from app.hardening import reset_rate_limits
from app.main import app

RUN_ID = uuid.uuid4().hex[:10]
PASSWORD = "correct-horse-battery"


def address(name: str) -> str:
    return f"{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset():
    login_limiter._hits.clear()
    reset_rate_limits()
    yield
    reset_rate_limits()


def signed_in(email: str) -> TestClient:
    client = TestClient(app)
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def make_order(email: str, status: str = "pending", provider_ref: str | None = None) -> str:
    with get_session_factory()() as db:
        user = db.query(User).filter(User.email == email).one()
        order = Order(
            id=uuid.uuid4().hex,
            user_id=user.id,
            kind="subscription",
            plan_id="starter",
            amount_usd=37.5,
            tokens=1500,
            status=status,
            provider="volet",
            provider_ref=provider_ref,
        )
        db.add(order)
        db.commit()
        return order.id


# --------------------------------------------------------------------------
# headers, docs, body cap
# --------------------------------------------------------------------------


def test_security_headers_on_api_responses():
    response = TestClient(app).get("/api/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "strict-origin" in response.headers["referrer-policy"]


def test_session_cookie_secure_behind_https():
    client = TestClient(app)
    response = client.post(
        "/api/v1/auth/register",
        json={"email": address("https"), "password": PASSWORD},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert response.status_code == 201
    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert response.headers["cache-control"] == "no-store"


def test_api_docs_hidden_by_default():
    client = TestClient(app)
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_oversized_json_body_refused(monkeypatch):
    monkeypatch.setattr(settings, "max_body_bytes", 100)
    response = TestClient(app).post(
        "/api/v1/auth/login", content=b"{" + b" " * 500 + b"}", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_secret_key_is_pinned():
    assert len(settings.secret_key) >= 16


# --------------------------------------------------------------------------
# rate limits
# --------------------------------------------------------------------------


def test_signup_is_rate_limited(monkeypatch):
    monkeypatch.setattr(settings, "rate_limits_enabled", True)
    client = TestClient(app)
    codes = [
        client.post(
            "/api/v1/auth/register",
            json={"email": address(f"flood{i}"), "password": PASSWORD},
            headers={"X-Real-IP": "203.0.113.7"},
        ).status_code
        for i in range(12)
    ]
    assert codes[:10] == [201] * 10
    assert codes[10] == 429
    # A different visitor is not affected.
    other = client.post(
        "/api/v1/auth/register",
        json={"email": address("other-visitor"), "password": PASSWORD},
        headers={"X-Real-IP": "203.0.113.8"},
    )
    assert other.status_code == 201


def test_login_spraying_one_account_is_limited(monkeypatch):
    monkeypatch.setattr(settings, "rate_limits_enabled", True)
    email = address("sprayed")
    signed_in(email)
    client = TestClient(app)
    codes = []
    for i in range(22):
        codes.append(
            client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "wrong-password-x"},
                headers={"X-Real-IP": f"198.51.100.{i}"},
            ).status_code
        )
    assert codes[0] == 401
    assert codes[-1] == 429
    # Even the right password waits until the window passes.
    right = client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}, headers={"X-Real-IP": "192.0.2.1"}
    )
    assert right.status_code == 429


# --------------------------------------------------------------------------
# support attachments
# --------------------------------------------------------------------------


def test_support_upload_checks_content_and_owner():
    owner = signed_in(address("sup-owner"))
    stranger = signed_in(address("sup-stranger"))

    fake = owner.post(
        "/api/v1/support/upload", files={"file": ("shot.png", b"<script>alert(1)</script>", "image/png")}
    )
    assert fake.status_code == 415

    real = owner.post("/api/v1/support/upload", files={"file": ("shot.png", png_bytes(), "image/png")})
    assert real.status_code == 201, real.text
    url = real.json()["url"]

    assert owner.get(url).status_code == 200
    assert stranger.get(url).status_code == 404

    # A stranger cannot attach someone else's file to their own message.
    stolen = stranger.post("/api/v1/support/thread/message", json={"body": "hi", "attachment_url": url})
    assert stolen.status_code == 422


def test_support_message_refuses_outside_links():
    client = signed_in(address("sup-links"))
    for url in ("https://evil.example/x.png", "javascript:alert(1)", "/api/v1/admin/users"):
        response = client.post("/api/v1/support/thread/message", json={"body": "look", "attachment_url": url})
        assert response.status_code == 422, url


# --------------------------------------------------------------------------
# payment check and proofs
# --------------------------------------------------------------------------


def test_verify_finds_paid_payment_by_transaction_id():
    email = address("verify-paid")
    client = signed_in(email)
    order_id = make_order(email, status="paid", provider_ref="VOLET-TX-12345")

    by_tx = client.post("/api/v1/payments/verify", json={"code": "VOLET-TX-12345"})
    assert by_tx.status_code == 200
    assert by_tx.json()["paid"] is True
    assert by_tx.json()["order_id"] == order_id

    by_order = client.post("/api/v1/payments/verify", json={"code": order_id})
    assert by_order.json()["paid"] is True


def test_verify_never_reveals_other_users_payments():
    owner_email = address("verify-owner")
    signed_in(owner_email)
    make_order(owner_email, status="paid", provider_ref="SECRET-TX-99999")
    other = signed_in(address("verify-other"))
    response = other.post("/api/v1/payments/verify", json={"code": "SECRET-TX-99999"})
    assert response.json() == {
        **response.json(),
        "found": False,
        "paid": False,
    }


def test_verify_rejects_garbage_codes():
    client = signed_in(address("verify-garbage"))
    response = client.post("/api/v1/payments/verify", json={"code": "' OR 1=1 --"})
    assert response.status_code == 422


def test_support_bot_checks_payment_ids():
    email = address("bot-pay")
    client = signed_in(email)
    make_order(email, status="paid", provider_ref="TX-777888")
    thread = client.post("/api/v1/support/thread/message", json={"body": "I paid, transaction TX-777888"})
    assert thread.status_code == 200
    last = thread.json()["messages"][-1]
    assert last["sender_role"] == "bot"
    assert "Payment confirmed" in last["body"]


def test_proof_waits_for_admin_then_activates(monkeypatch):
    customer_email = address("proof-customer")
    customer = signed_in(customer_email)
    order_id = make_order(customer_email)

    sent = customer.post(
        "/api/v1/payments/proof",
        data={"order_id": order_id, "transaction_id": "TX-PROOF-1"},
        files={"screenshot": ("receipt.png", png_bytes(), "image/png")},
    )
    assert sent.status_code == 201, sent.text
    proof = sent.json()
    assert proof["status"] == "pending"

    # Nothing activates on the screenshot alone.
    me = customer.get("/api/v1/auth/me").json()
    assert me["subscription_active"] is False
    assert customer.get(proof["screenshot_url"]).status_code == 200

    # Other customers cannot see it; customers cannot approve it.
    stranger = signed_in(address("proof-stranger"))
    assert stranger.get(proof["screenshot_url"]).status_code == 404
    assert customer.post(f"/api/v1/admin/payments/proofs/{proof['id']}/approve", json={}).status_code == 404

    admin_email = address("proof-admin")
    monkeypatch.setattr(settings, "admin_emails", [admin_email])
    admin = signed_in(admin_email)
    listed = admin.get("/api/v1/admin/payments/proofs").json()
    assert any(row["id"] == proof["id"] and row["user_email"] == customer_email for row in listed)

    approved = admin.post(f"/api/v1/admin/payments/proofs/{proof['id']}/approve", json={"note": "checked"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert customer.get("/api/v1/auth/me").json()["subscription_active"] is True

    # Approving twice does not credit twice.
    again = admin.post(f"/api/v1/admin/payments/proofs/{proof['id']}/approve", json={})
    assert again.status_code == 409


def test_proof_rejects_fake_images_and_foreign_orders():
    email = address("proof-fake")
    client = signed_in(email)
    order_id = make_order(email)
    fake = client.post(
        "/api/v1/payments/proof",
        data={"order_id": order_id, "transaction_id": "TX-1"},
        files={"screenshot": ("receipt.png", b"not an image at all", "image/png")},
    )
    assert fake.status_code == 415

    other = signed_in(address("proof-foreign"))
    foreign = other.post(
        "/api/v1/payments/proof",
        data={"order_id": order_id, "transaction_id": "TX-2"},
        files={"screenshot": ("receipt.png", png_bytes(), "image/png")},
    )
    assert foreign.status_code == 404


def test_proof_for_paid_order_is_matched():
    email = address("proof-matched")
    client = signed_in(email)
    order_id = make_order(email, status="paid", provider_ref="TX-ALREADY")
    sent = client.post(
        "/api/v1/payments/proof",
        data={"order_id": order_id, "transaction_id": "TX-ALREADY"},
        files={"screenshot": ("r.png", png_bytes(), "image/png")},
    )
    assert sent.json()["status"] == "matched"
    with get_session_factory()() as db:
        assert db.get(PaymentProof, sent.json()["id"]).status == "matched"
