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
    is_admin,
    clear_session_cookie,
    create_session_token,
    current_user,
    get_user_by_email,
    hash_password,
    set_session_cookie,
    validate_email,
    validate_password,
    verify_password,
)
from .activity import log_activity
from .config import settings
from .db import BatchRecord, User, get_db
from .plans import PLANS, apply_plan, default_plan, plan_expired, used_this_month

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


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class UserProfile(BaseModel):
    id: int
    email: str
    display_name: str | None
    created_at: datetime
    last_login_at: datetime | None
    is_admin: bool = False
    plan: str = "unlimited"
    plan_label: str = "Unlimited"
    monthly_quota: int | None = None
    used_this_month: int = 0
    plan_expires_at: datetime | None = None
    plan_expired: bool = False

    @classmethod
    def of(cls, user: User, db: Session) -> "UserProfile":
        plan = PLANS.get(user.plan)
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            is_admin=is_admin(user),
            plan=user.plan,
            plan_label=plan.label if plan else user.plan,
            monthly_quota=user.monthly_quota,
            used_this_month=used_this_month(db, user),
            plan_expires_at=user.plan_expires_at,
            plan_expired=plan_expired(user),
        )


class BatchSummary(BaseModel):
    id: str
    asset_count: int
    preset: str
    created_at: datetime


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


@router.post("/register", response_model=UserProfile, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> UserProfile:
    if not settings.allow_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="New accounts are closed on this instance.",
        )

    email = validate_email(payload.email)
    password = validate_password(payload.password)

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=(payload.display_name or "").strip() or None,
        last_login_at=datetime.now(timezone.utc),
    )
    apply_plan(user, default_plan().id)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique index is the real guard against a duplicate created by a
        # concurrent request, so handle its failure rather than pre-checking.
        db.rollback()
        raise AuthError("An account with that email already exists.", status.HTTP_409_CONFLICT)

    db.refresh(user)
    set_session_cookie(response, create_session_token(user))
    logger.info("registered user %s", user.id)
    log_activity(db, user.id, "signup", f"Signed up on the {user.plan} plan")
    return UserProfile.of(user, db)


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
    stored = user.password_hash if user else "$2b$12$" + "." * 53
    password_ok = verify_password(payload.password or "", stored)

    if user is None or not password_ok or not user.is_active:
        login_limiter.record_failure(key)
        raise AuthError("That email and password do not match.")

    login_limiter.clear(key)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    set_session_cookie(response, create_session_token(user))
    log_activity(db, user.id, "login", "Signed in")
    return UserProfile.of(user, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserProfile)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserProfile:
    return UserProfile.of(user, db)


@router.post("/password", response_model=UserProfile)
def change_password(
    payload: PasswordChange,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> UserProfile:
    if not verify_password(payload.current_password or "", user.password_hash):
        raise AuthError("Your current password is not correct.")

    new_password = validate_password(payload.new_password)
    user.password_hash = hash_password(new_password)
    # Ends every other session that was signed in with the old password.
    user.token_version += 1
    db.commit()
    db.refresh(user)

    set_session_cookie(response, create_session_token(user))
    log_activity(db, user.id, "password", "Changed password")
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


def record_batch(db: Session, batch_id: str, user_id: int, asset_count: int, options: object) -> None:
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
    log_activity(db, user_id, "batch", f"Started a batch of {asset_count} {noun} ({preset})")
