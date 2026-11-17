"""Customer emails: account codes, security notices, receipts and reminders.

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
from .brand import BRAND, SLOGAN, rebrand
from .config import settings
from .db import ActivityEvent, User, get_db
from .plans import aware

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 15.0

REMINDER_KIND = "reminder"
EMAIL_KIND = "email"
ENDING_SOON_DAYS = 3
ENDED_WINDOW_HOURS = 24
# Any constant works; it only has to be the same for every reminder run.
REMINDER_LOCK_ID = 7_420_031

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
    "days_left": "Days until the plan ends (renewal reminder)",
    "app_url": "Link to the workspace",
    "plan_url": "Link to the customer's plan page",
    "code": "The 6-digit code (code emails)",
    "minutes": "Minutes the code stays valid",
    "amount": "Amount paid, e.g. $89",
    "order_id": "Transaction ID of the payment",
    "paid_date": "Date of the payment",
    "method": "How they paid (Volet, BTCPay, ...)",
    "time": "Date and time of the event (UTC)",
    "device": "Browser and system of a sign-in",
    "ip": "IP address of a sign-in",
    "provider": "Google or Apple",
    "new_email": "The new email address (email change)",
    "login_url": "Link to the log in page",
    "reset_url": "Link to the forgot password page",
}

DEFAULT_TEMPLATES: dict[str, dict[str, Any]] = {
    "welcome": {
        "label": "Welcome",
        "kicker": "Account ready",
        "stat": "Welcome",
        "stat_sub": "Your account is set up",
        "headline": "",
        "button": "Choose a plan",
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
        "kicker": "Payment confirmed",
        "stat": "{tokens}",
        "stat_sub": "tokens added · until {end_date}",
        "headline": "",
        "button": "Open workspace",
        "when": "When a plan payment is confirmed or approved (Whop, Admin or Telegram).",
        "enabled": True,
        "subject": "Your {plan} plan is active",
        "body": (
            "Hi {name},\n\n"
            "Your {plan} plan is now active. {tokens} tokens were added to your account, "
            "and this period runs until {end_date}.\n\n"
            "Receipt\nAmount: {amount}\nTransaction ID: {order_id}\nPaid with: {method}\nDate: {paid_date}\n\n"
            "Open your workspace:\n{app_url}\n\n"
            "Thanks for choosing us.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "ending": {
        "label": "Renewal reminder",
        "kicker": "Renewal reminder",
        "stat": "{days_left} days",
        "stat_sub": "left on your {plan} plan",
        "headline": "",
        "button": "Renew plan",
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
        "kicker": "Plan ended",
        "stat": "{grace_days} days",
        "stat_sub": "to renew and keep your tokens",
        "headline": "",
        "button": "Renew plan",
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

    # --- security: codes ---------------------------------------------------
    "verify": {
        "label": "Sign-up code",
        "kicker": "Confirm your email",
        "stat": "{code}",
        "stat_sub": "Expires in {minutes} minutes",
        "headline": "",
        "button": "",
        "when": "Right after someone signs up with email and password. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "{code} is your " + BRAND + " code",
        "body": (
            "Hi {name},\n\n"
            "Enter this code on the sign-up page to confirm your email and open your account:\n\n"
            "{code}\n\n"
            "If you did not sign up, you can ignore this email. No account is opened without the code.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "reset": {
        "label": "Password reset code",
        "kicker": "Password reset",
        "stat": "{code}",
        "stat_sub": "Expires in {minutes} minutes",
        "headline": "",
        "button": "",
        "when": "When someone uses Forgot password. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "Your " + BRAND + " password reset code",
        "body": (
            "Hi {name},\n\n"
            "Someone asked to reset the password of your account. Enter this code to choose a new one:\n\n"
            "{code}\n\n"
            "If it was not you, ignore this email. Your password stays the same.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "password_code": {
        "label": "Password change code",
        "kicker": "Confirm password change",
        "stat": "{code}",
        "stat_sub": "Expires in {minutes} minutes",
        "headline": "",
        "button": "",
        "when": "When a signed-in customer changes their password. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "Confirm your " + BRAND + " password change",
        "body": (
            "Hi {name},\n\n"
            "Enter this code on your plan page to confirm the new password:\n\n"
            "{code}\n\n"
            "If you did not ask for this, someone may know your password. Change it now and contact support.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "email_code": {
        "label": "Email change code",
        "kicker": "Confirm new email",
        "stat": "{code}",
        "stat_sub": "Expires in {minutes} minutes",
        "headline": "",
        "button": "",
        "when": "Sent to the NEW address when a customer changes their email. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "Confirm your new " + BRAND + " email",
        "body": (
            "Hi {name},\n\n"
            "Enter this code on your plan page to use {new_email} for your account:\n\n"
            "{code}\n\n"
            "If you did not ask for this, ignore this email.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    # --- security: notices ---------------------------------------------------
    "password_changed": {
        "label": "Password changed",
        "kicker": "Security notice",
        "stat": "",
        "stat_sub": "",
        "headline": "Your password was changed",
        "button": "Reset password",
        "when": "After a password change or reset. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "Your " + BRAND + " password was changed",
        "body": (
            "Hi {name},\n\n"
            "The password of your account was changed on {time}. Every other device was signed out.\n\n"
            "If this was you, there is nothing to do. If it was not, reset your password right away and reply to this email:\n"
            "{reset_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "email_changed": {
        "label": "Email changed",
        "kicker": "Security notice",
        "stat": "",
        "stat_sub": "",
        "headline": "Your account email was changed",
        "button": "",
        "when": "Sent to the OLD address after a customer changes their email. Always sent.",
        "enabled": True,
        "locked": True,
        "subject": "Your " + BRAND + " email was changed",
        "body": (
            "Hi {name},\n\n"
            "On {time} the email of your account was changed to {new_email}. From now on, use that address to log in.\n\n"
            "If this was not you, reply to this email straight away so we can lock the account.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "new_login": {
        "label": "New sign-in alert",
        "kicker": "New sign-in",
        "stat": "",
        "stat_sub": "",
        "headline": "New sign-in to your account",
        "button": "Reset password",
        "when": "When someone signs in from a browser or device not used on the account before.",
        "enabled": True,
        "subject": "New sign-in to your " + BRAND + " account",
        "body": (
            "Hi {name},\n\n"
            "Your account was just signed in to from a new device.\n\n"
            "Device: {device}\nIP address: {ip}\nTime: {time}\n\n"
            "If this was you, there is nothing to do. If it was not, reset your password now:\n"
            "{reset_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "linked": {
        "label": "Google / Apple linked",
        "kicker": "Security notice",
        "stat": "",
        "stat_sub": "",
        "headline": "",
        "button": "Log in",
        "when": "When a Google or Apple login is connected to an existing account.",
        "enabled": True,
        "subject": "{provider} sign-in added to your " + BRAND + " account",
        "body": (
            "Hi {name},\n\n"
            "On {time} your {provider} account was connected to your {email} account. "
            "You can now log in with the Continue with {provider} button.\n\n"
            "{login_url}\n\n"
            "If this was not you, reply to this email straight away.\n\n"
            f"{SIGN_OFF}"
        ),
    },
    # --- billing ---------------------------------------------------------------
    "topup": {
        "label": "Top-up receipt",
        "kicker": "Payment received",
        "stat": "+{tokens}",
        "stat_sub": "tokens added to your balance",
        "headline": "",
        "button": "Open workspace",
        "when": "When a top-up payment is confirmed or approved.",
        "enabled": True,
        "subject": "Receipt: {tokens} tokens added",
        "body": (
            "Hi {name},\n\n"
            "Thanks for your top-up. {tokens} tokens were added to your {plan} balance.\n\n"
            "Receipt\nAmount: {amount}\nTransaction ID: {order_id}\nPaid with: {method}\nDate: {paid_date}\n\n"
            "Open your workspace:\n{app_url}\n\n"
            f"{SIGN_OFF}"
        ),
    },
    "payment_failed": {
        "label": "Payment not completed",
        "kicker": "Payment not completed",
        "stat": "{amount}",
        "stat_sub": "was not charged",
        "headline": "",
        "button": "Try again",
        "when": "When you reject a payment (Admin or Telegram), or an order is marked invalid.",
        "enabled": True,
        "subject": "Your " + BRAND + " payment did not go through",
        "body": (
            "Hi {name},\n\n"
            "Your payment of {amount} for {plan} (transaction ID {order_id}) did not go through, "
            "so nothing was added to your account.\n\n"
            "You can try again from your plan page:\n{plan_url}\n\n"
            "If money left your account, reply to this email with the transaction ID and we will sort it out.\n\n"
            f"{SIGN_OFF}"
        ),
    },
}
KINDS = tuple(DEFAULT_TEMPLATES)
SUBJECT_MAX = 200
BODY_MAX = 5000
# Per-email design text, all editable in Admin. Blank hides that part
# (headline blank = use the subject; button blank = keep the link as text).
DESIGN_FIELDS = ("kicker", "stat", "stat_sub", "headline", "button")
DESIGN_MAX = 200

# The look shared by every email (Admin > Settings > Customer emails > Design).
# A blank logo uses the ProteusFlow logo from the site's /brand folder.
DEFAULT_STYLE: dict[str, Any] = {
    "logo_url": "",
    "logo_size": 96,
    "header_color": "#0866ff",
    "header_text_color": "#ffffff",
    "page_color": "#f2f4f8",
    "card_color": "#ffffff",
    "text_color": "#1f232a",
    "button_color": "#0b0d12",
    "button_text_color": "#ffffff",
    "footer_text": f"{BRAND} · {SLOGAN}\nYou get this email because you have a {BRAND} account.",
    "show_footer_logo": True,
}
COLOR_FIELDS = ("header_color", "header_text_color", "page_color", "card_color", "text_color", "button_color", "button_text_color")
_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_SAFE_URL = re.compile(r"^(?:https://|/)[^\s\"'<>()\\]*$")
# The logo on a white rounded tile, so it stands out on the blue header.
LOGO_DEFAULT_PATH = "/brand/proteusflow-mark-email.png"
WORDMARK_PATH = "/brand/proteusflow-wordmark.png"
# The default logo of the current design: trident mark + ProteusFlow wordmark.
LOCKUP_PATH = "/brand/proteusflow-email-lockup.png"
LOCKUP_WIDTH = 210
MARK_PATH = "/brand/proteusflow-mark.png"


def clean_style(raw: Any) -> dict[str, Any]:
    """Saved style over the defaults, with anything unsafe dropped."""

    out = dict(DEFAULT_STYLE)
    if not isinstance(raw, dict):
        return out
    for field in COLOR_FIELDS:
        value = raw.get(field)
        if isinstance(value, str) and _HEX.match(value.strip()):
            out[field] = value.strip()
    logo = raw.get("logo_url")
    if isinstance(logo, str) and (not logo.strip() or _SAFE_URL.match(logo.strip())):
        # The old shield file gives way to the current default logo.
        # Old shield files and the logo made for the old blue header give way
        # to the current default (the mark + wordmark lockup).
        old = "blucloacking-" in logo or logo.strip() in (LOGO_DEFAULT_PATH, WORDMARK_PATH)
        out["logo_url"] = "" if old else logo.strip()
    size = raw.get("logo_size")
    if isinstance(size, int) and not isinstance(size, bool):
        out["logo_size"] = max(24, min(160, size))
    footer = raw.get("footer_text")
    if isinstance(footer, str):
        out["footer_text"] = rebrand(footer[:500])
    if isinstance(raw.get("show_footer_logo"), bool):
        out["show_footer_logo"] = raw["show_footer_logo"]
    return out


def get_style(db: Session) -> dict[str, Any]:
    return clean_style(get_setting(db, "email_style", {}) or {})


def get_templates(db: Session) -> dict[str, dict[str, Any]]:
    """Every template with the admin's saved changes laid over the defaults."""

    saved = get_setting(db, "email_templates", {}) or {}
    out: dict[str, dict[str, Any]] = {}
    for kind, default in DEFAULT_TEMPLATES.items():
        merged = dict(default)
        mine = saved.get(kind) if isinstance(saved, dict) else None
        if isinstance(mine, dict):
            # Codes and security notices cannot be switched off: without them
            # nobody could finish signing up or get back into an account.
            if isinstance(mine.get("enabled"), bool) and not default.get("locked"):
                merged["enabled"] = mine["enabled"]
            for field in ("subject", "body"):
                value = mine.get(field)
                if isinstance(value, str) and value.strip():
                    merged[field] = rebrand(value)
            # Design text may be saved blank on purpose: blank hides that part.
            for field in DESIGN_FIELDS:
                value = mine.get(field)
                if isinstance(value, str):
                    merged[field] = rebrand(value)
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


