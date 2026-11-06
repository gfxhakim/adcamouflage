"""Approve or reject a payment from the Telegram alert itself.

The 🛒 checkout and ⚠️ needs-a-look alerts carry two buttons, **Approve**
and **Reject**. Pressing one asks again (**Yes, activate** / **Back**), so a
slip of the thumb changes nothing. **Yes, activate** settles the order
through ``tokens.settle_order``: the very same code the payment
notifications and the admin grant use, so the plan or top-up is applied
exactly once, the activity log gets a line, Meta gets its Purchase event
and the ✅ PAID alert follows. **Yes, reject** marks a pending order
invalid; a payment the provider confirms later is still applied (see
``tokens.SETTLEABLE``).

Who can press: Telegram calls ``POST /api/v1/notify/telegram`` for every
press. A press is acted on only when

1. the request carries the webhook secret Telegram was given when the
   buttons were connected (``X-Telegram-Bot-Api-Secret-Token``),
2. the message it came from is in the configured alert chat, and the person
   who pressed is an allowed approver (the owner of a private chat, or the
   ids in ``ADCAM_NOTIFY_TELEGRAM_APPROVER_IDS``), and
3. the button's data carries a valid signature for that order and action,
   so a made-up button cannot name another order.

Everything else is answered "not allowed" and changes nothing. Approving an
order that is already paid is a no-op ("already active").
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import notify
from .accounts import require_admin
from .activity import log_activity
from .config import settings
from .db import Order, User, get_db

logger = logging.getLogger(__name__)

WEBHOOK_PATH = "/api/v1/notify/telegram"
SECRET_HEADER = "x-telegram-bot-api-secret-token"
TIMEOUT = 8.0

# Button actions: ask first, then do.
ASK_APPROVE, ASK_REJECT, BACK, DO_APPROVE, DO_REJECT = "a", "r", "b", "A", "R"
ACTIONS = {ASK_APPROVE, ASK_REJECT, BACK, DO_APPROVE, DO_REJECT}
SIG_LEN = 16


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------


def _token() -> str:
    value = settings.notify_telegram_bot_token
    return value.get_secret_value().strip() if value is not None else ""


def buttons_on() -> bool:
    return bool(settings.notify_telegram_buttons and notify.telegram_ready())


def webhook_secret() -> str:
    """What Telegram must send back with every press. Derived from the bot token unless set."""

    override = settings.notify_telegram_webhook_secret
    if override is not None and override.get_secret_value().strip():
        return override.get_secret_value().strip()
    # Telegram allows A-Z a-z 0-9 _ - here; a hex digest fits.
    return hmac.new(_token().encode(), b"adcam-telegram-webhook", hashlib.sha256).hexdigest()


def approvers() -> set[str]:
    chosen = {entry.strip() for entry in settings.notify_telegram_approver_ids if entry.strip()}
    if chosen:
        return chosen
    chat = settings.notify_telegram_chat_id.strip()
    # In a private chat the chat id is the person's own user id.
    return {chat} if chat.isdigit() else set()


def webhook_url() -> str:
    base = settings.public_url.strip().rstrip("/")
    return f"{base}{WEBHOOK_PATH}" if base else ""


# --------------------------------------------------------------------------
# buttons
# --------------------------------------------------------------------------


def _sign(action: str, order_id: str) -> str:
    key = hashlib.sha256(b"adcam-telegram-buttons:" + _token().encode()).digest()
    return hmac.new(key, f"{action}:{order_id}".encode(), hashlib.sha256).hexdigest()[:SIG_LEN]


def _data(action: str, order_id: str) -> str:
    # Telegram caps callback data at 64 bytes: 1 + 1 + 32 + 1 + 16 = 51.
    return f"{action}:{order_id}:{_sign(action, order_id)}"


def _parse(data: str) -> tuple[str, str] | None:
    parts = (data or "").split(":")
    if len(parts) != 3:
        return None
    action, order_id, sig = parts
    if action not in ACTIONS or not order_id or len(order_id) > 64:
        return None
    if not hmac.compare_digest(sig, _sign(action, order_id)):
        return None
    return action, order_id


def _button(text: str, action: str, order_id: str) -> dict[str, str]:
    return {"text": text, "callback_data": _data(action, order_id)}


def order_buttons(order: Any) -> list[list[dict]] | None:
    """The first row under an alert for an unpaid order: Approve / Reject."""

    if not buttons_on() or getattr(order, "status", "pending") == "paid":
        return None
    return [[_button("✅ Approve", ASK_APPROVE, order.id), _button("❌ Reject", ASK_REJECT, order.id)]]


def _confirm_buttons(action: str, order: Order) -> list[list[dict]]:
    if action == ASK_APPROVE:
        yes = _button("✅ Yes, activate", DO_APPROVE, order.id)
    else:
        yes = _button("❌ Yes, reject", DO_REJECT, order.id)
    return [[yes, _button("↩️ Back", BACK, order.id)]]


# --------------------------------------------------------------------------
# talking to Telegram
# --------------------------------------------------------------------------


def _call(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Call one Bot API method. Never logs the token (it is in the URL)."""

    response = httpx.post(f"https://api.telegram.org/bot{_token()}/{method}", json=payload, timeout=TIMEOUT)
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400 or not body.get("ok", False):
        raise RuntimeError(f"Telegram {method} answered {response.status_code}: {str(body.get('description', ''))[:200]}")
    return body


