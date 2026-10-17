"""What a signed-in client sees about their own plan: usage, history and options.

There is no payment provider, so asking for another plan records a request in
the activity log for the admin to act on; nothing is charged or changed here.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .accounts import current_user
from .activity import log_activity
from .app_settings import currency
from .config import settings
from .db import ActivityEvent, BatchRecord, User, get_db
from .plans import (
    aware,
    get_plans,
    month_start,
    plan_expired,
    plan_label,
    usage_window_start,
    used_this_month,
)

router = APIRouter(prefix="/api/v1/auth", tags=["subscription"])

DAILY_DAYS = 30
HISTORY_MONTHS = 6
REQUEST_KIND = "plan_request"
# A second request for the same plan inside this window is not logged again.
REQUEST_COOLDOWN = timedelta(hours=24)


class PlanOption(BaseModel):
    id: str
    label: str
    monthly_quota: int | None
    price: float


class DayUsage(BaseModel):
    day: date
    value: int


class MonthUsage(BaseModel):
    month: str  # "2026-10"
    files: int
    batches: int


class PlanRequestOut(BaseModel):
    plan_id: str
    plan_label: str
    created_at: datetime


class Subscription(BaseModel):
    plan: PlanOption
    # The limit on this account, which an admin may have set apart from the plan's.
    monthly_quota: int | None
    currency: str
    used_this_month: int
    left_this_month: int | None
    # Where this month's count started (the 1st, or a manual reset by support).
    window_start: datetime
    resets_at: datetime
    # A straight-line guess at the month's total from the pace so far.
    projected_this_month: int
    plan_expires_at: datetime | None
    plan_expired: bool
    member_since: datetime
    files_total: int
    batches_total: int
    favourite_preset: str | None
    daily: list[DayUsage]
    monthly: list[MonthUsage]
    plans: list[PlanOption]
    pending_request: PlanRequestOut | None
    retention_hours: int


class PlanRequestIn(BaseModel):
    plan_id: str = Field(max_length=32)
    note: str = Field(default="", max_length=500)


def _next_month(start: datetime) -> datetime:
    return (start + timedelta(days=32)).replace(day=1)


def _month_key(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _pending_request(db: Session, user: User) -> PlanRequestOut | None:
    since = datetime.now(timezone.utc) - REQUEST_COOLDOWN
    row = db.execute(
        select(ActivityEvent)
        .where(ActivityEvent.user_id == user.id, ActivityEvent.kind == REQUEST_KIND)
        .order_by(ActivityEvent.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if row is None or aware(row.created_at) < since:
        return None
    # The detail starts with the plan id in brackets, e.g. "[pro] Asked for ...".
    plan_id = row.detail[1 : row.detail.find("]")] if row.detail.startswith("[") else ""
    # Once the admin has moved them there, the request is settled.
    if not plan_id or (plan_id == user.plan and not plan_expired(user)):
        return None
    return PlanRequestOut(
        plan_id=plan_id,
        plan_label=plan_label(get_plans(db), plan_id),
        created_at=aware(row.created_at),
    )


@router.get("/subscription", response_model=Subscription)
def subscription(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Subscription:
    now = datetime.now(timezone.utc)
    plans = get_plans(db)
    current = plans.get(user.plan)
    plan = (
        PlanOption(id=current.id, label=current.label, monthly_quota=current.monthly_quota, price=current.price)
        if current
        else PlanOption(id=user.plan, label=user.plan, monthly_quota=user.monthly_quota, price=0)
    )

    used = used_this_month(db, user, now)
    left = None if user.monthly_quota is None else max(0, user.monthly_quota - used)
    window = usage_window_start(user, now)
    resets = _next_month(month_start(now))

    elapsed_days = max(1.0, (now - month_start(now)).total_seconds() / 86400)
    month_days = (resets - month_start(now)).days
    projected = round(used / elapsed_days * month_days) if used else 0

    history_start = month_start(now)
    for _ in range(HISTORY_MONTHS - 1):
        history_start = month_start(history_start - timedelta(days=1))
    today = now.date()
    daily_start = today - timedelta(days=DAILY_DAYS - 1)

    rows = db.execute(
        select(BatchRecord.asset_count, BatchRecord.preset, BatchRecord.created_at).where(
            BatchRecord.user_id == user.id
        )
    ).all()

    per_day: Counter[date] = Counter()
    month_files: Counter[str] = Counter()
    month_batches: Counter[str] = Counter()
    presets: Counter[str] = Counter()
    files_total = 0
    for count, preset, created in rows:
        created = aware(created)
        files_total += count
        presets[preset] += 1
        if created >= history_start:
            key = _month_key(created)
            month_files[key] += count
            month_batches[key] += 1
        if created.date() >= daily_start:
            per_day[created.date()] += count

    monthly: list[MonthUsage] = []
    cursor = history_start
    for _ in range(HISTORY_MONTHS):
        key = _month_key(cursor)
        monthly.append(MonthUsage(month=key, files=month_files[key], batches=month_batches[key]))
        cursor = _next_month(cursor)

    return Subscription(
        plan=plan,
        monthly_quota=user.monthly_quota,
        currency=currency(db),
        used_this_month=used,
        left_this_month=left,
        window_start=window,
        resets_at=resets,
        projected_this_month=projected,
        plan_expires_at=aware(user.plan_expires_at),
        plan_expired=plan_expired(user, now),
        member_since=aware(user.created_at),
        files_total=files_total,
        batches_total=len(rows),
        favourite_preset=presets.most_common(1)[0][0] if presets else None,
        daily=[
            DayUsage(day=daily_start + timedelta(days=offset), value=per_day[daily_start + timedelta(days=offset)])
            for offset in range(DAILY_DAYS)
        ],
        monthly=monthly,
        plans=[
            PlanOption(id=p.id, label=p.label, monthly_quota=p.monthly_quota, price=p.price) for p in plans.values()
        ],
        pending_request=_pending_request(db, user),
        retention_hours=settings.retention_hours,
    )


@router.post("/plan-request", response_model=PlanRequestOut, status_code=status.HTTP_201_CREATED)
def request_plan(
    payload: PlanRequestIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PlanRequestOut:
    plans = get_plans(db)
    target = plans.get(payload.plan_id)
    if target is None:
        raise HTTPException(status_code=422, detail="That plan does not exist.")
    if target.id == user.plan and not plan_expired(user):
        raise HTTPException(status_code=409, detail="You are already on this plan.")

    pending = _pending_request(db, user)
    if pending and pending.plan_id == target.id:
        return pending

    verb = "renew" if target.id == user.plan else "move to"
    note = " ".join(payload.note.split())
    detail = f"[{target.id}] Asked to {verb} {target.label} (from {plan_label(plans, user.plan)})"
    if note:
        detail += f": {note}"
    log_activity(db, user.id, REQUEST_KIND, detail)
    return PlanRequestOut(plan_id=target.id, plan_label=target.label, created_at=datetime.now(timezone.utc))