SANS = "Geist,'Helvetica Neue',Helvetica,Arial,sans-serif"
MONO = "'Geist Mono',Menlo,Consolas,monospace"
_URL_LINE = re.compile(r"^https?://\S+$")


def _abs(url: str) -> str:
    """Site-relative paths (``/brand/...``, uploaded media) need the full site URL in an email."""

    if url.startswith("/"):
        base = _base_url()
        return f"{base}{url}" if base else url
    return url


def _paragraphs(blocks: list[str], color: str) -> str:
    out = []
    for block in blocks:
        safe = html_lib.escape(block)
        safe = _LINK.sub(lambda m: f'<a href="{m.group(1)}" style="color:#0866ff">{m.group(1)}</a>', safe)
        out.append(
            f'<p style="margin:0 0 16px;font-family:{SANS};font-size:15px;line-height:1.6;color:{color}">'
            f'{safe.replace(chr(10), "<br>")}</p>'
        )
    return "".join(out)


def _split_at_button(body: str, has_button: bool) -> tuple[list[str], str | None, list[str]]:
    """Text before the button, the button link, text after it.

    The first line that is only a link becomes the button. Without a button
    label every link stays in the text.
    """

    before: list[str] = []
    after: list[str] = []
    link: str | None = None
    for block in re.split(r"\n\s*\n", body.strip()):
        if not block.strip():
            continue
        if link is None and has_button:
            lines = block.split("\n")
            for i, line in enumerate(lines):
                if _URL_LINE.match(line.strip()):
                    link = line.strip()
                    head = "\n".join(lines[:i]).strip()
                    tail = "\n".join(lines[i + 1 :]).strip()
                    if head:
                        before.append(head)
                    if tail:
                        after.append(tail)
                    break
            else:
                before.append(block)
            continue
        (after if link else before).append(block)
    return before, link, after


