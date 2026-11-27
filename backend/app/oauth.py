"""Continue with Google.

The authorization code flow, run entirely on the API:

1. ``GET /api/v1/auth/oauth/google/start`` stores a short-lived signed
   cookie (random ``state`` + ``nonce`` + where to go after) and redirects to
   Google.
2. Google sends the browser back to ``.../google/callback``. The API checks ``state`` against the
   cookie, swaps the code for an ID token over a direct HTTPS call, and
   verifies the token's signature, issuer, audience and nonce.
3. The person is matched by provider id, then by verified email (the
   provider is linked to that account), and otherwise a new, already
   verified account is opened. The session cookie is set and a tiny page
   moves the browser on to the workspace (or /admin for an admin).

The callback address registered at Google must be
``<ADCAM_PUBLIC_URL>/api/v1/auth/oauth/google/callback``.
"""

from __future__ import annotations

import html
import json
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import account_security as security
from . import affiliates, mailer, meta_capi
from .accounts import (
    create_session_token,
    is_admin,
    is_affiliate_only,
    is_disposable_email,
    normalise_email,
    set_session_cookie,
)
from .activity import log_activity
from .app_settings import registration_open
from .config import settings
from .db import OAuthIdentity, User, get_db
from .plans import apply_plan, default_plan
from .tokens import FREE_SIGNUP_GENERATIONS, TOKENS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth/oauth", tags=["auth"])

STATE_COOKIE = "adcam_oauth"
STATE_TTL = 600
TIMEOUT = 15.0

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

LABELS = {"google": "Google"}

_jwk_clients: dict[str, jwt.PyJWKClient] = {}


class OAuthFailure(Exception):
    """Ends the flow; ``code`` goes to the login page as ?oauth_error=."""

    def __init__(self, code: str, log: str = "") -> None:
        super().__init__(log or code)
        self.code = code


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _ready(provider: str) -> bool:
    return provider == "google" and settings.google_ready


def _base(request: Request) -> str:
    configured = settings.public_url.strip().rstrip("/")
    if configured:
        return configured
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host.split(',')[0].strip()}"


def redirect_uri(request: Request, provider: str) -> str:
    return f"{_base(request)}/api/v1/auth/oauth/{provider}/callback"


def _safe_next(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return ""
    return value[:500]


def _secure(request: Request) -> bool:
    return _base(request).startswith("https://") or settings.cookie_secure


def _sign_state(data: dict[str, Any]) -> str:
    payload = {**data, "aud": "adcam-oauth", "exp": int(time.time()) + STATE_TTL}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def _read_state(token: str | None) -> dict[str, Any]:
    if not token:
        raise OAuthFailure("expired", "no state cookie")
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"], audience="adcam-oauth")
    except jwt.InvalidTokenError as exc:
        raise OAuthFailure("expired", f"bad state cookie: {exc}") from exc


def _jwk_client(url: str) -> jwt.PyJWKClient:
    client = _jwk_clients.get(url)
    if client is None:
        client = _jwk_clients[url] = jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)
    return client


def verify_id_token(token: str, *, keys_url: str, audience: str, issuers: tuple[str, ...], nonce: str) -> dict[str, Any]:
    """Check an ID token's signature (provider's published keys), issuer, audience, expiry and nonce."""

    try:
        key = _jwk_client(keys_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=audience,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            leeway=60,
        )
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
        raise OAuthFailure("failed", f"id token rejected: {exc}") from exc
    if claims.get("iss") not in issuers:
        raise OAuthFailure("failed", f"unexpected issuer {claims.get('iss')}")
    if nonce and claims.get("nonce") != nonce:
        raise OAuthFailure("failed", "nonce mismatch")
    return claims


