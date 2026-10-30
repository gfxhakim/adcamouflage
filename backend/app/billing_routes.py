"""Checkout, provider callbacks and order endpoints for token billing.

A purchase is an ``Order`` row paid through one of two providers. With
BTCPay the API creates an invoice and the customer pays on BTCPay's checkout
page; the webhook settles the order, and the order poll settles it too if
the webhook was missed. With Volet the customer's browser posts a signed
form (served by the pay page below) to Volet's hosted checkout, and Volet's
status notification settles the order. Either way the customer comes back
to /app/plan?order=<id>, and every settlement goes through
``tokens.settle_order`` so an order is applied once.
"""

from __future__ import annotations

import html
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import btcpay, volet
from .accounts import current_user
from .activity import log_activity
from .app_settings import currency
from .config import settings
from .db import Order, User, get_db
from .plans import aware
from .tokens import (
    get_token_plans,
    get_topups,
    new_order,
    settle_order,
    subscription_active,
    topup_bonus,
    topup_tokens,
    void_order,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

ORDER_KINDS = ("subscription", "topup")
# Payment providers in the order the plan page offers them; whichever are
# set up appear, and the first one is the default.
BTCPAY = "btcpay"
PROVIDERS = (BTCPAY, volet.PROVIDER)
PROVIDER_LABELS = {BTCPAY: "Crypto wallet (BTCPay)", volet.PROVIDER: "Volet"}
# BTCPay event types the webhook knows about; anything else is acknowledged and ignored.
SETTLED_EVENT = "InvoiceSettled"
VOID_EVENTS = {"InvoiceExpired": "expired", "InvoiceInvalid": "invalid"}
KNOWN_EVENTS = {
    SETTLED_EVENT,
    "InvoiceProcessing",
    "InvoiceExpired",
    "InvoiceInvalid",
    "InvoicePaymentSettled",
    "InvoiceReceivedPayment",
}
ORDER_HISTORY = 50
# The order poll asks BTCPay about a pending invoice at most this often; the
# client polls every few seconds and the webhook is the normal path anyway.
POLL_EVERY = timedelta(seconds=10)
# A repeated checkout for the same thing reuses the open order instead of
# leaving a trail of them; a little before a BTCPay invoice would expire a
# new one is made (a Volet order has no expiry, but follows the same window).
REUSE_WINDOW = timedelta(minutes=btcpay.INVOICE_EXPIRY_MINUTES - 5)


class CheckoutIn(BaseModel):
    kind: str = Field(pattern="^(subscription|topup)$")
    plan_id: str | None = Field(default=None, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=100_000)
    # Left out means the first provider that is set up.
    provider: str | None = Field(default=None, pattern="^(btcpay|volet)$")


class CheckoutOut(BaseModel):
    order_id: str
    checkout_url: str
    amount: float
    tokens: int
    provider: str


class OrderOut(BaseModel):
    id: str
    kind: str
    plan_id: str
    amount: float
    tokens: int
    status: str
    provider: str
    checkout_url: str | None
    created_at: datetime
    paid_at: datetime | None


class SubscriptionState(BaseModel):
    cancelled: bool
    period_end: datetime | None


def available_providers() -> list[str]:
    """The providers the owner has set up, in the order the plan page offers them."""

    ready = {BTCPAY: btcpay.configured, volet.PROVIDER: volet.configured}
    return [provider for provider in PROVIDERS if ready[provider]()]


def provider_label(provider: str) -> str:
    return PROVIDER_LABELS.get(provider, provider)


def _resolve_provider(requested: str | None) -> str:
    """The provider to charge through: the one asked for, else the first one set up."""

    available = available_providers()
    if not available:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payments are not set up yet.")
    if requested is None:
        return available[0]
    if requested not in available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="That payment method is not set up."
        )
    return requested


def _order_out(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        kind=order.kind,
        plan_id=order.plan_id,
        amount=order.amount_usd,
        tokens=order.tokens,
        status=order.status,
        provider=order.provider,
        checkout_url=order.checkout_url,
        created_at=order.created_at,
        paid_at=order.paid_at,
    )


