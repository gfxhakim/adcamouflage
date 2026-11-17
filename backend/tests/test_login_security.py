"""Email codes, password reset, account changes, sign-in alerts, Google/Apple sign-in and billing emails."""

from __future__ import annotations

import re
import time
from datetime import timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import account_security, mailer, oauth
from app.auth_routes import code_limiter
from app.config import settings
from app.db import AuthCode, OAuthIdentity, Order, User
from app.main import app
from app.tokens import get_token_plans, new_order, settle_order, void_order
from tests.test_volet import (  # noqa: F401 - fixtures
    PASSWORD,
    _database,
    _load,
    _reset_limiter,
    _session,
    _signed_in,
    _with_user,
    address,
)

CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Mobile/15E148 Safari/604.1"
)


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "public_url", "https://shop.example.test")
    monkeypatch.setattr(mailer, "dispatch", lambda job: job())

    def fake(to, subject, html, text_body):
        sent.append({"to": to, "subject": subject, "html": html, "text": text_body})
        return True

    monkeypatch.setattr(mailer, "_send_smtp", fake)
    code_limiter._hits.clear()
    yield sent
    code_limiter._hits.clear()


def _to(outbox, email, contains=""):
    return [m for m in outbox if m["to"] == email and contains in m["subject"]]


def _code(message) -> str:
    return re.search(r"\b(\d{6})\b", message["text"]).group(1)


def _client(agent: str = CHROME_WIN) -> TestClient:
    return TestClient(app, headers={"user-agent": agent})


def _allow_resend(email: str) -> None:
    """Make the last code look older than the one-minute resend pause."""

    def older(db, user):
        for row in db.execute(select(AuthCode).where(AuthCode.user_id == user.id)).scalars():
            row.created_at = row.created_at - timedelta(minutes=2)

    _with_user(email, older)


# --------------------------------------------------------------------------
# sign-up code
# --------------------------------------------------------------------------


def test_signup_waits_for_the_code(outbox):
    email = address("sec-signup")
    client = _client()
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD, "display_name": "Sam"})
    assert response.status_code == 202, response.text
    assert response.json() == {"verify": True, "email": email}
    assert client.get("/api/v1/auth/me").status_code == 401  # not signed in yet

    codes = _to(outbox, email, "is your ProteusFlow code")
    assert len(codes) == 1
    code = _code(codes[0])
    assert code in codes[0]["subject"] and code in codes[0]["html"]
    assert not _to(outbox, email, "Welcome")

    # Logging in before confirming is refused (and does not resend within a minute).
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 403 and "code" in response.json()["detail"]
    assert len(_to(outbox, email, "is your ProteusFlow code")) == 1

    wrong = "000000" if code != "000000" else "111111"
    assert client.post("/api/v1/auth/verify-email", json={"email": email, "code": wrong}).status_code == 400
    response = client.post("/api/v1/auth/verify-email", json={"email": email, "code": f" {code[:3]} {code[3:]} "})
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/auth/me").json()["email"] == email
    assert _load(email).email_verified is True
    assert len(_to(outbox, email, "Welcome")) == 1
    # A code works once.
    assert client.post("/api/v1/auth/verify-email", json={"email": email, "code": code}).status_code == 409


def test_code_dies_after_five_wrong_guesses(outbox):
    email = address("sec-guess")
    client = _client()
    client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    code = _code(_to(outbox, email, "code")[0])
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(account_security.MAX_ATTEMPTS):
        client.post("/api/v1/auth/verify-email", json={"email": email, "code": wrong})
    assert client.post("/api/v1/auth/verify-email", json={"email": email, "code": code}).status_code == 400


def test_resend_and_signup_again_before_confirming(outbox):
    email = address("sec-again")
    client = _client()
    client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    first = _code(_to(outbox, email, "code")[0])
    # Resend within a minute: nothing new.
    assert client.post("/api/v1/auth/verify-email/resend", json={"email": email}).json() == {"ok": True}
    assert len(_to(outbox, email, "code")) == 1
    _allow_resend(email)
    # Signing up again with another password restarts it; the old code stops working.
    response = client.post("/api/v1/auth/register", json={"email": email, "password": "another-password-1"})
    assert response.status_code == 202
    second = _code(_to(outbox, email, "code")[-1])
    if first != second:
        assert client.post("/api/v1/auth/verify-email", json={"email": email, "code": first}).status_code == 400
    assert client.post("/api/v1/auth/verify-email", json={"email": email, "code": second}).status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "another-password-1"}).status_code == 200
    # Unknown emails get the same answer and no mail.
    stranger = address("sec-nobody")
    assert client.post("/api/v1/auth/verify-email/resend", json={"email": stranger}).json() == {"ok": True}
    assert not _to(outbox, stranger)


