"""Sign-up, sign-in and account endpoints."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .accounts import (
    AuthError,
    clear_session_cookie,
    create_session_token,
    current_user,
    get_user_by_email,
    is_admin,
    hash_password,
    set_session_cookie,
    validate_email,
    validate_password,
    verify_password,
)
from . import account_security as security
from . import mailer, meta_capi
from .activity import log_activity
from .app_settings import announcement, registration_open
from .config import settings
from .db import BatchRecord, TeamMember, User, get_db
from .plans import apply_plan, default_plan, get_plans, plan_expired, plan_label, used_this_month
from .tokens import TOKENS, subscription_active, usable_tokens

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# --------------------------------------------------------------------------
# brute-force throttle
# --------------------------------------------------------------------------


class _AttemptLimiter:
    """Sliding-window limiter for sign-in attempts.

    In-process, so it protects a single API instance. Behind several replicas
    put a shared limiter at the edge as well; this still bounds the damage a
    single instance will do.
    """

    def __init__(self, limit: int = 8, window_seconds: int = 300) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            recent = [stamp for stamp in self._hits[key] if now - stamp < self.window]
            self._hits[key] = recent
            if len(recent) >= self.limit:
                raise AuthError(
                    "Too many sign-in attempts. Wait a few minutes and try again.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                )

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


login_limiter = _AttemptLimiter()


def _client_key(request: Request, email: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{email}"


# --------------------------------------------------------------------------
# payloads
# --------------------------------------------------------------------------


class Credentials(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class RegisterRequest(Credentials):
    display_name: str | None = Field(default=None, max_length=120)


class UserProfile(BaseModel):
    id: int
    email: str
    display_name: str | None
    created_at: datetime
    last_login_at: datetime | None
    plan: str = "unlimited"
    plan_label: str = "Unlimited"
    monthly_quota: int | None = None
    used_this_month: int = 0
    plan_expires_at: datetime | None = None
    plan_expired: bool = False
    # A message the admin wants every signed-in user to see; empty for none.
    announcement: str = ""
    # Token billing (see app/tokens.py). Legacy accounts keep the fields above.
    billing_mode: str = "legacy"
    tokens_usable: int = 0
    subscription_active: bool = False
    # True for accounts made with Google or Apple until a password is set.
    social_only: bool = False

    @classmethod
    def of(cls, user: User, db: Session) -> "UserProfile":
        from .teams import billing_account

        payer = billing_account(db, user)
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            plan=user.plan,
            plan_label=plan_label(get_plans(db), user.plan),
            monthly_quota=user.monthly_quota,
            used_this_month=used_this_month(db, user),
            plan_expires_at=user.plan_expires_at,
            plan_expired=plan_expired(user),
            announcement=announcement(db),
            billing_mode=user.billing_mode,
            tokens_usable=usable_tokens(db, payer),
            subscription_active=subscription_active(payer),
            social_only=not security.has_password(user),
        )


class BatchSummary(BaseModel):
    id: str
    asset_count: int
    preset: str
    created_at: datetime


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


class RegisterPending(BaseModel):
    """Sign-up accepted; the account opens once the emailed code is entered."""

    verify: bool = True
    email: str


class EmailOnly(BaseModel):
    email: str = Field(max_length=320)


class CodeIn(BaseModel):
    email: str = Field(max_length=320)
    code: str = Field(max_length=20)


class ResetIn(CodeIn):
    new_password: str = Field(max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(default="", max_length=256)
    new_password: str = Field(max_length=256)
    code: str = Field(default="", max_length=20)


class EmailChangeStart(BaseModel):
    new_email: str = Field(max_length=320)
    current_password: str = Field(default="", max_length=256)


class EmailChangeIn(BaseModel):
    code: str = Field(max_length=20)


class Providers(BaseModel):
    google: bool
    apple: bool
    # True when new sign-ups must enter an emailed code.
    email_codes: bool


WRONG_CODE = "That code is wrong or has expired. Check the latest email, or ask for a new code."
code_limiter = _AttemptLimiter(limit=10, window_seconds=600)


def verification_on() -> bool:
    """Codes need a working mail server; without one, sign-up opens the account at once."""

    return mailer.configured()


def _send_code(db: Session, user: User, purpose: str, kind: str, *, to: str | None = None, extra: dict | None = None) -> None:
    code = security.issue(db, user, purpose, target=to)
    mailer.send_kind(db, user, kind, {"code": code, **(extra or {})}, to=to)


def _sign_in(db: Session, user: User, request: Request, response: Response, *, how: str = "Signed in") -> None:
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, create_session_token(user))
    log_activity(db, user.id, "login", how)
    security.note_sign_in(db, user, request)


def _welcome_new_account(db: Session, user: User, request: Request) -> None:
    """Everything a newly opened account gets: Meta event, welcome email, first device."""

    try:
        meta_capi.complete_registration(request, user.id, user.email)
    except Exception:  # noqa: BLE001 - tracking must never block a sign-up
        logger.exception("Meta CompleteRegistration for user %s failed", user.id)
    mailer.welcome(db, user)
    security.remember_device(db, user, request)


@router.get("/providers", response_model=Providers)
def providers() -> Providers:
    return Providers(google=settings.google_ready, apple=settings.apple_ready, email_codes=verification_on())


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> UserProfile | RegisterPending:
    if not registration_open(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="New accounts are closed on this instance.",
        )

    email = validate_email(payload.email)
    password = validate_password(payload.password)
    name = (payload.display_name or "").strip() or None
    needs_code = verification_on()

    existing = get_user_by_email(db, email)
    if existing is not None:
        if existing.email_verified or not needs_code or not existing.is_active:
            raise AuthError("An account with that email already exists.", status.HTTP_409_CONFLICT)
        # Signed up before but never entered the code: start again with the
        # new password. Safe, because nothing opens without the code.
        existing.password_hash = hash_password(password)
        existing.display_name = name or existing.display_name
        existing.token_version += 1
        db.commit()
        if not security.recently_sent(db, existing, security.VERIFY):
            _send_code(db, existing, security.VERIFY, "verify")
        response.status_code = status.HTTP_202_ACCEPTED
        return RegisterPending(email=email)

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=name,
        last_login_at=None if needs_code else datetime.now(timezone.utc),
        # New accounts buy a token plan; the legacy quota plan is only a label.
        billing_mode=TOKENS,
        email_verified=not needs_code,
    )
    apply_plan(db, user, default_plan(db).id)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique index is the real guard against a duplicate created by a
        # concurrent request, so handle its failure rather than pre-checking.
        db.rollback()
        raise AuthError("An account with that email already exists.", status.HTTP_409_CONFLICT)

    db.refresh(user)
    logger.info("registered user %s", user.id)
    log_activity(db, user.id, "signup", f"Signed up on the {user.plan} plan")
    if needs_code:
        _send_code(db, user, security.VERIFY, "verify")
        response.status_code = status.HTTP_202_ACCEPTED
        return RegisterPending(email=email)

    set_session_cookie(response, create_session_token(user))
    _welcome_new_account(db, user, request)
    return UserProfile.of(user, db)


@router.post("/verify-email", response_model=UserProfile)
def verify_email(payload: CodeIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserProfile:
    email = (payload.email or "").strip().lower()
    key = _client_key(request, "code:" + email)
    code_limiter.check(key)
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        code_limiter.record_failure(key)
        raise AuthError(WRONG_CODE, status.HTTP_400_BAD_REQUEST)
    if user.email_verified:
        raise AuthError("This email is already confirmed. Log in instead.", status.HTTP_409_CONFLICT)
    if security.check(db, user, security.VERIFY, payload.code) is None:
        code_limiter.record_failure(key)
        raise AuthError(WRONG_CODE, status.HTTP_400_BAD_REQUEST)
    code_limiter.clear(key)
    user.email_verified = True
    db.commit()
    log_activity(db, user.id, "signup", "Confirmed email with the code")
    _sign_in(db, user, request, response, how="Signed in after confirming email")
    _welcome_new_account(db, user, request)
    return UserProfile.of(user, db)


@router.post("/verify-email/resend")
def resend_verification(payload: EmailOnly, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Send a new sign-up code. Always answers ok, so it tells nobody which emails have accounts."""

    user = get_user_by_email(db, payload.email)
    if user is not None and user.is_active and not user.email_verified and verification_on():
        if not security.recently_sent(db, user, security.VERIFY):
            _send_code(db, user, security.VERIFY, "verify")
    return {"ok": True}


