"""Customer refund requests and the admin's decision on them.

The app never moves money. A customer asks for a refund on one paid order
(a plan period or a top-up) from Account settings and gives a crypto wallet
(coin + network + address) to be paid back to; the owner gets a phone
alert, sends the refund and presses Approve in Admin > Sales (with the
transaction hash, which goes into the customer's email). Approving marks the order refunded, takes back the
tokens the order gave (and ends the period it paid for), and undoes any
referral reward or partner commission it earned, through the same code as
the affiliate "Mark refunded" button. Reject sends the customer the owner's
note. The customer gets an email at each step.

Refund rules (Admin > Sales > Refund rules) decide what a customer may ask
for; the owner can still approve anything.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import affiliates, audit, mailer, notify, whop
from .accounts import clear_session_cookie, require_admin, require_studio_user
from .activity import log_activity
from .app_settings import currency, get_setting, set_setting
from .db import Order, RefundRequest, TokenLedger, User, get_db
from .plans import aware
from .tokens import (
    SUBSCRIPTION,
    TOPUP,
    _entry,
    bucket_totals,
    cancel_period,
    get_billing_rules,
    get_token_plans,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing/refunds", tags=["billing"])
admin_router = APIRouter(prefix="/api/v1/admin/refunds", tags=["admin"], dependencies=[Depends(require_admin)])

SETTING = "refund_rules"
DEFAULT_RULES: dict[str, Any] = {
    # Customers can ask at all (off hides the button and refuses new requests).
    "enabled": True,
    # Days after the payment a customer may ask.
    "window_days": 7,
    # The most of an order's tokens a customer may have used and still ask
    # (0 = only unused orders, 100 = no limit).
    "max_used_percent": 20,
    # Plan periods and top-ups can be switched separately.
    "allow_subscriptions": True,
    "allow_topups": True,
}

REASONS: dict[str, str] = {
    "mistake": "Bought by mistake",
    "duplicate": "Charged twice",
    "not_needed": "Don't need it anymore",
    "not_working": "It didn't work as I expected",
    "quality": "Not happy with the results",
    "other": "Something else",
}

ORDER_LIMIT = 50

# Where the money goes back: the customer picks a coin + network and gives a
# wallet address (required), the same way a crypto checkout asks for a
# refund address. The pattern catches typos and wrong-network addresses.
_EVM = r"^0x[0-9a-fA-F]{40}$"
_SOL = r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"
NETWORKS: dict[str, dict[str, str]] = {
    "usdt_trc20": {"label": "USDT · Tron (TRC-20)", "placeholder": "Tron address (starts with T)", "pattern": r"^T[1-9A-HJ-NP-Za-km-z]{33}$"},
    "usdt_eth": {"label": "USDT · Ethereum", "placeholder": "Ethereum address (0x...)", "pattern": _EVM},
    "usdc_eth": {"label": "USDC · Ethereum", "placeholder": "Ethereum address (0x...)", "pattern": _EVM},
    "usdc_base": {"label": "USDC · Base", "placeholder": "Base address (0x...)", "pattern": _EVM},
    "usdc_sol": {"label": "USDC · Solana", "placeholder": "Solana address", "pattern": _SOL},
    "usdt_bsc": {"label": "USDT · BNB Chain (BEP-20)", "placeholder": "BNB Chain address (0x...)", "pattern": _EVM},
}


# --------------------------------------------------------------------------
# rules
# --------------------------------------------------------------------------


def get_rules(db: Session) -> dict[str, Any]:
    saved = get_setting(db, SETTING, {}) or {}
    rules = dict(DEFAULT_RULES)
    if isinstance(saved, dict):
        for key, default in DEFAULT_RULES.items():
            value = saved.get(key)
            if isinstance(default, bool) and isinstance(value, bool):
                rules[key] = value
            elif isinstance(default, int) and not isinstance(default, bool) and isinstance(value, int):
                rules[key] = value
    return rules


class RulesIn(BaseModel):
    enabled: bool
    window_days: int = Field(ge=0, le=365)
    max_used_percent: int = Field(ge=0, le=100)
    allow_subscriptions: bool
    allow_topups: bool


# --------------------------------------------------------------------------
# what an order gave and what is left of it
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def tokens_used(db: Session, order: Order) -> int:
    """How many of the order's tokens the customer has spent, as best the ledger tells.

    * Plan period: tokens spent from the subscription bucket since it was paid
      (renders spend that bucket first).
    * Top-up: the order's tokens minus what is left in the top-up bucket.
    """

    total = int(order.tokens or 0)
    if total <= 0:
        return 0
    if order.kind == "subscription":
        since = aware(order.paid_at) or aware(order.created_at)
        spent = db.execute(
            select(func.coalesce(func.sum(TokenLedger.amount), 0)).where(
                TokenLedger.user_id == order.user_id,
                TokenLedger.bucket == SUBSCRIPTION,
                TokenLedger.kind.in_(("consume", "refund")),
                TokenLedger.created_at >= since,
            )
        ).scalar_one()
        used = -int(spent or 0)
    else:
        user = db.get(User, order.user_id)
        left = bucket_totals(db, user)[TOPUP] if user is not None else 0
        used = total - max(0, left)
    return max(0, min(total, used))


def tokens_remaining(db: Session, order: Order, used: int | None = None) -> int:
    """Unused tokens from this order still available in the customer's account."""

    total = int(order.tokens or 0)
    if total <= 0 or order.status != "paid":
        return 0
    used_count = tokens_used(db, order) if used is None else max(0, min(total, int(used)))
    by_order = max(0, total - used_count)
    user = db.get(User, order.user_id)
    if user is None:
        return 0
    bucket_key = SUBSCRIPTION if order.kind == "subscription" else TOPUP
    available_in_account = max(0, int(bucket_totals(db, user).get(bucket_key, 0)))
    return max(0, min(total, by_order, available_in_account))


