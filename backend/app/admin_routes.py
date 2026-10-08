"""Admin panel endpoints: follow users' activity and manage their plans."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .accounts import is_admin, require_admin
from .activity import log_activity
from .config import settings
from .db import ActivityEvent, BatchRecord, User, get_db
from .plans import PLANS, apply_plan, month_start, plan_expired, used_this_month

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])

CHART_DAYS = 14


# --------------------------------------------------------------------------
# payloads
# --------------------------------------------------------------------------


class PlanInfo(BaseModel):
    id: str
    label: str
    monthly_quota: int | None


class AdminUser(BaseModel):
    id: int
    email: str
    display_name: str | None
    created_at: datetime
    last_login_at: datetime | None
    last_seen_at: datetime | None
    is_active: bool
    is_admin: bool
    # Granted by ADCAM_ADMIN_EMAILS, so it cannot be taken away from the panel.
    admin_from_settings: bool
    plan: str
    plan_label: str
    monthly_quota: int | None
    used_this_month: int
    plan_expires_at: datetime | None
    plan_expired: bool
    batch_count: int
    files_total: int


class UserPage(BaseModel):
    total: int
    users: list[AdminUser]


class AdminBatch(BaseModel):
    id: str
    asset_count: int
    preset: str
    created_at: datetime


class Activity(BaseModel):
    id: int
    user_id: int
    email: str
    kind: str
    detail: str
    created_at: datetime


class UserDetail(BaseModel):
    user: AdminUser
    batches: list[AdminBatch]
    activity: list[Activity]


class DayCount(BaseModel):
    day: date
    files: int
    batches: int


class Overview(BaseModel):
    total_users: int
    suspended_users: int
    active_7d: int
    signups_7d: int
    files_this_month: int
    batches_today: int
    plans: dict[str, int]
    daily: list[DayCount]


class UserUpdate(BaseModel):
    """Only the fields that are sent are changed."""

    plan: str | None = None
    # Sent as null with the key present to make the user unlimited.
    monthly_quota: int | None = Field(default=None, ge=0, le=1_000_000)
    plan_expires_at: datetime | None = None
    is_active: bool | None = None
    is_admin: bool | None = None


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _batch_totals(db: Session, user_ids: list[int]) -> dict[int, tuple[int, int]]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(
            BatchRecord.user_id,
            func.count(BatchRecord.id),
            func.coalesce(func.sum(BatchRecord.asset_count), 0),
        )
        .where(BatchRecord.user_id.in_(user_ids))
        .group_by(BatchRecord.user_id)
    ).all()
    return {row[0]: (int(row[1]), int(row[2])) for row in rows}


def _row(db: Session, user: User, totals: tuple[int, int] = (0, 0)) -> AdminUser:
    plan = PLANS.get(user.plan)
    return AdminUser(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        last_seen_at=user.last_seen_at,
        is_active=user.is_active,
        is_admin=is_admin(user),
        admin_from_settings=user.email in settings.admin_emails,
        plan=user.plan,
        plan_label=plan.label if plan else user.plan,
        monthly_quota=user.monthly_quota,
        used_this_month=used_this_month(db, user),
        plan_expires_at=user.plan_expires_at,
        plan_expired=plan_expired(user),
        batch_count=totals[0],
        files_total=totals[1],
    )


def _load(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


def _activity(db: Session, limit: int, user_id: int | None = None) -> list[Activity]:
    query = (
        select(ActivityEvent, User.email)
        .join(User, User.id == ActivityEvent.user_id)
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .limit(max(1, min(limit, 200)))
    )
    if user_id is not None:
        query = query.where(ActivityEvent.user_id == user_id)
    return [
        Activity(
            id=event.id,
            user_id=event.user_id,
            email=email,
            kind=event.kind,
            detail=event.detail,
            created_at=event.created_at,
        )
        for event, email in db.execute(query).all()
    ]


def _quota_text(quota: int | None) -> str:
    return "unlimited" if quota is None else f"{quota} files/month"


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------


@router.get("/plans", response_model=list[PlanInfo])
def plans() -> list[PlanInfo]:
    return [PlanInfo(id=p.id, label=p.label, monthly_quota=p.monthly_quota) for p in PLANS.values()]


@router.get("/overview", response_model=Overview)
def overview(db: Session = Depends(get_db)) -> Overview:
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    chart_start = today - timedelta(days=CHART_DAYS - 1)

    total = db.execute(select(func.count(User.id))).scalar_one()
    suspended = db.execute(select(func.count(User.id)).where(User.is_active.is_(False))).scalar_one()
    active = db.execute(
        select(func.count(User.id)).where(
            or_(User.last_seen_at >= week_ago, User.last_login_at >= week_ago)
        )
    ).scalar_one()
    signups = db.execute(select(func.count(User.id)).where(User.created_at >= week_ago)).scalar_one()
    files_month = db.execute(
        select(func.coalesce(func.sum(BatchRecord.asset_count), 0)).where(
            BatchRecord.created_at >= month_start(now)
        )
    ).scalar_one()
    plan_counts = dict(db.execute(select(User.plan, func.count(User.id)).group_by(User.plan)).all())

    # Bucketed in Python so the same code works on SQLite and Postgres.
    files_by_day: Counter[date] = Counter()
    batches_by_day: Counter[date] = Counter()
    for created_at, count in db.execute(
        select(BatchRecord.created_at, BatchRecord.asset_count).where(BatchRecord.created_at >= chart_start)
    ).all():
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        day = created_at.astimezone(timezone.utc).date()
        files_by_day[day] += int(count)
        batches_by_day[day] += 1

    days = [(chart_start + timedelta(days=offset)).date() for offset in range(CHART_DAYS)]
    return Overview(
        total_users=int(total),
        suspended_users=int(suspended),
        active_7d=int(active),
        signups_7d=int(signups),
        files_this_month=int(files_month or 0),
        batches_today=batches_by_day[today.date()],
        plans={str(k): int(v) for k, v in plan_counts.items()},
        daily=[DayCount(day=d, files=files_by_day[d], batches=batches_by_day[d]) for d in days],
    )


@router.get("/users", response_model=UserPage)
def list_users(
    q: str = "",
    plan: str = "",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> UserPage:
    query = select(User)
    needle = q.strip().lower()
    if needle:
        like = f"%{needle}%"
        query = query.where(or_(User.email.ilike(like), User.display_name.ilike(like)))
    if plan:
        query = query.where(User.plan == plan)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    users = (
        db.execute(query.order_by(User.created_at.desc(), User.id.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    totals = _batch_totals(db, [u.id for u in users])
    return UserPage(total=int(total), users=[_row(db, u, totals.get(u.id, (0, 0))) for u in users])


@router.get("/users/{user_id}", response_model=UserDetail)
def user_detail(user_id: int, db: Session = Depends(get_db)) -> UserDetail:
    user = _load(db, user_id)
    batches = (
        db.execute(
            select(BatchRecord)
            .where(BatchRecord.user_id == user.id)
            .order_by(BatchRecord.created_at.desc())
            .limit(25)
        )
        .scalars()
        .all()
    )
    return UserDetail(
        user=_row(db, user, _batch_totals(db, [user.id]).get(user.id, (0, 0))),
        batches=[
            # Older rows stored the enum's repr, e.g. "Preset.BALANCED".
            AdminBatch(
                id=b.id,
                asset_count=b.asset_count,
                preset=b.preset.rsplit(".", 1)[-1].lower(),
                created_at=b.created_at,
            )
            for b in batches
        ],
        activity=_activity(db, 50, user.id),
    )


@router.patch("/users/{user_id}", response_model=AdminUser)
def update_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    user = _load(db, user_id)
    sent = payload.model_fields_set
    changes: list[str] = []

    if user.id == admin.id and (
        ("is_active" in sent and payload.is_active is False)
        or ("is_admin" in sent and payload.is_admin is False)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot suspend yourself or remove your own admin access.",
        )

    if "plan" in sent and payload.plan is not None:
        if payload.plan not in PLANS:
            raise HTTPException(status_code=422, detail=f"Unknown plan '{payload.plan}'.")
        apply_plan(user, payload.plan)
        changes.append(f"plan set to {PLANS[payload.plan].label}")

    # Applied after the plan, so a custom number sent with a plan wins.
    if "monthly_quota" in sent:
        user.monthly_quota = payload.monthly_quota
        changes.append(f"limit set to {_quota_text(payload.monthly_quota)}")

    if "plan_expires_at" in sent:
        user.plan_expires_at = payload.plan_expires_at
        changes.append(
            f"plan ends {payload.plan_expires_at:%Y-%m-%d}" if payload.plan_expires_at else "end date removed"
        )

    if "is_active" in sent and payload.is_active is not None and payload.is_active != user.is_active:
        user.is_active = payload.is_active
        if not payload.is_active:
            # Ends every session the user has open right now.
            user.token_version += 1
        changes.append("account reactivated" if payload.is_active else "account suspended")

    if "is_admin" in sent and payload.is_admin is not None and payload.is_admin != user.is_admin:
        if not payload.is_admin and user.email in settings.admin_emails:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This admin is set in the ADCAM_ADMIN_EMAILS setting; remove them there.",
            )
        user.is_admin = payload.is_admin
        changes.append("made admin" if payload.is_admin else "admin access removed")

    db.commit()
    db.refresh(user)
    if changes:
        log_activity(db, user.id, "admin", f"{', '.join(changes).capitalize()} by {admin.email}")
    return _row(db, user, _batch_totals(db, [user.id]).get(user.id, (0, 0)))


@router.post("/users/{user_id}/reset-usage", response_model=AdminUser)
def reset_usage(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    user = _load(db, user_id)
    user.usage_reset_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    log_activity(db, user.id, "admin", f"Monthly usage reset by {admin.email}")
    return _row(db, user, _batch_totals(db, [user.id]).get(user.id, (0, 0)))


@router.get("/activity", response_model=list[Activity])
def activity(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)) -> list[Activity]:
    return _activity(db, limit)
