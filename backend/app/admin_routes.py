"""Admin panel endpoints: users, plans, analytics and app settings."""

from __future__ import annotations

import csv
import io
import secrets
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .accounts import hash_password, is_admin, require_admin, validate_email, validate_password
from .activity import log_activity
from .app_settings import announcement, currency, get_setting, registration_open, set_setting
from .config import settings
from .db import ActivityEvent, BatchRecord, User, get_db
from .plans import (
    PLAN_IDS,
    Plan,
    aware,
    apply_plan,
    default_plan,
    get_plans,
    month_start,
    plan_expired,
    plan_label,
    save_plan,
    used_this_month,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])

CHART_DAYS = 14
NEAR_LIMIT = 0.8
EXPIRING_DAYS = 7


# --------------------------------------------------------------------------
# payloads
# --------------------------------------------------------------------------


class PlanInfo(BaseModel):
    id: str
    label: str
    monthly_quota: int | None
    price: float
    users: int = 0


class PlanEdit(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    monthly_quota: int | None = Field(default=None, ge=0, le=1_000_000)
    price: float = Field(ge=0, le=1_000_000)
    # Also move users on this plan who still have its old default limit.
    apply_to_users: bool = True


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
    price: float
    monthly_quota: int | None
    used_this_month: int
    plan_expires_at: datetime | None
    plan_expired: bool
    batch_count: int
    files_total: int
    admin_notes: str | None


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
    mrr: float
    paying_users: int
    currency: str
    near_limit: int
    expiring_soon: int
    hit_limit_this_month: int


class UserUpdate(BaseModel):
    """Only the fields that are sent are changed."""

    plan: str | None = None
    # Sent as null with the key present to make the user unlimited.
    monthly_quota: int | None = Field(default=None, ge=0, le=1_000_000)
    plan_expires_at: datetime | None = None
    is_active: bool | None = None
    is_admin: bool | None = None
    display_name: str | None = Field(default=None, max_length=120)
    admin_notes: str | None = Field(default=None, max_length=5000)


class NewUser(BaseModel):
    email: str = Field(max_length=320)
    display_name: str | None = Field(default=None, max_length=120)
    plan: str | None = None
    # Left empty, a temporary password is generated and returned once.
    password: str | None = Field(default=None, max_length=256)


class CreatedUser(BaseModel):
    user: AdminUser
    temporary_password: str | None


class TemporaryPassword(BaseModel):
    temporary_password: str


class Extension(BaseModel):
    days: int = Field(ge=1, le=3650)


class AppSettingsOut(BaseModel):
    registration_open: bool
    # ADCAM_ALLOW_REGISTRATION=false on the server; the panel cannot reopen it.
    registration_locked: bool
    default_plan: str
    announcement: str
    currency: str


class AppSettingsUpdate(BaseModel):
    registration_open: bool | None = None
    default_plan: str | None = None
    announcement: str | None = Field(default=None, max_length=500)
    currency: str | None = Field(default=None, min_length=1, max_length=8)


class Point(BaseModel):
    day: date
    value: int


class PlanRevenue(BaseModel):
    id: str
    label: str
    price: float
    users: int
    revenue: float


class UserUsage(BaseModel):
    id: int
    email: str
    plan_label: str
    used: int
    monthly_quota: int | None


class UserExpiry(BaseModel):
    id: int
    email: str
    plan_label: str
    plan_expires_at: datetime


class Analytics(BaseModel):
    days: int
    currency: str
    mrr: float
    arr: float
    paying_users: int
    arpu: float
    paid_share: float
    total_users: int
    dau: int
    wau: int
    mau: int
    files_this_month: int
    batches_this_month: int
    avg_files_per_batch: float
    signups: list[Point]
    active: list[Point]
    files: list[Point]
    revenue_by_plan: list[PlanRevenue]
    top_users: list[UserUsage]
    near_limit: list[UserUsage]
    hit_limit: list[UserUsage]
    expiring_soon: list[UserExpiry]
    expired: list[UserExpiry]
    presets: dict[str, int]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day(value: datetime) -> date:
    return aware(value).astimezone(timezone.utc).date()  # type: ignore[union-attr]


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


def _row(
    db: Session,
    user: User,
    totals: tuple[int, int] | None = None,
    plans: dict[str, Plan] | None = None,
) -> AdminUser:
    plans = plans or get_plans(db)
    if totals is None:
        totals = _batch_totals(db, [user.id]).get(user.id, (0, 0))
    plan = plans.get(user.plan)
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
        plan_label=plan_label(plans, user.plan),
        price=plan.price if plan else 0.0,
        monthly_quota=user.monthly_quota,
        used_this_month=used_this_month(db, user),
        plan_expires_at=user.plan_expires_at,
        plan_expired=plan_expired(user),
        batch_count=totals[0],
        files_total=totals[1],
        admin_notes=user.admin_notes,
    )