def refundable_amount(order: Order, remaining_tokens: int) -> float:
    """Prorated USD amount refundable strictly for the unused remaining tokens."""

    total = int(order.tokens or 0)
    paid = float(order.amount_usd or 0)
    if total <= 0 or paid <= 0 or remaining_tokens <= 0:
        return 0.0
    rem = min(total, max(0, int(remaining_tokens)))
    return round(paid * rem / total, 2)


def _money_text(amount: float, cur: str) -> str:
    code = (cur or "USD").upper()
    if code == "USD":
        return f"${amount:,.2f}".replace(".00", "")
    return f"{amount:,.2f} {code}".replace(".00", "")


def _label(db: Session, order: Order) -> str:
    plan = get_token_plans(db).get(order.plan_id)
    name = plan.label if plan else order.plan_id
    return f"the {name} plan" if order.kind == "subscription" else f"a ${order.amount_usd:g} top-up on {name}"


def _latest_request(db: Session, order_id: str) -> RefundRequest | None:
    return db.execute(
        select(RefundRequest).where(RefundRequest.order_id == order_id).order_by(RefundRequest.created_at.desc()).limit(1)
    ).scalar_one_or_none()


def eligibility(
    db: Session,
    order: Order,
    rules: dict[str, Any],
    now: datetime | None = None,
    *,
    remaining_override: int | None = None,
) -> tuple[bool, str, int]:
    """(can the customer ask, why not, tokens used)."""

    now = now or _now()
    used = tokens_used(db, order) if order.status == "paid" else 0
    if order.status == "refunded":
        return False, "Refunded", used
    if order.status != "paid" or float(order.amount_usd or 0) <= 0:
        return False, "Only paid orders can be refunded.", used
    if not rules["enabled"]:
        return False, "Refunds are handled by support. Write to us in the support chat.", used
    if order.kind == "subscription" and not rules["allow_subscriptions"]:
        return False, "Plan payments are not refundable.", used
    if order.kind == "topup" and not rules["allow_topups"]:
        return False, "Top-ups are not refundable.", used
    paid = aware(order.paid_at) or aware(order.created_at)
    if paid is not None and now > paid + timedelta(days=int(rules["window_days"])):
        days = int(rules["window_days"])
        return False, f"Refunds are possible within {days} day{'' if days == 1 else 's'} of payment.", used
    total = int(order.tokens or 0)
    rem = tokens_remaining(db, order, used=used) if remaining_override is None else max(0, int(remaining_override))
    if total > 0 and (rem <= 0 or refundable_amount(order, rem) <= 0):
        return False, "No unused tokens remain in your account from this payment.", used
    limit = int(rules["max_used_percent"])
    if total > 0 and limit < 100 and used * 100 > total * limit:
        if limit == 0:
            return False, "Refunds are possible only before any tokens from this payment are used.", used
        return False, f"Refunds are possible while at most {limit}% of the tokens are used.", used
    return True, "", used


