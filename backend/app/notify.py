"""Instant phone alerts for the owner: plan clicks, checkouts and payments.

Messages go to a Telegram chat through a bot the owner makes with
@BotFather, and/or to an ntfy.sh topic the ntfy phone app subscribes to.
Nothing is sent unless one of them is set up on the ``api`` service:

- Telegram: ADCAM_NOTIFY_TELEGRAM_BOT_TOKEN + ADCAM_NOTIFY_TELEGRAM_CHAT_ID
- ntfy:     ADCAM_NOTIFY_NTFY_TOPIC (+ ADCAM_NOTIFY_NTFY_URL / _TOKEN for a
            self-hosted or protected server)

Events (ADCAM_NOTIFY_EVENTS picks which, all by default):

- ``plan_click``  a visitor pressed Choose on a landing pricing card
- ``checkout``    a signed-in customer pressed Subscribe / Renew / Top up and
                  an order was opened (or an open one reused)
- ``paid``        the payment provider confirmed the money; the plan is on
- ``review``      a payment notification was set aside and needs a look

Sending happens on a background thread, so a slow or broken Telegram never
slows or breaks a checkout or a payment notification. The same alert
(same event, same person, same plan) is sent at most once per
ADCAM_NOTIFY_DEDUPE_SECONDS, and at most ``MAX_PER_MINUTE`` alerts leave in
any minute, so a visitor hammering a button cannot flood the phone.
"""

from __future__ import annotations

import html
import logging
import threading
import time
from collections import deque
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .accounts import optional_user, require_admin
from .config import settings
from .db import User, get_db

logger = logging.getLogger(__name__)

EVENTS = ("plan_click", "checkout", "paid", "review")
# Hard ceiling across every event: past this the extra alerts are dropped
# (and logged) until the minute rolls over.
MAX_PER_MINUTE = 20
# Landing clicks are public, so each visitor address gets a few per window.
CLICKS_PER_ADDRESS = 6
CLICK_WINDOW = 10 * 60
TIMEOUT = 8.0

_lock = threading.Lock()
_recent: dict[str, float] = {}
_sent_times: deque[float] = deque()
_clicks: dict[str, deque[float]] = {}


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------


def _secret(value: Any) -> str:
    return value.get_secret_value().strip() if value is not None else ""


def telegram_ready() -> bool:
    return bool(_secret(settings.notify_telegram_bot_token) and settings.notify_telegram_chat_id.strip())


def ntfy_ready() -> bool:
    return bool(settings.notify_ntfy_topic.strip())


def channels() -> list[str]:
    found = []
    if telegram_ready():
        found.append("telegram")
    if ntfy_ready():
        found.append("ntfy")
    return found


def enabled() -> bool:
    return bool(channels())


def event_on(event: str) -> bool:
    chosen = [e.strip().lower() for e in settings.notify_events if e.strip()]
    return event in chosen if chosen else True


def reset() -> None:
    """Forget dedupe and rate state (tests)."""

    with _lock:
        _recent.clear()
        _sent_times.clear()
        _clicks.clear()


# --------------------------------------------------------------------------
# sending
# --------------------------------------------------------------------------


def _send_telegram(title: str, lines: list[str]) -> None:
    token = _secret(settings.notify_telegram_bot_token)
    body = "\n".join([f"<b>{html.escape(title)}</b>", *(html.escape(line) for line in lines)])
    response = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": settings.notify_telegram_chat_id.strip(),
            "text": body,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=TIMEOUT,
    )
    if response.status_code >= 400:
        # The token is part of the URL, so only the status and Telegram's
        # own description are logged, never the request.
        raise RuntimeError(f"Telegram answered {response.status_code}: {response.text[:200]}")