_CODE = re.compile(r"^\d{4,8}$")


def to_html(
    body: str,
    footer: str = "",
    *,
    design: dict[str, Any] | None = None,
    style: dict[str, Any] | None = None,
) -> str:
    """Plain text -> the branded ProteusFlow HTML email.

    Layout: a white card with a thin accent bar, the ProteusFlow logo, a
    small coloured top line (kicker), the headline, an optional highlight box
    (the big ``stat`` + ``stat_sub``; a code is shown spaced out in mono),
    the message, a pill button and a footer under the card.

    ``design`` holds the filled-in per-email parts (kicker, stat, stat_sub,
    headline, button). ``style`` is the shared look from :func:`get_style`:
    ``header_color`` is the accent (bar, top line, highlight box) and
    ``header_text_color`` the text inside the highlight box. ``footer`` is
    extra trusted HTML from the app (for example an unsubscribe link) shown
    under the footer text. Customer and admin text is always escaped.
    """

    st = clean_style(style) if style is not None else dict(DEFAULT_STYLE)
    d = {k: str(v) for k, v in (design or {}).items() if v is not None}
    esc = html_lib.escape
    accent, accent_text = st["header_color"], st["header_text_color"]
    text_color = st["text_color"]
    button = d.get("button", "").strip()
    stat = d.get("stat", "").strip()
    is_code = bool(_CODE.match(stat))
    before, link, after = _split_at_button(body, bool(button))
    if is_code:
        # The code is in the highlight box; don't repeat it as a paragraph.
        before = [b for b in before if b.strip() != stat]
        after = [b for b in after if b.strip() != stat]

    if st["logo_url"]:
        size = int(st["logo_size"])
        logo = (
            f'<img src="{esc(_abs(st["logo_url"]))}" width="{size}" alt="{BRAND}" style="display:block;border:0;'
            f'width:{size}px;height:auto;max-width:100%">'
        )
    else:
        logo = (
            f'<img src="{esc(_abs(LOCKUP_PATH))}" width="{LOCKUP_WIDTH}" alt="{BRAND}" style="display:block;border:0;'
            f'width:{LOCKUP_WIDTH}px;height:auto;max-width:100%">'
        )

    content = [f'<div style="padding-bottom:28px">{logo}</div>']
    if d.get("kicker", "").strip():
        content.append(
            f'<div style="font-family:{MONO};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;'
            f'color:{accent};padding-bottom:10px">{esc(d["kicker"])}</div>'
        )
    if d.get("headline", "").strip():
        content.append(
            f'<h1 style="margin:0 0 18px;font-family:{SANS};font-weight:700;font-size:26px;line-height:1.25;'
            f'letter-spacing:-0.4px;color:{text_color}">{esc(d["headline"])}</h1>'
        )
    if stat:
        if is_code:
            big = (
                f'<div style="font-family:{MONO};font-weight:700;font-size:38px;line-height:1.1;letter-spacing:10px;'
                f'color:{accent_text};padding-left:10px">{esc(stat)}</div>'
            )
        else:
            big = (
                f'<div style="font-family:{SANS};font-weight:800;font-size:40px;line-height:1.1;letter-spacing:-1px;'
                f'color:{accent_text}">{esc(stat)}</div>'
            )
        sub = ""
        if d.get("stat_sub", "").strip():
            sub = (
                f'<div style="font-family:{SANS};font-size:13px;color:{accent_text};opacity:.85;padding-top:6px">'
                f'{esc(d["stat_sub"])}</div>'
            )
        content.append(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">'
            f'<tr><td align="center" style="background:{accent};border-radius:16px;padding:24px 20px">{big}{sub}</td></tr>'
            "</table>"
        )
    content.append(_paragraphs(before, text_color))
    if link:
        content.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px"><tr>'
            f'<td style="border-radius:999px;background:{st["button_color"]}">'
            f'<a href="{esc(link)}" style="display:inline-block;padding:13px 28px;font-family:{SANS};font-size:15px;'
            f'font-weight:600;color:{st["button_text_color"]};text-decoration:none;border-radius:999px">'
            f"{esc(button)} &rarr;</a></td></tr></table>"
        )
    content.append(_paragraphs(after, text_color))

    foot = []
    if st["show_footer_logo"]:
        foot.append(
            f'<img src="{esc(_abs(MARK_PATH))}" width="28" alt="" '
            'style="display:block;border:0;width:28px;height:auto;margin:0 auto 10px">'
        )
    if st["footer_text"].strip():
        foot.append(
            f'<div style="font-family:{SANS};font-size:12px;line-height:1.6;color:#8a8f98">'
            f'{esc(st["footer_text"]).replace(chr(10), "<br>")}</div>'
        )
    if footer:
        foot.append(f'<div style="font-family:{SANS};font-size:12px;line-height:1.6;color:#8a8f98;padding-top:6px">{footer}</div>')

    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>'
        f'<body style="margin:0;padding:0;background:{st["page_color"]}">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{st["page_color"]}">'
        '<tr><td align="center" style="padding:32px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">'
        f'<tr><td style="background:{accent};height:5px;line-height:5px;font-size:0;border-radius:20px 20px 0 0">&nbsp;</td></tr>'
        f'<tr><td style="background:{st["card_color"]};border-radius:0 0 20px 20px;padding:32px 36px 14px;'
        f'border:1px solid #e3e7ef;border-top:0">{"".join(content)}</td></tr>'
        f'<tr><td align="center" style="padding:22px 8px">{"".join(foot)}</td></tr>'
        "</table></td></tr></table></body></html>"
    )