def _request_out(row: RefundRequest | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row.id,
        "status": row.status,
        "reason": row.reason,
        "reason_label": REASONS.get(row.reason, row.reason),
        "details": row.details,
        "tokens_remaining": row.tokens_remaining,
        "refund_amount": row.refund_amount_usd,
        "network": row.refund_network,
        "network_label": NETWORKS.get(row.refund_network or "", {}).get("label", row.refund_network or ""),
        "address": row.refund_address,
        "admin_note": row.admin_note if row.status == "rejected" else "",
        "created_at": aware(row.created_at),
        "decided_at": aware(row.decided_at),
    }


# --------------------------------------------------------------------------
# customer
# --------------------------------------------------------------------------


class RefundIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=64)
    reason: str = Field(pattern="^(" + "|".join(REASONS) + ")$")
    details: str = Field(default="", max_length=1000)
    network: str = Field(default="", max_length=32)
    address: str = Field(default="", max_length=120)


def check_address(network: str, address: str) -> str:
    """The cleaned wallet address, or a 422 that says what is wrong with it."""

    spec = NETWORKS.get(network)
    if spec is None:
        raise HTTPException(status_code=422, detail="Pick a supported refund coin and network.")
    cleaned = address.strip()
    if not cleaned or not re.match(spec["pattern"], cleaned):
        raise HTTPException(
            status_code=422,
            detail=f"That does not look like a {spec['label']} address. Check it and the network you picked.",
        )
    return cleaned


