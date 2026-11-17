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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import affiliates, audit, mailer, notify
from .accounts import current_user, require_admin
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


def _label(db: Session, order: Order) -> str:
    plan = get_token_plans(db).get(order.plan_id)
    name = plan.label if plan else order.plan_id
    return f"the {name} plan" if order.kind == "subscription" else f"a ${order.amount_usd:g} top-up on {name}"


def _latest_request(db: Session, order_id: str) -> RefundRequest | None:
    return db.execute(
        select(RefundRequest).where(RefundRequest.order_id == order_id).order_by(RefundRequest.created_at.desc()).limit(1)
    ).scalar_one_or_none()


def eligibility(db: Session, order: Order, rules: dict[str, Any], now: datetime | None = None) -> tuple[bool, str, int]:
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
    network: str = Field(pattern="^(" + "|".join(NETWORKS) + ")$")
    address: str = Field(min_length=1, max_length=120)


def check_address(network: str, address: str) -> str:
    """The cleaned wallet address, or a 422 that says what is wrong with it."""

    cleaned = address.strip()
    spec = NETWORKS[network]
    if not re.match(spec["pattern"], cleaned):
        raise HTTPException(
            status_code=422,
            detail=f"That does not look like a {spec['label']} address. Check it and the network you picked.",
        )
    return cleaned


@router.get("")
def my_refunds(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
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
        ok, why, used = eligibility(db, order, rules, now)
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
                "paid_at": aware(order.paid_at) or aware(order.created_at),
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
def request_refund(payload: RefundIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
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
    details = " ".join(payload.details.split())[:1000]
    wallet = check_address(payload.network, payload.address)
    row = RefundRequest(
        order_id=order.id,
        user_id=user.id,
        reason=payload.reason,
        details=details,
        tokens_used=used,
        refund_network=payload.network,
        refund_address=wallet,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    reason_text = REASONS[payload.reason] + (f": {details}" if details else "")
    refund_to = f"{NETWORKS[payload.network]['label']} {wallet}"
    log_activity(db, user.id, "refund", f"Asked for a refund of ${order.amount_usd:g} ({reason_text})")
    plan = get_token_plans(db).get(order.plan_id)
    notify.refund_requested(
        order, user.email, plan.label if plan else order.plan_id, currency(db), reason_text, used,
        name=user.display_name, refund_to=refund_to,
    )
    mailer.send_kind(
        db,
        user,
        "refund_requested",
        {"plan": _label(db, order), "reason": reason_text, "refund_to": refund_to, **mailer._order_values(db, order)},
    )
    return _request_out(row)  # type: ignore[return-value]


@router.post("/{request_id}/withdraw")
def withdraw_refund(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
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
    # Approve only: the transaction hash / reference of the refund the owner sent.
    refund_tx: str = Field(default="", max_length=200)
    # Approve only: take the order's tokens back and end the period it paid for.
    remove_access: bool = True


def _admin_row(db: Session, row: RefundRequest, rules: dict[str, Any]) -> dict[str, Any]:
    order = db.get(Order, row.order_id)
    user = db.get(User, row.user_id)
    plan = get_token_plans(db).get(order.plan_id) if order else None
    in_rules = True
    why = ""
    if order is not None and row.status == "pending":
        in_rules, why, _used = eligibility(db, order, rules, aware(row.created_at))
    return {
        "id": row.id,
        "status": row.status,
        "reason": REASONS.get(row.reason, row.reason),
        "details": row.details,
        "network": NETWORKS.get(row.refund_network or "", {}).get("label", row.refund_network or ""),
        "address": row.refund_address,
        "refund_tx": row.refund_tx,
        "admin_note": row.admin_note,
        "created_at": aware(row.created_at),
        "decided_at": aware(row.decided_at),
        "decided_by": row.decided_by,
        "tokens_removed": row.tokens_removed,
        "user_id": row.user_id,
        "email": user.email if user else "",
        "name": user.display_name if user else None,
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
    """The owner refunded the payment at the provider: record it and take back what the order gave."""

    row, order, user = _load_pending(db, request_id)
    if order.status not in ("paid", "refunded"):
        raise HTTPException(status_code=409, detail="Only a paid order can be refunded.")
    already = order.status == "refunded"
    now = _now()
    result = {"removed": 0, "ended": False}
    if payload.remove_access:
        result = take_back(db, order, user, now)
    order.status = "refunded"
    note = " ".join(payload.note.split())
    row.status = "approved"
    row.admin_note = note
    row.decided_at = now
    row.decided_by = admin.email
    row.tokens_removed = int(result["removed"])
    row.refund_tx = " ".join(payload.refund_tx.split())
    db.commit()
    reversed_ = "" if already else affiliates.on_order_refunded(db, order)

    detail = f"Approved the ${order.amount_usd:g} refund ({notify.order_ref(order)})"
    if payload.remove_access:
        detail += f"; {result['removed']} tokens taken back" + ("; plan ended now" if result["ended"] else "")
    if reversed_:
        detail += f"; {reversed_}"
    if note:
        detail += f" ({note})"
    audit.record(db, admin, user, "refund_approved", detail)
    log_activity(db, user.id, "refund", f"Refund of ${order.amount_usd:g} approved")
    mailer.send_kind(
        db,
        user,
        "refund_approved",
        {
            "plan": _label(db, order),
            "reason": REASONS.get(row.reason, row.reason),
            "note": note,
            "refund_to": f"{NETWORKS.get(row.refund_network or '', {}).get('label', '')} {row.refund_address or ''}".strip(),
            "refund_tx": row.refund_tx or "-",
            **mailer._order_values(db, order),
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
    db.commit()
    audit.record(db, admin, user, "refund_rejected", f"Rejected the ${order.amount_usd:g} refund" + (f" ({note})" if note else ""))
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
