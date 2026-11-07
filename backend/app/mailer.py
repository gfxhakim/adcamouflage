"""Customer emails: welcome, plan activated and renewal reminders.

Mail goes out through any SMTP server (``ADCAM_SMTP_HOST`` and friends) or,
when no SMTP server is set, through Resend (``ADCAM_RESEND_API_KEY``). With
neither, every send returns False and nothing else changes: sign-ups and
payments never wait on, or fail because of, email.

Each email can be switched off and its subject and text edited in
Admin > Settings > Customer emails. Saved text is kept in the ``email_templates``
app setting; anything not saved uses the defaults below.

Duplicates are prevented per email:

- welcome: once per account (an ``email`` activity row marks it).
- plan activated: once per paid order, because ``tokens.settle_order`` applies
  an order once and only then calls :func:`plan_activated`.
- reminders: once per user per period end (a ``reminder`` activity row
  carries the period end), so a renewal makes the next reminder due again.
  The run holds a database lock on Postgres so two runs never overlap.
"""

from __future__ import annotations

import html as html_lib
import logging
import re
import smtplib
import ssl
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr
from typing import Any, Callable, Iterator

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .accounts import require_admin
from .app_settings import get_setting, set_setting
from .config import settings
from .db import ActivityEvent, User, get_db
from .plans import aware

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
TIMEOUT_SECONDS = 15.0

REMINDER_KIND = "reminder"
EMAIL_KIND = "email"
ENDING_SOON_DAYS = 3
ENDED_WINDOW_HOURS = 24
# Any constant works; it only has to be the same for every reminder run.
REMINDER_LOCK_ID = 7_420_031

BRAND = "BluCloacking"
SIGN_OFF = f"The {BRAND} team"

# --------------------------------------------------------------------------
# templates
# --------------------------------------------------------------------------

# Placeholders an admin can use in a subject or body. Anything else in
# {braces} is left exactly as typed.
PLACEHOLDERS: dict[str, str] = {
    "name": "Customer's name (or 'there' when they gave none)",
    "email": "Customer's email address",
    "plan": "Plan name, e.g. Pro",
    "tokens": "Tokens added by this payment",
    "end_date": "Date the current period ends",
    "grace_days": "Days after the end that rolled-over tokens are kept",
    "app_url": "Link to the workspace",
    "plan_url": "Link to the customer's plan page",
}