def _open_order(db: Session, user: User, kind: str, plan_id: str, amount: float, provider: str) -> Order | None:
    """The user's pending order for the same purchase through the same provider that can still be paid, if any."""

    # A BTCPay order is only usable once its invoice exists and a Volet order
    # once its pay page is linked. Both are set right after the row is made,
    # so this skips an order an outage left half-made.
    ready = Order.btcpay_invoice_id.is_not(None) if provider == BTCPAY else Order.checkout_url.is_not(None)
    since = datetime.now(timezone.utc) - REUSE_WINDOW
    return db.execute(
        select(Order)
        .where(
            Order.user_id == user.id,
            Order.status == "pending",
            Order.kind == kind,
            Order.plan_id == plan_id,
            Order.amount_usd == float(amount),
            Order.provider == provider,
            ready,
            Order.created_at >= since,
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _public_base(request: Request) -> str:
    """The site origin to send the customer back to: the configured one, else what the browser says."""

    base = settings.public_url.strip().rstrip("/")
    if not base:
        origin = request.headers.get("origin") or ""
        referer = request.headers.get("referer") or ""
        if origin:
            base = origin.rstrip("/")
        elif referer.startswith("http"):
            scheme, _, rest = referer.partition("://")
            base = f"{scheme}://{rest.split('/', 1)[0]}"
    return base


def _redirect_url(request: Request, order_id: str) -> str:
    return f"{_public_base(request)}/app/plan?order={order_id}"


def _pay_path(order_id: str) -> str:
    # Relative on purpose: the web app proxies /api to this service, so the
    # same link works from the plan page and from the order history.
    return f"/api/v1/billing/orders/{order_id}/pay"


@router.post("/checkout", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
def checkout(
    payload: CheckoutIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> CheckoutOut:
    provider = _resolve_provider(payload.provider)

    plans = get_token_plans(db)
    if payload.kind == "subscription":
        plan = plans.get(payload.plan_id or "")
        if plan is None:
            raise HTTPException(status_code=422, detail="Choose one of the plans: Starter, Pro or Max.")
        amount = plan.price
        tokens = plan.tokens
        bonus = 0
    else:
        if not subscription_active(user) or user.sub_plan not in plans:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Top-ups need an active subscription. Subscribe or renew first.",
            )
        plan = plans[user.sub_plan]
        topups = get_topups(db)
        amount_int = int(payload.amount) if payload.amount is not None else 0
        if payload.amount is None or amount_int != payload.amount or amount_int not in topups["amounts"]:
            allowed = ", ".join(f"${a}" for a in topups["amounts"])
            raise HTTPException(status_code=422, detail=f"Top-up amounts are {allowed}.")
        amount = float(amount_int)
        tokens = topup_tokens(plan, amount_int, topups)
        bonus = topup_bonus(plan, amount_int, topups)

    existing = _open_order(db, user, payload.kind, plan.id, amount, provider)
    if existing is not None:
        return CheckoutOut(
            order_id=existing.id,
            checkout_url=existing.checkout_url or "",
            amount=amount,
            tokens=existing.tokens,
            provider=existing.provider,
        )

    order = new_order(
        db, user, payload.kind, plan, amount, tokens, bonus=bonus if payload.kind == "topup" else 0, provider=provider
    )
    what = f"{plan.label} period" if order.kind == "subscription" else f"${amount:g} top-up on {plan.label}"
    if provider == volet.PROVIDER:
        # The signed form is built when the customer opens the pay page, so
        # nothing has to be asked of Volet here.
        order.checkout_url = _pay_path(order.id)
        db.commit()
        logger.info("Volet checkout started for order %s", order.id)
        log_activity(db, user.id, "checkout", f"Started Volet checkout for {what} (${amount:g})")
        return CheckoutOut(order_id=order.id, checkout_url=order.checkout_url, amount=amount, tokens=tokens, provider=provider)

    try:
        invoice_id, checkout_url = btcpay.create_invoice(
            order_id=order.id,
            user_id=user.id,
            kind=order.kind,
            plan_id=plan.id,
            amount=amount,
            currency=currency(db),
            redirect_url=_redirect_url(request, order.id),
        )
    except btcpay.BTCPayError as exc:
        # The pending order without an invoice is harmless; nothing was charged.
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    order.btcpay_invoice_id = invoice_id
    order.checkout_url = checkout_url
    db.commit()
    log_activity(db, user.id, "checkout", f"Started checkout for {what} (${amount:g})")
    return CheckoutOut(order_id=order.id, checkout_url=checkout_url, amount=amount, tokens=tokens, provider=provider)


# --------------------------------------------------------------------------
# Volet: pay page and status notification
# --------------------------------------------------------------------------


def _payment_page(fields: Mapping[str, str], summary: str) -> str:
    """A minimal page that posts the signed form to Volet as soon as it loads."""

    inputs = "\n".join(
        f'<input type="hidden" name="{html.escape(name)}" value="{html.escape(value)}">'
        for name, value in fields.items()
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Taking you to Volet…</title>
<style>
body {{ margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
       font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }}
main {{ max-width: 28rem; padding: 2rem; text-align: center; }}
button {{ margin-top: 1rem; padding: 0.75rem 1.5rem; font: inherit; border: 0; border-radius: 0.5rem;
          background: #0f172a; color: #ffffff; cursor: pointer; }}
</style>
</head>
<body>
<main>
<h1>Taking you to Volet…</h1>
<p>{html.escape(summary)}</p>
<form method="POST" action="{html.escape(settings.volet_sci_url)}">
{inputs}
<button type="submit">Continue to Volet</button>
</form>
<p>If nothing happens in a moment, press the button.</p>
</main>
<script>document.forms[0].submit()</script>
</body>
</html>
"""


@router.get("/orders/{order_id}/pay", response_class=HTMLResponse)
def pay_order(
    order_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """The page that sends a Volet order to Volet: a signed form the browser submits on load.

    Volet's checkout starts from the customer's browser, not from a server
    call, so the plan page sends the customer here and this page posts the
    form for them, with a button for a browser that blocks the script. The
    page is never cached: the signature is bound to the order and the amount.
    """

    order = db.get(Order, order_id)
    if order is None or order.user_id != user.id or order.provider != volet.PROVIDER:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This order is no longer open for payment.")
    if not volet.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="That payment method is not set up."
        )

    plan = get_token_plans(db).get(order.plan_id)
    label = plan.label if plan else order.plan_id
    what = f"{label} period" if order.kind == "subscription" else f"${order.amount_usd:g} top-up on {label}"
    base = _public_base(request)
    try:
        fields = volet.payment_fields(
            order=order,
            currency=currency(db),
            success_url=f"{base}/app/plan?order={order.id}",
            fail_url=f"{base}/app/plan?order={order.id}&cancelled=1",
            status_url=f"{base}/api/v1/billing/volet/status",
            comment=f"{settings.app_name}: {what}",
        )
    except volet.VoletError as exc:
        logger.warning("Volet pay page for order %s could not be built: %s", order.id, exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    page = _payment_page(fields, summary=f"{what}: {fields['ac_amount']} {fields['ac_currency']}")
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


async def _notification_fields(request: Request) -> dict[str, str]:
    """The ``ac_*`` fields of a notification, from the form body or the query string.

    Volet sends them by the method chosen on the gateway (the form asks for
    POST, but the account's own setting wins), so both are read; a form
    field beats a query one of the same name.
    """

    fields = {key: value for key, value in request.query_params.items()}
    if request.method == "POST":
        form = await request.form()
        fields.update({key: value for key, value in form.items() if isinstance(value, str)})
    return fields


def _sender_address(request: Request) -> str:
    """The address a notification came from, as the proxy in front of this service saw it.

    The service is only reached through one proxy that terminates the
    connection: Railway's edge (the web service's /api rewrite passes the
    headers through unchanged) or the Caddy in docker-compose.prod. That proxy
    writes the peer it accepted as the LAST entry of X-Forwarded-For; earlier
    entries, and ``request.client`` under uvicorn's ``--forwarded-allow-ips
    '*'`` (which takes the first entry), can be chosen by the sender, so they
    are not used. Without the header the socket peer is the sender.
    """

    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    if forwarded.strip():
        return forwarded.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else ""


def _notification_mismatch(db: Session, order: Order, fields: Mapping[str, str]) -> str | None:
    """Why a correctly signed notification must still not settle this order, or None.

    The hash proves Volet sent it, not that it is about what the customer was
    quoted: a notification for another gateway, or for a different amount or
    currency, is set aside and left for the owner to look at.
    """

    if order.provider != volet.PROVIDER:
        return "it is not a Volet order"
    if (fields.get("ac_sci_name") or "") != volet.sci_name():
        return "the gateway name differs"
    try:
        amount = float(fields.get("ac_amount") or "")
    except ValueError:
        amount = math.nan
    same_currency = (fields.get("ac_merchant_currency") or "").upper() == currency(db).upper()
    if not same_currency or not (abs(amount - order.amount_usd) < 0.005):
        return "amount or currency differs"
    return None


@router.api_route("/volet/status", methods=["GET", "POST"], response_class=PlainTextResponse)
async def volet_status(request: Request, db: Session = Depends(get_db)) -> PlainTextResponse:
    """Receive Volet's status notification. Hashed with the SCI password over the listed fields.

    Two checks of who sent it: the hash, which proves the fields were made
    with the SCI password, and the sender's address against the ones Volet
    sends from (``ADCAM_VOLET_NOTIFY_IPS``), because the hash does not cover
    the status field (see ``volet.sender_allowed``). A well-formed
    notification is always answered ``OK``: the spec names no required
    reply, and a non-2xx would only make Volet retry something that was
    looked at and set aside on purpose. A repeated COMPLETED is a no-op
    through ``settle_order``'s atomic claim. Every notification leaves a log
    line, with the order id once there is one, so the deploy log tells the
    owner what arrived and what was done with it.
    """

    if not volet.configured():
        logger.warning("Volet notification refused: Volet is not set up on this service")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="That payment method is not set up."
        )
    sender = _sender_address(request)
    if not volet.sender_allowed(sender):
        logger.warning("Volet notification from %s refused: not one of Volet's addresses", sender or "(unknown)")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Notifications are accepted from Volet's addresses only."
        )
    fields = await _notification_fields(request)
    # Volet's order ids are the app's own (32 hex characters); the slice keeps a stray value out of the log.
    order_id = (fields.get("ac_order_id") or "")[:64]
    if not volet.verify_status(fields):
        logger.warning("Volet notification for order %s refused: bad hash", order_id or "(none)")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad notification hash.")

    order = db.get(Order, order_id) if order_id else None
    if order is None:
        logger.info("Volet notification for an unknown order %s", order_id)
        return PlainTextResponse("OK")

    reason = _notification_mismatch(db, order, fields)
    if reason:
        logger.warning("Volet notification for order %s ignored: %s", order.id, reason)
        log_activity(db, order.user_id, "payment", f"Volet notification for order {order.id} ignored: {reason}")
        return PlainTextResponse("OK")

    state = (fields.get("ac_transaction_status") or "").upper()
    logger.info("Volet notification for order %s: %s", order.id, state or "(no status)")
    if state == volet.COMPLETED:
        # Kept before the claim so even a settlement that fails leaves a
        # trace of which Volet transaction it was.
        order.provider_ref = (fields.get("ac_transfer") or "")[:128] or None
        db.commit()
        settle_order(db, order, source="Volet")
    elif state == volet.CANCELED:
        void_order(db, order, "expired")
    # PENDING and PROCESS mean the money is still on its way: nothing to do yet.
    return PlainTextResponse("OK")


# --------------------------------------------------------------------------
# BTCPay webhook
# --------------------------------------------------------------------------


def _order_for_event(db: Session, event: dict[str, Any]) -> Order | None:
    invoice_id = str(event.get("invoiceId") or "")
    if invoice_id:
        order = db.execute(select(Order).where(Order.btcpay_invoice_id == invoice_id)).scalar_one_or_none()
        if order is not None:
            return order
    metadata = event.get("metadata") or {}
    order_id = str(metadata.get("orderId") or "") if isinstance(metadata, dict) else ""
    return db.get(Order, order_id) if order_id else None


@router.post("/btcpay/webhook")
async def btcpay_webhook(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """Receive BTCPay's invoice events. Signed with the webhook secret over the raw body."""

    raw = await request.body()
    if not btcpay.verify_signature(raw, request.headers.get(btcpay.SIGNATURE_HEADER)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad webhook signature.")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="The webhook body is not JSON.")
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="The webhook body is not an event.")

    event_type = str(event.get("type") or "")
    if event_type not in KNOWN_EVENTS:
        return JSONResponse({"ok": True, "ignored": event_type})

    order = _order_for_event(db, event)
    if order is None:
        logger.info("BTCPay %s for an unknown invoice %s", event_type, event.get("invoiceId"))
        return JSONResponse({"ok": True, "ignored": "unknown order"})

    if event_type == SETTLED_EVENT:
        # Also credits an order already marked expired or invalid: BTCPay only
        # sends this once the owner's own server has confirmed the payment.
        applied = settle_order(db, order, source="BTCPay")
        return JSONResponse({"ok": True, "applied": applied})
    if event_type in VOID_EVENTS:
        void_order(db, order, VOID_EVENTS[event_type])
    return JSONResponse({"ok": True})


# --------------------------------------------------------------------------
# orders
# --------------------------------------------------------------------------


def _settle_from_btcpay(db: Session, order: Order) -> None:
    """Ask BTCPay whether a pending order has been paid, in case the webhook was missed.

    Only for BTCPay orders: a Volet order is settled by its status
    notification alone. Throttled per order so a client looping the poll
    cannot keep a worker busy on outbound calls; ``settle_order`` claims the
    order atomically, so a webhook that lands during the round trip wins and
    this is a no-op.
    """

    if order.provider != BTCPAY or order.status != "pending" or not order.btcpay_invoice_id:
        return
    if not btcpay.configured():
        return
    now = datetime.now(timezone.utc)
    checked = aware(order.checked_at)
    if checked is not None and now - checked < POLL_EVERY:
        return
    order.checked_at = now
    db.commit()
    try:
        invoice = btcpay.get_invoice(order.btcpay_invoice_id)
    except btcpay.BTCPayError:
        return  # the next poll will try again
    db.refresh(order)
    state = str(invoice.get("status") or "")
    if state == "Settled":
        settle_order(db, order, source="BTCPay poll")
    elif state == "Expired":
        void_order(db, order, "expired")
    elif state == "Invalid":
        void_order(db, order, "invalid")


@router.get("/orders", response_model=list[OrderOut])
def my_orders(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[OrderOut]:
    rows = (
        db.execute(
            select(Order)
            .where(Order.user_id == user.id)
            .order_by(Order.created_at.desc())
            .limit(ORDER_HISTORY)
        )
        .scalars()
        .all()
    )
    return [_order_out(row) for row in rows]


@router.get("/orders/{order_id}", response_model=OrderOut)
def order_status(order_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> OrderOut:
    order = db.get(Order, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    _settle_from_btcpay(db, order)
    return _order_out(order)


# --------------------------------------------------------------------------
# cancel / resume
# --------------------------------------------------------------------------


@router.post("/cancel", response_model=SubscriptionState)
def cancel_subscription(user: User = Depends(current_user), db: Session = Depends(get_db)) -> SubscriptionState:
    """Stop at the end of the paid period. Access continues until then; the next purchase gets no rollover."""

    if not subscription_active(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no active subscription to cancel.")
    if user.sub_cancelled_at is None:
        user.sub_cancelled_at = datetime.now(timezone.utc)
        db.commit()
        log_activity(db, user.id, "subscription", f"Cancelled the {user.sub_plan} subscription")
    return SubscriptionState(cancelled=True, period_end=user.sub_period_end)


@router.post("/resume", response_model=SubscriptionState)
def resume_subscription(user: User = Depends(current_user), db: Session = Depends(get_db)) -> SubscriptionState:
    if not subscription_active(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no active subscription to resume.")
    if user.sub_cancelled_at is not None:
        user.sub_cancelled_at = None
        db.commit()
        log_activity(db, user.id, "subscription", f"Resumed the {user.sub_plan} subscription")
    return SubscriptionState(cancelled=False, period_end=user.sub_period_end)
