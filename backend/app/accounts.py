"""Password hashing, session tokens and the request dependencies that use them."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import User, get_db
from .plans import apply_plan

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


DISPOSABLE_EMAIL_DOMAINS: frozenset[str] = frozenset(
    {
        "mailinator.com",
        "guerrillamail.com",
        "guerrillamail.net",
        "guerrillamail.org",
        "sharklasers.com",
        "grr.la",
        "tempmail.com",
        "temp-mail.org",
        "temp-mail.io",
        "10minutemail.com",
        "10minutemail.net",
        "yopmail.com",
        "yopmail.fr",
        "yopmail.net",
        "throwawaymail.com",
        "trashmail.com",
        "trashmail.net",
        "getnada.com",
        "nada.email",
        "dispostable.com",
        "fakeinbox.com",
        "maildrop.cc",
        "mintemail.com",
        "mohmal.com",
        "emailondeck.com",
        "getairmail.com",
        "harakirimail.com",
        "mailnesia.com",
        "burnermail.io",
        "tempr.email",
        "discard.email",
        "inboxkitten.com",
        "moakt.com",
        "mytemp.email",
        "tempail.com",
    }
)

_WEAK_PASSWORDS: frozenset[str] = frozenset(
    {
        "password",
        "password1",
        "password123",
        "passw0rd",
        "qwerty",
        "qwertyui",
        "qwertyuiop",
        "qwerty123",
        "admin",
        "admin123",
        "admin1234",
        "letmein",
        "welcome",
        "welcome1",
        "welcome123",
        "iloveyou",
        "sunshine",
        "football",
        "princess",
        "dragon12",
        "monkey12",
        "trustno1",
        "proteusflow",
        "camo1234",
        "12345678",
        "123456789",
        "1234567890",
        "00000000",
        "11111111",
        "aaaaaaaa",
    }
)

_WEAK_BASE_WORDS: frozenset[str] = frozenset(
    {
        "password",
        "passw0rd",
        "qwerty",
        "qwertyuiop",
        "admin",
        "letmein",
        "welcome",
        "iloveyou",
        "abcdef",
        "abcdefg",
        "abcdefgh",
        "proteusflow",
    }
)

_WEAK_SEQUENCES: tuple[str, ...] = (
    "01234",
    "12345",
    "23456",
    "34567",
    "45678",
    "56789",
    "98765",
    "87654",
    "76543",
    "65432",
    "54321",
    "43210",
    "abcdef",
    "fedcba",
    "qwerty",
    "asdfgh",
    "zxcvbn",
)


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def email_domain(email: str) -> str:
    cleaned = normalise_email(email)
    return cleaned.rsplit("@", 1)[-1] if "@" in cleaned else ""


def is_disposable_email(email: str) -> bool:
    return email_domain(email) in DISPOSABLE_EMAIL_DOMAINS


def is_trusted_email_domain(domain: str) -> bool:
    cleaned = domain.strip().lower().lstrip("@")
    if not cleaned or cleaned in DISPOSABLE_EMAIL_DOMAINS:
        return False
    allowed = {entry.strip().lower().lstrip("@") for entry in settings.trusted_email_domains if entry.strip()}
    return not allowed or cleaned in allowed


def validate_email(email: str, *, require_trusted: bool = True) -> str:
    cleaned = normalise_email(email)
    if not cleaned or len(cleaned) > 320 or not _EMAIL_PATTERN.match(cleaned):
        raise AuthError("Enter a valid email address.", status.HTTP_422_UNPROCESSABLE_ENTITY)
    domain = email_domain(cleaned)
    if domain in DISPOSABLE_EMAIL_DOMAINS:
        raise AuthError(
            "Temporary or disposable email addresses are not allowed. Use a trusted provider like Gmail, Hotmail, Outlook, iCloud, Yahoo, or Proton.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if require_trusted and not is_trusted_email_domain(domain):
        raise AuthError(
            "Use a trusted email provider like Gmail, Hotmail, Outlook, iCloud, Yahoo, or Proton.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return cleaned


def validate_password(password: str, *, email: str = "") -> str:
    if not password:
        raise AuthError("A password is required.", status.HTTP_422_UNPROCESSABLE_ENTITY)
    if len(password) < settings.min_password_length:
        raise AuthError(
            f"Use at least {settings.min_password_length} characters.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if not password.strip():
        raise AuthError("Password cannot be spaces only.", status.HTTP_422_UNPROCESSABLE_ENTITY)
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise AuthError(
            "That password is too long; use 72 bytes or fewer.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    lower = password.lower()
    if lower in _WEAK_PASSWORDS:
        raise AuthError(
            "That password is too common. Pick a personal phrase or mix letters, numbers, and symbols.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    alpha_only = re.sub(r"[^a-z]+", "", lower)
    if alpha_only in _WEAK_BASE_WORDS and len(password) < 12:
        raise AuthError(
            "That password is too easy to guess. Pick a stronger phrase or word combination.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if re.search(r"(.)\1\1\1", password):
        raise AuthError(
            "Avoid repeating the same character 4+ times in a row.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if any(seq in lower for seq in _WEAK_SEQUENCES) and len(password) < 12:
        raise AuthError(
            "Avoid obvious keyboard or number sequences like 12345 or qwerty.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if len(set(password)) < 5:
        raise AuthError(
            "Use more varied characters so your password is harder to guess.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if email:
        cleaned_email = normalise_email(email)
        local_part = cleaned_email.split("@", 1)[0]
        if lower == cleaned_email or (len(local_part) >= 4 and local_part in lower and len(lower) <= len(local_part) + 3):
            raise AuthError(
                "Do not use your email address as your password.",
                status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
    classes = sum(
        (
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() and not c.isspace() for c in password),
        )
    )
    strong_passphrase = len(password) >= 12 and classes >= 2 and len(set(password)) >= 6
    strong_mixed = classes >= 3
    if not (strong_passphrase or strong_mixed):
        raise AuthError(
            "Make it stronger: mix 3 of uppercase, lowercase, numbers, or symbols — or use a 12+ character passphrase.",
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


def is_affiliate_only(user: User) -> bool:
    """True for partners who signed up via the affiliate portal (dashboard-only)."""

    return getattr(user, "account_role", "customer") == "affiliate" and not is_admin(user)


def current_user(
    session_cookie: str | None = Cookie(default=None, alias=settings.cookie_name),
    db: Session = Depends(get_db),
) -> User:
    """Require a signed-in user."""

    user = _load_user(session_cookie, db)
    if user is None:
        raise AuthError("Sign in to continue.")
    return user


def require_studio_user(user: User = Depends(current_user)) -> User:
    """Block affiliate-only accounts from workspace, render, batch, team, or billing APIs."""

    if is_affiliate_only(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Affiliate accounts only have access to the Affiliate Dashboard.",
        )
    return user


def ensure_admin_account(db: Session) -> None:
    """Give the first ADCAM_ADMIN_EMAILS address a working login from ADCAM_ADMIN_PASSWORD.

    Runs on every API start. The account is created if it is missing, so nobody
    can sign up with the admin's email first, and its password is reset whenever
    it no longer matches the variable: the variable always wins, which makes it
    the way to recover a forgotten admin password.
    """

    secret = settings.admin_password.get_secret_value() if settings.admin_password else ""
    if not secret or not settings.admin_emails:
        return
    try:
        email = validate_email(settings.admin_emails[0], require_trusted=False)
        password = validate_password(secret, email=email)
    except AuthError as exc:
        logger.error("ADCAM_ADMIN_PASSWORD was not applied: %s", exc.detail)
        return

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, password_hash=hash_password(password), display_name="Admin")
        # No file limit, but on the free plan so the owner is not counted as revenue.
        apply_plan(db, user, "free")
        user.monthly_quota = None
        db.add(user)
        change = "created"
    elif not verify_password(password, user.password_hash):
        user.password_hash = hash_password(password)
        user.token_version += 1  # sign out sessions made with the old password
        change = "password updated"
    else:
        change = ""
    user.is_admin = True
    user.is_active = True
    user.email_verified = True
    try:
        db.commit()
    except IntegrityError:
        # Another API process created it at the same moment; that one wins.
        db.rollback()
        return
    if change:
        logger.info("admin account %s for %s", change, email)


def require_admin(user: User = Depends(current_user)) -> User:
    """Require a signed-in admin.

    Everyone else gets the same 404 as a route that does not exist, so the
    admin API is not discoverable by customers poking at the network tab.
    """

    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
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