def _try(method: str, payload: dict[str, Any]) -> None:
    try:
        _call(method, payload)
    except Exception as exc:  # noqa: BLE001 - the action itself is already done
        logger.warning("Telegram %s failed: %s", method, exc)


def webhook_state() -> tuple[str, str]:
    """For the admin card: off | not_connected | connected | unknown, plus a detail line."""

    if not buttons_on():
        return "off", ""
    try:
        info = _call("getWebhookInfo", {}).get("result", {})
    except Exception as exc:  # noqa: BLE001
        return "unknown", str(exc)[:200]
    url = info.get("url", "")
    expected = webhook_url()
    if url and expected and url == expected:
        error = info.get("last_error_message") or ""
        return "connected", f"Last error: {error}" if error else ""
    if url:
        return "not_connected", "The bot sends presses to another address. Press Connect buttons."
    return "not_connected", ""


# --------------------------------------------------------------------------
# the press
# --------------------------------------------------------------------------


def _when() -> str:
    return datetime.now(timezone.utc).strftime("%d %b %H:%M UTC")


def _describe(db: Session, order: Order) -> tuple[User | None, str]:
    from .tokens import get_token_plans

    user = db.get(User, order.user_id)
    plan = get_token_plans(db).get(order.plan_id)
    label = plan.label if plan else order.plan_id
    what = f"{label} subscription" if order.kind == "subscription" else f"${order.amount_usd:g} top-up on {label}"
    return user, what


def _approve(db: Session, order: Order, presser: str) -> str:
    from .tokens import SETTLEABLE, settle_order

    if order.status == "paid":
        return "Already active. Nothing changed."
    if order.status not in SETTLEABLE:
        return f"This order is {order.status} and cannot be activated here."
    user, what = _describe(db, order)
    applied = settle_order(db, order, source="approved in Telegram", note="approved in Telegram")
    if not applied:
        db.refresh(order)
        return "Already active. Nothing changed." if order.status == "paid" else "Could not activate this order."
    if user is not None:
        log_activity(db, user.id, "admin", f"Order {notify.order_ref(order)} approved in Telegram by {presser}")
    logger.info("Order %s approved in Telegram by %s", order.id, presser)
    return f"✅ Activated: {what} for {user.email if user else 'the customer'} · {_when()}"


def _reject(db: Session, order: Order, presser: str) -> str:
    from .tokens import void_order

    if order.status == "paid":
        return "Already paid and active. Rejecting is not possible here; use Admin to change the plan."
    if order.status != "pending":
        return f"Already {order.status}. Nothing changed."
    if not void_order(db, order, "invalid"):
        return "Could not reject this order."
    log_activity(db, order.user_id, "payment", f"Order {notify.order_ref(order)} rejected in Telegram by {presser}")
    logger.info("Order %s rejected in Telegram by %s", order.id, presser)
    return f"❌ Rejected · {_when()}"


def _edit(message: dict[str, Any], *, buttons: list[list[dict]] | None, status_line: str | None = None) -> None:
    chat_id = (message.get("chat") or {}).get("id")
    message_id = message.get("message_id")
    if chat_id is None or message_id is None:
        return
    markup = {"inline_keyboard": buttons or []}
    if status_line:
        text = f"{message.get('text', '')}\n\n{status_line}"[:4096]
        _try("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": text, "reply_markup": markup})
    else:
        _try("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": message_id, "reply_markup": markup})


