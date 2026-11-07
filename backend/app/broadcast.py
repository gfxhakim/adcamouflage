"""Group emails: Admin > Settings > Customer emails > Send to a group.

The admin picks people (by group, or one by one), writes a subject and a
message with the same ``{placeholders}`` as the automatic emails, sends a
test to themselves, then types SEND to queue it.

Sending is slow on purpose. A worker sends one email at a time with a pause
between each, and stops for the day at a daily cap (Brevo's free plan allows
about 300 a day, account emails included). Whatever is left goes out the
next day. Every person is one ``email_recipients`` row:

- (campaign, user) is unique, so nobody is queued twice for one email.
- a row is claimed (pending -> sending) with a conditional UPDATE before the
  message goes out, and the run holds a database lock, so two workers never
  send the same row.
- a row still marked "sending" when a run starts was cut off mid-send (a
  restart). It is marked failed rather than retried, because the message
  may already have arrived.

Every group email carries an unsubscribe link (and List-Unsubscribe headers
for one-click unsubscribe in Gmail and others). People who unsubscribed are
skipped by every later group email. Account emails (welcome, plan activated,
reminders) are not affected.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html as html_lib
import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from . import audit, mailer
from .accounts import is_admin, require_admin
from .app_settings import get_setting, set_setting
from .config import settings
from .db import BatchRecord, EmailCampaign, EmailRecipient, Order, TokenLedger, User, get_db
from .plans import aware

logger = logging.getLogger(__name__)

RULES_SETTING = "group_email_rules"
DEFAULT_RULES = {"daily_limit": 250, "seconds_between": 3}
LOCK_ID = 7_420_032
CONFIRM_WORD = "SEND"
MAX_PEOPLE = 5000
# One run sends for at most this long; the next scheduled run carries on.
RUN_SECONDS = 100

PENDING, SENDING, SENT, FAILED, SKIPPED = "pending", "sending", "sent", "failed", "skipped"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------


def get_rules(db: Session) -> dict[str, int]:
    saved = get_setting(db, RULES_SETTING, {}) or {}
    rules = dict(DEFAULT_RULES)
    if isinstance(saved, dict):
        if isinstance(saved.get("daily_limit"), int):
            rules["daily_limit"] = max(1, min(100_000, saved["daily_limit"]))
        if isinstance(saved.get("seconds_between"), int):
            rules["seconds_between"] = max(0, min(60, saved["seconds_between"]))
    return rules


def sent_today(db: Session, now: datetime | None = None) -> int:
    now = now or _now()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(
        db.execute(
            select(func.count(EmailRecipient.id)).where(EmailRecipient.status == SENT, EmailRecipient.sent_at >= day)
        ).scalar()
        or 0
    )


# --------------------------------------------------------------------------
# unsubscribe links
# --------------------------------------------------------------------------


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _signature(user_id: int) -> str:
    digest = hmac.new(settings.secret_key.encode("utf-8"), f"unsubscribe:{user_id}".encode(), hashlib.sha256).digest()
    return _b64(digest[:18])


def unsubscribe_token(user_id: int) -> str:
    return f"{user_id}.{_signature(user_id)}"


def read_token(token: str) -> int | None:
    user_part, _, signature = (token or "").partition(".")
    if not user_part.isdigit() or not signature:
        return None
    user_id = int(user_part)
    return user_id if hmac.compare_digest(_signature(user_id), signature) else None


def unsubscribe_links(user_id: int) -> tuple[str, str]:
    """(page a person opens, address mail apps POST to for one-click unsubscribe)."""

    base = mailer._base_url()
    token = unsubscribe_token(user_id)
    return f"{base}/unsubscribe?t={token}", f"{base}/api/v1/emails/unsubscribe?t={token}"


# --------------------------------------------------------------------------
# groups
# --------------------------------------------------------------------------


@dataclass
class Person:
    user: User
    tokens: int
    batches: int
    paid_orders: int
    open_orders: int
    groups: list[str]


def _groups(db: Session, now: datetime) -> list[dict[str, str]]:
    from .tokens import get_token_plans

    groups = [
        {"id": "all", "label": "All customers", "hint": "Every customer account (admins left out)."},
        {"id": "new_7d", "label": "New sign-ups", "hint": "Signed up in the last 7 days."},
        {"id": "never_paid", "label": "Never paid", "hint": "Signed up but never had a plan."},
        {"id": "checkout_unpaid", "label": "Checkout not finished", "hint": "Opened a checkout, never paid."},
        {"id": "active", "label": "Active subscribers", "hint": "On any plan right now."},
    ]
    for plan_id, plan in get_token_plans(db, now).items():
        groups.append({"id": f"plan:{plan_id}", "label": f"Active on {plan.label}", "hint": f"Plan running now is {plan.label}."})
    groups += [
        {"id": "ending_7d", "label": "Ending in 7 days", "hint": "Active, period ends within 7 days."},
        {"id": "cancelled", "label": "Cancelled", "hint": "Cancelled, still running until the period ends."},
        {"id": "expired", "label": "Plan ended", "hint": "Had a plan; it has ended and was not renewed."},
        {"id": "grace", "label": "Ended, tokens still kept", "hint": "Ended recently, still inside the rollover grace days."},
        {"id": "low_tokens", "label": "Low on tokens", "hint": "Active, tokens left for fewer than 2 generations."},
        {"id": "no_renders", "label": "Paid, never rendered", "hint": "Has or had a plan but never made a render."},
        {"id": "inactive_30d", "label": "Away 30+ days", "hint": "Not seen in the app for 30 days."},
        {"id": "unsubscribed", "label": "Unsubscribed", "hint": "Opted out of group emails. Shown only; they are never sent to."},
    ]
    return groups


def _counts_by_user(db: Session, stmt) -> dict[int, int]:  # type: ignore[no-untyped-def]
    return {int(uid): int(n or 0) for uid, n in db.execute(stmt).all()}


def people(db: Session, now: datetime | None = None) -> list[Person]:
    """Every customer account with the groups it belongs to right now."""

    from .tokens import generation_cost, get_billing_rules, get_token_plans, in_grace, subscription_active

    now = now or _now()
    plans = get_token_plans(db, now)
    rules = get_billing_rules(db)
    users = [
        u
        for u in db.execute(select(User).where(User.is_active.is_(True)).order_by(User.created_at.desc())).scalars()
        if not is_admin(u)
    ][:MAX_PEOPLE]

    tokens = _counts_by_user(db, select(TokenLedger.user_id, func.sum(TokenLedger.amount)).group_by(TokenLedger.user_id))
    batches = _counts_by_user(db, select(BatchRecord.user_id, func.count(BatchRecord.id)).group_by(BatchRecord.user_id))
    paid = _counts_by_user(
        db, select(Order.user_id, func.count(Order.id)).where(Order.status == "paid").group_by(Order.user_id)
    )
    opened = _counts_by_user(db, select(Order.user_id, func.count(Order.id)).group_by(Order.user_id))

    out: list[Person] = []
    for user in users:
        active = subscription_active(user, now)
        end = aware(user.sub_period_end)
        had_plan = bool(user.sub_plan) or paid.get(user.id, 0) > 0
        balance = max(0, tokens.get(user.id, 0)) if active else 0
        seen = aware(user.last_seen_at) or aware(user.last_login_at) or aware(user.created_at)
        g = ["all"]
        if aware(user.created_at) and aware(user.created_at) >= now - timedelta(days=7):
            g.append("new_7d")
        if not had_plan:
            g.append("never_paid")
            if opened.get(user.id, 0) > 0:
                g.append("checkout_unpaid")
        if active:
            g.append("active")
            if user.sub_plan in plans:
                g.append(f"plan:{user.sub_plan}")
            if end and end <= now + timedelta(days=7):
                g.append("ending_7d")
            if user.sub_cancelled_at:
                g.append("cancelled")
            cost = generation_cost(user, plans)
            if cost and balance < 2 * cost:
                g.append("low_tokens")
        elif had_plan and end:
            g.append("expired")
            if in_grace(user, rules, now):
                g.append("grace")
        if had_plan and batches.get(user.id, 0) == 0:
            g.append("no_renders")
        if seen and seen < now - timedelta(days=30):
            g.append("inactive_30d")
        if user.email_opt_out_at:
            g.append("unsubscribed")
        out.append(
            Person(
                user=user,
                tokens=balance,
                batches=batches.get(user.id, 0),
                paid_orders=paid.get(user.id, 0),
                open_orders=opened.get(user.id, 0),
                groups=g,
            )
        )
    return out


def person_values(db: Session, user: User, tokens: int | None = None) -> dict[str, Any]:
    from .tokens import get_token_plans, subscription_active, usable_tokens

    plans = get_token_plans(db)
    plan = plans.get(user.sub_plan or "")
    end = aware(user.sub_period_end)
    if tokens is None:
        tokens = usable_tokens(db, user)
    return {
        **mailer.base_values(user),
        "plan": plan.label if plan else (user.sub_plan or "no plan"),
        "tokens": f"{int(tokens):,}",
        "end_date": f"{end:%d %B %Y}" if end else "",
        "status": "active" if subscription_active(user) else ("ended" if end else "no plan yet"),
    }


PLACEHOLDERS: dict[str, str] = {
    "name": "Customer's name (or 'there')",
    "email": "Customer's email address",
    "plan": "Their plan, e.g. Pro (or 'no plan')",
    "tokens": "Tokens they can use right now",
    "end_date": "Date their current or last period ends",
    "status": "active, ended, or no plan yet",
    "app_url": "Link to the workspace",
    "plan_url": "Link to their plan page",
}


def compose(
    user_id: int,
    subject: str,
    body: str,
    values: dict[str, Any],
    *,
    button: str = "",
    style: dict[str, Any] | None = None,
) -> tuple[str, str, str, dict[str, str]]:
    """(subject, text, html, headers) for one person, with the unsubscribe footer.

    Uses the same branded layout as the account emails: the saved logo and
    colours (``style``), the subject as the headline, and the first line that
    is only a link drawn as a button labelled ``button``.
    """

    page, one_click = unsubscribe_links(user_id)
    subject = " ".join(mailer.fill(subject, values).split())[: mailer.SUBJECT_MAX]
    filled = mailer.fill(body, values)
    footer = f'<a href="{html_lib.escape(page)}" style="color:#8a8d91">Unsubscribe</a> from these updates.'
    design = {"headline": subject, "button": " ".join(mailer.fill(button, values).split())}
    text_body = f"{filled}\n\n--\nYou are receiving this because you have a {mailer.BRAND} account.\nUnsubscribe: {page}"
    headers = {"List-Unsubscribe": f"<{one_click}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    return subject, text_body, mailer.to_html(filled, footer=footer, design=design, style=style), headers


# --------------------------------------------------------------------------
# sending
# --------------------------------------------------------------------------


@contextmanager
def _lock(db: Session) -> Iterator[bool]:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        with _local_lock(blocking=False) as got:
            yield got
        return
    engine = getattr(bind, "engine", bind)
    with engine.connect() as conn:
        got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar())
        try:
            yield got
        finally:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


_THREAD_LOCK = threading.Lock()


@contextmanager
def _local_lock(blocking: bool) -> Iterator[bool]:
    got = _THREAD_LOCK.acquire(blocking=blocking)
    try:
        yield got
    finally:
        if got:
            _THREAD_LOCK.release()


def refresh_counts(db: Session, campaign: EmailCampaign, now: datetime | None = None) -> None:
    rows = dict(
        db.execute(
            select(EmailRecipient.status, func.count(EmailRecipient.id))
            .where(EmailRecipient.campaign_id == campaign.id)
            .group_by(EmailRecipient.status)
        ).all()
    )
    campaign.sent = int(rows.get(SENT, 0))
    campaign.failed = int(rows.get(FAILED, 0))
    campaign.skipped = int(rows.get(SKIPPED, 0))
    left = int(rows.get(PENDING, 0)) + int(rows.get(SENDING, 0))
    if campaign.status == "sending" and left == 0:
        campaign.status = "done"
        campaign.finished_at = now or _now()


def process(
    db: Session,
    now: Callable[[], datetime] = _now,
    send: Callable[..., bool] = mailer.send_email,
    sleep: Callable[[float], None] = time.sleep,
    max_seconds: float = RUN_SECONDS,
) -> dict[str, int]:
    """Send queued group emails, one at a time, up to today's cap. Safe to run often."""

    stats = {"sent": 0, "failed": 0, "skipped": 0}
    if send is mailer.send_email and not mailer.configured():
        return stats
    with _lock(db) as got:
        if not got:
            return stats
        started = time.monotonic()

        # A row left "sending" was cut off mid-send by a restart. It may have
        # gone out, so it is not tried again.
        db.execute(
            update(EmailRecipient)
            .where(EmailRecipient.status == SENDING)
            .values(status=FAILED, error="Interrupted while sending; not retried so it cannot arrive twice.")
        )
        db.commit()

        rules = get_rules(db)
        allowance = rules["daily_limit"] - sent_today(db, now())
        campaigns = db.execute(
            select(EmailCampaign).where(EmailCampaign.status == "sending").order_by(EmailCampaign.id)
        ).scalars().all()
        style = mailer.get_style(db)
        first = True
        for campaign in campaigns:
            while allowance > 0 and time.monotonic() - started < max_seconds:
                db.refresh(campaign)
                if campaign.status != "sending":
                    break
                row = db.execute(
                    select(EmailRecipient)
                    .where(EmailRecipient.campaign_id == campaign.id, EmailRecipient.status == PENDING)
                    .order_by(EmailRecipient.id)
                    .limit(1)
                ).scalar_one_or_none()
                if row is None:
                    break
                claimed = db.execute(
                    update(EmailRecipient)
                    .where(EmailRecipient.id == row.id, EmailRecipient.status == PENDING)
                    .values(status=SENDING, sent_at=now())
                ).rowcount
                db.commit()
                if claimed != 1:
                    continue
                user = db.get(User, row.user_id)
                if user is None or not user.is_active or user.email_opt_out_at is not None:
                    reason = "Unsubscribed" if user is not None and user.email_opt_out_at else "Account removed or disabled"
                    _finish(db, row, SKIPPED, reason, None)
                    stats["skipped"] += 1
                    continue
                if not first and rules["seconds_between"]:
                    sleep(rules["seconds_between"])
                first = False
                try:
                    subject, text_body, html, headers = compose(
                        user.id,
                        campaign.subject,
                        campaign.body,
                        person_values(db, user),
                        button=campaign.button,
                        style=style,
                    )
                    ok = bool(send(user.email, subject, html, text_body, headers=headers))
                except Exception:  # noqa: BLE001 - one bad send must not stop the rest
                    logger.exception("group email %s to user %s failed", campaign.id, user.id)
                    ok = False
                if ok:
                    _finish(db, row, SENT, "", now())
                    stats["sent"] += 1
                    allowance -= 1
                else:
                    _finish(db, row, FAILED, "The mail server did not accept it.", None)
                    stats["failed"] += 1
            refresh_counts(db, campaign, now())
            db.commit()
    return stats