def design_for(template: dict[str, Any], values: dict[str, Any], subject: str) -> dict[str, str]:
    """The template's design parts with ``{placeholders}`` filled in."""

    parts = {field: " ".join(fill(str(template.get(field, "")), values).split()) for field in DESIGN_FIELDS}
    if not parts["headline"]:
        parts["headline"] = subject
    return parts


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
    html = to_html(body, design=design_for(template, values, subject), style=get_style(db))
    return subject, body, html


# --------------------------------------------------------------------------
# sending
# --------------------------------------------------------------------------


def _secret(value: Any) -> str:
    return value.get_secret_value().strip() if value is not None else ""


def _api_key() -> str:
    return _secret(settings.resend_api_key)


def smtp_ready() -> bool:
    return bool(settings.smtp_host.strip())


def transport() -> str:
    """``smtp``, ``resend`` or ``""`` when email is not set up."""

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


def _send_smtp(to: str, subject: str, html: str, text_body: str, headers: dict[str, str] | None = None) -> bool:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = to
    message["Subject"] = subject
    if settings.email_reply_to.strip():
        message["Reply-To"] = settings.email_reply_to.strip()
    domain = parseaddr(settings.email_from)[1].rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    for name, value in (headers or {}).items():
        message[name] = value
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
    except (smtplib.SMTPException, OSError):
        logger.warning("email to %s could not be sent over SMTP", to, exc_info=True)
        return False
    return True