@router.get("")
def my_refunds(user: User = Depends(require_studio_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Every paid or refunded order with whether a refund can be asked for, and any request on it."""

    rules = get_rules(db)
    now = _now()
    orders = (
        db.execute(
            select(Order)
            .where(Order.user_id == user.id, Order.status.in_(("paid", "refunded")), Order.amount_usd > 0)
            .order_by(Order.created_at.desc())
            .limit(ORDER_LIMIT)
        )
        .scalars()
        .all()
    )
    out = []
    for order in orders:
        request = _latest_request(db, order.id)
        rem_override = (
            request.tokens_remaining
            if request is not None and request.status in ("pending", "approved", "rejected") and request.tokens_remaining is not None
            else None
        )
        ok, why, used = eligibility(db, order, rules, now, remaining_override=rem_override)
        rem = rem_override if rem_override is not None else tokens_remaining(db, order, used=used)
        refund_amt = (
            float(request.refund_amount_usd)
            if request is not None and request.refund_amount_usd is not None and rem_override is not None
            else refundable_amount(order, rem)
        )
        if request is not None and request.status in ("pending", "rejected", "approved"):
            ok = False
        out.append(
            {
                "order_id": order.id,
                "ref": notify.order_ref(order),
                "kind": order.kind,
                "plan_id": order.plan_id,
                "amount": order.amount_usd,
                "tokens": order.tokens,
                "tokens_used": used,
                "tokens_remaining": rem,
                "refundable_amount": refund_amt,
                "paid_at": aware(order.paid_at) or aware(order.created_at),
                "provider": order.provider,
                "status": order.status,
                "can_request": ok,
                "why_not": why,
                "request": _request_out(request),
            }
        )
    return {
        "rules": {
            "enabled": rules["enabled"],
            "window_days": rules["window_days"],
            "max_used_percent": rules["max_used_percent"],
        },
        "reasons": [{"id": key, "label": label} for key, label in REASONS.items()],
        "networks": [
            {"id": key, "label": spec["label"], "placeholder": spec["placeholder"]} for key, spec in NETWORKS.items()
        ],
        "currency": currency(db),
        "orders": out,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def request_refund(
    payload: RefundIn,
    response: Response,
    user: User = Depends(require_studio_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = db.get(Order, payload.order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="Order not found.")
    existing = _latest_request(db, order.id)
    if existing is not None and existing.status == "pending":
        raise HTTPException(status_code=409, detail="You already asked for a refund on this order. We will email you the answer.")
    if existing is not None and existing.status in ("approved", "rejected"):
        raise HTTPException(status_code=409, detail="This order already had a refund request. Write to us in the support chat.")
    ok, why, used = eligibility(db, order, get_rules(db))
    if not ok:
        raise HTTPException(status_code=409, detail=why)
    rem = tokens_remaining(db, order, used=used)
    refund_amt = refundable_amount(order, rem)
    if rem <= 0 or refund_amt <= 0:
        raise HTTPException(status_code=409, detail="No unused tokens remain in your account from this payment.")
    details = " ".join(payload.details.split())[:1000]
    net_raw = (payload.network or "").strip()
    addr_raw = (payload.address or "").strip()
    if order.provider != whop.PROVIDER or net_raw or addr_raw:
        if not net_raw or net_raw not in NETWORKS:
            raise HTTPException(status_code=422, detail="Pick a supported refund coin and network.")
        network = net_raw
        wallet = check_address(network, addr_raw)
        refund_to = f"{NETWORKS[network]['label']} {wallet}"
    else:
        network = "whop_card"
        wallet = (order.provider_ref or "")[:120]
        refund_to = "Original card / payment method via Whop"

    row = RefundRequest(
        order_id=order.id,
        user_id=user.id,
        reason=payload.reason,
        details=details,
        tokens_used=used,
        tokens_remaining=rem,
        refund_amount_usd=refund_amt,
        refund_network=network,
        refund_address=wallet,
    )
    db.add(row)

    # Stop future renewals on Whop best-effort while the request is reviewed.
    mem_id = (order.whop_membership_id or user.whop_membership_id or "").strip()
    if mem_id and whop.configured():
        try:
            whop.cancel_membership(mem_id, at_period_end=True, reason="Customer requested refund")
        except whop.WhopError:
            logger.warning("Could not cancel Whop membership %s on refund request for %s", mem_id, order.id, exc_info=True)

    # Stop plan and deactivate account immediately so no further rendering can occur.
    cancel_res = cancel_period(db, user, immediately=True, reason="Refund requested by customer")
    if order.kind == "subscription":
        row.tokens_removed = min(int(order.tokens or 0), int(cancel_res.get("expired", 0)))
    user.is_active = False
    user.token_version += 1
    db.commit()
    db.refresh(row)
    clear_session_cookie(response)

    cur = currency(db)
    refund_money = _money_text(refund_amt, cur)
    reason_text = REASONS[payload.reason] + (f": {details}" if details else "")
    log_activity(
        db,
        user.id,
        "refund",
        f"Asked for a refund of {refund_money} for {rem:,} remaining tokens ({reason_text}); account stopped",
    )
    plan = get_token_plans(db).get(order.plan_id)
    notify.refund_requested(
        order,
        user.email,
        plan.label if plan else order.plan_id,
        cur,
        reason_text,
        used,
        name=user.display_name,
        refund_to=refund_to,
        tokens_remaining=rem,
        refund_amount=refund_amt,
    )
    mailer.send_kind(
        db,
        user,
        "refund_requested",
        {
            "plan": _label(db, order),
            "reason": reason_text,
            "refund_to": refund_to,
            **mailer._order_values(db, order),
            "amount": refund_money,
        },
    )
    out = _request_out(row) or {}
    return {**out, "account_stopped": True}


@router.post("/{request_id}/withdraw")
def withdraw_refund(request_id: int, user: User = Depends(require_studio_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(RefundRequest, request_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Request not found.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="This request was already answered.")
    row.status = "withdrawn"
    row.decided_at = _now()
    db.commit()
    log_activity(db, user.id, "refund", "Withdrew a refund request")
    return _request_out(row)  # type: ignore[return-value]


# --------------------------------------------------------------------------
# taking back what a refunded order gave
# --------------------------------------------------------------------------


def take_back(db: Session, order: Order, user: User, now: datetime | None = None) -> dict[str, Any]:
    """Remove the order's tokens (what is left of them) and end the period it paid for. Does not commit."""

    now = now or _now()
    totals = bucket_totals(db, user)
    marker = f"refund of order {notify.order_ref(order)}"
    removed = 0
    ended = False
    if order.kind == "subscription":
        give_back = min(int(order.tokens or 0), max(0, totals[SUBSCRIPTION]))
        if give_back:
            _entry(db, user.id, SUBSCRIPTION, "clawback", -give_back, order_id=order.id, note=marker)
            db.flush()  # so the balance cancel_period reads below already has it
            removed += give_back
        latest = db.execute(
            select(Order.id)
            .where(Order.user_id == user.id, Order.kind == "subscription", Order.status.in_(("paid", "refunded")))
            .order_by(Order.paid_at.desc().nullslast(), Order.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        end = aware(user.sub_period_end)
        if latest == order.id and end is not None and end > now:
            # Take this order's days off the period; if nothing paid is left, it ends now.
            new_end = end - timedelta(days=get_billing_rules(db)["period_days"])
            if new_end <= now:
                result = cancel_period(db, user, immediately=True, reason=marker, now=now)
                removed += int(result["expired"])
                ended = True
            else:
                user.sub_period_end = new_end
    else:
        give_back = min(int(order.tokens or 0), max(0, totals[TOPUP]))
        if give_back:
            _entry(db, user.id, TOPUP, "clawback", -give_back, order_id=order.id, note=marker)
            removed += give_back
    return {"removed": removed, "ended": ended}


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=1000)
    # Approve only: optional reference/tx hash (populated automatically on Whop refunds).
    refund_tx: str = Field(default="", max_length=200)
    # Approve only: take the order's tokens back and end the period it paid for.
    remove_access: bool = True
    # Reject only: optionally reactivate a customer account that stopped when requesting a refund.
    reactivate_account: bool = False


def apply_provider_refund(
    db: Session,
    order: Order,
    *,
    refund_id: str = "",
    reason: str = "Refunded via Whop",
) -> str:
    """Finalize a refund triggered via Whop webhook: take back tokens, stop account & plan, undo affiliates."""

    now = _now()
    user = db.get(User, order.user_id)
    already = order.status == "refunded"
    removed = 0
    if user is not None and not already:
        removed = int(take_back(db, order, user, now)["removed"])
    order.status = "refunded"
    row = _latest_request(db, order.id)
    if row is not None and row.status == "pending":
        row.status = "approved"
        row.decided_at = now
        row.decided_by = "whop_webhook"
        row.tokens_removed = removed
        if refund_id:
            row.refund_tx = refund_id[:200]
    if user is not None:
        cancel_period(db, user, immediately=True, reason=reason, now=now)
        user.is_active = False
        user.token_version += 1
    db.commit()
    return "" if already else affiliates.on_order_refunded(db, order)


def _row_remaining_and_amount(db: Session, row: RefundRequest, order: Order | None) -> tuple[int, float]:
    """Resolve remaining tokens and prorated refundable USD for an existing RefundRequest."""

    if order is None:
        return int(row.tokens_remaining or 0), float(row.refund_amount_usd or 0.0)
    if row.tokens_remaining is not None:
        rem = max(0, int(row.tokens_remaining))
    elif row.status == "pending" and order.kind == "subscription":
        # Legacy pending rows created before tokens_remaining existed already had cancel_period write off sub tokens.
        rem = max(0, int(order.tokens or 0) - int(row.tokens_used or 0))
    else:
        rem = tokens_remaining(db, order, used=row.tokens_used)
    amt = float(row.refund_amount_usd) if row.refund_amount_usd is not None else refundable_amount(order, rem)
    return rem, amt


def _admin_row(db: Session, row: RefundRequest, rules: dict[str, Any]) -> dict[str, Any]:
    order = db.get(Order, row.order_id)
    user = db.get(User, row.user_id)
    plan = get_token_plans(db).get(order.plan_id) if order else None
    rem, refund_amt = _row_remaining_and_amount(db, row, order)
    in_rules = True
    why = ""
    if order is not None and row.status == "pending":
        in_rules, why, _used = eligibility(db, order, rules, aware(row.created_at), remaining_override=rem)
    net_label = (
        "Whop (original card / payment method)"
        if row.refund_network == "whop_card"
        else NETWORKS.get(row.refund_network or "", {}).get("label", row.refund_network or "")
    )
    return {
        "id": row.id,
        "status": row.status,
        "reason": REASONS.get(row.reason, row.reason),
        "details": row.details,
        "network": net_label,
        "address": None if row.refund_network == "whop_card" else row.refund_address,
        "refund_tx": row.refund_tx,
        "admin_note": row.admin_note,
        "created_at": aware(row.created_at),
        "decided_at": aware(row.decided_at),
        "decided_by": row.decided_by,
        "tokens_removed": row.tokens_removed,
        "tokens_remaining": rem,
        "refund_amount": refund_amt,
        "user_id": row.user_id,
        "email": user.email if user else "",
        "name": user.display_name if user else None,
        "user_is_active": bool(user.is_active) if user else False,
        "order": None
        if order is None
        else {
            "id": order.id,
            "ref": notify.order_ref(order),
            "kind": order.kind,
            "plan_label": plan.label if plan else order.plan_id,
            "amount": order.amount_usd,
            "tokens": order.tokens,
            "tokens_used": tokens_used(db, order) if order.status == "paid" else row.tokens_used,
            "tokens_remaining": rem,
            "refund_amount": refund_amt,
            "provider": order.provider,
            "provider_ref": order.provider_ref,
            "status": order.status,
            "paid_at": aware(order.paid_at),
        },
        "in_rules": in_rules,
        "outside_rules": why,
    }


@admin_router.get("")
def admin_list(
    state: str = Query(default="pending", pattern="^(pending|all)$"), db: Session = Depends(get_db)
) -> dict[str, Any]:
    query = select(RefundRequest).order_by(RefundRequest.created_at.desc()).limit(200)
    if state == "pending":
        query = query.where(RefundRequest.status == "pending")
    rules = get_rules(db)
    rows = db.execute(query).scalars().all()
    pending = db.execute(select(func.count()).where(RefundRequest.status == "pending")).scalar_one()
    return {
        "currency": currency(db),
        "pending": int(pending or 0),
        "rules": rules,
        "requests": [_admin_row(db, row, rules) for row in rows],
    }


def _load_pending(db: Session, request_id: int) -> tuple[RefundRequest, Order, User]:
    row = db.get(RefundRequest, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such refund request.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"This request is already {row.status}.")
    order = db.get(Order, row.order_id)
    user = db.get(User, row.user_id)
    if order is None or user is None:
        raise HTTPException(status_code=409, detail="The order or the customer no longer exists.")
    return row, order, user


@admin_router.post("/{request_id}/approve")
def admin_approve(
    request_id: int, payload: DecisionIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Send the refund via Whop back to the customer's card (when paid via Whop), revoke access, and undo affiliates."""

    row, order, user = _load_pending(db, request_id)
    if order.status not in ("paid", "refunded"):
        raise HTTPException(status_code=409, detail="Only a paid order can be refunded.")
    already = order.status == "refunded"
    rem, refund_amt = _row_remaining_and_amount(db, row, order)
    if not already and (rem <= 0 or refund_amt <= 0):
        raise HTTPException(status_code=409, detail="No unused tokens remain on this account to refund.")

    refund_tx = " ".join(payload.refund_tx.split())
    if not already and order.provider == whop.PROVIDER and order.provider_ref and whop.configured():
        full_paid = round(float(order.amount_usd or 0), 2)
        whop_kwargs: dict[str, Any] = {
            "metadata": {
                "refund_request_id": str(row.id),
                "order_id": order.id,
                "reviewed_by": admin.email,
                "tokens_remaining": str(rem),
                "refund_amount_usd": f"{refund_amt:.2f}",
            }
        }
        if refund_amt < full_paid:
            whop_kwargs["amount"] = refund_amt
        try:
            res = whop.refund_payment(order.provider_ref, **whop_kwargs)
            refund_tx = res.get("refund_id") or refund_tx or order.provider_ref
        except whop.WhopError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    now = _now()
    result = {"removed": 0, "ended": False}
    if payload.remove_access:
        result = take_back(db, order, user, now)
        cancel_period(db, user, immediately=True, reason="Refund approved", now=now)
    user.is_active = False
    user.token_version += 1
    order.status = "refunded"
    note = " ".join(payload.note.split())
    row.status = "approved"
    row.admin_note = note
    row.decided_at = now
    row.decided_by = admin.email
    row.tokens_remaining = rem
    row.refund_amount_usd = refund_amt
    row.tokens_removed = int(row.tokens_removed or 0) + int(result["removed"])
    row.refund_tx = refund_tx[:200]
    db.commit()
    reversed_ = "" if already else affiliates.on_order_refunded(db, order)

    cur = currency(db)
    refund_money = _money_text(refund_amt, cur)
    detail = f"Approved the {refund_money} refund for {rem:,} remaining tokens ({notify.order_ref(order)})"
    if payload.remove_access:
        detail += f"; {result['removed']} tokens taken back" + ("; plan ended now" if result["ended"] else "")
    if reversed_:
        detail += f"; {reversed_}"
    if note:
        detail += f" ({note})"
    audit.record(db, admin, user, "refund_approved", detail)
    log_activity(db, user.id, "refund", f"Refund of {refund_money} approved ({rem:,} remaining tokens)")
    refund_to_label = (
        "Original card / payment method via Whop"
        if row.refund_network == "whop_card"
        else f"{NETWORKS.get(row.refund_network or '', {}).get('label', '')} {row.refund_address or ''}".strip()
    )
    mailer.send_kind(
        db,
        user,
        "refund_approved",
        {
            "plan": _label(db, order),
            "reason": REASONS.get(row.reason, row.reason),
            "note": note,
            "refund_to": refund_to_label,
            "refund_tx": row.refund_tx or "-",
            **mailer._order_values(db, order),
            "amount": refund_money,
        },
    )
    return _admin_row(db, row, get_rules(db))


@admin_router.post("/{request_id}/reject")
def admin_reject(
    request_id: int, payload: DecisionIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    row, order, user = _load_pending(db, request_id)
    note = " ".join(payload.note.split())
    row.status = "rejected"
    row.admin_note = note
    row.decided_at = _now()
    row.decided_by = admin.email
    if payload.reactivate_account:
        user.is_active = True
    db.commit()
    detail = f"Rejected the ${order.amount_usd:g} refund"
    if payload.reactivate_account:
        detail += " and reactivated account"
    if note:
        detail += f" ({note})"
    audit.record(db, admin, user, "refund_rejected", detail)
    log_activity(db, user.id, "refund", f"Refund of ${order.amount_usd:g} not approved")
    mailer.send_kind(
        db,
        user,
        "refund_rejected",
        {
            "plan": _label(db, order),
            "reason": REASONS.get(row.reason, row.reason),
            "note": note,
            **mailer._order_values(db, order),
        },
    )
    return _admin_row(db, row, get_rules(db))


@admin_router.get("/rules")
def admin_rules(db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_rules(db)


@admin_router.put("/rules")
def admin_save_rules(payload: RulesIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, Any]:
    set_setting(db, SETTING, payload.model_dump())
    db.commit()
    audit.record(db, admin, None, "refund_rules", "Changed the refund rules")
    return get_rules(db)