def test_without_a_mail_server_signup_opens_at_once(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "resend_api_key", None)
    client = _client()
    assert client.get("/api/v1/auth/providers").json()["email_codes"] is False
    response = client.post("/api/v1/auth/register", json={"email": address("sec-nomail"), "password": PASSWORD})
    assert response.status_code == 201 and response.json()["email"] == address("sec-nomail")


# --------------------------------------------------------------------------
# forgot password
# --------------------------------------------------------------------------


def test_forgot_password_reset_with_code(outbox):
    email = address("sec-forgot")
    old = _signed_in(email)
    client = _client()
    assert client.post("/api/v1/auth/password/forgot", json={"email": email}).json()["ok"] is True
    reset = _to(outbox, email, "password reset code")
    assert len(reset) == 1
    code = _code(reset[0])

    bad = client.post("/api/v1/auth/password/reset", json={"email": email, "code": code, "new_password": "short"})
    assert bad.status_code == 422
    response = client.post(
        "/api/v1/auth/password/reset", json={"email": email, "code": code, "new_password": "brand-new-password"}
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/auth/me").status_code == 200  # signed in
    assert old.get("/api/v1/auth/me").status_code == 401  # other devices signed out
    assert len(_to(outbox, email, "password was changed")) == 1
    assert _client().post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
    assert _client().post("/api/v1/auth/login", json={"email": email, "password": "brand-new-password"}).status_code == 200
    # Used code cannot be replayed.
    again = client.post("/api/v1/auth/password/reset", json={"email": email, "code": code, "new_password": "third-password-x"})
    assert again.status_code == 400

    stranger = address("sec-forgot-nobody")
    assert client.post("/api/v1/auth/password/forgot", json={"email": stranger}).json()["ok"] is True
    assert not _to(outbox, stranger)


# --------------------------------------------------------------------------
# signed-in changes
# --------------------------------------------------------------------------


def test_password_change_needs_the_emailed_code(outbox):
    email = address("sec-change")
    client = _signed_in(email)
    no_code = {"current_password": PASSWORD, "new_password": "changed-password-1", "code": ""}
    assert client.post("/api/v1/auth/password", json=no_code).status_code == 400
    assert client.post("/api/v1/auth/password/code").json() == {"sent": True, "required": True}
    assert client.post("/api/v1/auth/password/code").status_code == 429  # once a minute
    code = _code(_to(outbox, email, "Confirm your ProteusFlow password change")[0])
    wrong_current = {**no_code, "current_password": "nope-nope-nope", "code": code}
    assert client.post("/api/v1/auth/password", json=wrong_current).status_code == 401
    response = client.post("/api/v1/auth/password", json={**no_code, "code": code})
    assert response.status_code == 200, response.text
    assert len(_to(outbox, email, "password was changed")) == 1


def test_email_change_confirmed_from_the_new_inbox(outbox):
    email = address("sec-move")
    new_email = address("sec-moved")
    client = _signed_in(email)
    start = {"new_email": new_email, "current_password": PASSWORD}
    assert client.post("/api/v1/auth/email/code", json={**start, "current_password": "wrong-wrong-1"}).status_code == 401
    taken = _signed_in(address("sec-taken")) and address("sec-taken")
    assert client.post("/api/v1/auth/email/code", json={**start, "new_email": taken}).status_code == 409
    response = client.post("/api/v1/auth/email/code", json=start)
    assert response.status_code == 200 and response.json() == {"sent_to": new_email}
    message = _to(outbox, new_email, "Confirm your new ProteusFlow email")
    assert len(message) == 1
    response = client.post("/api/v1/auth/email", json={"code": _code(message[0])})
    assert response.status_code == 200, response.text
    assert response.json()["email"] == new_email
    notice = _to(outbox, email, "email was changed")
    assert len(notice) == 1 and new_email in notice[0]["text"]
    assert _client().post("/api/v1/auth/login", json={"email": new_email, "password": PASSWORD}).status_code == 200


# --------------------------------------------------------------------------
# new sign-in alert
# --------------------------------------------------------------------------


def test_new_device_sign_in_alert(outbox):
    email = address("sec-device")
    _signed_in(email)  # first browser: remembered quietly
    credentials = {"email": email, "password": PASSWORD}
    TestClient(app).post("/api/v1/auth/login", json=credentials)  # same (test) browser
    assert not _to(outbox, email, "New sign-in")
    response = _client(SAFARI_IPHONE).post("/api/v1/auth/login", json=credentials)
    assert response.status_code == 200
    alerts = _to(outbox, email, "New sign-in")
    assert len(alerts) == 1 and "Safari on iPhone" in alerts[0]["text"]
    _client(SAFARI_IPHONE).post("/api/v1/auth/login", json=credentials)
    assert len(_to(outbox, email, "New sign-in")) == 1


def test_device_labels():
    assert account_security.device_label(CHROME_WIN) == "Chrome on Windows"
    assert account_security.device_label(SAFARI_IPHONE) == "Safari on iPhone"
    assert account_security.device_label("") == "Unknown browser on unknown system"


# --------------------------------------------------------------------------
# admin: codes cannot be switched off; previews of every email
# --------------------------------------------------------------------------


def test_code_emails_cannot_be_switched_off(outbox, admin):
    response = admin.put("/api/v1/admin/emails", json={"templates": {"verify": {"enabled": False}, "new_login": {"enabled": False}}})
    assert response.status_code == 200
    data = response.json()["templates"]
    assert data["verify"]["enabled"] is True and data["new_login"]["enabled"] is False
    style = admin.get("/api/v1/admin/emails").json()["style_defaults"]
    for kind in mailer.KINDS:
        template = mailer.DEFAULT_TEMPLATES[kind]
        payload = {"kind": kind, "template": {"enabled": True, "subject": "", "body": ""}, "style": style}
        preview = admin.post("/api/v1/admin/emails/preview", json=payload)
        assert preview.status_code == 200, (kind, preview.text)
        html = preview.json()["html"]
        assert "{" not in preview.json()["subject"], kind
        if template.get("stat") == "{code}":
            assert "482913" in html and "letter-spacing:10px" in html
    admin.put("/api/v1/admin/emails", json={"templates": {"new_login": {"enabled": True}}})


@pytest.fixture
def admin(monkeypatch):
    email = address("sec-boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


# --------------------------------------------------------------------------
# Google / Apple
# --------------------------------------------------------------------------


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "client-123.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_client_secret", SecretStr("google-secret"))
    monkeypatch.setattr(settings, "public_url", "https://shop.example.test")
    who: dict = {}
    monkeypatch.setattr(oauth, "_identity", lambda provider, request, code, nonce, user: dict(who))
    return who


def _oauth_round(who, *, next_path: str | None = None, agent: str = CHROME_WIN) -> tuple[TestClient, object]:
    client = TestClient(app, base_url="https://shop.example.test", headers={"user-agent": agent})
    url = "/api/v1/auth/oauth/google/start" + (f"?next={next_path}" if next_path else "")
    start = client.get(url, follow_redirects=False)
    assert start.status_code == 303
    location = start.headers["location"]
    assert location.startswith(oauth.GOOGLE_AUTH)
    assert "redirect_uri=https%3A%2F%2Fshop.example.test%2Fapi%2Fv1%2Fauth%2Foauth%2Fgoogle%2Fcallback" in location
    cookie = start.headers["set-cookie"]
    assert "SameSite=none" in cookie and "Secure" in cookie and "HttpOnly" in cookie
    state = re.search(r"state=([^&]+)", location).group(1)
    done = client.get(f"/api/v1/auth/oauth/google/callback?code=abc&state={state}")
    return client, done


def test_google_opens_a_new_verified_account(outbox, google):
    email = address("sec-google-new")
    google.update(subject="g-new-1", email=email, email_verified=True, name="Gina")
    client, done = _oauth_round(google)
    assert done.status_code == 200 and "location.replace(\"/app\")" in done.text
    me = client.get("/api/v1/auth/me").json()
    assert me["email"] == email and me["display_name"] == "Gina" and me["social_only"] is True
    assert _load(email).email_verified is True
    assert len(_to(outbox, email, "Welcome")) == 1
    # Password login is refused with a hint; signing in again with Google works.
    response = _client().post("/api/v1/auth/login", json={"email": email, "password": "anything-long"})
    assert response.status_code == 401 and "Google" in response.json()["detail"]
    client2, done2 = _oauth_round(google, next_path="/app/plan")
    assert "location.replace(\"/app/plan\")" in done2.text
    assert client2.get("/api/v1/auth/me").json()["email"] == email


def test_google_links_an_existing_account(outbox, google):
    email = address("sec-google-link")
    _signed_in(email)
    google.update(subject="g-link-1", email=email.upper(), email_verified=True, name=None)
    client, done = _oauth_round(google)
    assert client.get("/api/v1/auth/me").json()["email"] == email
    assert len(_to(outbox, email, "Google sign-in added")) == 1
    with _session() as db:
        assert db.execute(select(OAuthIdentity).where(OAuthIdentity.subject == "g-link-1")).scalar_one().provider == "google"
    # The password still works too.
    assert _client().post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).status_code == 200


