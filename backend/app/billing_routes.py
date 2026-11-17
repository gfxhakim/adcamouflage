"""Checkout, Whop webhook callback, and order endpoints for token billing.

A purchase is an ``Order`` row paid through Whop Embedded Checkout.
``POST /api/v1/billing/checkout`` opens a pending ``Order`` and returns
``{order_id, whop_plan}`` so the browser can mount ``<WhopCheckout />`` with
``order_id`` attached in metadata. Once the customer pays, Whop sends
``payment.succeeded`` to ``POST /api/v1/billing/whop/webhook``, which verifies
the webhook signature and settles the order via ``tokens.settle_order`` so tokens
are applied at most once.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import affiliates, meta_capi, notify, whop
from .accounts import current_user
from .activity import log_activity
from .app_settings import currency
from .db import Order, User, get_db
from .tokens import (
    get_token_plans,
    get_topups,
    new_order,
    settle_order,
    subscription_active,
    topup_bonus,
    topup_tokens,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

ORDER_KINDS = ("subscription", "topup")
PROVIDERS = (whop.PROVIDER,)
PROVIDER_LABELS = {whop.PROVIDER: "Whop"}
ORDER_HISTORY = 50
# Repeating an identical unpaid checkout within this window reuses the open order.
REUSE_WINDOW = timedelta(minutes=55)


class CheckoutIn(BaseModel):
    kind: str = Field(pattern="^(subscription|topup)$")
    plan_id: str | None = Field(default=None, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=100_000)
    # Left out means the first provider that is set up.
    provider: str | None = Field(default=None, pattern="^whop$")
    # A friend's or creator's code typed at checkout (a link sets it at sign-up).
    coupon: str | None = Field(default=None, max_length=40)


class CheckoutOut(BaseModel):
    order_id: str
    whop_plan: str
    checkout_url: str = ""
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
    coupon_code: str | None = None
    discount: float = 0.0


class SubscriptionState(BaseModel):
    cancelled: bool
    period_end: datetime | None


def available_providers() -> list[str]:
    """The configured payment providers, in offer order."""

    return [whop.PROVIDER] if whop.configured() else []


def provider_label(provider: str) -> str:
    return PROVIDER_LABELS.get(provider, provider)


def _resolve_provider(requested: str | None) -> str:
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
        coupon_code=order.coupon_code,
        discount=order.discount_usd or 0.0,
    )


def _open_order(db: Session, user: User, kind: str, plan_id: str, amount: float, provider: str) -> Order | None:
    """The user's recent pending order for the same purchase, if any."""

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
            Order.created_at >= since,
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