def _send_ntfy(title: str, lines: list[str], priority: str) -> None:
    # JSON publishing to the server root keeps emoji in the title working
    # (HTTP headers would have to be plain ASCII).
    base = (settings.notify_ntfy_url.strip() or "https://ntfy.sh").rstrip("/")
    headers = {}
    token = _secret(settings.notify_ntfy_token)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = httpx.post(
        base,
        json={
            "topic": settings.notify_ntfy_topic.strip(),
            "title": title,
            "message": "\n".join(lines),
            "priority": 4 if priority == "high" else 3,
        },
        headers=headers,
        timeout=TIMEOUT,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"ntfy answered {response.status_code}: {response.text[:200]}")


def deliver(title: str, lines: list[str], priority: str = "default") -> dict[str, str]:
    """Send now on every channel that is set up. Returns channel -> "ok" or the error."""

    results: dict[str, str] = {}
    if telegram_ready():
        try:
            _send_telegram(title, lines)
            results["telegram"] = "ok"
        except Exception as exc:  # noqa: BLE001 - an alert must never raise
            logger.warning("Telegram alert failed: %s", exc)
            results["telegram"] = str(exc)[:300]
    if ntfy_ready():
        try:
            _send_ntfy(title, lines, priority)
            results["ntfy"] = "ok"
        except Exception as exc:  # noqa: BLE001
            logger.warning("ntfy alert failed: %s", exc)
            results["ntfy"] = str(exc)[:300]
    return results


def _admit(key: str | None) -> bool:
    """Dedupe + global rate limit. True if this alert may go out now."""

    now = time.monotonic()
    window = max(0, int(settings.notify_dedupe_seconds))
    with _lock:
        while _sent_times and now - _sent_times[0] > 60:
            _sent_times.popleft()
        if key and window:
            # Drop stale keys so the map cannot grow without bound.
            if len(_recent) > 2000:
                for stale in [k for k, t in _recent.items() if now - t > window]:
                    _recent.pop(stale, None)
            last = _recent.get(key)
            if last is not None and now - last < window:
                return False
        if len(_sent_times) >= MAX_PER_MINUTE:
            logger.warning("Phone alert dropped: more than %d alerts in a minute", MAX_PER_MINUTE)
            return False
        if key:
            _recent[key] = now
        _sent_times.append(now)
    return True


def _dispatch(title: str, lines: list[str], priority: str) -> None:
    threading.Thread(target=deliver, args=(title, lines, priority), daemon=True, name="phone-alert").start()


def alert(event: str, title: str, lines: list[str], *, key: str | None = None, priority: str = "default") -> bool:
    """Queue one alert. Never raises; returns True if it was queued."""

    try:
        if not enabled() or not event_on(event):
            return False
        if not _admit(f"{event}:{key}" if key else None):
            return False
        _dispatch(title, [line for line in lines if line], priority)
        return True
    except Exception:  # noqa: BLE001 - alerts must never break the caller
        logger.exception("Phone alert %s could not be queued", event)
        return False


# --------------------------------------------------------------------------
# the events
# --------------------------------------------------------------------------


def order_ref(order: Any) -> str:
    """The id the customer sees for an order: its BC- transaction id when it has one."""

    ref = getattr(order, "ref_code", None)
    return str(ref) if ref else f"#{str(order.id)[:8]}"


def _money(amount: float, currency: str) -> str:
    return f"${amount:g}" if currency.upper() == "USD" else f"{amount:g} {currency.upper()}"


def plan_click(plan_label: str, price: float | None, currency: str, who: str | None, address: str) -> bool:
    price_text = f" ({_money(price, currency)})" if price else ""
    return alert(
        "plan_click",
        f"👀 Plan click: {plan_label}{price_text}",
        [f"By: {who or 'visitor (not signed in)'}", f"From: {address}" if address and not who else ""],
        key=f"{who or address}:{plan_label}",
    )


