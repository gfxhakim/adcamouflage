"""Subscription plans and the monthly usage quota they carry.

There is no payment provider yet: an admin puts each user on a plan by hand.
A plan is a label plus a default monthly allowance of processed files (every
uploaded file and every extra variant counts as one). The allowance stored on
the user is what is enforced, so an admin can give one user a custom number.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import BatchRecord, User


@dataclass(frozen=True)
class Plan:
    id: str
    label: str
    monthly_quota: int | None  # None = unlimited


PLANS: dict[str, Plan] = {
    plan.id: plan
    for plan in (
        Plan("free", "Free", 10),
        Plan("starter", "Starter", 100),
        Plan("pro", "Pro", 500),
        Plan("unlimited", "Unlimited", None),
    )
}


def default_plan() -> Plan:
    return PLANS.get(settings.default_plan, PLANS["free"])


def apply_plan(user: User, plan_id: str) -> None:
    plan = PLANS[plan_id]
    user.plan = plan.id
    user.monthly_quota = plan.monthly_quota


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _aware(value: datetime | None) -> datetime | None:
    # SQLite hands timestamps back without a zone; they were stored as UTC.
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def usage_window_start(user: User, now: datetime | None = None) -> datetime:
    start = month_start(now)
    reset = _aware(user.usage_reset_at)
    return max(start, reset) if reset else start


def used_this_month(db: Session, user: User, now: datetime | None = None) -> int:
    since = usage_window_start(user, now)
    total = db.execute(
        select(func.coalesce(func.sum(BatchRecord.asset_count), 0)).where(
            BatchRecord.user_id == user.id, BatchRecord.created_at >= since
        )
    ).scalar_one()
    return int(total or 0)


def plan_expired(user: User, now: datetime | None = None) -> bool:
    expires = _aware(user.plan_expires_at)
    return expires is not None and expires <= (now or datetime.now(timezone.utc))


def check_allowance(db: Session, user: User, requested: int) -> str | None:
    """Return why `user` may not process `requested` more files, or None if they may."""

    if plan_expired(user):
        return "Your plan has expired. Contact support to renew it."
    if user.monthly_quota is None:
        return None
    used = used_this_month(db, user)
    left = max(0, user.monthly_quota - used)
    if requested > left:
        if left == 0:
            return f"You have used all {user.monthly_quota} files in your plan this month."
        return (
            f"This batch needs {requested} files but you have {left} left this month "
            f"(plan limit {user.monthly_quota})."
        )
    return None