def test_google_takes_over_an_unconfirmed_signup(outbox, google):
    email = address("sec-google-squat")
    _client().post("/api/v1/auth/register", json={"email": email, "password": "someone-elses-pw"})
    google.update(subject="g-squat-1", email=email, email_verified=True, name="Owner")
    client, _ = _oauth_round(google)
    assert client.get("/api/v1/auth/me").json()["email"] == email
    # The password typed at the unconfirmed sign-up no longer opens the account.
    assert _client().post("/api/v1/auth/login", json={"email": email, "password": "someone-elses-pw"}).status_code == 401


def test_google_refusals(outbox, google):
    google.update(subject="g-unverified", email=address("sec-g-unv"), email_verified=False, name=None)
    _, done = _oauth_round(google)
    assert "oauth_error=no_email" in done.text
    # A forged state is refused.
    client = TestClient(app, base_url="https://shop.example.test")
    client.get("/api/v1/auth/oauth/google/start", follow_redirects=False)
    done = client.get("/api/v1/auth/oauth/google/callback?code=abc&state=forged")
    assert "oauth_error=expired" in done.text
    # Cancelled at Google.
    done = client.get("/api/v1/auth/oauth/google/callback?error=access_denied")
    assert "oauth_error=cancelled" in done.text


def test_providers_listed_only_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    monkeypatch.setattr(settings, "apple_client_id", "")
    data = TestClient(app).get("/api/v1/auth/providers").json()
    assert data["google"] is False and data["apple"] is False
    response = TestClient(app).get("/api/v1/auth/oauth/apple/start", follow_redirects=False)
    assert response.status_code == 303 and "oauth_error=unavailable" in response.headers["location"]


