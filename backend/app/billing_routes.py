"""Checkout, BTCPay webhook and order endpoints for token billing.

A purchase is an ``Order`` row plus a BTCPay invoice. The customer pays on
BTCPay's checkout page and comes back to /app/plan?order=<id>; the webhook
settles the order, and the order poll settles it too if the webhook was
missed. Both go through ``tokens.settle_order`` so an order is applied once.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import btcpay
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
# A repeated checkout for the same thing reuses the open invoice instead of
# leaving a trail of them; a little before expiry a new one is made.
REUSE_WINDOW = timedelta(minutes=btcpay.INVOICE_EXPIRY_MINUTES - 5)


class CheckoutIn(BaseModel):
    kind: str = Field(pattern="^(subscription|topup)$")
    plan_id: str | None = Field(default=None, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=100_000)


class CheckoutOut(BaseModel):
    order_id: str
    checkout_url: str
    amount: float
    tokens: int


class OrderOut(BaseModel):
    id: str
    kind: str
    plan_id: str
    amount: float
    tokens: int
    status: str
    checkout_url: str | None
    created_at: datetime
    paid_at: datetime | None


class SubscriptionState(BaseModel):
    cancelled: bool
    period_end: datetime | None


def _order_out(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        kind=order.kind,
        plan_id=order.plan_id,
        amount=order.amount_usd,
        tokens=order.tokens,
        status=order.status,
        checkout_url=order.checkout_url,
        created_at=order.created_at,
        paid_at=order.paid_at,
    )


def _open_order(db: Session, user: User, kind: str, plan_id: str, amount: float) -> Order | None:
    """The user's pending order for the same purchase whose invoice is still live, if any."""

    since = datetime.now(timezone.utc) - REUSE_WINDOW
    return db.execute(
        select(Order)
        .where(
            Order.user_id == user.id,
            Order.status == "pending",
            Order.kind == kind,
            Order.plan_id == plan_id,
            Order.amount_usd == float(amount),
            Order.btcpay_invoice_id.is_not(None),
            Order.created_at >= since,
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _redirect_url(request: Request, order_id: str) -> str:
    base = settings.public_url.strip().rstrip("/")
    if not base:
        origin = request.headers.get("origin") or ""
        referer = request.headers.get("referer") or ""
        if origin:
            base = origin.rstrip("/")
        elif referer.startswith("http"):
            scheme, _, rest = referer.partition("://")
            base = f"{scheme}://{rest.split('/', 1)[0]}"
    return f"{base}/app/plan?order={order_id}"


@router.post("/checkout", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
def checkout(
    payload: CheckoutIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> CheckoutOut:
    if not btcpay.configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payments are not set up yet.")

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

    existing = _open_order(db, user, payload.kind, plan.id, amount)
    if existing is not None:
        return CheckoutOut(
            order_id=existing.id, checkout_url=existing.checkout_url or "", amount=amount, tokens=existing.tokens
        )

    order = new_order(db, user, payload.kind, plan, amount, tokens, bonus=bonus if payload.kind == "topup" else 0)
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
    what = f"{plan.label} period" if order.kind == "subscription" else f"${amount:g} top-up on {plan.label}"
    log_activity(db, user.id, "checkout", f"Started checkout for {what} (${amount:g})")
    return CheckoutOut(order_id=order.id, checkout_url=checkout_url, amount=amount, tokens=tokens)


# --------------------------------------------------------------------------
# webhook
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

    Throttled per order so a client looping the poll cannot keep a worker
    busy on outbound calls; ``settle_order`` claims the order atomically, so
    a webhook that lands during the round trip wins and this is a no-op.
    """

    if order.status != "pending" or not order.btcpay_invoice_id or not btcpay.configured():
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