def _load(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


def _activity(db: Session, limit: int, user_id: int | None = None, kind: str = "") -> list[Activity]:
    query = (
        select(ActivityEvent, User.email)
        .join(User, User.id == ActivityEvent.user_id)
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .limit(max(1, min(limit, 500)))
    )
    if user_id is not None:
        query = query.where(ActivityEvent.user_id == user_id)
    if kind:
        query = query.where(ActivityEvent.kind == kind)
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


def _preset_name(raw: str) -> str:
    # Older rows stored the enum's repr, e.g. "Preset.BALANCED".
    return raw.rsplit(".", 1)[-1].lower()


def _temporary_password() -> str:
    return secrets.token_urlsafe(9)


def _paying(db: Session, plans: dict[str, Plan]) -> tuple[float, int, Counter[str]]:
    """Monthly revenue, paying users and users per plan, counting only live accounts."""

    now = _now()
    per_plan: Counter[str] = Counter()
    for plan_id, expires in db.execute(
        select(User.plan, User.plan_expires_at).where(User.is_active.is_(True))
    ).all():
        expires = aware(expires)
        if expires is not None and expires <= now:
            continue
        per_plan[plan_id] += 1
    mrr = sum(plans[p].price * n for p, n in per_plan.items() if p in plans)
    paying = sum(n for p, n in per_plan.items() if p in plans and plans[p].price > 0)
    return round(mrr, 2), paying, per_plan


def _limited_usage(db: Session, plans: dict[str, Plan]) -> list[UserUsage]:
    """Users at or above NEAR_LIMIT of their monthly allowance, fullest first."""

    rough = dict(
        db.execute(
            select(BatchRecord.user_id, func.sum(BatchRecord.asset_count))
            .where(BatchRecord.created_at >= month_start())
            .group_by(BatchRecord.user_id)
        ).all()
    )
    found: list[UserUsage] = []
    candidates = db.execute(
        select(User).where(User.monthly_quota.is_not(None), User.is_active.is_(True))
    ).scalars()
    for user in candidates:
        quota = user.monthly_quota or 0
        if int(rough.get(user.id) or 0) < quota * NEAR_LIMIT and quota > 0:
            continue
        used = used_this_month(db, user)
        if used >= quota * NEAR_LIMIT:
            found.append(
                UserUsage(
                    id=user.id,
                    email=user.email,
                    plan_label=plan_label(plans, user.plan),
                    used=used,
                    monthly_quota=user.monthly_quota,
                )
            )
    found.sort(key=lambda u: (u.used / u.monthly_quota) if u.monthly_quota else 1, reverse=True)
    return found


def _hit_limit(db: Session, plans: dict[str, Plan]) -> list[UserUsage]:
    """Users refused at least once this month: the best upgrade candidates."""

    rows = db.execute(
        select(ActivityEvent.user_id, func.count(ActivityEvent.id))
        .where(ActivityEvent.kind == "blocked", ActivityEvent.created_at >= month_start())
        .group_by(ActivityEvent.user_id)
        .order_by(func.count(ActivityEvent.id).desc())
        .limit(50)
    ).all()
    result = []
    for user_id, _count in rows:
        user = db.get(User, user_id)
        if user is None:
            continue
        result.append(
            UserUsage(
                id=user.id,
                email=user.email,
                plan_label=plan_label(plans, user.plan),
                used=used_this_month(db, user),
                monthly_quota=user.monthly_quota,
            )
        )
    return result


def _expiring(db: Session, plans: dict[str, Plan], upcoming: bool) -> list[UserExpiry]:
    now = _now()
    query = select(User).where(User.plan_expires_at.is_not(None), User.is_active.is_(True))
    if upcoming:
        query = query.where(
            User.plan_expires_at > now, User.plan_expires_at <= now + timedelta(days=EXPIRING_DAYS)
        ).order_by(User.plan_expires_at.asc())
    else:
        query = query.where(User.plan_expires_at <= now).order_by(User.plan_expires_at.desc())
    return [
        UserExpiry(
            id=u.id,
            email=u.email,
            plan_label=plan_label(plans, u.plan),
            plan_expires_at=u.plan_expires_at,
        )
        for u in db.execute(query.limit(50)).scalars()
    ]


def _series(start: date, days: int, counts: Counter[date] | dict[date, int]) -> list[Point]:
    return [
        Point(day=start + timedelta(days=offset), value=int(counts.get(start + timedelta(days=offset), 0)))
        for offset in range(days)
    ]


# --------------------------------------------------------------------------
# plans & settings
# --------------------------------------------------------------------------


@router.get("/plans", response_model=list[PlanInfo])
def plans(db: Session = Depends(get_db)) -> list[PlanInfo]:
    counts = dict(db.execute(select(User.plan, func.count(User.id)).group_by(User.plan)).all())
    return [
        PlanInfo(id=p.id, label=p.label, monthly_quota=p.monthly_quota, price=p.price, users=int(counts.get(p.id, 0)))
        for p in get_plans(db).values()
    ]


@router.put("/plans/{plan_id}", response_model=PlanInfo)
def edit_plan(
    plan_id: str,
    payload: PlanEdit,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlanInfo:
    current = get_plans(db).get(plan_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Plan not found.")

    updated = Plan(plan_id, payload.label.strip(), payload.monthly_quota, round(payload.price, 2))
    save_plan(db, updated)

    moved = 0
    if payload.apply_to_users and current.monthly_quota != updated.monthly_quota:
        # Users given a custom limit keep it; only those on the plan's default move.
        query = select(User).where(User.plan == plan_id)
        query = query.where(
            User.monthly_quota.is_(None) if current.monthly_quota is None else User.monthly_quota == current.monthly_quota
        )
        for user in db.execute(query).scalars():
            user.monthly_quota = updated.monthly_quota
            moved += 1
    db.commit()
    log_activity(
        db,
        admin.id,
        "admin",
        f"Plan {updated.label} set to {_quota_text(updated.monthly_quota)} at {updated.price:g}/month"
        + (f", {moved} users updated" if moved else ""),
    )
    count = db.execute(select(func.count(User.id)).where(User.plan == plan_id)).scalar_one()
    return PlanInfo(**updated.__dict__, users=int(count))


def _settings_out(db: Session) -> AppSettingsOut:
    return AppSettingsOut(
        registration_open=registration_open(db),
        registration_locked=not settings.allow_registration,
        default_plan=default_plan(db).id,
        announcement=announcement(db),
        currency=currency(db),
    )


@router.get("/settings", response_model=AppSettingsOut)
def read_settings(db: Session = Depends(get_db)) -> AppSettingsOut:
    return _settings_out(db)


@router.patch("/settings", response_model=AppSettingsOut)
def update_settings(
    payload: AppSettingsUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AppSettingsOut:
    sent = payload.model_fields_set
    changes: list[str] = []
    if "registration_open" in sent and payload.registration_open is not None:
        set_setting(db, "registration_open", payload.registration_open)
        changes.append("sign-ups " + ("opened" if payload.registration_open else "closed"))
    if "default_plan" in sent and payload.default_plan:
        if payload.default_plan not in PLAN_IDS:
            raise HTTPException(status_code=422, detail=f"Unknown plan '{payload.default_plan}'.")
        set_setting(db, "default_plan", payload.default_plan)
        changes.append(f"new users start on {payload.default_plan}")
    if "announcement" in sent:
        set_setting(db, "announcement", (payload.announcement or "").strip())
        changes.append("announcement updated" if (payload.announcement or "").strip() else "announcement removed")
    if "currency" in sent and payload.currency:
        set_setting(db, "currency", payload.currency.strip().upper())
        changes.append(f"currency set to {payload.currency.strip().upper()}")
    db.commit()
    if changes:
        log_activity(db, admin.id, "admin", f"Settings: {', '.join(changes)}")
    return _settings_out(db)


# --------------------------------------------------------------------------
# overview & analytics
# --------------------------------------------------------------------------


@router.get("/overview", response_model=Overview)
def overview(db: Session = Depends(get_db)) -> Overview:
    now = _now()
    week_ago = now - timedelta(days=7)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    chart_start = today - timedelta(days=CHART_DAYS - 1)
    plans_now = get_plans(db)

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
        day = _day(created_at)
        files_by_day[day] += int(count)
        batches_by_day[day] += 1

    mrr, paying, _ = _paying(db, plans_now)
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
        mrr=mrr,
        paying_users=paying,
        currency=currency(db),
        near_limit=len(_limited_usage(db, plans_now)),
        expiring_soon=len(_expiring(db, plans_now, upcoming=True)),
        hit_limit_this_month=len(_hit_limit(db, plans_now)),
    )


@router.get("/analytics", response_model=Analytics)
def analytics(days: int = Query(default=30, ge=7, le=180), db: Session = Depends(get_db)) -> Analytics:
    now = _now()
    plans_now = get_plans(db)
    start = (now - timedelta(days=days - 1)).date()
    start_dt = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)

    signups: Counter[date] = Counter(
        _day(created) for (created,) in db.execute(select(User.created_at).where(User.created_at >= start_dt)).all()
    )

    files: Counter[date] = Counter()
    for created, count in db.execute(
        select(BatchRecord.created_at, BatchRecord.asset_count).where(BatchRecord.created_at >= start_dt)
    ).all():
        files[_day(created)] += int(count)

    # A user is active on a day they signed in, signed up or started a batch.
    active_sets: dict[date, set[int]] = defaultdict(set)
    for created, user_id in db.execute(
        select(ActivityEvent.created_at, ActivityEvent.user_id).where(
            ActivityEvent.created_at >= start_dt,
            ActivityEvent.kind.in_(("login", "signup", "batch", "blocked")),
        )
    ).all():
        active_sets[_day(created)].add(user_id)

    def seen_since(delta: timedelta) -> int:
        since = now - delta
        return int(
            db.execute(
                select(func.count(User.id)).where(or_(User.last_seen_at >= since, User.last_login_at >= since))
            ).scalar_one()
        )

    total_users = int(db.execute(select(func.count(User.id))).scalar_one())
    mrr, paying, per_plan = _paying(db, plans_now)

    month_rows = db.execute(
        select(BatchRecord.user_id, BatchRecord.asset_count, BatchRecord.preset).where(
            BatchRecord.created_at >= month_start(now)
        )
    ).all()
    per_user: Counter[int] = Counter()
    presets: Counter[str] = Counter()
    for user_id, count, preset in month_rows:
        per_user[user_id] += int(count)
        presets[_preset_name(preset)] += 1
    files_month = sum(per_user.values())

    top_users = []
    for user_id, used in per_user.most_common(10):
        user = db.get(User, user_id)
        if user is not None:
            top_users.append(
                UserUsage(
                    id=user.id,
                    email=user.email,
                    plan_label=plan_label(plans_now, user.plan),
                    used=used,
                    monthly_quota=user.monthly_quota,
                )
            )

    live_accounts = sum(per_plan.values())
    return Analytics(
        days=days,
        currency=currency(db),
        mrr=mrr,
        arr=round(mrr * 12, 2),
        paying_users=paying,
        arpu=round(mrr / paying, 2) if paying else 0.0,
        paid_share=round(paying / live_accounts, 4) if live_accounts else 0.0,
        total_users=total_users,
        dau=seen_since(timedelta(days=1)),
        wau=seen_since(timedelta(days=7)),
        mau=seen_since(timedelta(days=30)),
        files_this_month=files_month,
        batches_this_month=len(month_rows),
        avg_files_per_batch=round(files_month / len(month_rows), 1) if month_rows else 0.0,
        signups=_series(start, days, signups),
        active=_series(start, days, {d: len(ids) for d, ids in active_sets.items()}),
        files=_series(start, days, files),
        revenue_by_plan=[
            PlanRevenue(
                id=p.id,
                label=p.label,
                price=p.price,
                users=per_plan.get(p.id, 0),
                revenue=round(p.price * per_plan.get(p.id, 0), 2),
            )
            for p in plans_now.values()
        ],
        top_users=top_users,
        near_limit=_limited_usage(db, plans_now),
        hit_limit=_hit_limit(db, plans_now),
        expiring_soon=_expiring(db, plans_now, upcoming=True),
        expired=_expiring(db, plans_now, upcoming=False),
        presets=dict(presets.most_common()),
    )


# --------------------------------------------------------------------------
# users
# --------------------------------------------------------------------------


def _user_query(q: str, plan: str, state: str):
    query = select(User)
    needle = q.strip().lower()
    if needle:
        like = f"%{needle}%"
        query = query.where(or_(User.email.ilike(like), User.display_name.ilike(like)))
    if plan:
        query = query.where(User.plan == plan)
    now = _now()
    if state == "active":
        query = query.where(User.is_active.is_(True))
    elif state == "suspended":
        query = query.where(User.is_active.is_(False))
    elif state == "expired":
        query = query.where(User.plan_expires_at.is_not(None), User.plan_expires_at <= now)
    elif state == "admins":
        query = query.where(or_(User.is_admin.is_(True), User.email.in_(settings.admin_emails or [""])))
    return query


@router.get("/users", response_model=UserPage)
def list_users(
    q: str = "",
    plan: str = "",
    state: str = "",
    sort: str = "newest",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> UserPage:
    query = _user_query(q, plan, state)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    order = {
        "newest": (User.created_at.desc(), User.id.desc()),
        "oldest": (User.created_at.asc(), User.id.asc()),
        "active": (func.coalesce(User.last_seen_at, User.last_login_at, User.created_at).desc(), User.id.desc()),
        "email": (User.email.asc(),),
    }.get(sort, (User.created_at.desc(), User.id.desc()))
    users = db.execute(query.order_by(*order).limit(limit).offset(offset)).scalars().all()

    totals = _batch_totals(db, [u.id for u in users])
    plans_now = get_plans(db)
    return UserPage(
        total=int(total),
        users=[_row(db, u, totals.get(u.id, (0, 0)), plans_now) for u in users],
    )


@router.get("/users/export.csv")
def export_users(q: str = "", plan: str = "", state: str = "", db: Session = Depends(get_db)) -> Response:
    users = db.execute(_user_query(q, plan, state).order_by(User.created_at.asc())).scalars().all()
    totals = _batch_totals(db, [u.id for u in users])
    plans_now = get_plans(db)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "id", "email", "name", "plan", "price", "monthly_limit", "used_this_month",
            "batches", "files_total", "status", "admin", "plan_ends", "joined", "last_active", "notes",
        ]
    )
    for user in users:
        row = _row(db, user, totals.get(user.id, (0, 0)), plans_now)
        last_active = row.last_seen_at or row.last_login_at
        writer.writerow(
            [
                row.id, row.email, row.display_name or "", row.plan_label, row.price,
                "unlimited" if row.monthly_quota is None else row.monthly_quota,
                row.used_this_month, row.batch_count, row.files_total,
                "active" if row.is_active else "suspended", "yes" if row.is_admin else "no",
                row.plan_expires_at.isoformat() if row.plan_expires_at else "",
                row.created_at.isoformat(), last_active.isoformat() if last_active else "",
                (row.admin_notes or "").replace("\n", " "),
            ]
        )
    stamp = _now().strftime("%Y-%m-%d")
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="adcamouflage-users-{stamp}.csv"'},
    )