def test_apple_client_secret_is_signed_with_the_p8_key(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    monkeypatch.setattr(settings, "apple_client_id", "com.example.web")
    monkeypatch.setattr(settings, "apple_team_id", "TEAM123456")
    monkeypatch.setattr(settings, "apple_key_id", "KEY1234567")
    # Railway may store the key with literal \n escapes.
    monkeypatch.setattr(settings, "apple_private_key", SecretStr(pem.replace("\n", "\\n")))
    assert settings.apple_ready
    token = oauth.apple_client_secret()
    assert jwt.get_unverified_header(token)["kid"] == "KEY1234567"
    claims = jwt.decode(token, key.public_key(), algorithms=["ES256"], audience="https://appleid.apple.com")
    assert claims["iss"] == "TEAM123456" and claims["sub"] == "com.example.web"


def test_id_token_checks(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class Keys:
        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": key.public_key()})()

    monkeypatch.setattr(oauth, "_jwk_client", lambda url: Keys())
    now = int(time.time())
    base = {"sub": "1", "iss": "https://accounts.google.com", "aud": "me", "iat": now, "exp": now + 300, "nonce": "n1"}
    good = jwt.encode(base, key, algorithm="RS256")
    args = dict(keys_url="x", audience="me", issuers=oauth.GOOGLE_ISSUERS)
    assert oauth.verify_id_token(good, nonce="n1", **args)["sub"] == "1"
    for bad_claims, nonce in (
        ({**base, "aud": "someone-else"}, "n1"),
        ({**base, "iss": "https://evil.example"}, "n1"),
        ({**base, "exp": now - 600}, "n1"),
        (base, "other-nonce"),
    ):
        with pytest.raises(oauth.OAuthFailure):
            oauth.verify_id_token(jwt.encode(bad_claims, key, algorithm="RS256"), nonce=nonce, **args)


# --------------------------------------------------------------------------
# billing emails
# --------------------------------------------------------------------------


def _order(email: str, kind: str, amount: float, tokens: int) -> Order:
    def make(db, user):
        plan = get_token_plans(db)["pro"]
        order = new_order(db, user, kind, plan, amount, tokens, provider="volet")
        return order.id

    order_id = _with_user(email, make)
    with _session() as db:
        return db.get(Order, order_id)


def test_receipts_and_failed_payment_emails(outbox):
    email = address("sec-bill")
    _signed_in(email)
    with _session() as db:
        order = db.get(Order, _order(email, "subscription", 89, 4500).id)
        assert settle_order(db, order, source="test")
    activated = _to(outbox, email, "plan is active")
    assert len(activated) == 1 and "$89" in activated[0]["text"] and "Volet" in activated[0]["text"]

    with _session() as db:
        order = db.get(Order, _order(email, "topup", 20, 1000).id)
        assert settle_order(db, order, source="test")
    receipt = _to(outbox, email, "Receipt")
    assert len(receipt) == 1 and "1,000" in receipt[0]["subject"] and "$20" in receipt[0]["text"]

    with _session() as db:
        order = db.get(Order, _order(email, "topup", 40, 2000).id)
        assert void_order(db, order, "expired")  # timed out unpaid: no email
    assert not _to(outbox, email, "did not go through")
    with _session() as db:
        order = db.get(Order, _order(email, "topup", 40, 2000).id)
        assert void_order(db, order, "invalid")  # rejected: email
    failed = _to(outbox, email, "did not go through")
    assert len(failed) == 1 and "$40" in failed[0]["text"]