DEFAULT_TEMPLATES: dict[str, dict[str, Any]] = {
    "welcome": {
        "label": "Welcome",
        "when": "Right after someone signs up.",
        "enabled": True,
        "subject": f"Welcome to {BRAND}",
        "body": (
            "Hi {name},\n\n"
            f"Thanks for signing up to {BRAND}. Your account is ready.\n\n"
            "To start rendering, choose a plan on your plan page:\n{plan_url}\n\n"
            "If you have a question, open the support chat in the app and we will help.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "activated": {
        "label": "Plan activated",
        "when": "When a plan payment is confirmed or approved (Volet, BTCPay, Admin or Telegram).",
        "enabled": True,
        "subject": "Your {plan} plan is active",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan is now active. {tokens} tokens were added to your account, "
            "and this period runs until {end_date}.\n\n"
            "Open your workspace:\n{app_url}\n\n"
            "Thanks for choosing us.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "ending": {
        "label": "Renewal reminder",
        "when": "A few days before a plan period ends.",
        "enabled": True,
        "days_before": ENDING_SOON_DAYS,
        "subject": "Your {plan} plan ends on {end_date}",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan ends on {end_date}. Renew before then to keep generating without a break "
            "and to carry your unused tokens into the next period.\n\n"
            "Renew here:\n{plan_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "ended": {
        "label": "Plan ended",
        "when": "Within a day after a plan period ends without a renewal.",
        "enabled": True,
        "subject": "Your {plan} plan has ended",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan ended on {end_date}. Renew within {grace_days} days to keep your "
            "rolled-over tokens.\n\n"
            "Renew here:\n{plan_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
}
KINDS = tuple(DEFAULT_TEMPLATES)
SUBJECT_MAX = 200
BODY_MAX = 5000


def get_templates(db: Session) -> dict[str, dict[str, Any]]:
    """Every template with the admin's saved changes laid over the defaults."""

    saved = get_setting(db, "email_templates", {}) or {}
    out: dict[str, dict[str, Any]] = {}
    for kind, default in DEFAULT_TEMPLATES.items():
        merged = dict(default)
        mine = saved.get(kind) if isinstance(saved, dict) else None
        if isinstance(mine, dict):
            if isinstance(mine.get("enabled"), bool):
                merged["enabled"] = mine["enabled"]
            for field in ("subject", "body"):
                value = mine.get(field)
                if isinstance(value, str) and value.strip():
                    merged[field] = value
            if "days_before" in default and isinstance(mine.get("days_before"), int):
                merged["days_before"] = max(1, min(14, mine["days_before"]))
        out[kind] = merged
    return out


_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def fill(template: str, values: dict[str, Any]) -> str:
    """Replace known ``{placeholders}``; leave everything else untouched."""

    def swap(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(values[key]) if key in values else match.group(0)

    return _PLACEHOLDER.sub(swap, template)


_LINK = re.compile(r"(https?://[^\s<]+)")


def to_html(body: str) -> str:
    """Plain text -> a simple branded HTML message. Links become clickable."""

    paragraphs = []
    for block in re.split(r"\n\s*\n", body.strip()):
        safe = html_lib.escape(block)
        safe = _LINK.sub(lambda m: f'<a href="{m.group(1)}" style="color:#1d4ed8">{m.group(1)}</a>', safe)
        paragraphs.append(f'<p style="margin:0 0 16px">{safe.replace(chr(10), "<br>")}</p>')
    return (
        '<div style="background:#f5f6f8;padding:24px 12px;font-family:Helvetica,Arial,sans-serif">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;'
        'padding:28px 28px 12px;color:#0b0d12;font-size:15px;line-height:1.55">'
        f'<div style="font-weight:700;font-size:18px;margin-bottom:20px;color:#1d4ed8">{BRAND}</div>'
        + "".join(paragraphs)
        + "</div></div>"
    )


def _base_url() -> str:
    return settings.public_url.strip().rstrip("/")


def base_values(user: User) -> dict[str, Any]:
    base = _base_url()
    name = (user.display_name or "").strip() or "there"
    return {
        "name": name,
        "email": user.email,
        "app_url": f"{base}/app" if base else "/app",
        "plan_url": f"{base}/app/plan" if base else "/app/plan",
    }


def render(db: Session, kind: str, values: dict[str, Any]) -> tuple[str, str, str] | None:
    """``(subject, text, html)`` for ``kind``, or None when it is switched off."""

    template = get_templates(db)[kind]
    if not template["enabled"]:
        return None
    subject = " ".join(fill(template["subject"], values).split())[:SUBJECT_MAX]
    body = fill(template["body"], values)
    return subject, body, to_html(body)


# --------------------------------------------------------------------------
# sending
# --------------------------------------------------------------------------


def _secret(value: Any) -> str:
    return value.get_secret_value().strip() if value is not None else ""


def _api_key() -> str:
    return _secret(settings.resend_api_key)


def _brevo_key() -> str:
    return _secret(settings.brevo_api_key)


def smtp_ready() -> bool:
    return bool(settings.smtp_host.strip())


def transport() -> str:
    """``brevo``, ``smtp``, ``resend`` or ``""`` when email is not set up."""

    if _brevo_key():
        return "brevo"
    if smtp_ready():
        return "smtp"
    if _api_key():
        return "resend"
    return ""


def configured() -> bool:
    """Whether email can go out at all."""

    return bool(transport())


def _html_to_text(html: str) -> str:
    stripped = re.sub(r"<br\s*/?>", "\n", html)
    stripped = re.sub(r"</p>", "\n\n", stripped)
    return html_lib.unescape(re.sub(r"<[^>]+>", "", stripped)).strip()


def _send_smtp(to: str, subject: str, html: str, text_body: str) -> bool | str:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = to
    message["Subject"] = subject
    if settings.email_reply_to.strip():
        message["Reply-To"] = settings.email_reply_to.strip()
    domain = parseaddr(settings.email_from)[1].rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(text_body)
    message.add_alternative(html, subtype="html")

    host = settings.smtp_host.strip()
    port = int(settings.smtp_port)
    security = settings.smtp_security.strip().lower()
    user = settings.smtp_username.strip()
    password = _secret(settings.smtp_password)
    context = ssl.create_default_context()
    try:
        if security == "ssl":
            server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=TIMEOUT_SECONDS)
        with server:
            if security not in ("ssl", "none"):
                server.starttls(context=context)
            if user:
                server.login(user, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("email to %s could not be sent over SMTP", to, exc_info=True)
        return smtp_reason(exc, host, port)
    return True


def _server_text(exc: Exception) -> str:
    raw = getattr(exc, "smtp_error", b"")
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    code = getattr(exc, "smtp_code", "")
    said = " ".join(str(raw or "").split())[:200]
    return f" The server said: {code} {said}".rstrip() + "." if said else ""


def _sender_address() -> str:
    return parseaddr(settings.email_from)[1] or settings.email_from


def smtp_reason(exc: Exception, host: str, port: int) -> str:
    """A plain-words reason for an SMTP failure, safe to show an admin.

    Never includes the password: only the exception type and the mail
    server's own reply text.
    """

    said = _server_text(exc)
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return (
            "The mail server refused the login. Check ADCAM_SMTP_USERNAME (the SMTP login) and "
            "ADCAM_SMTP_PASSWORD (the SMTP key, not your account password)." + said
        )
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return f"The mail server refused the From address {_sender_address()}. Add and verify it as a sender with your mail provider." + said
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "The mail server refused the recipient address."
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return "The mail server does not support STARTTLS on this port. Try ADCAM_SMTP_SECURITY=ssl with port 465." + said
    if isinstance(exc, ssl.SSLError):
        return "Secure connection failed. Use port 587 with ADCAM_SMTP_SECURITY=starttls, or port 465 with ssl."
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)) or not isinstance(exc, smtplib.SMTPException):
        return (
            f"Could not reach {host}:{port}. Railway blocks outgoing mail ports on Free, Trial and Hobby plans; "
            "use Brevo's web API instead (set ADCAM_BREVO_API_KEY), or try port 2525."
        )
    return "The mail server refused the message." + said


def _send_resend(to: str, subject: str, html: str, text_body: str) -> bool | str:
    payload: dict[str, Any] = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text_body,
    }
    if settings.email_reply_to.strip():
        payload["reply_to"] = settings.email_reply_to.strip()
    try:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        logger.warning("email to %s could not be sent", to, exc_info=True)
        return "Could not reach Resend."
    if response.status_code >= 400:
        logger.warning("email to %s refused by Resend: %s %s", to, response.status_code, response.text[:200])
        return f"Resend refused the message ({response.status_code}): {' '.join(response.text.split())[:200]}"
    return True