def checkout_started(
    order: Any, email: str, plan_label: str, provider_label: str, currency: str, *, reused: bool
) -> bool:
    what = f"{plan_label} subscription" if order.kind == "subscription" else f"Top-up on {plan_label}"
    return alert(
        "checkout",
        f"🛒 Checkout {'re-opened' if reused else 'started'}: {what}",
        [
            f"Amount: {_money(order.amount_usd, currency)} ({order.tokens:,} tokens)",
            f"Customer: {email}",
            f"Pay with: {provider_label}",
            f"Order: {order_ref(order)}",
        ],
        key=f"{email}:{order.kind}:{order.plan_id}:{order.amount_usd:g}",
    )


def paid(order: Any, email: str, plan_label: str, currency: str, source: str) -> bool:
    what = f"{plan_label} subscription" if order.kind == "subscription" else f"Top-up on {plan_label}"
    return alert(
        "paid",
        f"✅ PAID {_money(order.amount_usd, currency)}: {what}",
        [
            f"Customer: {email}",
            f"Tokens: {order.tokens:,}",
            f"Confirmed by: {source}",
            f"Order: {order_ref(order)}",
        ],
        key=f"order:{order.id}",
        priority="high",
    )


def needs_review(order: Any, email: str | None, reason: str) -> bool:
    return alert(
        "review",
        "⚠️ Payment needs a look",
        [
            f"Order: {order_ref(order)} ({_money(order.amount_usd, 'USD')})",
            f"Customer: {email or 'unknown'}",
            f"Why: {reason}",
        ],
        key=f"review:{order.id}:{reason}",
        priority="high",
    )


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------

router = APIRouter(tags=["notify"])


class PlanClickIn(BaseModel):
    plan_id: str = Field(min_length=1, max_length=32)


def _visitor_address(request: Request) -> str:
    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    if forwarded.strip():
        return forwarded.split(",", 1)[0].strip()[:64]
    return request.client.host if request.client else ""


def _click_allowed(address: str) -> bool:
    now = time.monotonic()
    with _lock:
        if len(_clicks) > 5000:
            _clicks.clear()
        times = _clicks.setdefault(address or "?", deque())
        while times and now - times[0] > CLICK_WINDOW:
            times.popleft()
        if len(times) >= CLICKS_PER_ADDRESS:
            return False
        times.append(now)
    return True


@router.post("/api/v1/notify/plan-click", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def plan_click_route(
    payload: PlanClickIn,
    request: Request,
    user: User | None = Depends(optional_user),
    db: Session = Depends(get_db),
) -> Response:
    """The landing pricing card's Choose button reports its click here. Always 204."""

    if not enabled() or not event_on("plan_click"):
        return Response(status_code=204)
    address = _visitor_address(request)
    if not _click_allowed(address):
        return Response(status_code=204)
    from .app_settings import currency
    from .tokens import get_token_plans

    plan = get_token_plans(db).get(payload.plan_id)
    if plan is None:
        return Response(status_code=204)
    plan_click(plan.label, plan.price, currency(db), user.email if user else None, address)
    return Response(status_code=204)


class NotifyStatus(BaseModel):
    channels: list[str]
    events: list[str]


class NotifyTest(BaseModel):
    results: dict[str, str]


@router.get("/api/v1/admin/notify", response_model=NotifyStatus)
def notify_status(_: User = Depends(require_admin)) -> NotifyStatus:
    return NotifyStatus(channels=channels(), events=[e for e in EVENTS if event_on(e)])


@router.post("/api/v1/admin/notify/test", response_model=NotifyTest)
def notify_test(admin: User = Depends(require_admin)) -> NotifyTest:
    """Send one test alert right away, so the owner can see it reach the phone."""

    if not enabled():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone alerts are not set up. Add the Telegram or ntfy variables on the api service.",
        )
    results = deliver(
        "🔔 Test alert from BluCloacking",
        [f"Sent by {admin.email}.", "Plan clicks, checkouts and payments will arrive here."],
    )
    return NotifyTest(results=results)
