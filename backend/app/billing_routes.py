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

from . import affiliates, meta_capi, notify, refunds, whop
from .accounts import require_studio_user
from .activity import log_activity
from .app_settings import currency
from .config import settings
from .db import Order, User, get_db
from .tokens import (
    cancel_period,
    get_billing_rules,
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
    whop_checkout_config: str | None = None
    checkout_url: str = ""
    amount: float
    original_amount: float | None = None
    discount: float = 0.0
    promo_code: str | None = None
    whop_promo_to_prefill: str | None = None
    whop_metadata: dict[str, str] = Field(default_factory=dict)
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


def _open_order(
    db: Session,
    user: User,
    kind: str,
    plan_id: str,
    amount: float,
    provider: str,
    coupon_code: str | None = None,
) -> Order | None:
    """The user's recent pending order for the same purchase & coupon, if any."""

    since = datetime.now(timezone.utc) - REUSE_WINDOW
    coupon_match = Order.coupon_code == coupon_code if coupon_code else Order.coupon_code.is_(None)
    return db.execute(
        select(Order)
        .where(
            Order.user_id == user.id,
            Order.status == "pending",
            Order.kind == kind,
            Order.plan_id == plan_id,
            Order.amount_usd == float(amount),
            Order.provider == provider,
            coupon_match,
            Order.created_at >= since,
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _checkout_return_url(order_id: str) -> str:
    base = settings.public_url.strip().rstrip("/")
    return f"{base}/app/plan?order={order_id}" if base else ""


def _build_whop_metadata(
    *,
    order_id: str,
    base_whop_plan: str,
    original_amount: float,
    coupon_code: str | None = None,
    affiliate_channel: str | None = None,
    discount_pct: float = 0.0,
    discount_usd: float = 0.0,
) -> dict[str, str]:
    meta: dict[str, str] = {
        "order_id": order_id,
        "base_whop_plan": base_whop_plan,
        "original_amount_usd": f"{original_amount:.2f}",
    }
    if coupon_code:
        meta.update(
            {
                "coupon_code": coupon_code,
                "promo_code": coupon_code,
                "affiliate_channel": affiliate_channel or "",
                "referral_code": coupon_code,
                "discount_pct": f"{discount_pct:g}",
                "discount_usd": f"{discount_usd:.2f}",
            }
        )
    return meta


@router.post("/checkout", response_model=CheckoutOut, status_code=status.HTTP_201_CREATED)
def checkout(
    payload: CheckoutIn,
    request: Request,
    user: User = Depends(require_studio_user),
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
    device = affiliates.device_hash(request.headers.get("x-device-id"))
    ip = affiliates.ip_hash(meta_capi._client_ip(request))
    if payload.kind == "subscription":
        plan = plans.get(payload.plan_id or "")
        if plan is None:
            raise HTTPException(status_code=422, detail="Choose one of the plans: Starter, Pro or Max.")
        original_amount = float(plan.price)
        amount = original_amount
        tokens = plan.tokens
        bonus = 0
        if payload.coupon and payload.coupon.strip():
            code = affiliates.find_code(db, payload.coupon)
            if code is None:
                raise HTTPException(status_code=422, detail="That code does not exist.")
            try:
                affiliates.attribute(db, user, code, source="coupon", device=device, ip=ip)
            except affiliates.AttributionError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            # Coupons never stack: at most one, on the first subscription payment.
            coupon = affiliates.checkout_discount(db, user, plan.id, plan.price)
            if coupon is not None:
                amount = coupon["amount"]
        else:
            if affiliates.referral_of(db, user.id) is None and not affiliates.has_paid(db, user):
                affiliates.attribute_signup(db, user, request.cookies.get(affiliates.COOKIE), device, ip)
            coupon = None
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
        original_amount = float(amount_int)
        amount = original_amount
        tokens = topup_tokens(plan, amount_int, topups)
        bonus = topup_bonus(plan, amount_int, topups)
        coupon = None

    try:
        base_whop_plan = whop.plan_id_for(payload.kind, plan.id, original_amount)
    except whop.WhopError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    coupon_code = coupon["code"] if coupon else None
    discount_usd = float(coupon["discount"]) if coupon else 0.0
    discount_pct = float(coupon["pct"]) if coupon else 0.0
    ref_row = affiliates.referral_of(db, user.id)
    ref_code_for_meta = coupon_code or (ref_row.code if ref_row and ref_row.status in ("signed_up", "active", "waiting", "rewarded") else None)
    ref_channel_for_meta = (coupon["channel"] if coupon else None) or (ref_row.channel if ref_row and ref_code_for_meta else None)

    existing = _open_order(db, user, payload.kind, plan.id, amount, provider, coupon_code=coupon_code)
    if existing is not None:
        resolved_plan = existing.whop_plan_id or base_whop_plan
        existing_meta = _build_whop_metadata(
            order_id=existing.id,
            base_whop_plan=base_whop_plan,
            original_amount=original_amount,
            coupon_code=ref_code_for_meta,
            affiliate_channel=ref_channel_for_meta,
            discount_pct=discount_pct,
            discount_usd=existing.discount_usd or discount_usd,
        )
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
            whop_plan=resolved_plan,
            whop_checkout_config=None,
            checkout_url=existing.checkout_url or "",
            amount=amount,
            original_amount=original_amount,
            discount=existing.discount_usd or discount_usd,
            promo_code=coupon_code,
            whop_promo_to_prefill=coupon_code if (coupon_code and resolved_plan == base_whop_plan and discount_usd > 0) else None,
            whop_metadata=existing_meta,
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
        coupon_code=coupon_code,
        discount=discount_usd,
    )
    period_days = get_billing_rules(db)["period_days"]
    session = whop.create_discounted_checkout(
        base_whop_plan=base_whop_plan,
        order_id=order.id,
        amount=amount,
        original_amount=original_amount,
        plan_label=plan.label,
        period_days=period_days,
        return_url=_checkout_return_url(order.id),
        coupon_code=coupon_code,
        affiliate_channel=ref_channel_for_meta,
        discount_pct=discount_pct,
        discount_usd=discount_usd,
    )
    whop_plan = session["whop_plan"]
    checkout_url = session["checkout_url"]
    whop_meta = dict(session["metadata"])
    if ref_code_for_meta and not coupon_code:
        whop_meta["referral_code"] = ref_code_for_meta
        whop_meta["affiliate_channel"] = ref_channel_for_meta or ""
    order.whop_plan_id = whop_plan
    if checkout_url:
        order.checkout_url = checkout_url
    db.commit()

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
        whop_checkout_config=session.get("checkout_config_id"),
        checkout_url=checkout_url,
        amount=amount,
        original_amount=original_amount,
        discount=discount_usd,
        promo_code=coupon_code,
        whop_promo_to_prefill=session.get("promo_to_prefill"),
        whop_metadata=whop_meta,
        tokens=tokens,
        provider=provider,
    )


# --------------------------------------------------------------------------
# Whop membership & webhook helpers
# --------------------------------------------------------------------------


def _resolve_user_whop_membership(db: Session, user: User) -> str:
    """Return the user's Whop ``mem_...`` id from user row, paid orders, or Whop API fallback."""

    if user.whop_membership_id:
        return user.whop_membership_id.strip()

    last_sub = db.execute(
        select(Order)
        .where(
            Order.user_id == user.id,
            Order.kind == "subscription",
            Order.status == "paid",
            Order.provider == whop.PROVIDER,
        )
        .order_by(Order.paid_at.desc().nullslast(), Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last_sub is None:
        return ""
    if last_sub.whop_membership_id:
        user.whop_membership_id = last_sub.whop_membership_id.strip()
        db.commit()
        return user.whop_membership_id
    if last_sub.provider_ref and whop.configured():
        try:
            mem_id = whop.retrieve_payment_membership_id(last_sub.provider_ref)
        except whop.WhopError:
            mem_id = ""
        if mem_id:
            last_sub.whop_membership_id = mem_id
            user.whop_membership_id = mem_id
            db.commit()
            return mem_id
    return ""


def _record_whop_payment_refs(
    db: Session,
    order: Order,
    *,
    payment_id: str,
    membership_id: str,
    payer_id: str,
) -> None:
    changed = False
    if payment_id and not order.provider_ref:
        order.provider_ref = payment_id[:128]
        changed = True
    if membership_id and not order.whop_membership_id:
        order.whop_membership_id = membership_id[:128]
        changed = True
    if payer_id and not order.payer_hash:
        order.payer_hash = affiliates.payer_hash(payer_id) or None
        changed = True
    if membership_id and order.kind == "subscription":
        owner = db.get(User, order.user_id)
        if owner is not None and owner.whop_membership_id != membership_id:
            owner.whop_membership_id = membership_id[:128]
            changed = True
    if changed:
        db.commit()


def _settle_whop_renewal(
    db: Session,
    event: dict,
    *,
    prior_order: Order | None,
    payment_id: str,
    membership_id: str,
    paid_plan: str,
    payer_id: str,
) -> JSONResponse:
    if payment_id:
        duplicate = db.execute(
            select(Order.id).where(Order.provider == whop.PROVIDER, Order.provider_ref == payment_id).limit(1)
        ).scalar_one_or_none()
        if duplicate is not None:
            return JSONResponse({"ok": True, "applied": False})

    user: User | None = None
    ref_order = prior_order
    if ref_order is not None:
        user = db.get(User, ref_order.user_id)
    if user is None and membership_id:
        user = db.execute(select(User).where(User.whop_membership_id == membership_id).limit(1)).scalar_one_or_none()
        if user is None:
            ref_order = db.execute(
                select(Order)
                .where(Order.whop_membership_id == membership_id)
                .order_by(Order.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            if ref_order is not None:
                user = db.get(User, ref_order.user_id)
    if user is None:
        logger.info("Whop renewal for unknown membership %s / payment %s", membership_id or "(none)", payment_id or "(none)")
        return JSONResponse({"ok": True, "ignored": "unknown membership"})

    plans = get_token_plans(db)
    plan = None
    if paid_plan:
        mapped = whop.plan_for_whop_id(paid_plan)
        if mapped and mapped[0] == "subscription":
            plan = plans.get(mapped[1])
    if plan is None and user.sub_plan:
        plan = plans.get(user.sub_plan)
    if plan is None and ref_order is not None:
        plan = plans.get(ref_order.plan_id)
    if plan is None:
        logger.warning("Whop renewal ignored for user %s: unknown plan (%s)", user.id, paid_plan)
        return JSONResponse({"ok": True, "ignored": "unknown plan"})

    if not user.is_active:
        logger.warning("Whop renewal charge arrived for inactive/refunded user %s (payment %s)", user.id, payment_id)
        if ref_order is not None:
            notify.needs_review(
                ref_order,
                user.email,
                f"Whop renewal payment {payment_id} arrived on disabled account",
                name=user.display_name,
            )
        return JSONResponse({"ok": True, "ignored": "inactive account"})

    amount = whop.usd_amount_from_event(event)
    if amount is None or amount <= 0:
        amount = plan.price
    renewal = new_order(db, user, "subscription", plan, amount, plan.tokens, provider=whop.PROVIDER)
    if paid_plan:
        renewal.whop_plan_id = paid_plan[:128]
    _record_whop_payment_refs(db, renewal, payment_id=payment_id, membership_id=membership_id, payer_id=payer_id)
    applied = settle_order(db, renewal, source="Whop")
    return JSONResponse({"ok": True, "applied": applied, "renewal": True})


def _handle_payment_succeeded(db: Session, event: dict) -> JSONResponse:
    order_id = whop.order_id_from_event(event)
    payment_id = whop.payment_id_from_event(event)
    membership_id = whop.membership_id_from_event(event)
    billing_reason = whop.billing_reason_from_event(event)
    paid_plan = whop.plan_id_from_event(event)
    payer_id = whop.payer_id_from_event(event)

    order = db.get(Order, order_id) if order_id else None
    is_new_cycle = (
        billing_reason == "subscription_cycle"
        or (order is not None and order.status == "paid" and bool(payment_id) and bool(order.provider_ref) and order.provider_ref != payment_id)
        or (order is None and bool(membership_id))
    )
    if is_new_cycle:
        return _settle_whop_renewal(
            db,
            event,
            prior_order=order,
            payment_id=payment_id,
            membership_id=membership_id,
            paid_plan=paid_plan,
            payer_id=payer_id,
        )

    if order is None:
        logger.info("Whop payment.succeeded for an unknown order %s", order_id or "(missing)")
        return JSONResponse({"ok": True, "ignored": "unknown order"})

    if order.provider != whop.PROVIDER:
        logger.warning("Whop webhook for order %s ignored: provider is %s", order.id, order.provider)
        return JSONResponse({"ok": True, "ignored": "wrong provider"})

    if paid_plan:
        expected_plans: set[str] = set()
        if order.whop_plan_id:
            expected_plans.add(order.whop_plan_id.strip())
        try:
            base_expected = whop.plan_id_for(order.kind, order.plan_id, order.amount_usd)
            if base_expected:
                expected_plans.add(base_expected)
        except whop.WhopError:
            pass
        if expected_plans and paid_plan not in expected_plans:
            logger.warning(
                "Whop webhook for order %s ignored: plan mismatch (%s not in %s)",
                order.id,
                paid_plan,
                sorted(expected_plans),
            )
            log_activity(db, order.user_id, "payment", f"Whop webhook for order {order.id} ignored: plan mismatch")
            owner = db.get(User, order.user_id)
            notify.needs_review(
                order,
                owner.email if owner else None,
                f"Whop plan mismatch: paid {paid_plan}, expected {' or '.join(sorted(expected_plans))}",
                name=owner.display_name if owner else None,
            )
            return JSONResponse({"ok": True, "ignored": "plan mismatch"})

    # If the user entered an affiliate/promo code inside Whop Checkout itself (or
    # Whop charged a discounted amount), sync attribution & real paid total before
    # commission bookkeeping runs inside settle_order.
    whop_promo = whop.promo_code_from_event(event)
    paid_usd = whop.usd_amount_from_event(event)
    if order.status in ("pending", "expired", "invalid"):
        changed = False
        if whop_promo and not order.coupon_code and order.kind == "subscription":
            owner = db.get(User, order.user_id)
            code_row = affiliates.find_code(db, whop_promo)
            existing_ref = affiliates.referral_of(db, owner.id) if owner is not None else None
            if (
                owner is not None
                and code_row is not None
                and (existing_ref is None or existing_ref.first_order_id is None)
                and not affiliates.has_paid(db, owner)
            ):
                try:
                    affiliates.attribute(db, owner, code_row, source="coupon")
                except affiliates.AttributionError:
                    pass
            order.coupon_code = whop_promo[:40]
            changed = True
        if paid_usd is not None and paid_usd > 0 and round(paid_usd, 2) < round(order.amount_usd, 2):
            if order.discount_usd == 0:
                order.discount_usd = round(order.amount_usd - paid_usd, 2)
            order.amount_usd = round(paid_usd, 2)
            changed = True
        if changed:
            db.commit()

    _record_whop_payment_refs(db, order, payment_id=payment_id, membership_id=membership_id, payer_id=payer_id)
    applied = settle_order(db, order, source="Whop")
    return JSONResponse({"ok": True, "applied": applied})


def _handle_payment_failed(db: Session, event: dict) -> JSONResponse:
    order_id = whop.order_id_from_event(event)
    payment_id = whop.payment_id_from_event(event)
    membership_id = whop.membership_id_from_event(event)

    order = db.get(Order, order_id) if order_id else None
    if order is None and payment_id:
        order = db.execute(
            select(Order).where(Order.provider == whop.PROVIDER, Order.provider_ref == payment_id).limit(1)
        ).scalar_one_or_none()
    if order is not None and order.provider == whop.PROVIDER and order.status == "pending":
        void_order(db, order, "invalid")
        log_activity(db, order.user_id, "payment", f"Whop payment failed for order {order.id}")
        return JSONResponse({"ok": True, "failed_order": order.id})

    user: User | None = db.get(User, order.user_id) if order is not None else None
    if user is None and membership_id:
        user = db.execute(select(User).where(User.whop_membership_id == membership_id).limit(1)).scalar_one_or_none()
        if order is None:
            order = db.execute(
                select(Order)
                .where(Order.provider == whop.PROVIDER, Order.whop_membership_id == membership_id)
                .order_by(Order.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            if user is None and order is not None:
                user = db.get(User, order.user_id)
    if user is not None:
        if order is None:
            order = db.execute(
                select(Order)
                .where(Order.user_id == user.id, Order.provider == whop.PROVIDER)
                .order_by(Order.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
        log_activity(db, user.id, "payment", "Whop renewal payment failed")
        if order is not None:
            notify.needs_review(order, user.email, "Whop renewal payment failed", name=user.display_name)
        return JSONResponse({"ok": True, "failed_noted": True})
    return JSONResponse({"ok": True, "ignored": "unknown payment"})


def _handle_membership_deactivated(db: Session, event: dict) -> JSONResponse:
    mem_id = whop.membership_id_from_event(event)
    if not mem_id:
        return JSONResponse({"ok": True, "ignored": "missing membership id"})

    user = db.execute(select(User).where(User.whop_membership_id == mem_id).limit(1)).scalar_one_or_none()
    if user is None:
        order = db.execute(
            select(Order).where(Order.whop_membership_id == mem_id).order_by(Order.created_at.desc()).limit(1)
        ).scalar_one_or_none()
        if order is not None:
            user = db.get(User, order.user_id)
    if user is None:
        return JSONResponse({"ok": True, "ignored": "unknown membership"})

    data = whop._event_data(event)
    cancel_at_end = data.get("cancel_at_period_end")
    if cancel_at_end is not True:
        cancel_period(db, user, immediately=True, reason="Membership deactivated on Whop")
        db.commit()
        log_activity(db, user.id, "subscription", f"Membership {user.sub_plan or 'subscription'} deactivated on Whop")
        return JSONResponse({"ok": True, "synced": "deactivated"})

    if user.sub_cancelled_at is None:
        user.sub_cancelled_at = datetime.now(timezone.utc)
        db.commit()
        log_activity(db, user.id, "subscription", f"Cancelled {user.sub_plan or 'subscription'} auto-renewal on Whop")
    return JSONResponse({"ok": True, "synced": "cancelled"})


def _handle_refund_event(db: Session, event: dict) -> JSONResponse:
    payment_id = whop.refund_payment_id_from_event(event)
    refund_id = whop.refund_id_from_event(event)
    r_status = whop.refund_status_from_event(event)

    if not payment_id:
        return JSONResponse({"ok": True, "ignored": "missing payment id"})

    order = db.execute(
        select(Order).where(Order.provider == whop.PROVIDER, Order.provider_ref == payment_id).limit(1)
    ).scalar_one_or_none()
    if order is None:
        return JSONResponse({"ok": True, "ignored": "unknown payment"})

    if r_status == "failed":
        owner = db.get(User, order.user_id)
        notify.needs_review(
            order,
            owner.email if owner else None,
            f"Whop refund {refund_id or ''} failed",
            name=owner.display_name if owner else None,
        )
        return JSONResponse({"ok": True, "ignored": "refund failed"})

    was_paid = order.status == "paid"
    refunds.apply_provider_refund(db, order, refund_id=refund_id, reason="Refunded via Whop")
    if was_paid:
        log_activity(db, order.user_id, "payment", f"Order of ${order.amount_usd:g} refunded on Whop; account stopped")
    return JSONResponse({"ok": True, "refunded": True})


def _handle_dispute_event(db: Session, etype: str, event: dict) -> JSONResponse:
    payment_id = whop.refund_payment_id_from_event(event)
    d_status = whop.dispute_status_from_event(event)
    d_reason = whop.dispute_reason_from_event(event)
    if not payment_id:
        return JSONResponse({"ok": True, "ignored": "missing payment id"})

    order = db.execute(
        select(Order).where(Order.provider == whop.PROVIDER, Order.provider_ref == payment_id).limit(1)
    ).scalar_one_or_none()
    if order is None:
        return JSONResponse({"ok": True, "ignored": "unknown payment"})

    owner = db.get(User, order.user_id)
    if d_status in ("won", "warning_closed"):
        log_activity(db, order.user_id, "payment", f"Whop dispute for order {order.id} resolved ({d_status})")
        notify.needs_review(
            order,
            owner.email if owner else None,
            f"Whop dispute resolved ({d_status})",
            name=owner.display_name if owner else None,
        )
        return JSONResponse({"ok": True, "dispute": d_status})

    reason_text = f"Whop dispute ({d_status or etype})" + (f": {d_reason}" if d_reason else "")
    if d_status == "lost":
        refunds.apply_provider_refund(db, order, reason=reason_text)
    elif owner is not None:
        cancel_period(db, owner, immediately=True, reason=reason_text)
        owner.is_active = False
        owner.token_version += 1
        db.commit()

    log_activity(db, order.user_id, "payment", f"{reason_text}; plan & account stopped")
    notify.needs_review(
        order,
        owner.email if owner else None,
        f"{reason_text} — account stopped",
        name=owner.display_name if owner else None,
    )
    return JSONResponse({"ok": True, "dispute_handled": True})


# --------------------------------------------------------------------------
# Whop webhook
# --------------------------------------------------------------------------


@router.post("/whop/webhook")
async def whop_webhook(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """Receive signed Whop Standard Webhooks events for payments, memberships, refunds, and disputes."""

    raw = await request.body()
    try:
        event = whop.verify_webhook(raw, request.headers)
    except whop.WhopError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    etype = whop.event_type(event)
    if etype == whop.SETTLED_EVENT:
        return _handle_payment_succeeded(db, event)
    if etype == "payment.failed":
        return _handle_payment_failed(db, event)
    if etype == "membership.deactivated":
        return _handle_membership_deactivated(db, event)
    if etype in ("refund.created", "refund.updated"):
        return _handle_refund_event(db, event)
    if etype in ("dispute.created", "dispute.updated"):
        return _handle_dispute_event(db, etype, event)
    return JSONResponse({"ok": True, "ignored": etype or "unknown event"})


# --------------------------------------------------------------------------
# orders
# --------------------------------------------------------------------------


@router.get("/orders", response_model=list[OrderOut])
def my_orders(user: User = Depends(require_studio_user), db: Session = Depends(get_db)) -> list[OrderOut]:
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
def order_status(order_id: str, user: User = Depends(require_studio_user), db: Session = Depends(get_db)) -> OrderOut:
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
    payload: CancelIn | None = None, user: User = Depends(require_studio_user), db: Session = Depends(get_db)
) -> SubscriptionState:
    """Stop auto-renewal on Whop at period end; days and tokens left stay active until then."""

    if not subscription_active(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no active subscription to cancel.")
    reason = " ".join((payload.reason if payload else "").split())
    mem_id = _resolve_user_whop_membership(db, user)
    if mem_id and whop.configured():
        try:
            whop.cancel_membership(mem_id, at_period_end=True, reason=reason or "Cancelled by customer")
        except whop.WhopError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if user.sub_cancelled_at is None:
        user.sub_cancelled_at = datetime.now(timezone.utc)
        db.commit()
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
def resume_subscription(user: User = Depends(require_studio_user), db: Session = Depends(get_db)) -> SubscriptionState:
    if not subscription_active(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no active subscription to resume.")
    mem_id = _resolve_user_whop_membership(db, user)
    if mem_id and whop.configured():
        try:
            whop.resume_membership(mem_id)
        except whop.WhopError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if user.sub_cancelled_at is not None:
        user.sub_cancelled_at = None
        db.commit()
        log_activity(db, user.id, "subscription", f"Resumed the {user.sub_plan} subscription")
    return SubscriptionState(cancelled=False, period_end=user.sub_period_end)