def _send_brevo(to: str, subject: str, html: str, text_body: str) -> bool | str:
    name, address = parseaddr(settings.email_from)
    sender: dict[str, str] = {"email": address or settings.email_from}
    if name:
        sender["name"] = name
    payload: dict[str, Any] = {
        "sender": sender,
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text_body,
    }
    reply_to = parseaddr(settings.email_reply_to.strip())[1]
    if reply_to:
        payload["replyTo"] = {"email": reply_to}
    try:
        response = httpx.post(
            BREVO_URL,
            headers={"api-key": _brevo_key(), "accept": "application/json", "content-type": "application/json"},
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        logger.warning("email to %s could not be sent through Brevo", to, exc_info=True)
        return "Could not reach Brevo (api.brevo.com)."
    if response.status_code < 400:
        return True
    said = " ".join(response.text.split())[:200]
    logger.warning("email to %s refused by Brevo: %s %s", to, response.status_code, said)
    lowered = said.lower()
    if "ip" in lowered and ("unrecognised" in lowered or "unrecognized" in lowered or "authorised" in lowered or "authorized" in lowered):
        return (
            "Brevo blocked the server's IP address. In Brevo open Security > Authorised IPs and turn off "
            "IP blocking (Railway's IP changes). Brevo said: " + said
        )
    if response.status_code == 401:
        return "Brevo refused the API key. Check ADCAM_BREVO_API_KEY (an API key from SMTP & API > API keys, not the SMTP key). Brevo said: " + said
    if "sender" in lowered:
        return f"Brevo refused the From address {_sender_address()}. Add and verify it under Senders. Brevo said: " + said
    return f"Brevo refused the message ({response.status_code}). Brevo said: " + said


def send_email_reason(to: str, subject: str, html: str, text_body: str | None = None) -> str | None:
    """Send one message. Returns None when it went out, else a plain-words reason. Never raises."""

    how = transport()
    if not how:
        return "Email is not set up on the server yet."
    if not to:
        return "No recipient address."
    text_body = text_body if text_body is not None else _html_to_text(html)
    sender = {"brevo": _send_brevo, "smtp": _send_smtp}.get(how, _send_resend)
    result = sender(to, subject, html, text_body)
    if result is True:
        return None
    return result if isinstance(result, str) and result else "The mail server did not accept the message."


def send_email(to: str, subject: str, html: str, text_body: str | None = None) -> bool:
    """Send one message. Returns False, without raising, when it cannot."""

    return send_email_reason(to, subject, html, text_body) is None


def _background(fn: Callable[[], None]) -> None:
    threading.Thread(target=fn, name="adcam-email", daemon=True).start()


# Tests swap this for a synchronous runner.
dispatch: Callable[[Callable[[], None]], None] = _background


def _log(db: Session, user_id: int, detail: str) -> None:
    db.add(ActivityEvent(user_id=user_id, kind=EMAIL_KIND, detail=detail[:500]))
    db.commit()


# --------------------------------------------------------------------------
# welcome + plan activated
# --------------------------------------------------------------------------


def _send_in_background(user_id: int, to: str, subject: str, text_body: str, html: str, label: str) -> None:
    def job() -> None:
        from .db import get_session_factory

        ok = send_email(to, subject, html, text_body)
        try:
            with get_session_factory()() as db:
                _log(db, user_id, f"{label} {'sent' if ok else 'NOT sent'}: {subject}")
        except Exception:  # noqa: BLE001 - logging must never raise in the thread
            logger.exception("could not record the %s email for user %s", label, user_id)

    dispatch(job)


def welcome(db: Session, user: User) -> bool:
    """Queue the welcome email once per account. Never raises."""

    try:
        if not configured():
            return False
        already = db.execute(
            select(ActivityEvent.id)
            .where(
                ActivityEvent.user_id == user.id,
                ActivityEvent.kind == EMAIL_KIND,
                ActivityEvent.detail.like("Welcome %"),
            )
            .limit(1)
        ).first()
        if already:
            return False
        rendered = render(db, "welcome", base_values(user))
        if rendered is None:
            return False
        subject, body, html = rendered
        _send_in_background(user.id, user.email, subject, body, html, "Welcome")
        return True
    except Exception:  # noqa: BLE001 - email must never break a sign-up
        logger.exception("welcome email for user %s failed", user.id)
        return False


def plan_activated(db: Session, user: User, plan_label: str, tokens: int) -> bool:
    """Queue the plan activated email. Called once per applied order. Never raises."""

    try:
        if not configured():
            return False
        end = aware(user.sub_period_end)
        values = {
            **base_values(user),
            "plan": plan_label,
            "tokens": f"{int(tokens):,}",
            "end_date": f"{end:%d %B %Y}" if end else "",
        }
        rendered = render(db, "activated", values)
        if rendered is None:
            return False
        subject, body, html = rendered
        _send_in_background(user.id, user.email, subject, body, html, "Plan activated")
        return True
    except Exception:  # noqa: BLE001 - email must never undo a payment
        logger.exception("plan activated email for user %s failed", user.id)
        return False


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
    (period ends within the reminder's ``days_before``) or ``ended`` (ended in
    the last day). Users already reminded for the same period end, and
    reminders switched off in Admin, are skipped.
    """

    from .tokens import TOKENS, get_billing_rules, get_token_plans

    now = now or datetime.now(timezone.utc)
    templates = get_templates(db)
    if not templates["ending"]["enabled"] and not templates["ended"]["enabled"]:
        return []
    plans = get_token_plans(db)
    grace = get_billing_rules(db)["grace_days"]
    soon = now + timedelta(days=templates["ending"]["days_before"])
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
        code = "ending" if end > now else "ended"
        if _already_sent(db, user.id, _marker(end, code)):
            continue
        plan = plans.get(user.sub_plan or "")
        values = {
            **base_values(user),
            "plan": plan.label if plan else (user.sub_plan or "plan"),
            "end_date": f"{end:%d %B %Y}",
            "grace_days": grace,
            "tokens": "",
        }
        rendered = render(db, code, values)
        if rendered is None:
            continue
        subject, _body, html = rendered
        due.append((user, code, subject, html))
    return due


@contextmanager
def _reminder_lock(db: Session) -> Iterator[bool]:
    """Yield True while this run holds the reminder lock (always True off Postgres).

    The lock lives on its own connection, so the run can commit after every
    email without letting a second run start in between.
    """

    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        yield True
        return
    engine = getattr(bind, "engine", bind)
    with engine.connect() as conn:
        got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": REMINDER_LOCK_ID}).scalar())
        try:
            yield got
        finally:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": REMINDER_LOCK_ID})


def send_billing_reminders(
    db: Session,
    now: datetime | None = None,
    send: Callable[[str, str, str], bool] = send_email,
) -> dict[str, int]:
    """Send every due reminder and record each one delivered so it is not repeated.

    Without a mail server this is a no-op: nothing is sent and nobody is
    marked, so the reminders go out once email is set up. A send that is
    refused is not marked either and is retried on the next run;
    ``due_reminders`` only looks a day back for ended periods, so a long
    outage cannot pile up stale mail.
    """

    if send is send_email and not configured():
        return {"sent": 0, "skipped": 0}
    with _reminder_lock(db) as got:
        if not got:
            return {"sent": 0, "skipped": 0}
        sent = skipped = 0
        for user, code, subject, html in due_reminders(db, now):
            if not send(user.email, subject, html):
                skipped += 1
                continue
            sent += 1
            detail = _marker(user.sub_period_end, code) + f": {subject}"
            db.add(ActivityEvent(user_id=user.id, kind=REMINDER_KIND, detail=detail[:500]))
            db.commit()
    return {"sent": sent, "skipped": skipped}


# --------------------------------------------------------------------------
# admin routes
# --------------------------------------------------------------------------


class EmailTemplateIn(BaseModel):
    enabled: bool = True
    subject: str = Field(default="", max_length=SUBJECT_MAX)
    body: str = Field(default="", max_length=BODY_MAX)
    days_before: int | None = Field(default=None, ge=1, le=14)


class EmailSettingsIn(BaseModel):
    templates: dict[str, EmailTemplateIn]


class EmailTestIn(BaseModel):
    kind: str


router = APIRouter(prefix="/api/v1/admin/emails", tags=["emails"], dependencies=[Depends(require_admin)])


def _status(db: Session) -> dict[str, Any]:
    return {
        "transport": transport(),
        "from": settings.email_from,
        "public_url_set": bool(_base_url()),
        "placeholders": PLACEHOLDERS,
        "templates": get_templates(db),
        "defaults": DEFAULT_TEMPLATES,
    }


@router.get("")
def email_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _status(db)


@router.put("")
def save_email_settings(payload: EmailSettingsIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    unknown = set(payload.templates) - set(KINDS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown email: {', '.join(sorted(unknown))}")
    saved = dict(get_setting(db, "email_templates", {}) or {})
    for kind, template in payload.templates.items():
        default = DEFAULT_TEMPLATES[kind]
        entry: dict[str, Any] = {"enabled": template.enabled}
        # Text equal to the default (or blank) is not stored, so later
        # improvements to the default still reach unedited emails.
        for field in ("subject", "body"):
            value = getattr(template, field).replace("\r\n", "\n")
            if value.strip() and value.strip() != default[field].strip():
                entry[field] = value
        if "days_before" in default and template.days_before is not None:
            entry["days_before"] = template.days_before
        saved[kind] = entry
    set_setting(db, "email_templates", saved)
    db.commit()
    return _status(db)


@router.post("/test")
def send_test_email(payload: EmailTestIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown email.")
    if not configured():
        raise HTTPException(status_code=409, detail="Email is not set up on the server yet.")
    template = get_templates(db)[payload.kind]
    values = {
        **base_values(admin),
        "plan": "Pro",
        "tokens": "4,500",
        "end_date": f"{datetime.now(timezone.utc) + timedelta(days=30):%d %B %Y}",
        "grace_days": 7,
    }
    subject = "[Test] " + " ".join(fill(template["subject"], values).split())[:SUBJECT_MAX]
    body = fill(template["body"], values)
    reason = send_email_reason(admin.email, subject, to_html(body), body)
    if reason:
        raise HTTPException(status_code=502, detail=reason)
    return {"sent_to": admin.email}
