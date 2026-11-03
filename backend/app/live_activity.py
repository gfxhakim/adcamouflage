"""Public, anonymised activity for the landing page's live ticker.

Only real events are reported: paid subscription orders from the last few
days, and how many accounts started a batch in the last few minutes. Nothing
here identifies anyone: no names, emails or ids leave the API, only the plan
a new subscriber picked and how long ago it was. The answer is cached for a
short while so a busy landing page costs a couple of queries a minute.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import BatchRecord, Order, get_db
from .tokens import get_token_plans

router = APIRouter(prefix="/api/v1", tags=["site-content"])

# A batch started this recently counts as someone working right now.
ACTIVE_WINDOW = timedelta(minutes=10)
# New subscriptions shown on the ticker: at most this many, this recent.
SUBSCRIBER_WINDOW = timedelta(days=7)
SUBSCRIBER_LIMIT = 8
CACHE_SECONDS = 30.0

_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def collect(db: Session, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    plans = get_token_plans(db)

    active = db.scalar(
        select(func.count(func.distinct(BatchRecord.user_id))).where(BatchRecord.created_at >= now - ACTIVE_WINDOW)
    ) or 0

    rows = db.execute(
        select(Order.plan_id, Order.paid_at)
        .where(
            Order.kind == "subscription",
            Order.status == "paid",
            # Admin grants are recorded as $0 orders; only real purchases count.
            Order.amount_usd > 0,
            Order.paid_at.is_not(None),
            Order.paid_at >= now - SUBSCRIBER_WINDOW,
        )
        .order_by(Order.paid_at.desc())
        .limit(SUBSCRIBER_LIMIT)
    ).all()

    subscribers = []
    for plan_id, paid_at in rows:
        plan = plans.get(plan_id)
        seconds = max(0, int((now - _aware(paid_at)).total_seconds()))
        subscribers.append({"plan": plan.label if plan else plan_id.title(), "seconds_ago": seconds})

    return {"active_now": int(active), "subscribers": subscribers, "window_minutes": int(ACTIVE_WINDOW.total_seconds() // 60)}


@router.get("/live-activity")
def live_activity(response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    with _lock:
        fresh = _cache["value"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS
        if not fresh:
            _cache["value"] = collect(db)
            _cache["at"] = time.monotonic()
        value = _cache["value"]
    response.headers["Cache-Control"] = f"public, max-age={int(CACHE_SECONDS)}"
    return value


def clear_cache() -> None:
    with _lock:
        _cache["value"] = None
        _cache["at"] = 0.0
