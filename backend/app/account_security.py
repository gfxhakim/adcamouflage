"""Email codes (sign-up, password reset, changes) and the new sign-in alert.

Codes are 6 digits, valid for ``ADCAM_EMAIL_CODE_MINUTES`` (15 by default),
work once, and die after a few wrong guesses. Only an HMAC of the code (keyed
with the app's secret) is stored. A new code for the same purpose replaces
the older ones, and a fresh code can be requested at most once a minute.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import AuthCode, KnownDevice, User
from .plans import aware

logger = logging.getLogger(__name__)

VERIFY = "verify"
RESET = "reset"
PASSWORD = "password"
EMAIL = "email"
PURPOSES = (VERIFY, RESET, PASSWORD, EMAIL)

MAX_ATTEMPTS = 5
RESEND_AFTER = timedelta(seconds=60)
CODE_LENGTH = 6

# An unusable password for accounts made with Google or Apple. bcrypt cannot
# parse it, so a password sign-in always fails until the owner sets one
# through Forgot password.
NO_PASSWORD = "!no-password"


def has_password(user: User) -> bool:
    return bool(user.password_hash) and not user.password_hash.startswith("!")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(user_id: int, purpose: str, code: str) -> str:
    key = settings.secret_key.encode("utf-8")
    return hmac.new(key, f"{purpose}:{user_id}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def recently_sent(db: Session, user: User, purpose: str) -> bool:
    """True when a code for this purpose went out less than a minute ago."""

    last = db.execute(
        select(AuthCode.created_at)
        .where(AuthCode.user_id == user.id, AuthCode.purpose == purpose)
        .order_by(AuthCode.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return last is not None and _now() - aware(last) < RESEND_AFTER


def issue(db: Session, user: User, purpose: str, target: str | None = None) -> str:
    """Make a new code for ``purpose`` (older unused ones stop working) and return it."""

    assert purpose in PURPOSES
    now = _now()
    db.execute(
        update(AuthCode)
        .where(AuthCode.user_id == user.id, AuthCode.purpose == purpose, AuthCode.used_at.is_(None))
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    code = f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"
    db.add(
        AuthCode(
            user_id=user.id,
            purpose=purpose,
            code_hash=_hash(user.id, purpose, code),
            target=target,
            created_at=now,
            expires_at=now + timedelta(minutes=max(1, settings.email_code_minutes)),
        )
    )
    db.commit()
    return code


def _clean(code: str) -> str:
    return re.sub(r"\D", "", code or "")


def check(db: Session, user: User, purpose: str, code: str) -> AuthCode | None:
    """Use up the live code for ``purpose`` if ``code`` matches it.

    Returns the code row (its ``target`` matters for an email change) or
    None when it is wrong, expired, used or out of attempts. A wrong guess
    counts against the code.
    """

    row = db.execute(
        select(AuthCode)
        .where(AuthCode.user_id == user.id, AuthCode.purpose == purpose, AuthCode.used_at.is_(None))
        .order_by(AuthCode.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        return None
    now = _now()
    if aware(row.expires_at) <= now or row.attempts >= MAX_ATTEMPTS:
        return None
    if not hmac.compare_digest(row.code_hash, _hash(user.id, purpose, _clean(code))):
        row.attempts += 1
        db.commit()
        return None
    # Claimed with a conditional update so two requests with the same code
    # cannot both succeed.
    claimed = db.execute(
        update(AuthCode)
        .where(AuthCode.id == row.id, AuthCode.used_at.is_(None))
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    if claimed != 1:
        return None
    db.refresh(row)
    return row


# --------------------------------------------------------------------------
# new sign-in alert
# --------------------------------------------------------------------------

_BROWSERS = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("SamsungBrowser", "Samsung Internet"),
    ("Firefox/", "Firefox"),
    ("FxiOS", "Firefox"),
    ("CriOS", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
_SYSTEMS = (
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Android", "Android"),
    ("Windows", "Windows"),
    ("Mac OS X", "Mac"),
    ("Macintosh", "Mac"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
)


def device_label(user_agent: str) -> str:
    """'Chrome on Windows' style label from a User-Agent (no version numbers)."""

    ua = user_agent or ""
    browser = next((name for needle, name in _BROWSERS if needle in ua), "Unknown browser")
    system = next((name for needle, name in _SYSTEMS if needle in ua), "unknown system")
    return f"{browser} on {system}"


def client_ip(request: Request) -> str:
    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    first = forwarded.split(",")[0].strip() if forwarded else ""
    return first or (request.client.host if request.client else "") or "unknown"


def note_sign_in(db: Session, user: User, request: Request) -> None:
    """Remember this browser; email the owner when it is a new one. Never raises.

    The very first browser on an account (the sign-up, or the first sign-in
    after this feature shipped) is remembered quietly, so nobody gets an
    alert for their own usual device.
    """

    try:
        label = device_label(request.headers.get("user-agent", ""))
        fingerprint = hashlib.sha256(label.encode("utf-8")).hexdigest()[:32]
        now = _now()
        known = db.execute(select(KnownDevice).where(KnownDevice.user_id == user.id)).scalars().all()
        mine = next((d for d in known if d.fingerprint == fingerprint), None)
        if mine is not None:
            mine.last_seen = now
            db.commit()
            return
        db.add(KnownDevice(user_id=user.id, fingerprint=fingerprint, label=label, first_seen=now, last_seen=now))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # a parallel sign-in from the same browser added it
            return
        if known:
            from . import mailer

            mailer.send_kind(db, user, "new_login", {"device": label, "ip": client_ip(request)})
    except Exception:  # noqa: BLE001 - an alert must never block a sign-in
        db.rollback()
        logger.exception("sign-in alert for user %s failed", user.id)


def remember_device(db: Session, user: User, request: Request) -> None:
    """Remember the browser used to sign up, without an alert."""

    try:
        label = device_label(request.headers.get("user-agent", ""))
        fingerprint = hashlib.sha256(label.encode("utf-8")).hexdigest()[:32]
        exists = db.execute(
            select(KnownDevice.id).where(KnownDevice.user_id == user.id, KnownDevice.fingerprint == fingerprint)
        ).first()
        if not exists:
            db.add(KnownDevice(user_id=user.id, fingerprint=fingerprint, label=label))
            db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