def _send_resend(to: str, subject: str, html: str, text_body: str, headers: dict[str, str] | None = None) -> bool:
    payload: dict[str, Any] = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text_body,
    }
    if settings.email_reply_to.strip():
        payload["reply_to"] = settings.email_reply_to.strip()
    if headers:
        payload["headers"] = dict(headers)
    try:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"},
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        logger.warning("email to %s could not be sent", to, exc_info=True)
        return False
    if response.status_code >= 400:
        logger.warning("email to %s refused by Resend: %s %s", to, response.status_code, response.text[:200])
        return False
    return True


def send_email(
    to: str,
    subject: str,
    html: str,
    text_body: str | None = None,
    headers: dict[str, str] | None = None,
) -> bool:
    """Send one message. Returns False, without raising, when it cannot.

    ``headers`` are extra message headers (group emails add List-Unsubscribe).
    """

    how = transport()
    if not how or not to:
        return False
    text_body = text_body if text_body is not None else _html_to_text(html)
    if how == "smtp":
        return _send_smtp(to, subject, html, text_body, headers) if headers else _send_smtp(to, subject, html, text_body)
    return _send_resend(to, subject, html, text_body, headers) if headers else _send_resend(to, subject, html, text_body)


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


def _send_in_background(
    user_id: int, to: str, subject: str, text_body: str, html: str, label: str, *, real_subject: str | None = None
) -> None:
    """Send in a thread and log it. ``subject`` is what the log shows; ``real_subject`` (if given) is sent."""

    def job() -> None:
        from .db import get_session_factory

        ok = send_email(to, real_subject or subject, html, text_body)
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