def _answer(callback_id: str, text: str, *, alert: bool = False) -> JSONResponse:
    # Telegram accepts one Bot API call as the webhook's reply, which saves a round trip.
    return JSONResponse(
        {"method": "answerCallbackQuery", "callback_query_id": callback_id, "text": text[:190], "show_alert": alert}
    )


router = APIRouter(tags=["notify"])


@router.post(WEBHOOK_PATH)
def telegram_webhook(
    request: Request,
    update: Any = Body(default=None),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Telegram delivers button presses here. Only the owner's presses do anything."""

    if not buttons_on():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    given = request.headers.get(SECRET_HEADER, "")
    if not given or not hmac.compare_digest(given, webhook_secret()):
        logger.warning("Telegram webhook refused: wrong or missing secret")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad secret.")
    query = update.get("callback_query") if isinstance(update, dict) else None
    if not isinstance(query, dict):
        return JSONResponse({})  # a plain message to the bot: nothing to do
    callback_id = str(query.get("id", ""))
    message = query.get("message") or {}
    chat_id = str((message.get("chat") or {}).get("id", ""))
    presser_id = str((query.get("from") or {}).get("id", ""))
    if chat_id != settings.notify_telegram_chat_id.strip() or presser_id not in approvers():
        logger.warning("Telegram button press refused: user %s in chat %s is not allowed", presser_id, chat_id)
        return _answer(callback_id, "Not allowed.", alert=True)
    parsed = _parse(str(query.get("data", "")))
    if parsed is None:
        logger.warning("Telegram button press refused: bad button data")
        return _answer(callback_id, "This button is not valid any more.", alert=True)
    action, order_id = parsed
    order = db.get(Order, order_id)
    if order is None:
        _edit(message, buttons=None, status_line="Order not found.")
        return _answer(callback_id, "Order not found.", alert=True)

    presser = f"Telegram user {presser_id}"
    if action in (ASK_APPROVE, ASK_REJECT):
        if order.status == "paid":
            _edit(message, buttons=None, status_line="Already paid and active.")
            return _answer(callback_id, "Already paid and active.")
        _edit(message, buttons=_confirm_buttons(action, order))
        return _answer(callback_id, "Activate this order?" if action == ASK_APPROVE else "Reject this order?")
    if action == BACK:
        _edit(message, buttons=order_buttons(order))
        return _answer(callback_id, "OK")
    result = _approve(db, order, presser) if action == DO_APPROVE else _reject(db, order, presser)
    _edit(message, buttons=None, status_line=result)
    return _answer(callback_id, result, alert=not result.startswith(("✅", "❌")))


# --------------------------------------------------------------------------
# admin: connect the buttons
# --------------------------------------------------------------------------


class ConnectOut(BaseModel):
    telegram_buttons: str
    telegram_buttons_detail: str = ""


@router.post("/api/v1/admin/notify/telegram/connect", response_model=ConnectOut)
def connect_buttons(_: User = Depends(require_admin)) -> ConnectOut:
    """Tell Telegram where to send button presses (setWebhook) with the secret."""

    if not notify.telegram_ready():
        raise HTTPException(status_code=409, detail="Telegram alerts are not set up on the api service.")
    if not settings.notify_telegram_buttons:
        raise HTTPException(status_code=409, detail="Buttons are switched off (ADCAM_NOTIFY_TELEGRAM_BUTTONS=false).")
    url = webhook_url()
    if not url.startswith("https://"):
        raise HTTPException(
            status_code=409, detail="Set ADCAM_PUBLIC_URL to your https site address on the api service first."
        )
    if not approvers():
        raise HTTPException(
            status_code=409,
            detail="The alert chat is a group: set ADCAM_NOTIFY_TELEGRAM_APPROVER_IDS to who may press the buttons.",
        )
    try:
        _call(
            "setWebhook",
            {
                "url": url,
                "secret_token": webhook_secret(),
                "allowed_updates": ["callback_query"],
                "drop_pending_updates": True,
                "max_connections": 5,
            },
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)[:300]) from exc
    state, detail = webhook_state()
    return ConnectOut(telegram_buttons=state, telegram_buttons_detail=detail)