def _exchange(url: str, data: dict[str, str]) -> dict[str, Any]:
    try:
        response = httpx.post(url, data=data, headers={"Accept": "application/json"}, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise OAuthFailure("failed", f"token endpoint unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise OAuthFailure("failed", f"token endpoint said {response.status_code}: {response.text[:300]}")
    try:
        return response.json()
    except ValueError as exc:
        raise OAuthFailure("failed", "token endpoint did not answer JSON") from exc


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


# --------------------------------------------------------------------------
# finding or opening the account
# --------------------------------------------------------------------------


def find_or_create_user(
    db: Session,
    request: Request,
    *,
    provider: str,
    subject: str,
    email: str | None,
    email_verified: bool,
    name: str | None,
    account_role: str = "customer",
) -> tuple[User, bool]:
    """The account for this Google person, and whether it was just opened."""

    label = LABELS[provider]
    identity = db.execute(
        select(OAuthIdentity).where(OAuthIdentity.provider == provider, OAuthIdentity.subject == subject)
    ).scalar_one_or_none()
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise OAuthFailure("disabled", f"identity {identity.id} points at an inactive account")
        return user, False

    email = normalise_email(email or "")
    if not email or not email_verified:
        raise OAuthFailure("no_email", f"{provider} gave no verified email")
    if is_disposable_email(email):
        raise OAuthFailure("untrusted_email", f"{provider} rejected disposable domain")

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None:
        if not user.is_active:
            raise OAuthFailure("disabled", f"account {user.id} is inactive")
        was_verified = user.email_verified
        if not was_verified:
            # Someone signed up with this address but never entered the code.
            # The provider just proved who owns the inbox, so whatever
            # password was typed at that sign-up is dropped.
            user.password_hash = security.NO_PASSWORD
            user.token_version += 1
            user.email_verified = True
        db.add(OAuthIdentity(user_id=user.id, provider=provider, subject=subject, email=email))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise OAuthFailure("failed", "identity was linked twice at once")
        log_activity(db, user.id, "login", f"Connected {label} sign-in")
        if was_verified:
            mailer.send_kind(db, user, "linked", {"provider": label})
        else:
            mailer.welcome(db, user)
        return user, not was_verified

    if not registration_open(db):
        raise OAuthFailure("closed", "registration closed")
    role = "affiliate" if account_role == "affiliate" and email not in settings.admin_emails else "customer"
    user = User(
        email=email,
        password_hash=security.NO_PASSWORD,
        display_name=(name or "").strip()[:120] or None,
        billing_mode=TOKENS,
        free_generations=FREE_SIGNUP_GENERATIONS if role == "customer" else 0,
        account_role=role,
        email_verified=True,
    )
    apply_plan(db, user, default_plan(db).id)
    db.add(user)
    try:
        db.flush()
        db.add(OAuthIdentity(user_id=user.id, provider=provider, subject=subject, email=email))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise OAuthFailure("failed", "account was opened twice at once")
    db.refresh(user)
    logger.info("registered user %s with %s", user.id, provider)
    log_activity(db, user.id, "signup", f"Signed up with {label} on the {user.plan} plan")
    from . import meta_capi

    try:
        meta_capi.complete_registration(request, user.id, user.email)
    except Exception:  # noqa: BLE001
        logger.exception("Meta CompleteRegistration for user %s failed", user.id)
    mailer.welcome(db, user)
    return user, True


# --------------------------------------------------------------------------
# responses
# --------------------------------------------------------------------------


def _clear_state(response: Any, request: Request) -> None:
    response.delete_cookie(STATE_COOKIE, path="/api/v1/auth/oauth", secure=_secure(request), samesite="lax")


def _go(target: str) -> HTMLResponse:
    """A 200 page that moves on by itself, so the next request is same-site
    and the (Lax) session cookie goes with it in every browser."""

    safe = html.escape(target, quote=True)
    body = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<meta http-equiv='refresh' content='0;url={safe}'><title>Signing in…</title></head>"
        "<body style='font-family:system-ui,sans-serif;background:#fff;color:#111;display:grid;place-items:center;"
        "min-height:100vh;margin:0'>"
        f"<p>Signing you in… <a href='{safe}'>Continue</a></p>"
        f"<script>location.replace({json.dumps(target)})</script></body></html>"
    )
    return HTMLResponse(body, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


def _fail(request: Request, code: str) -> HTMLResponse:
    response = _go(f"/login?oauth_error={quote(code)}")
    _clear_state(response, request)
    return response


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


def _canonical_start_redirect(
    request: Request,
    provider: str,
    next_path: str | None,
    role: str | None,
    ref_code: str | None,
) -> RedirectResponse | None:
    """Bounce alternate-host/scheme requests (e.g. apex vs www) to ADCAM_PUBLIC_URL before setting OAuth cookies."""

    configured = settings.public_url.strip().rstrip("/")
    if not configured or request.query_params.get("_c") == "1":
        return None
    parsed = urlparse(configured)
    canonical_scheme = parsed.scheme.lower()
    canonical_host = parsed.netloc.lower()
    if not canonical_scheme or not canonical_host:
        return None
    canonical_bare = canonical_host.removeprefix("www.")

    forwarded_host = request.headers.get("x-forwarded-host", "").split(",", 1)[0].strip().lower()
    raw_host = request.headers.get("host", "").split(",", 1)[0].strip().lower()
    external_host = forwarded_host or raw_host
    if external_host.endswith(".internal") or external_host in ("", "testserver"):
        referer = request.headers.get("referer") or ""
        ref_host = urlparse(referer).netloc.lower() if referer else ""
        if ref_host:
            external_host = ref_host

    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
    external_bare = external_host.removeprefix("www.")
    same_site = bool(
        external_host
        and canonical_bare
        and (
            external_bare == canonical_bare
            or external_host.endswith(f".{canonical_bare}")
            or canonical_host.endswith(f".{external_host}")
        )
    )
    proto_mismatch = bool(forwarded_proto and forwarded_proto != canonical_scheme)
    if not same_site or (external_host == canonical_host and not proto_mismatch):
        return None

    params: dict[str, str] = {"_c": "1"}
    safe = _safe_next(next_path)
    if safe:
        params["next"] = safe
    if role == "affiliate":
        params["role"] = "affiliate"
    carried_ref = (request.cookies.get(affiliates.COOKIE) or ref_code or "").strip()[:80]
    if carried_ref:
        params["ref"] = carried_ref
    return RedirectResponse(
        f"{configured}/api/v1/auth/oauth/{quote(provider)}/start?{urlencode(params)}",
        status_code=307,
    )


@router.get("/{provider}/start")
def start(
    provider: str,
    request: Request,
    next: str | None = None,
    role: str | None = None,
    ref: str | None = None,
) -> RedirectResponse:
    if provider not in LABELS or not _ready(provider):
        return RedirectResponse("/login?oauth_error=unavailable", status_code=303)
    bounce = _canonical_start_redirect(request, provider, next, role, ref)
    if bounce is not None:
        return bounce
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    params = {
        "client_id": settings.google_client_id.strip(),
        "redirect_uri": redirect_uri(request, provider),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    }
    url = f"{GOOGLE_AUTH}?{urlencode(params)}"
    response = RedirectResponse(url, status_code=303)
    secure = _secure(request)
    response.set_cookie(
        STATE_COOKIE,
        _sign_state(
            {
                "p": provider,
                "s": state,
                "n": nonce,
                "next": _safe_next(next),
                "r": "affiliate" if role == "affiliate" else "customer",
                "ref": (request.cookies.get(affiliates.COOKIE) or ref or "").strip()[:80],
            }
        ),
        max_age=STATE_TTL,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/v1/auth/oauth",
    )
    return response


def _identity(provider: str, request: Request, code: str, nonce: str) -> dict[str, Any]:
    tokens = _exchange(
        GOOGLE_TOKEN,
        {
            "code": code,
            "client_id": settings.google_client_id.strip(),
            "client_secret": settings.google_client_secret.get_secret_value() if settings.google_client_secret else "",
            "redirect_uri": redirect_uri(request, provider),
            "grant_type": "authorization_code",
        },
    )
    claims = verify_id_token(
        str(tokens.get("id_token") or ""),
        keys_url=GOOGLE_KEYS,
        audience=settings.google_client_id.strip(),
        issuers=GOOGLE_ISSUERS,
        nonce=nonce,
    )
    return {
        "subject": str(claims["sub"]),
        "email": claims.get("email"),
        "email_verified": _truthy(claims.get("email_verified")),
        "name": claims.get("name") or claims.get("given_name"),
    }


def _callback(provider: str, request: Request, db: Session, fields: dict[str, str]) -> HTMLResponse:
    if provider not in LABELS or not _ready(provider):
        return _fail(request, "unavailable")
    if fields.get("error"):
        cancelled = fields["error"] in ("access_denied", "user_cancelled_authorize")
        logger.info("%s sign-in ended by the provider: %s", provider, fields["error"])
        return _fail(request, "cancelled" if cancelled else "failed")

    try:
        state = _read_state(request.cookies.get(STATE_COOKIE))
        if state.get("p") != provider or not secrets.compare_digest(str(state.get("s", "")), fields.get("state", "")):
            raise OAuthFailure("expired", "state mismatch")
        if not fields.get("code"):
            raise OAuthFailure("failed", "no code")
        who = _identity(provider, request, fields["code"], str(state.get("n", "")))
        user, opened = find_or_create_user(
            db, request, provider=provider, account_role=str(state.get("r", "customer")), **who
        )
    except OAuthFailure as failure:
        logger.warning("%s sign-in failed: %s", provider, failure)
        return _fail(request, failure.code)

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    log_activity(db, user.id, "login", f"Signed in with {LABELS[provider]}")
    ip = affiliates.ip_hash(meta_capi._client_ip(request))
    if opened:
        ref_cookie = request.cookies.get(affiliates.COOKIE) or str(state.get("ref") or "")
        affiliates.attribute_signup(db, user, ref_cookie or None, "", ip)
        affiliates.remember_device(db, user, "", ip)
        security.remember_device(db, user, request)
    else:
        affiliates.remember_device(db, user, "", ip)
        security.note_sign_in(db, user, request)

    if is_admin(user):
        target = state.get("next") or "/admin"
    elif is_affiliate_only(user):
        next_url = str(state.get("next") or "")
        target = next_url if next_url.startswith("/affiliates") else "/affiliates/dashboard"
    else:
        target = state.get("next") or "/app"
    response = _go(target)
    set_session_cookie(response, create_session_token(user))
    _clear_state(response, request)
    return response


@router.get("/{provider}/callback")
def callback_get(provider: str, request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    return _callback(provider, request, db, dict(request.query_params))