def _order_values(db: Session, order: Any) -> dict[str, Any]:
    """Receipt placeholders for an order: amount, transaction ID, method, date."""

    from .app_settings import currency
    from .notify import order_ref

    amount = float(getattr(order, "amount_usd", 0) or 0)
    cur = currency(db)
    if amount <= 0:
        money = "Free (added by support)"
    elif cur.upper() == "USD":
        money = f"${amount:,.2f}".replace(".00", "")
    else:
        money = f"{amount:,.2f} {cur.upper()}".replace(".00", "")
    provider = str(getattr(order, "provider", "") or "")
    method = {"whop": "Whop", "volet": "Volet", "btcpay": "Crypto (BTCPay)"}.get(provider, provider.capitalize() or "-")
    if amount <= 0:
        method = "Added by support"
    paid = aware(getattr(order, "paid_at", None)) or aware(getattr(order, "created_at", None)) or datetime.now(timezone.utc)
    return {
        "amount": money,
        "order_id": order_ref(order),
        "method": method,
        "paid_date": f"{paid:%d %B %Y}",
    }


def plan_activated(db: Session, user: User, plan_label: str, tokens: int, order: Any = None) -> bool:
    """Queue the plan activated email (with the receipt). Called once per applied order. Never raises."""

    try:
        if not configured():
            return False
        end = aware(user.sub_period_end)
        values = {
            **base_values(user),
            "plan": plan_label,
            "tokens": f"{int(tokens):,}",
            "end_date": f"{end:%d %B %Y}" if end else "",
            "amount": "-",
            "order_id": "-",
            "method": "-",
            "paid_date": f"{datetime.now(timezone.utc):%d %B %Y}",
        }
        if order is not None:
            values.update(_order_values(db, order))
        rendered = render(db, "activated", values)
        if rendered is None:
            return False
        subject, body, html = rendered
        _send_in_background(user.id, user.email, subject, body, html, "Plan activated")
        return True
    except Exception:  # noqa: BLE001 - email must never undo a payment
        logger.exception("plan activated email for user %s failed", user.id)
        return False


