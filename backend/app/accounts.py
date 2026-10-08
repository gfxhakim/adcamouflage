"""Password hashing, session tokens and the request dependencies that use them."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import User, get_db

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
TOKEN_AUDIENCE = "adcamouflage-session"

# bcrypt truncates silently past 72 bytes, which would make two different long
# passwords equivalent. Reject them instead of quietly accepting.
MAX_PASSWORD_BYTES = 72

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


class AuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED) -> None:
        super().__init__(status_code=status_code, detail=detail)


# --------------------------------------------------------------------------
# passwords
# --------------------------------------------------------------------------


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def validate_email(email: str) -> str:
    cleaned = normalise_email(email)
    if not cleaned or len(cleaned) > 320 or not _EMAIL_PATTERN.match(cleaned):
        raise AuthError("Enter a valid email address.", status.HTTP_422_UNPROCESSABLE_ENTITY)
    return cleaned


def validate_password(password: str) -> str:
    if not password:
        raise AuthError("A password is required.", status.HTTP_422_UNPROCESSABLE_ENTITY)
    if len(password) < settings.min_password_length:
        raise AuthError(
            f"Use at least {settings.min_password_length} characters.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise AuthError(
            "That password is too long; use 72 bytes or fewer.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return password


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # A malformed stored hash must read as "wrong password", never crash.
        return False


# --------------------------------------------------------------------------
# session tokens
# --------------------------------------------------------------------------


def create_session_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "ver": user.token_version,
        "aud": TOKEN_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.session_ttl_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_session_token(token: str) -> dict[str, object]:
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            audience=TOKEN_AUDIENCE,
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Your session has expired. Sign in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Your session is not valid. Sign in again.") from exc


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite_value,
        domain=settings.cookie_domain,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.cookie_name,
        domain=settings.cookie_domain,
        path="/",
    )


# --------------------------------------------------------------------------
# dependencies
# --------------------------------------------------------------------------


def _load_user(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    payload = decode_session_token(token)
    try:
        user_id = int(str(payload.get("sub")))
    except (TypeError, ValueError):
        raise AuthError("Your session is not valid. Sign in again.")

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthError("This account is no longer active.")

    # A password change bumps token_version, invalidating older sessions.
    if int(payload.get("ver", -1)) != user.token_version:
        raise AuthError("Your session has ended. Sign in again.")

    _touch_last_seen(user, db)
    return user


LAST_SEEN_RESOLUTION = timedelta(minutes=5)


def _touch_last_seen(user: User, db: Session) -> None:
    """Note when the user was last active, at most one write every few minutes."""

    now = datetime.now(timezone.utc)
    seen = user.last_seen_at
    if seen is not None and seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    if seen is not None and now - seen < LAST_SEEN_RESOLUTION:
        return
    try:
        user.last_seen_at = now
        db.commit()
    except Exception:  # noqa: BLE001 - a missed timestamp must not fail the request
        db.rollback()


def is_admin(user: User) -> bool:
    return bool(user.is_admin) or user.email in settings.admin_emails


def current_user(
    session_cookie: str | None = Cookie(default=None, alias=settings.cookie_name),
    db: Session = Depends(get_db),
) -> User:
    """Require a signed-in user."""

    user = _load_user(session_cookie, db)
    if user is None:
        raise AuthError("Sign in to continue.")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    """Require a signed-in admin."""

    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only.")
    return user


def optional_user(
    session_cookie: str | None = Cookie(default=None, alias=settings.cookie_name),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the signed-in user, or None - never raises for an absent cookie."""

    if not session_cookie:
        return None
    try:
        return _load_user(session_cookie, db)
    except HTTPException:
        return None


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == normalise_email(email))).scalar_one_or_none()
