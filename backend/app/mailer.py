"""Outgoing email through Resend, and the billing reminders that use it.

Email is optional: with no ``ADCAM_RESEND_API_KEY`` every send returns False
and nothing else changes. The reminder selection is kept apart from the
sending so it can be tested without a mail provider.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import ActivityEvent, User
from .plans import aware
from .tokens import TOKENS, get_billing_rules, get_token_plans

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 15.0

REMINDER_KIND = "reminder"
ENDING_SOON_DAYS = 3
ENDED_WINDOW_HOURS = 24


def _api_key() -> str:
    return (settings.resend_api_key.get_secret_value() if settings.resend_api_key else "").strip()


def configured() -> bool:
    """Whether email can go out at all (``ADCAM_RESEND_API_KEY`` is set)."""

    return bool(_api_key())


def send_email(to: str, subject: str, html: str) -> bool:
    """Send one message. Returns False, without raising, when it cannot."""

    key = _api_key()
    if not key or not to:
        return False
    try:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        logger.warning("email to %s could not be sent", to, exc_info=True)
        return False
    if response.status_code >= 400:
        logger.warning("email to %s refused by Resend: %s %s", to, response.status_code, response.text[:200])
        return False
    return True


# --------------------------------------------------------------------------
# billing reminders
# --------------------------------------------------------------------------


def _marker(period_end: datetime, code: str) -> str:
    # The detail starts with the period end in brackets, so a reminder for a
    # renewed (later) period is a different marker and goes out again.
    return f"[{aware(period_end).isoformat()}] {code}"


def _already_sent(db: Session, user_id: int, marker: str) -> bool:
    row = db.execute(
        select(ActivityEvent.id)
        .where(
            ActivityEvent.user_id == user_id,
            ActivityEvent.kind == REMINDER_KIND,
            ActivityEvent.detail.like(f"{marker}%"),
        )
        .limit(1)
    ).first()
    return row is not None


def due_reminders(db: Session, now: datetime | None = None) -> list[tuple[User, str, str, str]]:
    """Token-mode users owed a reminder right now.

    Returns ``(user, code, subject, html)`` with ``code`` either ``ending``
    (period ends within three days) or ``ended`` (ended in the last day).
    Users already reminded for the same period end are skipped.
    """

    now = now or datetime.now(timezone.utc)
    plans = get_token_plans(db)
    grace = get_billing_rules(db)["grace_days"]
    soon = now + timedelta(days=ENDING_SOON_DAYS)
    recently = now - timedelta(hours=ENDED_WINDOW_HOURS)

    candidates = db.execute(
        select(User).where(
            User.is_active.is_(True),
            User.billing_mode == TOKENS,
            User.sub_period_end.is_not(None),
            User.sub_period_end >= recently,
            User.sub_period_end <= soon,
        )
    ).scalars()

    due: list[tuple[User, str, str, str]] = []
    for user in candidates:
        end = aware(user.sub_period_end)
        plan = plans.get(user.sub_plan or "")
        label = plan.label if plan else (user.sub_plan or "plan")
        when = f"{end:%d %B %Y}"
        if end > now:
            code = "ending"
            subject = f"Your {label} period ends on {when}"
            html = (
                f"<p>Your {label} period ends on {when}.</p>"
                "<p>Renew before then to keep generating and to carry your unused tokens "
                "into the next period.</p>"
            )
        else:
            code = "ended"
            subject = "Your period ended"
            html = (
                f"<p>Your {label} period ended on {when}.</p>"
                f"<p>Renew within {grace} days to keep your rolled-over tokens.</p>"
            )
        if _already_sent(db, user.id, _marker(end, code)):
            continue
        due.append((user, code, subject, html))
    return due


def send_billing_reminders(
    db: Session,
    now: datetime | None = None,
    send: Callable[[str, str, str], bool] = send_email,
) -> dict[str, int]:
    """Send every due reminder and record each one delivered so it is not repeated.

    Without a Resend key this is a no-op: nothing is sent and nobody is
    marked, so the reminders go out once the key is added. A send that
    Resend refuses is not marked either and is retried on the next run;
    ``due_reminders`` only looks a day back for ended periods, so a long
    outage cannot pile up stale mail.
    """

    if send is send_email and not configured():
        return {"sent": 0, "skipped": 0}
    sent = skipped = 0
    for user, code, subject, html in due_reminders(db, now):
        if not send(user.email, subject, html):
            skipped += 1
            continue
        sent += 1
        detail = _marker(user.sub_period_end, code) + f": {subject}"
        db.add(ActivityEvent(user_id=user.id, kind=REMINDER_KIND, detail=detail))
        db.commit()
    return {"sent": sent, "skipped": skipped}