@router.post("/users", response_model=CreatedUser, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: NewUser,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CreatedUser:
    email = validate_email(payload.email)
    generated = None
    if payload.password:
        password = validate_password(payload.password)
    else:
        password = generated = _temporary_password()

    plan_id = payload.plan or default_plan(db).id
    if plan_id not in PLAN_IDS:
        raise HTTPException(status_code=422, detail=f"Unknown plan '{plan_id}'.")

    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=(payload.display_name or "").strip() or None,
    )
    apply_plan(db, user, plan_id)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    db.refresh(user)
    log_activity(db, user.id, "signup", f"Account created by {admin.email} on the {plan_id} plan")
    return CreatedUser(user=_row(db, user), temporary_password=generated)


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
        user=_row(db, user),
        batches=[
            AdminBatch(
                id=b.id,
                asset_count=b.asset_count,
                preset=_preset_name(b.preset),
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

    plans_now = get_plans(db)
    if "plan" in sent and payload.plan is not None:
        if payload.plan not in plans_now:
            raise HTTPException(status_code=422, detail=f"Unknown plan '{payload.plan}'.")
        if payload.plan != user.plan:
            changes.append(f"plan set to {plans_now[payload.plan].label}")
        apply_plan(db, user, payload.plan)

    # Applied after the plan, so a custom number sent with a plan wins.
    if "monthly_quota" in sent and payload.monthly_quota != user.monthly_quota:
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

    if "display_name" in sent:
        user.display_name = (payload.display_name or "").strip() or None

    # Notes are private and change often, so they are not logged.
    if "admin_notes" in sent:
        user.admin_notes = (payload.admin_notes or "").strip() or None

    db.commit()
    db.refresh(user)
    if changes:
        log_activity(db, user.id, "admin", f"{', '.join(changes).capitalize()} by {admin.email}")
    return _row(db, user)


@router.post("/users/{user_id}/reset-usage", response_model=AdminUser)
def reset_usage(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    user = _load(db, user_id)
    user.usage_reset_at = _now()
    db.commit()
    db.refresh(user)
    log_activity(db, user.id, "admin", f"Monthly usage reset by {admin.email}")
    return _row(db, user)


@router.post("/users/{user_id}/extend", response_model=AdminUser)
def extend_plan(
    user_id: int,
    payload: Extension,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    """Add days to the plan, counting from its end date or from now if it already ended."""

    user = _load(db, user_id)
    now = _now()
    current = aware(user.plan_expires_at)
    base = current if current and current > now else now
    user.plan_expires_at = base + timedelta(days=payload.days)
    db.commit()
    db.refresh(user)
    log_activity(
        db,
        user.id,
        "admin",
        f"Plan extended {payload.days} days to {user.plan_expires_at:%Y-%m-%d} by {admin.email}",
    )
    return _row(db, user)


@router.post("/users/{user_id}/reset-password", response_model=TemporaryPassword)
def reset_password(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TemporaryPassword:
    user = _load(db, user_id)
    password = _temporary_password()
    user.password_hash = hash_password(password)
    user.token_version += 1
    db.commit()
    log_activity(db, user.id, "password", f"Password reset by {admin.email}")
    return TemporaryPassword(temporary_password=password)


@router.post("/users/{user_id}/sign-out", response_model=AdminUser)
def sign_out_everywhere(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUser:
    user = _load(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Use Sign out in the header to end your own session.")
    user.token_version += 1
    db.commit()
    db.refresh(user)
    log_activity(db, user.id, "admin", f"Signed out of every device by {admin.email}")
    return _row(db, user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    user = _load(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    if user.email in settings.admin_emails:
        raise HTTPException(
            status_code=400,
            detail="This admin is set in the ADCAM_ADMIN_EMAILS setting; remove them there first.",
        )
    email = user.email
    db.delete(user)
    db.commit()
    # Logged on the admin, since the deleted user's own history goes with them.
    log_activity(db, admin.id, "admin", f"Deleted the account {email}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/activity", response_model=list[Activity])
def activity(
    limit: int = Query(default=50, ge=1, le=500),
    kind: str = "",
    db: Session = Depends(get_db),
) -> list[Activity]:
    return _activity(db, limit, kind=kind)