def _now_text() -> str:
    return f"{datetime.now(timezone.utc):%d %B %Y, %H:%M} UTC"


def security_values(user: User) -> dict[str, Any]:
    """Placeholders every account and security email can use."""

    base = _base_url()
    return {
        **base_values(user),
        "time": _now_text(),
        "login_url": f"{base}/login" if base else "/login",
        "reset_url": f"{base}/forgot-password" if base else "/forgot-password",
        "minutes": settings.email_code_minutes,
    }


def send_kind(db: Session, user: User, kind: str, values: dict[str, Any] | None = None, *, to: str | None = None) -> bool:
    """Queue one of the account emails (codes, notices, receipts) for ``user``. Never raises.

    ``to`` overrides the recipient (an email change code goes to the new address).
    """

    try:
        if not configured():
            return False
        rendered = render(db, kind, {**security_values(user), **(values or {})})
        if rendered is None:
            return False
        subject, body, html = rendered
        label = DEFAULT_TEMPLATES[kind]["label"]
        # Codes are never written to the activity log, only that one was sent.
        logged = subject if "code" not in kind and kind not in ("verify", "reset") else label
        _send_in_background(user.id, to or user.email, logged, body, html, label, real_subject=subject)
        return True
    except Exception:  # noqa: BLE001 - email must never break the request that triggered it
        logger.exception("%s email for user %s failed", kind, user.id)
        return False


def topup_receipt(db: Session, user: User, order: Any, plan_label: str) -> bool:
    values = {"plan": plan_label, "tokens": f"{int(order.tokens or 0):,}", **_order_values(db, order)}
    return send_kind(db, user, "topup", values)