def _finish(db: Session, row: EmailRecipient, status: str, error: str, sent_at: datetime | None) -> None:
    row.status = status
    row.error = error[:300]
    row.sent_at = sent_at
    db.commit()


def _kick_inline() -> None:
    def job() -> None:
        from .db import get_session_factory

        try:
            with get_session_factory()() as db:
                process(db)
        except Exception:  # noqa: BLE001
            logger.exception("group email run failed")

    threading.Thread(target=job, name="adcam-group-email", daemon=True).start()


def _kick_default() -> None:
    """Start sending now. The scheduled run every two minutes is the fallback."""

    if settings.inline_worker:
        _kick_inline()
        return
    try:
        from .tasks import send_group_emails

        send_group_emails.delay()
    except Exception:  # noqa: BLE001 - the beat schedule picks it up anyway
        logger.warning("could not queue the group email run; the scheduled run will send it", exc_info=True)


# Tests swap this for a synchronous runner.
kick: Callable[[], None] = _kick_default


# --------------------------------------------------------------------------
# starter drafts
# --------------------------------------------------------------------------

SIGN_OFF = mailer.SIGN_OFF

DRAFTS: list[dict[str, Any]] = [
    {
        "id": "choose_plan",
        "button": "Choose a plan",
        "label": "Pick a plan",
        "groups": ["never_paid", "checkout_unpaid"],
        "subject": "Your {brand} account is ready",
        "body": (
            "Hi {name},\n\n"
            "You signed up but have not picked a plan yet. Choose one and you can start rendering straight away:\n"
            "{plan_url}\n\n"
            "If something stopped you at checkout, just reply to this email and we will help.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    {
        "id": "come_back",
        "button": "Renew my plan",
        "label": "Come back (plan ended)",
        "groups": ["expired", "grace"],
        "subject": "Your {plan} plan has ended",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan ended on {end_date}. Renew any time to pick up where you left off:\n"
            "{plan_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    {
        "id": "renew_soon",
        "button": "Renew now",
        "label": "Renew soon",
        "groups": ["ending_7d", "cancelled"],
        "subject": "Your {plan} plan ends on {end_date}",
        "body": (
            "Hi {name},\n\n"
            "A quick note that your {plan} plan ends on {end_date}. Renew before then to keep generating "
            "without a break:\n{plan_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    {
        "id": "low_tokens",
        "button": "Top up",
        "label": "Running low on tokens",
        "groups": ["low_tokens"],
        "subject": "You have {tokens} tokens left",
        "body": (
            "Hi {name},\n\n"
            "You have {tokens} tokens left on your {plan} plan. Top up from your plan page so your next "
            "batch does not stop halfway:\n{plan_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    {
        "id": "first_render",
        "button": "Open the workspace",
        "label": "Make your first render",
        "groups": ["no_renders"],
        "subject": "Ready for your first render?",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan is set up but you have not made a render yet. Open the workspace, drop in a file "
            "and follow the steps:\n{app_url}\n\n"
            "Stuck on anything? Open the support chat in the app.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    {
        "id": "update",
        "button": "Open the workspace",
        "label": "Product update",
        "groups": ["all"],
        "subject": "What's new at {brand}",
        "body": (
            "Hi {name},\n\n"
            "Here is what changed this week:\n\n"
            "- (write your update here)\n\n"
            "Open the workspace:\n{app_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
]


def drafts() -> list[dict[str, Any]]:
    out = []
    for d in DRAFTS:
        item = dict(d)
        item["subject"] = d["subject"].replace("{brand}", mailer.BRAND)
        item["body"] = d["body"].replace("{brand}", mailer.BRAND)
        out.append(item)
    return out


# --------------------------------------------------------------------------
# admin routes
# --------------------------------------------------------------------------


class MessageIn(BaseModel):
    subject: str = Field(min_length=1, max_length=mailer.SUBJECT_MAX)
    body: str = Field(min_length=1, max_length=mailer.BODY_MAX)
    # Label of the button drawn from the first line that is only a link.
    button: str = Field(default="", max_length=60)


class PreviewIn(MessageIn):
    user_id: int | None = None


class SendIn(MessageIn):
    user_ids: list[int] = Field(min_length=1, max_length=MAX_PEOPLE)
    audience: str = Field(default="", max_length=500)
    confirm: str = ""


class RulesIn(BaseModel):
    daily_limit: int = Field(ge=1, le=100_000)
    seconds_between: int = Field(ge=0, le=60)


router = APIRouter(prefix="/api/v1/admin/emails/groups", tags=["emails"], dependencies=[Depends(require_admin)])


def _campaign_out(c: EmailCampaign) -> dict[str, Any]:
    pending = max(0, c.total - c.sent - c.failed - c.skipped)
    return {
        "id": c.id,
        "subject": c.subject,
        "audience": c.audience,
        "admin_email": c.admin_email,
        "status": c.status,
        "total": c.total,
        "sent": c.sent,
        "failed": c.failed,
        "skipped": c.skipped,
        "pending": pending,
        "created_at": aware(c.created_at).isoformat() if c.created_at else None,
        "finished_at": aware(c.finished_at).isoformat() if c.finished_at else None,
    }


def _status(db: Session) -> dict[str, Any]:
    now = _now()
    everyone = people(db, now)
    groups = _groups(db, now)
    counts: dict[str, int] = {}
    for p in everyone:
        for g in p.groups:
            counts[g] = counts.get(g, 0) + 1
    rules = get_rules(db)
    today = sent_today(db, now)
    campaigns = db.execute(select(EmailCampaign).order_by(EmailCampaign.id.desc()).limit(20)).scalars().all()
    return {
        "transport": mailer.transport(),
        "public_url_set": bool(mailer._base_url()),
        "groups": [{**g, "count": counts.get(g["id"], 0)} for g in groups],
        "people": [
            {
                "id": p.user.id,
                "email": p.user.email,
                "name": p.user.display_name or "",
                "plan": p.user.sub_plan,
                "tokens": p.tokens,
                "created_at": aware(p.user.created_at).isoformat() if p.user.created_at else None,
                "unsubscribed": p.user.email_opt_out_at is not None,
                "groups": p.groups,
            }
            for p in everyone
        ],
        "placeholders": PLACEHOLDERS,
        "drafts": drafts(),
        "rules": rules,
        "sent_today": today,
        "left_today": max(0, rules["daily_limit"] - today),
        "campaigns": [_campaign_out(c) for c in campaigns],
    }


@router.get("")
def group_email_status(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _status(db)


@router.put("/rules")
def save_rules(payload: RulesIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    set_setting(db, RULES_SETTING, payload.model_dump())
    db.commit()
    audit.record(db, admin, None, "group_email_rules", f"daily limit {payload.daily_limit}, {payload.seconds_between}s apart")
    return _status(db)


@router.post("/preview")
def preview(payload: PreviewIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = db.get(User, payload.user_id) if payload.user_id else None
    user = user or admin
    subject, text_body, html, _headers = compose(
        user.id, payload.subject, payload.body, person_values(db, user), button=payload.button, style=mailer.get_style(db)
    )
    return {"subject": subject, "text": text_body, "html": html, "for": user.email}


@router.post("/test")
def send_test(payload: MessageIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    if not mailer.configured():
        raise HTTPException(status_code=409, detail="Email is not set up on the server yet.")
    subject, text_body, html, headers = compose(
        admin.id, payload.subject, payload.body, person_values(db, admin), button=payload.button, style=mailer.get_style(db)
    )
    if not mailer.send_email(admin.email, "[Test] " + subject, html, text_body, headers=headers):
        raise HTTPException(status_code=502, detail="The mail server did not accept the message. Check the api logs.")
    return {"sent_to": admin.email}


@router.post("/send", status_code=201)
def send_group(payload: SendIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    if payload.confirm.strip() != CONFIRM_WORD:
        raise HTTPException(status_code=422, detail=f"Type {CONFIRM_WORD} to confirm.")
    if not mailer.configured():
        raise HTTPException(status_code=409, detail="Email is not set up on the server yet.")
    if not mailer._base_url():
        raise HTTPException(
            status_code=409,
            detail="Set ADCAM_PUBLIC_URL on the api service first, so the unsubscribe link in the email works.",
        )
    wanted = list(dict.fromkeys(payload.user_ids))
    users = db.execute(select(User).where(User.id.in_(wanted))).scalars().all()
    eligible = [u for u in users if u.is_active and not is_admin(u)]
    reachable = [u for u in eligible if u.email_opt_out_at is None]
    if not reachable:
        raise HTTPException(status_code=422, detail="Nobody to send to: everyone picked is unsubscribed, disabled or an admin.")

    campaign = EmailCampaign(
        admin_id=admin.id,
        admin_email=admin.email,
        audience=payload.audience.strip()[:500] or f"{len(reachable)} people",
        subject=payload.subject.strip(),
        body=payload.body.replace("\r\n", "\n"),
        button=payload.button.strip(),
        status="sending",
        total=len(reachable),
    )
    db.add(campaign)
    db.flush()
    for user in reachable:
        db.add(EmailRecipient(campaign_id=campaign.id, user_id=user.id, email=user.email))
    db.commit()
    audit.record(
        db,
        admin,
        None,
        "group_email",
        f"#{campaign.id} '{campaign.subject}' to {len(reachable)} ({campaign.audience}); "
        f"{len(eligible) - len(reachable)} unsubscribed left out",
    )
    kick()
    db.refresh(campaign)
    return {"campaign": _campaign_out(campaign), "left_out_unsubscribed": len(eligible) - len(reachable)}


def _campaign(db: Session, campaign_id: int) -> EmailCampaign:
    campaign = db.get(EmailCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="No such group email.")
    return campaign


@router.get("/{campaign_id}")
def campaign_detail(campaign_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    campaign = _campaign(db, campaign_id)
    rows = db.execute(
        select(EmailRecipient).where(EmailRecipient.campaign_id == campaign.id).order_by(EmailRecipient.id)
    ).scalars().all()
    return {
        "campaign": _campaign_out(campaign),
        "body": campaign.body,
        "recipients": [
            {
                "email": r.email,
                "status": r.status,
                "error": r.error,
                "sent_at": aware(r.sent_at).isoformat() if r.sent_at else None,
            }
            for r in rows
        ],
    }


@router.post("/{campaign_id}/cancel")
def cancel_campaign(campaign_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    campaign = _campaign(db, campaign_id)
    if campaign.status == "sending":
        campaign.status = "cancelled"
        campaign.finished_at = _now()
        db.execute(
            update(EmailRecipient)
            .where(EmailRecipient.campaign_id == campaign.id, EmailRecipient.status == PENDING)
            .values(status=SKIPPED, error="Stopped by admin")
        )
        refresh_counts(db, campaign)
        db.commit()
        audit.record(db, admin, None, "group_email_stop", f"#{campaign.id} '{campaign.subject}' stopped")
    return _campaign_out(campaign)


@router.post("/{campaign_id}/retry")
def retry_failed(campaign_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Queue the failed ones again. Rows cut off mid-send stay failed: they may have arrived."""

    campaign = _campaign(db, campaign_id)
    result = db.execute(
        update(EmailRecipient)
        .where(
            EmailRecipient.campaign_id == campaign.id,
            EmailRecipient.status == FAILED,
            EmailRecipient.error == "The mail server did not accept it.",
        )
        .values(status=PENDING, error="")
    )
    if result.rowcount:
        campaign.status = "sending"
        campaign.finished_at = None
        refresh_counts(db, campaign)
        db.commit()
        audit.record(db, admin, None, "group_email_retry", f"#{campaign.id}: {result.rowcount} failed queued again")
        kick()
    return _campaign_out(campaign)


# --------------------------------------------------------------------------
# public unsubscribe
# --------------------------------------------------------------------------

public_router = APIRouter(prefix="/api/v1/emails", tags=["emails"])


def _masked(email: str) -> str:
    local, _, domain = email.partition("@")
    return (local[:2] + "***@" + domain) if domain else "***"


def _token_user(db: Session, token: str) -> User:
    user_id = read_token(token)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    return user


@public_router.get("/unsubscribe")
def unsubscribe_state(t: str = Query(default="", max_length=200), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = _token_user(db, t)
    return {"email": _masked(user.email), "unsubscribed": user.email_opt_out_at is not None}


@public_router.post("/unsubscribe")
def unsubscribe(t: str = Query(default="", max_length=200), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Opt out of group emails. Mail apps call this directly (one-click unsubscribe)."""

    user = _token_user(db, t)
    if user.email_opt_out_at is None:
        user.email_opt_out_at = _now()
        db.commit()
    return {"email": _masked(user.email), "unsubscribed": True}


@public_router.post("/resubscribe")
def resubscribe(t: str = Query(default="", max_length=200), db: Session = Depends(get_db)) -> dict[str, Any]:
    user = _token_user(db, t)
    if user.email_opt_out_at is not None:
        user.email_opt_out_at = None
        db.commit()
    return {"email": _masked(user.email), "unsubscribed": False}