@router.post("/login", response_model=UserProfile)
def login(
    payload: Credentials,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> UserProfile:
    email = (payload.email or "").strip().lower()
    key = _client_key(request, email)
    login_limiter.check(key)

    user = get_user_by_email(db, email)
    # Always run a hash comparison so a missing account and a wrong password
    # take a similar amount of time, and report the same message either way.
    stored = user.password_hash if user and security.has_password(user) else "$2b$12$" + "." * 53
    password_ok = verify_password(payload.password or "", stored)

    if user is None or not password_ok or not user.is_active:
        login_limiter.record_failure(key)
        if user is not None and user.is_active and not security.has_password(user):
            raise AuthError(
                "This account uses Google or Apple to log in. Use that button, or set a password with Forgot password."
            )
        raise AuthError("That email and password do not match.")

    login_limiter.clear(key)
    if not user.email_verified and not is_admin(user) and verification_on():
        if not security.recently_sent(db, user, security.VERIFY):
            _send_code(db, user, security.VERIFY, "verify")
        raise AuthError(
            f"Confirm your email first: enter the 6-digit code we sent to {user.email}.",
            status.HTTP_403_FORBIDDEN,
        )
    _sign_in(db, user, request, response)
    return UserProfile.of(user, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserProfile)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserProfile:
    return UserProfile.of(user, db)


# --------------------------------------------------------------------------
# forgot password
# --------------------------------------------------------------------------


@router.post("/password/forgot")
def forgot_password(payload: EmailOnly, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Email a reset code. Always answers ok, so it tells nobody which emails have accounts."""

    user = get_user_by_email(db, payload.email)
    if user is not None and user.is_active and not security.recently_sent(db, user, security.RESET):
        _send_code(db, user, security.RESET, "reset")
    return {"ok": True, "email_ready": mailer.configured()}


@router.post("/password/reset", response_model=UserProfile)
def reset_password(payload: ResetIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserProfile:
    email = (payload.email or "").strip().lower()
    key = _client_key(request, "code:" + email)
    code_limiter.check(key)
    new_password = validate_password(payload.new_password)
    user = get_user_by_email(db, email)
    if user is None or not user.is_active or security.check(db, user, security.RESET, payload.code) is None:
        code_limiter.record_failure(key)
        raise AuthError(WRONG_CODE, status.HTTP_400_BAD_REQUEST)
    code_limiter.clear(key)
    user.password_hash = hash_password(new_password)
    user.token_version += 1  # signs out every other device
    newly_verified = not user.email_verified
    user.email_verified = True  # the code proves they own the inbox
    db.commit()
    log_activity(db, user.id, "password", "Reset password with an emailed code")
    mailer.send_kind(db, user, "password_changed")
    _sign_in(db, user, request, response, how="Signed in after a password reset")
    if newly_verified:
        _welcome_new_account(db, user, request)
    return UserProfile.of(user, db)


# --------------------------------------------------------------------------
# signed-in changes: password and email
# --------------------------------------------------------------------------


@router.post("/password/code")
def password_change_code(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, bool]:
    """Email the code that confirms a password change."""

    if not mailer.configured():
        return {"sent": False, "required": False}
    if security.recently_sent(db, user, security.PASSWORD):
        raise HTTPException(status_code=429, detail="A code was just sent. Wait a minute before asking for another.")
    _send_code(db, user, security.PASSWORD, "password_code")
    return {"sent": True, "required": True}


@router.post("/password", response_model=UserProfile)
def change_password(
    payload: PasswordChangeIn,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> UserProfile:
    if security.has_password(user) and not verify_password(payload.current_password or "", user.password_hash):
        raise AuthError("Your current password is not correct.")

    new_password = validate_password(payload.new_password)
    if mailer.configured():
        key = _client_key(request, f"pwcode:{user.id}")
        code_limiter.check(key)
        if security.check(db, user, security.PASSWORD, payload.code) is None:
            code_limiter.record_failure(key)
            raise AuthError(WRONG_CODE, status.HTTP_400_BAD_REQUEST)
        code_limiter.clear(key)
    user.password_hash = hash_password(new_password)
    # Ends every other session that was signed in with the old password.
    user.token_version += 1
    db.commit()
    db.refresh(user)

    set_session_cookie(response, create_session_token(user))
    log_activity(db, user.id, "password", "Changed password")
    mailer.send_kind(db, user, "password_changed")
    return UserProfile.of(user, db)


@router.post("/email/code")
def email_change_code(
    payload: EmailChangeStart, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, str]:
    """Send a code to the new address; the change happens once it is entered."""

    if is_admin(user):
        raise HTTPException(status_code=403, detail="The admin email is set with ADCAM_ADMIN_EMAILS on the api service.")
    if not mailer.configured():
        raise HTTPException(status_code=409, detail="Email is not set up on the server yet, so the address cannot be changed.")
    if security.has_password(user) and not verify_password(payload.current_password or "", user.password_hash):
        raise AuthError("Your current password is not correct.")
    new_email = validate_email(payload.new_email)
    if new_email == user.email:
        raise HTTPException(status_code=422, detail="That is already your email.")
    if get_user_by_email(db, new_email) is not None:
        raise HTTPException(status_code=409, detail="Another account already uses that email.")
    if security.recently_sent(db, user, security.EMAIL):
        raise HTTPException(status_code=429, detail="A code was just sent. Wait a minute before asking for another.")
    _send_code(db, user, security.EMAIL, "email_code", to=new_email, extra={"new_email": new_email})
    return {"sent_to": new_email}


@router.post("/email", response_model=UserProfile)
def change_email(
    payload: EmailChangeIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> UserProfile:
    key = _client_key(request, f"emailcode:{user.id}")
    code_limiter.check(key)
    row = security.check(db, user, security.EMAIL, payload.code)
    if row is None or not row.target:
        code_limiter.record_failure(key)
        raise AuthError(WRONG_CODE, status.HTTP_400_BAD_REQUEST)
    code_limiter.clear(key)
    old_email, new_email = user.email, row.target
    if get_user_by_email(db, new_email) is not None:
        raise HTTPException(status_code=409, detail="Another account already uses that email.")
    user.email = new_email
    user.email_verified = True
    # A team seat follows the person to the new address.
    seat = db.execute(select(TeamMember).where(TeamMember.email == old_email)).scalar_one_or_none()
    taken = db.execute(select(TeamMember.id).where(TeamMember.email == new_email)).first()
    if seat is not None and not taken:
        seat.email = new_email
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Another account already uses that email.")
    db.refresh(user)
    log_activity(db, user.id, "email", f"Changed email from {old_email} to {new_email}")
    mailer.send_kind(db, user, "email_changed", {"new_email": new_email}, to=old_email)
    return UserProfile.of(user, db)


@router.get("/batches", response_model=list[BatchSummary])
def my_batches(
    limit: int = 25,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[BatchSummary]:
    rows = (
        db.execute(
            select(BatchRecord)
            .where(BatchRecord.user_id == user.id)
            .order_by(BatchRecord.created_at.desc())
            .limit(max(1, min(limit, 100)))
        )
        .scalars()
        .all()
    )
    return [
        BatchSummary(
            id=row.id,
            asset_count=row.asset_count,
            preset=row.preset,
            created_at=row.created_at,
        )
        for row in rows
    ]


def record_batch(
    db: Session,
    batch_id: str,
    user_id: int,
    asset_count: int,
    options: object,
    token_cost: int = 0,
) -> None:
    """Persist a batch so it survives the Redis retention window."""

    try:
        payload = options.model_dump() if hasattr(options, "model_dump") else dict(options or {})
        raw_preset = payload.get("preset", "balanced")
        preset = str(getattr(raw_preset, "value", raw_preset))
        db.add(
            BatchRecord(
                id=batch_id,
                user_id=user_id,
                asset_count=asset_count,
                preset=preset,
                options_json=json.dumps(payload, default=str),
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 - history must never fail a submission
        db.rollback()
        logger.warning("could not record batch %s", batch_id, exc_info=True)
        return
    noun = "file" if asset_count == 1 else "files"
    cost = f" for {token_cost} tokens" if token_cost else ""
    log_activity(db, user_id, "batch", f"Started a batch of {asset_count} {noun} ({preset}){cost}")