def payment_failed(db: Session, order: Any) -> bool:
    """Tell the buyer a payment did not go through (cancelled, invalid or rejected). Never raises."""

    try:
        if not order or float(order.amount_usd or 0) <= 0:
            return False
        user = db.get(User, order.user_id)
        if user is None or not user.is_active:
            return False
        from .tokens import get_token_plans

        plan = get_token_plans(db).get(order.plan_id)
        label = plan.label if plan else order.plan_id
        what = f"the {label} plan" if order.kind == "subscription" else f"a top-up on {label}"
        return send_kind(db, user, "payment_failed", {"plan": what, **_order_values(db, order)})
    except Exception:  # noqa: BLE001
        logger.exception("payment failed email for order %s failed", getattr(order, "id", "?"))
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
            "days_left": max(1, -(-int((end - now).total_seconds()) // 86400)) if end > now else 0,
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
    # Design text; None = leave as it is, "" = hide that part.
    kicker: str | None = Field(default=None, max_length=DESIGN_MAX)
    stat: str | None = Field(default=None, max_length=DESIGN_MAX)
    stat_sub: str | None = Field(default=None, max_length=DESIGN_MAX)
    headline: str | None = Field(default=None, max_length=DESIGN_MAX)
    button: str | None = Field(default=None, max_length=DESIGN_MAX)


class EmailStyleIn(BaseModel):
    logo_url: str = Field(default="", max_length=1000)
    logo_size: int = Field(default=96, ge=24, le=160)
    header_color: str = Field(default="#0866ff", max_length=7)
    header_text_color: str = Field(default="#ffffff", max_length=7)
    page_color: str = Field(default="#eef2f9", max_length=7)
    card_color: str = Field(default="#ffffff", max_length=7)
    text_color: str = Field(default="#1f232a", max_length=7)
    button_color: str = Field(default="#0b0d12", max_length=7)
    button_text_color: str = Field(default="#ffffff", max_length=7)
    footer_text: str = Field(default="", max_length=500)
    show_footer_logo: bool = True


class EmailSettingsIn(BaseModel):
    templates: dict[str, EmailTemplateIn]
    style: EmailStyleIn | None = None


class EmailTestIn(BaseModel):
    kind: str


class EmailPreviewIn(BaseModel):
    kind: str
    template: EmailTemplateIn
    style: EmailStyleIn


def _check_style(style: EmailStyleIn) -> dict[str, Any]:
    raw = style.model_dump()
    for field in COLOR_FIELDS:
        if not _HEX.match(raw[field].strip()):
            raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').capitalize()} must be a colour like #0866ff.")
    logo = raw["logo_url"].strip()
    if logo and not _SAFE_URL.match(logo):
        raise HTTPException(status_code=422, detail="The logo must be an https:// link or an uploaded image.")
    return clean_style(raw)


def _sample_values(user: User, kind: str, days_before: int) -> dict[str, Any]:
    return {
        **security_values(user),
        "code": "482913",
        "amount": "$89",
        "order_id": "BC-7Q2M-K4XD",
        "method": "Whop",
        "paid_date": f"{datetime.now(timezone.utc):%d %B %Y}",
        "device": "Chrome on Windows",
        "ip": "203.0.113.24",
        "provider": "Google",
        "new_email": "new-address@example.com",
        "plan": "the Pro plan" if kind == "payment_failed" else "Pro",
        "tokens": "1,000" if kind == "topup" else "4,500",
        "end_date": f"{datetime.now(timezone.utc) + timedelta(days=days_before if kind == 'ending' else 30):%d %B %Y}",
        "grace_days": 7,
        "days_left": days_before,
    }


router = APIRouter(prefix="/api/v1/admin/emails", tags=["emails"], dependencies=[Depends(require_admin)])


def _status(db: Session) -> dict[str, Any]:
    return {
        "transport": transport(),
        "from": settings.email_from,
        "public_url_set": bool(_base_url()),
        "placeholders": PLACEHOLDERS,
        "templates": get_templates(db),
        "defaults": DEFAULT_TEMPLATES,
        "style": get_style(db),
        "style_defaults": DEFAULT_STYLE,
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
        for field in DESIGN_FIELDS:
            value = getattr(template, field)
            if value is None:
                previous = saved.get(kind, {}) if isinstance(saved.get(kind), dict) else {}
                if isinstance(previous.get(field), str):
                    entry[field] = previous[field]
            elif value.strip() != str(default.get(field, "")).strip():
                entry[field] = value.strip()
        if "days_before" in default and template.days_before is not None:
            entry["days_before"] = template.days_before
        saved[kind] = entry
    set_setting(db, "email_templates", saved)
    if payload.style is not None:
        set_setting(db, "email_style", _check_style(payload.style))
    db.commit()
    return _status(db)


@router.post("/test")
def send_test_email(payload: EmailTestIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown email.")
    if not configured():
        raise HTTPException(status_code=409, detail="Email is not set up on the server yet.")
    template = get_templates(db)[payload.kind]
    values = _sample_values(admin, payload.kind, int(template.get("days_before") or ENDING_SOON_DAYS))
    clean_subject = " ".join(fill(template["subject"], values).split())[:SUBJECT_MAX]
    subject = "[Test] " + clean_subject
    body = fill(template["body"], values)
    html = to_html(body, design=design_for(template, values, clean_subject), style=get_style(db))
    ok = send_email(admin.email, subject, html, body)
    if not ok:
        raise HTTPException(status_code=502, detail="The mail server did not accept the message. Check the api logs.")
    return {"sent_to": admin.email}


@router.post("/preview")
def preview_email(payload: EmailPreviewIn, admin: User = Depends(require_admin)) -> dict[str, Any]:
    """Render unsaved edits with sample values, for the live preview in Admin."""

    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown email.")
    default = DEFAULT_TEMPLATES[payload.kind]
    t = payload.template
    template: dict[str, Any] = {
        "subject": t.subject if t.subject.strip() else default["subject"],
        "body": t.body if t.body.strip() else default["body"],
    }
    for field in DESIGN_FIELDS:
        value = getattr(t, field)
        template[field] = default.get(field, "") if value is None else value
    values = _sample_values(admin, payload.kind, t.days_before or int(default.get("days_before") or ENDING_SOON_DAYS))
    subject = " ".join(fill(template["subject"], values).split())[:SUBJECT_MAX]
    body = fill(template["body"], values)
    html = to_html(body, design=design_for(template, values, subject), style=_check_style(payload.style))
    return {"subject": subject, "html": html, "text": body}