@router.post("/checkout", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
def checkout(
    payload: CheckoutIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> CheckoutOut:
    from .teams import membership

    seat = membership(db, user)
    if seat is not None:
        owner = db.get(User, seat.owner_id)
        who = owner.email if owner else "the team owner"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You are on {who}'s team, so they manage the plan. Leave the team to buy your own.",
        )
    provider = _resolve_provider(payload.provider)

    plans = get_token_plans(db)
    if payload.kind == "subscription":
        plan = plans.get(payload.plan_id or "")
        if plan is None:
            raise HTTPException(status_code=422, detail="Choose one of the plans: Starter, Pro or Max.")
        amount = plan.price
        tokens = plan.tokens
        bonus = 0
        if payload.coupon and payload.coupon.strip():
            code = affiliates.find_code(db, payload.coupon)
            if code is None:
                raise HTTPException(status_code=422, detail="That code does not exist.")
            try:
                affiliates.attribute(
                    db,
                    user,
                    code,
                    source="coupon",
                    device=affiliates.device_hash(request.headers.get("x-device-id")),
                    ip=affiliates.ip_hash(meta_capi._client_ip(request)),
                )
            except affiliates.AttributionError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        # Coupons never stack: at most one, on the first subscription payment.
        coupon = affiliates.checkout_discount(db, user, plan.id, plan.price)
        if coupon is not None:
            amount = coupon["amount"]
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
        coupon = None

    try:
        whop_plan = whop.plan_id_for(payload.kind, plan.id, amount)
    except whop.WhopError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    existing = _open_order(db, user, payload.kind, plan.id, amount, provider)
    if existing is not None:
        notify.checkout_started(
            existing,
            user.email,
            plan.label,
            provider_label(provider),
            currency(db),
            reused=True,
            name=user.display_name,
        )
        try:
            fresh = meta_capi.refresh_checkout(request, existing)
            if fresh is not None:
                existing.tracking = fresh
                db.commit()
        except Exception:  # noqa: BLE001 - tracking must never block a checkout
            logger.exception("Meta tracking refresh for order %s failed", existing.id)
        return CheckoutOut(
            order_id=existing.id,
            whop_plan=whop_plan,
            checkout_url=existing.checkout_url or "",
            amount=amount,
            tokens=existing.tokens,
            provider=existing.provider,
        )

    order = new_order(
        db,
        user,
        payload.kind,
        plan,
        amount,
        tokens,
        bonus=bonus if payload.kind == "topup" else 0,
        provider=provider,
        coupon_code=coupon["code"] if coupon else None,
        discount=coupon["discount"] if coupon else 0.0,
    )
    what = f"{plan.label} period" if order.kind == "subscription" else f"${amount:g} top-up on {plan.label}"
    try:
        tracking = meta_capi.initiate_checkout(request, order, user.email, currency(db))
        order.tracking = json.dumps(tracking) if tracking else None
        db.commit()
    except Exception:  # noqa: BLE001 - tracking must never block a checkout
        logger.exception("Meta InitiateCheckout for order %s failed", order.id)
    notify.checkout_started(
        order, user.email, plan.label, provider_label(provider), currency(db), reused=False, name=user.display_name
    )
    logger.info("Whop checkout started for order %s (%s)", order.id, whop_plan)
    log_activity(db, user.id, "checkout", f"Started Whop checkout for {what} (${amount:g})")
    return CheckoutOut(
        order_id=order.id,
        whop_plan=whop_plan,
        checkout_url="",
        amount=amount,
        tokens=tokens,
        provider=provider,
    )


# --------------------------------------------------------------------------
# Whop webhook
# --------------------------------------------------------------------------


@router.post("/whop/webhook")
async def whop_webhook(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """Receive signed Whop Standard Webhooks events and settle paid orders."""

    raw = await request.body()
    try:
        event = whop.verify_webhook(raw, request.headers)
    except whop.WhopError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    etype = whop.event_type(event)
    if etype != whop.SETTLED_EVENT:
        return JSONResponse({"ok": True, "ignored": etype or "unknown event"})

    order_id = whop.order_id_from_event(event)
    order = db.get(Order, order_id) if order_id else None
    if order is None:
        logger.info("Whop %s for an unknown order %s", etype, order_id or "(missing)")
        return JSONResponse({"ok": True, "ignored": "unknown order"})

    if order.provider != whop.PROVIDER:
        logger.warning("Whop webhook for order %s ignored: provider is %s", order.id, order.provider)
        return JSONResponse({"ok": True, "ignored": "wrong provider"})

    paid_plan = whop.plan_id_from_event(event)
    if paid_plan:
        try:
            expected_plan = whop.plan_id_for(order.kind, order.plan_id, order.amount_usd)
        except whop.WhopError:
            expected_plan = ""
        if expected_plan and paid_plan != expected_plan:
            logger.warning("Whop webhook for order %s ignored: plan mismatch (%s != %s)", order.id, paid_plan, expected_plan)
            log_activity(db, order.user_id, "payment", f"Whop webhook for order {order.id} ignored: plan mismatch")
            owner = db.get(User, order.user_id)
            notify.needs_review(
                order,
                owner.email if owner else None,
                f"Whop plan mismatch: paid {paid_plan}, expected {expected_plan}",
                name=owner.display_name if owner else None,
            )
            return JSONResponse({"ok": True, "ignored": "plan mismatch"})

    payment_id = whop.payment_id_from_event(event)
    payer_id = whop.payer_id_from_event(event)
    changed = False
    if payment_id and not order.provider_ref:
        order.provider_ref = payment_id[:128]
        changed = True
    if payer_id and not order.payer_hash:
        order.payer_hash = affiliates.payer_hash(payer_id) or None
        changed = True
    if changed:
        db.commit()

    applied = settle_order(db, order, source="Whop")
    return JSONResponse({"ok": True, "applied": applied})


# --------------------------------------------------------------------------
# orders
# --------------------------------------------------------------------------


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
    return _order_out(order)


# --------------------------------------------------------------------------
# cancel / resume
# --------------------------------------------------------------------------


class CancelIn(BaseModel):
    reason: str = Field(default="", max_length=500)


@router.post("/cancel", response_model=SubscriptionState)
def cancel_subscription(
    payload: CancelIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> SubscriptionState:
    """Stop at the end of the paid period. Access continues until then; the next purchase gets no rollover."""

    if not subscription_active(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no active subscription to cancel.")
    if user.sub_cancelled_at is None:
        user.sub_cancelled_at = datetime.now(timezone.utc)
        db.commit()
        reason = " ".join((payload.reason if payload else "").split())
        log_activity(
            db, user.id, "subscription", f"Cancelled the {user.sub_plan} subscription" + (f" ({reason})" if reason else "")
        )
        plan = get_token_plans(db).get(user.sub_plan or "")
        label = plan.label if plan else (user.sub_plan or "")
        end = user.sub_period_end
        notify.cancelled(user.email, label, end, reason, name=user.display_name)
        from . import mailer

        mailer.send_kind(db, user, "cancelled", {"plan": label, "end_date": f"{end:%d %B %Y}" if end else ""})
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
