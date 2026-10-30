"""Token plans: pricing, balances, purchases and consumption.

A token plan is a paid 30-day period. Crypto cannot auto-charge, so every
purchase (subscribe, renew, change plan) starts a new period and grants the
plan's tokens; one generation (one uploaded file x one variant) costs the
plan's ``tokens_per_generation``. Extra tokens come from top-ups bought at
the plan's rate. Everything is a signed row in ``token_ledger`` split into
two buckets:

* ``subscription`` - granted each period, spent first, rolled over at the
  next purchase up to the plan's cap (``rollover_months`` x tokens) and
  written off beyond it, or entirely on a downgrade, after a cancellation or
  when the renewal comes later than the grace window.
* ``topup`` - never expires, spent after the subscription bucket, and frozen
  (kept but unusable) while the subscription has lapsed.

The defaults below are the owner's price list; an admin can edit them from
the panel, which stores overrides in app settings (``token_plans``,
``token_topups`` and ``billing_rules``).

Accounts that predate token billing have ``billing_mode == 'legacy'`` and
keep the monthly file quota from ``plans.py`` until they buy a token plan.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .activity import log_activity
from .app_settings import get_setting, set_setting
from .db import BatchRecord, Order, TokenLedger, User
from .plans import aware, check_allowance, plan_expired

logger = logging.getLogger(__name__)

SUBSCRIPTION = "subscription"
TOPUP = "topup"
LEGACY = "legacy"
TOKENS = "tokens"

PLAN_SETTING = "token_plans"
TOPUP_SETTING = "token_topups"
RULES_SETTING = "billing_rules"


# --------------------------------------------------------------------------
# pricing
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class TokenPlan:
    id: str
    label: str
    price: float  # per 30-day period, USD
    tokens: int  # granted each period
    tokens_per_generation: int
    rollover_months: int  # the cap is rollover_months x tokens
    topup_rate: int  # tokens per 1 USD on a top-up

    @property
    def generations(self) -> int:
        return self.tokens // self.tokens_per_generation if self.tokens_per_generation else 0

    @property
    def price_per_generation(self) -> float:
        return round(self.price / self.generations, 2) if self.generations else 0.0

    @property
    def rollover_cap(self) -> int:
        return self.rollover_months * self.tokens

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "price": self.price,
            "tokens": self.tokens,
            "tokens_per_generation": self.tokens_per_generation,
            "generations": self.generations,
            "price_per_generation": self.price_per_generation,
            "rollover_months": self.rollover_months,
            "rollover_cap": self.rollover_cap,
            "topup_rate": self.topup_rate,
        }


DEFAULT_PLANS: dict[str, TokenPlan] = {
    plan.id: plan
    for plan in (
        TokenPlan("starter", "Starter", 37.50, 1500, 100, 0, 40),
        TokenPlan("pro", "Pro", 89.0, 4500, 90, 1, 50),
        TokenPlan("max", "Max", 149.0, 9600, 80, 2, 65),
    )
}
PLAN_IDS = tuple(DEFAULT_PLANS)

# Top-up amounts in USD and the bonus tokens each amount earns per plan. The
# bonus follows the dollar amount on every purchase, the first one included.
DEFAULT_TOPUPS: dict[str, Any] = {
    "amounts": [20, 40, 80, 160, 240],
    "bonus": {
        "starter": {"20": 0, "40": 100, "80": 300, "160": 1000, "240": 1900},
        "pro": {"20": 0, "40": 100, "80": 400, "160": 1200, "240": 2400},
        "max": {"20": 0, "40": 150, "80": 500, "160": 1550, "240": 3100},
    },
}

DEFAULT_RULES: dict[str, int] = {"grace_days": 7, "period_days": 30}


def get_token_plans(db: Session) -> dict[str, TokenPlan]:
    """The three plans with any admin edits applied."""

    overrides = get_setting(db, PLAN_SETTING, {}) or {}
    plans: dict[str, TokenPlan] = {}
    for plan_id, base in DEFAULT_PLANS.items():
        edit = overrides.get(plan_id) or {}
        plans[plan_id] = replace(
            base,
            label=str(edit.get("label", base.label)),
            price=float(edit.get("price", base.price)),
            tokens=int(edit.get("tokens", base.tokens)),
            tokens_per_generation=int(edit.get("tokens_per_generation", base.tokens_per_generation)),
            rollover_months=int(edit.get("rollover_months", base.rollover_months)),
            topup_rate=int(edit.get("topup_rate", base.topup_rate)),
        )
    return plans


def save_token_plans(db: Session, plans: dict[str, dict[str, Any]]) -> None:
    overrides = dict(get_setting(db, PLAN_SETTING, {}) or {})
    for plan_id, data in plans.items():
        overrides[plan_id] = {**(overrides.get(plan_id) or {}), **data}
    set_setting(db, PLAN_SETTING, overrides)


def get_topups(db: Session) -> dict[str, Any]:
    """Allowed top-up amounts and the bonus table, as stored (string keys)."""

    stored = get_setting(db, TOPUP_SETTING, None) or {}
    amounts = [int(a) for a in (stored.get("amounts") or DEFAULT_TOPUPS["amounts"])]
    bonus: dict[str, dict[str, int]] = {}
    for plan_id in PLAN_IDS:
        table = (stored.get("bonus") or {}).get(plan_id) or DEFAULT_TOPUPS["bonus"][plan_id]
        bonus[plan_id] = {str(int(amount)): int(value) for amount, value in table.items()}
    return {"amounts": amounts, "bonus": bonus}


def save_topups(db: Session, topups: dict[str, Any]) -> None:
    set_setting(db, TOPUP_SETTING, topups)


def get_billing_rules(db: Session) -> dict[str, int]:
    stored = get_setting(db, RULES_SETTING, {}) or {}
    return {key: int(stored.get(key, default)) for key, default in DEFAULT_RULES.items()}


def save_billing_rules(db: Session, rules: dict[str, int]) -> None:
    set_setting(db, RULES_SETTING, {**get_billing_rules(db), **rules})


def topup_bonus(plan: TokenPlan, amount: int, topups: dict[str, Any] | None = None) -> int:
    table = (topups or DEFAULT_TOPUPS)["bonus"].get(plan.id) or {}
    return int(table.get(str(int(amount)), table.get(int(amount), 0)) or 0)


def topup_tokens(plan: TokenPlan, amount: int, topups: dict[str, Any] | None = None) -> int:
    """Tokens a top-up of ``amount`` USD credits on ``plan``, bonus included."""

    return int(amount) * plan.topup_rate + topup_bonus(plan, amount, topups)


def topup_options(plan: TokenPlan | None, topups: dict[str, Any]) -> list[dict[str, Any]]:
    """The top-up picker for one plan: amount, base tokens, bonus, total, generations."""

    if plan is None:
        return []
    options = []
    for amount in topups["amounts"]:
        bonus = topup_bonus(plan, amount, topups)
        total = amount * plan.topup_rate + bonus
        options.append(
            {
                "amount": amount,
                "tokens": amount * plan.topup_rate,
                "bonus": bonus,
                "total": total,
                "generations": total // plan.tokens_per_generation if plan.tokens_per_generation else 0,
            }
        )
    return options


# --------------------------------------------------------------------------
# state helpers
# --------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def subscription_active(user: User, now: datetime | None = None) -> bool:
    end = aware(user.sub_period_end)
    return end is not None and (now or _now()) < end


def grace_until(user: User, rules: dict[str, int]) -> datetime | None:
    end = aware(user.sub_period_end)
    return end + timedelta(days=rules["grace_days"]) if end else None


def in_grace(user: User, rules: dict[str, int], now: datetime | None = None) -> bool:
    """True between period_end and period_end + grace: lapsed, but a renewal keeps the rollover."""

    now = now or _now()
    until = grace_until(user, rules)
    return until is not None and not subscription_active(user, now) and now <= until


def days_left(user: User, now: datetime | None = None) -> int:
    end = aware(user.sub_period_end)
    if end is None:
        return 0
    seconds = (end - (now or _now())).total_seconds()
    return max(0, math.ceil(seconds / 86400))


def uses_tokens(user: User, now: datetime | None = None) -> bool:
    """Whether the token rules apply: tokens mode, or a legacy plan that has run out."""

    return user.billing_mode != LEGACY or plan_expired(user, now)


def generation_cost(user: User, plans: dict[str, TokenPlan] | None = None) -> int:
    """Tokens one generation costs this user: the snapshot taken at purchase."""

    if user.sub_tokens_per_generation:
        return int(user.sub_tokens_per_generation)
    plan = (plans or DEFAULT_PLANS).get(user.sub_plan or "")
    return plan.tokens_per_generation if plan else 0


def balances(db: Session, user: User) -> tuple[int, int]:
    """(subscription tokens, top-up tokens) as the ledger sums them."""

    rows = db.execute(
        select(TokenLedger.bucket, func.coalesce(func.sum(TokenLedger.amount), 0))
        .where(TokenLedger.user_id == user.id)
        .group_by(TokenLedger.bucket)
    ).all()
    totals = {bucket: int(total or 0) for bucket, total in rows}
    return totals.get(SUBSCRIPTION, 0), totals.get(TOPUP, 0)


def usable_tokens(db: Session, user: User, now: datetime | None = None) -> int:
    """Tokens the user can spend right now: nothing unless the subscription is active."""

    if not subscription_active(user, now):
        return 0
    sub, top = balances(db, user)
    return max(0, sub + top)


def _entry(
    db: Session,
    user_id: int,
    bucket: str,
    kind: str,
    amount: int,
    *,
    batch_id: str | None = None,
    order_id: str | None = None,
    note: str = "",
) -> TokenLedger:
    row = TokenLedger(
        user_id=user_id,
        bucket=bucket,
        kind=kind,
        amount=int(amount),
        batch_id=batch_id,
        order_id=order_id,
        note=note[:500],
    )
    db.add(row)
    return row


# --------------------------------------------------------------------------
# allowance
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Quote:
    generations: int
    cost_per_generation: int
    cost: int
    available: int
    refusal: str | None

    @property
    def allowed(self) -> bool:
        return self.refusal is None


def quote_batch(db: Session, user: User, files: int, variants: int, now: datetime | None = None) -> Quote:
    """Price a batch of ``files`` x ``variants`` generations and say whether it may run."""

    now = now or _now()
    generations = max(0, files) * max(1, variants)
    per_generation = generation_cost(user, get_token_plans(db))
    cost = generations * per_generation

    if user.sub_plan is None:
        return Quote(generations, per_generation, cost, 0, "Subscribe to a plan to start generating.")
    if not subscription_active(user, now):
        plans = get_token_plans(db)
        label = plans[user.sub_plan].label if user.sub_plan in plans else user.sub_plan
        ended = aware(user.sub_period_end)
        when = f"{ended:%d %b %Y}" if ended else "recently"
        return Quote(generations, per_generation, cost, 0, f"Your {label} period ended on {when}. Renew to continue.")

    sub, top = balances(db, user)
    available = max(0, sub + top)
    if cost > available:
        noun = "generation" if generations == 1 else "generations"
        return Quote(
            generations,
            per_generation,
            cost,
            available,
            f"This batch needs {cost} tokens ({generations} {noun}) but you have {available}. "
            "Top up or upgrade your plan.",
        )
    return Quote(generations, per_generation, cost, available, None)


def check_billing(db: Session, user: User, files: int, variants: int) -> str | None:
    """Why ``user`` may not run this batch, or None if they may.

    Legacy accounts whose plan has not run out keep the monthly file quota
    exactly as before; everyone else needs an active subscription and enough
    tokens. The message is shown to the user with a 402.
    """

    if not uses_tokens(user):
        return check_allowance(db, user, files * max(1, variants))
    return quote_batch(db, user, files, variants).refusal


class InsufficientTokens(Exception):
    """The deduction was refused because the balance changed since the batch was quoted."""

    def __init__(self, quote: Quote) -> None:
        super().__init__(quote.refusal or "Not enough tokens.")
        self.quote = quote


def _lock_user(db: Session, user: User) -> None:
    """Serialise ledger writes per user for the rest of the transaction.

    An UPDATE that changes nothing still takes the row lock on Postgres and
    the write lock on SQLite, so two requests for the same account cannot
    both read the balance before either has written its deduction. The
    lock is released by the caller's commit or rollback.
    """

    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(token_version=User.token_version)
        .execution_options(synchronize_session=False)
    )


def consume(db: Session, user: User, generations: int, batch_id: str) -> int:
    """Charge ``generations`` to the user, subscription bucket first, and commit.

    The balance is read again under a per-user lock and the batch is refused
    with ``InsufficientTokens`` when it no longer covers the cost, so two
    batches submitted at once cannot both spend the same tokens. Returns the
    tokens taken. Legacy accounts still on their quota pay nothing.
    """

    if generations <= 0 or not uses_tokens(user):
        return 0
    per_generation = generation_cost(user, get_token_plans(db))
    cost = generations * per_generation
    if cost <= 0:
        return 0

    try:
        _lock_user(db, user)
        sub, top = balances(db, user)
        if not subscription_active(user) or cost > sub + top:
            quote = quote_batch(db, user, generations, 1)
            if quote.allowed:  # the period is live but the locked balance says no
                quote = replace(
                    quote,
                    available=max(0, sub + top),
                    refusal=(
                        f"This batch needs {cost} tokens but you have {max(0, sub + top)}. "
                        "Top up or upgrade your plan."
                    ),
                )
            raise InsufficientTokens(quote)
        from_sub = min(cost, max(0, sub))
        from_top = cost - from_sub
        noun = "generation" if generations == 1 else "generations"
        note = f"{generations} {noun} x {per_generation} tokens"
        if from_sub:
            _entry(db, user.id, SUBSCRIPTION, "consume", -from_sub, batch_id=batch_id, note=note)
        if from_top:
            _entry(db, user.id, TOPUP, "consume", -from_top, batch_id=batch_id, note=note)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return cost


# --------------------------------------------------------------------------
# purchases
# --------------------------------------------------------------------------


def activate_period(
    db: Session,
    user: User,
    plan: TokenPlan,
    *,
    periods: int = 1,
    tokens: int | None = None,
    tokens_per_generation: int | None = None,
    order_id: str | None = None,
    note: str = "",
    now: datetime | None = None,
) -> dict[str, int]:
    """Start a new paid period on ``plan`` (subscribe, renew or change plan).

    The period runs ``period_days`` x ``periods`` from the later of now and
    the old end, so unused days are never lost. The subscription bucket is
    settled first: what is left rolls over up to the new plan's cap when the
    plan is the same or better, the previous one was not cancelled and the
    purchase is within the grace window; the rest is written off. Then the
    tokens are granted: ``tokens`` and ``tokens_per_generation`` as quoted on
    the order when given, else the plan's current figures. Does not commit;
    the caller does.
    """

    now = now or _now()
    rules = get_billing_rules(db)
    plans = get_token_plans(db)
    old_plan = plans.get(user.sub_plan or "")
    old_end = aware(user.sub_period_end)
    leftover, _top = balances(db, user)
    leftover = max(0, leftover)

    rollover = 0
    reason = ""
    if leftover and old_plan is None:
        reason = "no previous plan"
    elif leftover:
        if user.sub_cancelled_at is not None:
            reason = "previous period was cancelled"
        elif plan.price < old_plan.price:
            reason = f"downgrade from {old_plan.label}"
        elif old_end is not None and now > old_end + timedelta(days=rules["grace_days"]):
            reason = f"renewed more than {rules['grace_days']} days after the period ended"
        else:
            rollover = min(leftover, plan.rollover_cap)
            if rollover < leftover:
                reason = f"over the {plan.label} rollover cap of {plan.rollover_cap}"

    # Rolled-over tokens never leave the bucket, so the only ledger row is the
    # write-off of what was lost; the grant's note says what was kept.
    written_off = leftover - rollover
    if written_off:
        _entry(
            db,
            user.id,
            SUBSCRIPTION,
            "expire",
            -written_off,
            order_id=order_id,
            note=f"{written_off} of {leftover} left from the previous period written off"
            + (f": {reason}" if reason else ""),
        )

    granted = int(tokens) if tokens else plan.tokens * max(1, periods)
    grant_note = (note or f"{plan.label} period") + (f" x{periods}" if periods > 1 else "")
    if rollover:
        grant_note += f" ({rollover} rolled over)"
    _entry(db, user.id, SUBSCRIPTION, "grant", granted, order_id=order_id, note=grant_note)

    base = old_end if old_end is not None and old_end > now else now
    user.billing_mode = TOKENS
    user.sub_plan = plan.id
    user.sub_period_start = now
    user.sub_period_end = base + timedelta(days=rules["period_days"] * max(1, periods))
    user.sub_cancelled_at = None
    user.sub_tokens_per_generation = int(tokens_per_generation or plan.tokens_per_generation)
    return {"granted": granted, "rollover": rollover, "expired": written_off}


def apply_topup(
    db: Session,
    user: User,
    plan: TokenPlan,
    amount: int,
    *,
    tokens: int | None = None,
    bonus: int | None = None,
    order_id: str | None = None,
    note: str = "",
) -> dict[str, int]:
    """Credit a top-up of ``amount`` USD. Does not commit.

    ``tokens`` (bonus included) and ``bonus`` are what the order quoted at
    checkout; without them the current rate and bonus table are used.
    """

    if tokens is None:
        bonus = topup_bonus(plan, amount, get_topups(db))
        base = int(amount) * plan.topup_rate
    else:
        bonus = max(0, min(int(tokens), int(bonus or 0)))
        base = int(tokens) - bonus
    label = note or f"${amount:g} top-up on {plan.label}"
    _entry(db, user.id, TOPUP, "topup", base, order_id=order_id, note=label)
    if bonus:
        _entry(db, user.id, TOPUP, "bonus", bonus, order_id=order_id, note=f"bonus for the ${amount:g} top-up")
    return {"tokens": base, "bonus": bonus, "total": base + bonus}


def new_order(
    db: Session,
    user: User,
    kind: str,
    plan: TokenPlan,
    amount: float,
    tokens: int,
    *,
    bonus: int = 0,
    provider: str = "btcpay",
) -> Order:
    """Record a purchase with the credit it was quoted at, so a later settlement applies exactly that.

    ``provider`` names who will take the money ('btcpay' or 'volet'); the
    route that starts the checkout fills in that provider's own ids after.
    """

    order = Order(
        id=uuid.uuid4().hex,
        user_id=user.id,
        kind=kind,
        plan_id=plan.id,
        amount_usd=float(amount),
        tokens=int(tokens),
        bonus_tokens=int(bonus),
        tokens_per_generation=plan.tokens_per_generation,
        status="pending",
        provider=provider,
    )
    db.add(order)
    db.commit()
    return order


# Statuses a settlement may move to 'paid'. An expired or invalid order was
# never credited, so a payment that BTCPay confirms late is still applied once.
SETTLEABLE = ("pending", "expired", "invalid")


def settle_order(db: Session, order: Order, *, source: str = "BTCPay", note: str = "", periods: int = 1) -> bool:
    """Apply a paid order exactly once. Returns False when it was already paid.

    Shared by the webhook, the order poll and the admin grant so there is one
    place that moves tokens. The order is claimed with a conditional UPDATE
    (status still settleable -> paid) in the same transaction as the ledger
    rows and the user's period, so a webhook and a poll that overlap, or two
    deliveries of the same event, credit the order once: the second one's
    claim matches no row and it backs off.
    """

    if order.status not in SETTLEABLE:
        return False
    user = db.get(User, order.user_id)
    plans = get_token_plans(db)
    plan = plans.get(order.plan_id)
    if user is None or plan is None:
        void_order(db, order, "invalid")
        logger.warning("order %s cannot be applied: user or plan missing", order.id)
        return False

    now = _now()
    paid_late = order.status != "pending"
    try:
        claimed = db.execute(
            update(Order)
            .where(Order.id == order.id, Order.status.in_(SETTLEABLE))
            .values(status="paid", paid_at=now, applied_at=now)
            .execution_options(synchronize_session=False)
        ).rowcount
        if claimed != 1:
            db.rollback()
            db.refresh(order)
            return False
        if order.kind == "subscription":
            activate_period(
                db,
                user,
                plan,
                periods=periods,
                tokens=order.tokens,
                tokens_per_generation=order.tokens_per_generation,
                order_id=order.id,
                note=note,
                now=now,
            )
            what = f"{plan.label} period" + (f" x{periods}" if periods > 1 else "")
        else:
            apply_topup(
                db,
                user,
                plan,
                int(round(order.amount_usd)),
                tokens=order.tokens,
                bonus=order.bonus_tokens,
                order_id=order.id,
                note=note,
            )
            what = f"a ${order.amount_usd:g} top-up on {plan.label}"
        db.commit()
    except BaseException:
        db.rollback()  # the claim goes too, so the order stays settleable
        raise
    db.refresh(order)

    if order.amount_usd:
        detail = f"Paid ${order.amount_usd:g} for {what} ({source})"
        if paid_late:
            detail += " - paid after the invoice had expired"
    else:
        detail = f"{what.capitalize()} {note or 'granted'} ({source})"
    log_activity(db, user.id, "payment", detail)
    return True


def void_order(db: Session, order: Order, status: str) -> bool:
    """Mark a pending order expired or invalid. Paid orders are left alone."""

    if order.status != "pending":
        return False
    order.status = status
    db.commit()
    return True


# --------------------------------------------------------------------------
# refunds
# --------------------------------------------------------------------------


def refund_asset(asset_id: str) -> int:
    """Give back one generation's tokens for an asset that failed to render.

    Runs on the worker after a FAILED update, so it opens its own session and
    never raises: a refund that cannot be made is logged and skipped. Each
    asset is refunded at most once (the ledger note ``refund <asset id>`` is
    the marker). Tokens go back to the bucket they were taken from, the
    subscription bucket first. Returns the tokens refunded.
    """

    try:
        from .db import get_session_factory
        from .storage import get_store

        asset = get_store().get_asset(asset_id)
        if asset is None:
            return 0
        with get_session_factory()() as db:
            return _refund_in_session(db, asset.batch_id, asset_id)
    except Exception:  # noqa: BLE001 - a missed refund must never break a render
        logger.warning("could not refund tokens for asset %s", asset_id, exc_info=True)
        return 0


def _refund_in_session(db: Session, batch_id: str, asset_id: str) -> int:
    marker = f"refund {asset_id}"
    already = db.execute(
        select(func.count(TokenLedger.id)).where(TokenLedger.batch_id == batch_id, TokenLedger.note == marker)
    ).scalar_one()
    if already:
        return 0

    rows = db.execute(
        select(TokenLedger.user_id, TokenLedger.bucket, TokenLedger.kind, TokenLedger.amount).where(
            TokenLedger.batch_id == batch_id, TokenLedger.kind.in_(("consume", "refund"))
        )
    ).all()
    if not rows:
        return 0  # a legacy batch, or one that was never charged

    user_id = rows[0][0]
    consumed = {SUBSCRIPTION: 0, TOPUP: 0}
    refunded = {SUBSCRIPTION: 0, TOPUP: 0}
    for _uid, bucket, kind, amount in rows:
        if kind == "consume":
            consumed[bucket] += -int(amount)
        else:
            refunded[bucket] += int(amount)
    total = consumed[SUBSCRIPTION] + consumed[TOPUP]

    record = db.get(BatchRecord, batch_id)
    generations = record.asset_count if record and record.asset_count else 0
    if not generations:
        from .storage import get_store

        generations = len(get_store().list_asset_ids(batch_id))
    per_generation = total // generations if generations else 0
    if per_generation <= 0:
        return 0

    remaining = per_generation
    for bucket in (SUBSCRIPTION, TOPUP):
        room = consumed[bucket] - refunded[bucket]
        give = min(remaining, max(0, room))
        if give:
            _entry(db, user_id, bucket, "refund", give, batch_id=batch_id, note=marker)
            remaining -= give
    db.commit()
    return per_generation - remaining


# --------------------------------------------------------------------------
# client payloads
# --------------------------------------------------------------------------


def subscription_summary(db: Session, user: User, now: datetime | None = None) -> dict[str, Any] | None:
    """The ``subscription`` block of the client payload, or None if never subscribed."""

    if user.sub_plan is None:
        return None
    now = now or _now()
    rules = get_billing_rules(db)
    plans = get_token_plans(db)
    plan = plans.get(user.sub_plan)
    return {
        "plan_id": user.sub_plan,
        "plan_label": plan.label if plan else user.sub_plan,
        "price": plan.price if plan else 0.0,
        "tokens_per_generation": generation_cost(user, plans),
        "period_start": aware(user.sub_period_start),
        "period_end": aware(user.sub_period_end),
        "active": subscription_active(user, now),
        "days_left": days_left(user, now),
        "cancelled": user.sub_cancelled_at is not None,
        "grace_until": grace_until(user, rules),
        "in_grace": in_grace(user, rules, now),
    }


def balance_summary(db: Session, user: User, now: datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    sub, top = balances(db, user)
    active = subscription_active(user, now)
    usable = max(0, sub + top) if active else 0
    per_generation = generation_cost(user, get_token_plans(db))
    return {
        "subscription_tokens": sub,
        "topup_tokens": top,
        "usable_tokens": usable,
        "generations_left": usable // per_generation if per_generation else 0,
        "frozen_topup": top > 0 and not active,
    }


def billing_alerts(db: Session, user: User, now: datetime | None = None) -> list[dict[str, str]]:
    """In-app reminders for the workspace banner and the plan page."""

    now = now or _now()
    if not uses_tokens(user, now):
        return []
    alerts: list[dict[str, str]] = []
    subscription = subscription_summary(db, user, now)
    if subscription is None:
        alerts.append(
            {"level": "danger", "code": "no_subscription", "text": "Subscribe to a plan to start generating."}
        )
        return alerts

    label = subscription["plan_label"]
    end = subscription["period_end"]
    if not subscription["active"]:
        until = subscription["grace_until"]
        grace_left = max(0, math.ceil((until - now).total_seconds() / 86400)) if until else 0
        text = f"Your {label} period ended on {end:%d %b %Y}."
        if grace_left:
            noun = "day" if grace_left == 1 else "days"
            text += f" Renew within {grace_left} {noun} to keep your rolled-over tokens."
        else:
            text += " Renew to continue."
        alerts.append({"level": "danger", "code": "ended", "text": text})
        return alerts

    if subscription["cancelled"]:
        alerts.append(
            {
                "level": "info",
                "code": "cancelled",
                "text": f"Your subscription is cancelled and ends on {end:%d %b %Y}. Buy a plan to keep going.",
            }
        )
    left = subscription["days_left"]
    if left <= 5:
        noun = "day" if left == 1 else "days"
        alerts.append(
            {
                "level": "warning",
                "code": "ends_soon",
                "text": f"Your {label} period ends in {left} {noun} ({end:%d %b %Y}). Renew to keep your tokens rolling over.",
            }
        )
    balance = balance_summary(db, user, now)
    if balance["generations_left"] < 2:
        alerts.append(
            {
                "level": "warning",
                "code": "low_tokens",
                "text": f"You have {balance['usable_tokens']} tokens left ({balance['generations_left']} generations). Top up or upgrade.",
            }
        )
    return alerts
