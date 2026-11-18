"""Referral and partner program: links, coupons, rewards, commissions and payouts.

Two independent channels bring customers in, and a customer belongs to one
of them only (the last link or coupon used before the first payment wins):

* ``friend`` - every active subscriber has a personal link and coupon. The
  friend gets a percentage off the first subscription payment on the plans
  the program covers, and the referrer is rewarded in tokens once the
  friend has paid and stayed for the hold period.
* ``partner`` - approved creators. Their audience gets a percentage off the
  first payment, and the creator earns a share of everything those
  customers actually pay (subscriptions, renewals, upgrades, top-ups). The
  share comes from a monthly tier ladder counted on paying customers.

Every number lives in the ``affiliate_program`` app setting and is edited
from Admin > Affiliates. Money is never moved by the app: a payout is the
owner sending funds by hand and recording it here.

Payments reach this module from one place, ``tokens.settle_order``, so
Whop, manual approvals and Telegram approvals all count the same.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from . import whop
from .app_settings import get_setting, set_setting
from .config import settings
from .db import (
    AffiliateCommission,
    AffiliatePartner,
    AffiliatePayout,
    AffiliatePayoutRequest,
    Order,
    Referral,
    ReferralClick,
    ReferralCode,
    TokenLedger,
    User,
    UserDevice,
)
from .plans import aware

logger = logging.getLogger(__name__)

FRIEND = "friend"
PARTNER = "partner"
SETTING = "affiliate_program"
COOKIE = "pf_ref"
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,23}$")
MIN_WITHDRAWAL_USD = 100.0

DEFAULTS: dict[str, Any] = {
    # Days a clicked link keeps counting.
    "link_days": 30,
    "friend": {
        "enabled": True,
        "discount_pct": 0.0,
        "plans": ["starter", "pro", "max"],
        "reward_tokens": {"starter": 300, "pro": 750, "max": 1250},  # by the friend's plan
        "hold_days": 7,
        "monthly_cap": 10,
    },
    "partner": {
        "enabled": True,
        "applications_open": True,
        "discount_pct": 0.0,
        "plans": ["starter", "pro", "max"],
        # Share of collected revenue by paying customers in the month.
        "tiers": [{"min": 0, "pct": 25.0}, {"min": 20, "pct": 30.0}, {"min": 50, "pct": 35.0}],
        "hold_days": 30,
        "min_payout": MIN_WITHDRAWAL_USD,
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------


def get_program(db: Session) -> dict[str, Any]:
    saved = get_setting(db, SETTING, {}) or {}
    program: dict[str, Any] = {"link_days": int(saved.get("link_days", DEFAULTS["link_days"]))}
    for channel in (FRIEND, PARTNER):
        merged = dict(DEFAULTS[channel])
        merged.update(saved.get(channel) or {})
        # Promo discounts come strictly from Whop Promo Codes, never app-side defaults.
        merged["discount_pct"] = 0.0
        program[channel] = merged
    tiers = sorted(program[PARTNER]["tiers"], key=lambda tier: tier["min"])
    program[PARTNER]["tiers"] = tiers or DEFAULTS[PARTNER]["tiers"]
    program[PARTNER]["min_payout"] = max(MIN_WITHDRAWAL_USD, float(program[PARTNER].get("min_payout") or MIN_WITHDRAWAL_USD))
    return program


def save_program(db: Session, program: dict[str, Any]) -> None:
    set_setting(db, SETTING, program)


def tier_pct(program: dict[str, Any], paying_customers: int) -> float:
    pct = 0.0
    for tier in program[PARTNER]["tiers"]:
        if paying_customers >= int(tier["min"]):
            pct = float(tier["pct"])
    return pct


# --------------------------------------------------------------------------
# fingerprints (hashed, for the self-referral check only)
# --------------------------------------------------------------------------


def _hash(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    return hashlib.sha256(f"{settings.secret_key}:{value}".encode()).hexdigest()


def device_hash(raw: str | None) -> str:
    raw = (raw or "").strip()
    return _hash(raw[:100]) if 8 <= len(raw) <= 100 else ""


def ip_hash(ip: str | None) -> str:
    return _hash(ip or "")


def payer_hash(account: str | None) -> str:
    """Hash of the account a payment came from (Whop buyer id or email), when provided."""

    return _hash((account or "").strip().upper())


def same_payer(db: Session, order: Order, referrer_id: int) -> bool:
    """True when this payment came from an account the referrer has paid from themselves."""

    if not order.payer_hash:
        return False
    return bool(
        db.execute(
            select(func.count(Order.id)).where(Order.user_id == referrer_id, Order.payer_hash == order.payer_hash)
        ).scalar_one()
    )


def remember_device(db: Session, user: User, device: str, ip: str) -> None:
    """Note the browser/network an account signed in from. Never breaks the request."""

    if not device and not ip:
        return
    try:
        found = db.execute(
            select(UserDevice).where(
                UserDevice.user_id == user.id, UserDevice.device_hash == device, UserDevice.ip_hash == ip
            )
        ).scalar_one_or_none()
        if found is None:
            db.add(UserDevice(user_id=user.id, device_hash=device, ip_hash=ip))
        else:
            found.seen_at = _now()
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not record device for user %s", user.id, exc_info=True)


def _mailbox(email: str) -> str:
    """The mailbox behind an address: plus-tags dropped, and dots for Gmail."""

    local, _, domain = email.lower().partition("@")
    local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def self_referral_flags(db: Session, referrer: User, referred: User, device: str = "", ip: str = "") -> list[str]:
    """Why this looks like someone referring themselves. 'device'/'email' block; 'ip' is for review."""

    flags: list[str] = []
    if referrer.id == referred.id or _mailbox(referrer.email) == _mailbox(referred.email):
        flags.append("email")
    theirs = db.execute(select(UserDevice.device_hash, UserDevice.ip_hash).where(UserDevice.user_id == referrer.id)).all()
    mine = db.execute(select(UserDevice.device_hash, UserDevice.ip_hash).where(UserDevice.user_id == referred.id)).all()
    my_devices = {d for d, _ in mine if d} | ({device} if device else set())
    my_ips = {i for _, i in mine if i} | ({ip} if ip else set())
    if my_devices & {d for d, _ in theirs if d}:
        flags.append("device")
    if my_ips & {i for _, i in theirs if i}:
        flags.append("ip")
    return flags


BLOCKING_FLAGS = {"email", "device"}


# --------------------------------------------------------------------------
# codes
# --------------------------------------------------------------------------


def normalise_code(raw: str | None) -> str:
    return re.sub(r"\s+", "", (raw or "")).upper()[:40]


def valid_code(code: str) -> bool:
    return bool(CODE_RE.match(code))


def find_code(db: Session, raw: str | None) -> ReferralCode | None:
    code = normalise_code(raw)
    if not code:
        return None
    return db.execute(select(ReferralCode).where(ReferralCode.code == code)).scalar_one_or_none()


def _stem(user: User) -> str:
    base = user.display_name or user.email.split("@", 1)[0]
    stem = re.sub(r"[^A-Z0-9]", "", base.upper())[:10]
    return stem if len(stem) >= 3 else "FRIEND"


def friend_code(db: Session, user: User) -> ReferralCode:
    """The user's personal friend code, made on first use (their name plus a few digits)."""

    found = db.execute(
        select(ReferralCode).where(ReferralCode.user_id == user.id, ReferralCode.channel == FRIEND)
    ).scalar_one_or_none()
    if found is not None:
        return found
    stem = _stem(user)
    for _ in range(20):
        code = f"{stem}{secrets.randbelow(900) + 100}"
        if find_code(db, code) is None:
            break
    else:  # pragma: no cover - 20 collisions in a row
        code = f"PF{secrets.token_hex(4).upper()}"
    row = ReferralCode(user_id=user.id, code=code, channel=FRIEND)
    db.add(row)
    db.commit()
    return row


def partner_code(db: Session, user_id: int) -> ReferralCode | None:
    return db.execute(
        select(ReferralCode).where(ReferralCode.user_id == user_id, ReferralCode.channel == PARTNER)
    ).scalar_one_or_none()


def code_usable(db: Session, code: ReferralCode, program: dict[str, Any] | None = None) -> str | None:
    """Why a code cannot be used right now, or None when it can."""

    from .tokens import subscription_active

    program = program or get_program(db)
    if code.status != "active" or not program[code.channel]["enabled"]:
        return "This code is not active."
    owner = db.get(User, code.user_id)
    if owner is None or not owner.is_active:
        return "This code is not active."
    if code.channel == FRIEND:
        if not subscription_active(owner):
            return "This code is not active right now."
    else:
        partner = db.get(AffiliatePartner, code.user_id)
        if partner is None or partner.status != "approved":
            return "This code is not active."
    return None


def compute_discounted_price(price: float, promo_type: str, amount_off: float) -> tuple[float, float]:
    """Apply a Whop promo reduction cleanly onto the real base price (never launch compare-at)."""

    base = round(float(price), 2)
    off = float(amount_off or 0.0)
    if off <= 0:
        return (base, 0.0)
    if promo_type == "flat_amount":
        final = round(max(0.0, base - off), 2)
        return (final, round(base - final, 2))
    pct = max(0.0, min(100.0, off))
    final = round(base * (100.0 - pct) / 100.0, 2)
    return (final, round(base - final, 2))


def whop_promo_details(code_str: str, *, bypass_cache: bool = False) -> dict[str, Any] | None:
    """Resolve an active Whop promo code directly from Whop when available."""

    return whop.lookup_promo_code(code_str, bypass_cache=bypass_cache)


def offer_for_code(
    db: Session,
    code: ReferralCode,
    program: dict[str, Any] | None = None,
    *,
    whop_promo: dict[str, Any] | None = None,
) -> dict[str, Any]:
    program = program or get_program(db)
    channel = program[code.channel]
    promo = whop_promo if whop_promo is not None else whop_promo_details(code.code)

    base_offer: dict[str, Any] = {
        "code": code.code,
        "channel": code.channel,
        "promo_type": "percentage",
        "discount_pct": 0.0,
        "discount_amount": 0.0,
        "plans": [],
        "whop_verified": bool(promo and promo.get("verified")),
        "whop_valid": (bool(promo["valid"]) if promo and promo.get("verified") else None),
        "whop_reason": promo.get("reason") if promo and promo.get("verified") else None,
    }
    if promo and promo.get("verified"):
        if not promo.get("valid"):
            return base_offer
        promo_type = str(promo.get("promo_type") or "percentage")
        amount_off = round(float(promo.get("amount_off") or 0.0), 2)
        whop_plans = promo.get("plans") or []
        eligible = [p for p in channel["plans"] if not whop_plans or p in whop_plans]
        base_offer.update(
            promo_type=promo_type,
            discount_pct=amount_off if promo_type == "percentage" else 0.0,
            discount_amount=amount_off if promo_type == "flat_amount" else 0.0,
            plans=eligible,
        )
        return base_offer

    # When Whop promo verification cannot run (no live key or missing promo_code:read),
    # avoid applying any artificial app discount while preserving partner code pre-fill.
    if code.channel == PARTNER:
        base_offer["plans"] = list(channel["plans"])
    return base_offer


# --------------------------------------------------------------------------
# attribution
# --------------------------------------------------------------------------


def record_click(db: Session, code: ReferralCode, device: str, ip: str) -> None:
    """Count a link click, once an hour per browser or network so reloads do not inflate it."""

    try:
        same = [ReferralClick.device_hash == device] if device else []
        same += [ReferralClick.ip_hash == ip] if ip else []
        if same:
            recent = db.execute(
                select(func.count(ReferralClick.id)).where(
                    ReferralClick.code_id == code.id,
                    ReferralClick.created_at >= _now() - timedelta(hours=1),
                    or_(*same),
                )
            ).scalar_one()
            if recent:
                return
        db.add(ReferralClick(code_id=code.id, device_hash=device, ip_hash=ip))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def cookie_value(code: ReferralCode) -> str:
    return f"{code.code}.{int(_now().timestamp())}"


def code_from_cookie(db: Session, raw: str | None, program: dict[str, Any] | None = None) -> ReferralCode | None:
    """The code a visitor's link cookie names, if the click is still inside the window."""

    if not raw or "." not in raw:
        return None
    name, _, stamp = raw.rpartition(".")
    try:
        clicked = datetime.fromtimestamp(int(stamp), timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None
    program = program or get_program(db)
    if _now() - clicked > timedelta(days=int(program["link_days"])):
        return None
    return find_code(db, name)


def has_paid(db: Session, user: User) -> bool:
    count = db.execute(
        select(func.count(Order.id)).where(Order.user_id == user.id, Order.status == "paid", Order.amount_usd > 0)
    ).scalar_one()
    return bool(count) or user.sub_plan is not None


def referral_of(db: Session, user_id: int) -> Referral | None:
    return db.execute(select(Referral).where(Referral.referred_user_id == user_id)).scalar_one_or_none()


class AttributionError(Exception):
    pass


def attribute(
    db: Session, user: User, code: ReferralCode, *, source: str, device: str = "", ip: str = ""
) -> Referral:
    """Tie ``user`` to ``code``. The last code before the first payment wins; after that it is fixed.

    Raises ``AttributionError`` with a message for the customer when the
    code cannot apply to them.
    """

    program = get_program(db)
    problem = code_usable(db, code, program)
    if problem:
        raise AttributionError(problem)
    if code.user_id == user.id:
        raise AttributionError("You cannot use your own code.")
    if has_paid(db, user):
        raise AttributionError("Codes are for new customers, before the first payment.")
    referrer = db.get(User, code.user_id)
    flags = self_referral_flags(db, referrer, user, device, ip)
    blocked = bool(BLOCKING_FLAGS & set(flags))

    row = referral_of(db, user.id)
    if row is None:
        row = Referral(referred_user_id=user.id, referrer_id=code.user_id, code=code.code, channel=code.channel)
        db.add(row)
    elif row.first_order_id is not None:
        raise AttributionError("Codes are for new customers, before the first payment.")
    row.referrer_id = code.user_id
    row.code_id = code.id
    row.code = code.code
    row.channel = code.channel
    row.source = source
    row.flags = ",".join(flags)
    row.device_hash = device or row.device_hash or ""
    row.ip_hash = ip or row.ip_hash or ""
    row.status = "blocked" if blocked else "signed_up"
    row.void_reason = "Looks like a self-referral (same " + " and ".join(sorted(BLOCKING_FLAGS & set(flags))) + ")" if blocked else ""
    db.commit()
    if blocked:
        raise AttributionError("This code cannot be used on your own account.")
    return row


def attribute_signup(db: Session, user: User, cookie: str | None, device: str, ip: str) -> None:
    """At sign-up: tie the new account to the link it arrived through. Never breaks the sign-up."""

    try:
        code = code_from_cookie(db, cookie)
        if code is not None:
            attribute(db, user, code, source="link", device=device, ip=ip)
    except AttributionError:
        pass
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("referral attribution failed for user %s", user.id, exc_info=True)


def checkout_discount(db: Session, user: User, plan_id: str, price: float) -> dict[str, Any] | None:
    """Whop promo discount and checkout pre-fill state for ``user``'s first subscription payment."""

    row = referral_of(db, user.id)
    if row is None or row.status != "signed_up" or row.first_order_id is not None or has_paid(db, user):
        return None
    program = get_program(db)
    code = db.get(ReferralCode, row.code_id) if row.code_id else None
    if code is None or code_usable(db, code, program):
        return None
    offer = offer_for_code(db, code, program)
    if offer.get("whop_verified") and not offer.get("whop_valid"):
        return None
    if plan_id not in offer["plans"]:
        return None
    amount_off = offer["discount_amount"] if offer["promo_type"] == "flat_amount" else offer["discount_pct"]
    amount, discount = compute_discounted_price(price, offer["promo_type"], amount_off)
    if discount <= 0 and row.channel != PARTNER:
        return None
    return {
        "code": row.code,
        "channel": row.channel,
        "promo_type": offer["promo_type"],
        "pct": offer["discount_pct"],
        "discount_amount": offer["discount_amount"],
        "amount": amount,
        "discount": discount,
        "whop_verified": offer["whop_verified"],
        "prefill_promo": discount > 0 or row.channel == PARTNER,
    }


# --------------------------------------------------------------------------
# payments
# --------------------------------------------------------------------------


def _month(when: datetime) -> str:
    return f"{when:%Y-%m}"


def on_order_paid(db: Session, order: Order, *, returning: bool = False) -> None:
    """A real payment was confirmed: start the friend reward clock or book the partner's commission.

    ``returning`` says the customer's subscription had already ended (past
    the grace window) before this payment. A partner earns for as long as
    the customer stays subscribed, so that is where their commission stops.
    """

    if not order.amount_usd or order.amount_usd <= 0:
        return
    row = referral_of(db, order.user_id)
    if row is None or row.status in ("blocked", "void", "ended"):
        return
    program = get_program(db)
    paid_at = aware(order.paid_at) or _now()
    first = row.first_order_id is None
    if same_payer(db, order, row.referrer_id):
        flags = {flag for flag in row.flags.split(",") if flag} | {"payment"}
        row.flags = ",".join(sorted(flags))
        row.status = "blocked"
        row.void_reason = "Looks like a self-referral (paid from the referrer's own payment account)"
        db.commit()
        return

    if row.channel == FRIEND:
        if not first or order.kind != "subscription":
            return
        row.first_order_id = order.id
        row.first_paid_at = paid_at
        row.reward_tokens = int(program[FRIEND]["reward_tokens"].get(order.plan_id, 0))
        row.reward_due_at = paid_at + timedelta(days=int(program[FRIEND]["hold_days"]))
        row.status = "waiting"
        db.commit()
        return

    if returning and not first:
        row.status = "ended"
        row.void_reason = "The customer's subscription had ended before they came back, so the commission stopped"
        db.commit()
        return
    partner = db.get(AffiliatePartner, row.referrer_id)
    if first:
        row.first_order_id = order.id
        row.first_paid_at = paid_at
        row.status = "active"
    if partner is None or partner.status != "approved":
        db.commit()
        return
    exists = db.execute(
        select(func.count(AffiliateCommission.id)).where(
            AffiliateCommission.order_id == order.id, AffiliateCommission.kind == "sale"
        )
    ).scalar_one()
    if not exists:
        db.add(
            AffiliateCommission(
                partner_id=row.referrer_id,
                referral_id=row.id,
                customer_id=order.user_id,
                order_id=order.id,
                amount_usd=float(order.amount_usd),
                month=_month(paid_at),
                payable_at=paid_at + timedelta(days=int(program[PARTNER]["hold_days"])),
            )
        )
    db.commit()


def on_order_refunded(db: Session, order: Order) -> str:
    """Undo what a refunded order earned. Returns a short note of what was reversed."""

    notes: list[str] = []
    row = referral_of(db, order.user_id)
    if row is not None and row.channel == FRIEND and row.first_order_id == order.id:
        if row.reward_given_at is not None and row.reward_tokens:
            from .tokens import REFERRAL, _entry

            _entry(
                db,
                row.referrer_id,
                REFERRAL,
                "clawback",
                -row.reward_tokens,
                order_id=order.id,
                note=f"referral reward taken back: the referred customer was refunded ({row.code})",
            )
            notes.append(f"took back {row.reward_tokens} reward tokens from the referrer")
        elif row.status == "waiting":
            notes.append("cancelled the referrer's pending reward")
        row.status = "void"
        row.void_reason = "The referred customer's first payment was refunded"
    for sale in db.execute(
        select(AffiliateCommission).where(AffiliateCommission.order_id == order.id, AffiliateCommission.kind == "sale")
    ).scalars():
        if sale.status == "paid":
            db.add(
                AffiliateCommission(
                    partner_id=sale.partner_id,
                    referral_id=sale.referral_id,
                    customer_id=sale.customer_id,
                    order_id=sale.order_id,
                    kind="clawback",
                    amount_usd=-sale.amount_usd,
                    month=sale.month,
                    rate_pct=sale.rate_pct,
                    commission_usd=-(sale.commission_usd or 0.0),
                    payable_at=_now(),
                    void_reason="Refunded after the commission was paid",
                )
            )
            notes.append(f"${sale.commission_usd or 0:.2f} commission will come off the partner's next payout")
        elif sale.status != "void":
            sale.status = "void"
            sale.void_reason = "The customer's payment was refunded"
            notes.append("cancelled the partner's commission")
    db.commit()
    return "; ".join(notes)


# --------------------------------------------------------------------------
# friend rewards
# --------------------------------------------------------------------------


def rewards_this_month(db: Session, referrer_id: int, now: datetime | None = None) -> int:
    now = now or _now()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(
        db.execute(
            select(func.count(Referral.id)).where(
                Referral.referrer_id == referrer_id,
                Referral.channel == FRIEND,
                Referral.reward_given_at.is_not(None),
                Referral.reward_given_at >= start,
            )
        ).scalar_one()
    )


def give_reward(db: Session, row: Referral, *, force: bool = False, now: datetime | None = None) -> str:
    """Pay one friend reward if its conditions hold. Returns the referral's new status. Commits."""

    from .tokens import REFERRAL, _entry, subscription_active

    now = now or _now()
    program = get_program(db)
    # Claim the row first, so two runs at the same moment cannot both pay it.
    claimed = db.execute(
        update(Referral)
        .where(Referral.id == row.id, Referral.status.in_(("waiting", "capped")))
        .values(status="granting")
        .execution_options(synchronize_session=False)
    ).rowcount
    if claimed != 1:
        db.rollback()
        db.refresh(row)
        return row.status
    db.refresh(row)
    referrer = db.get(User, row.referrer_id)
    referred = db.get(User, row.referred_user_id)
    if referrer is None or referred is None:
        row.status, row.void_reason = "void", "Account no longer exists"
    elif not force and (referred.sub_cancelled_at is not None or not subscription_active(referred, now)):
        row.status, row.void_reason = "void", "The referred customer did not stay subscribed for the hold period"
    elif not subscription_active(referrer, now):
        row.status, row.void_reason = "void", "The referrer had no active subscription when the reward came due"
    elif not force and rewards_this_month(db, referrer.id, now) >= int(program[FRIEND]["monthly_cap"]):
        row.status, row.void_reason = "capped", f"Over the cap of {program[FRIEND]['monthly_cap']} rewards a month"
    elif row.reward_tokens <= 0:
        row.status, row.void_reason = "void", "No reward is set for that plan"
    else:
        _entry(
            db,
            referrer.id,
            REFERRAL,
            "reward",
            row.reward_tokens,
            order_id=row.first_order_id,
            note=f"referral reward: {referred.email} subscribed with {row.code}",
        )
        row.status = "rewarded"
        row.reward_given_at = now
        row.void_reason = ""
    db.commit()
    return row.status


def process_due_rewards(db: Session, now: datetime | None = None) -> int:
    """Pay every friend reward whose hold has passed. Safe to run often. Returns rewards paid."""

    now = now or _now()
    due = db.execute(
        select(Referral).where(Referral.channel == FRIEND, Referral.status == "waiting", Referral.reward_due_at <= now)
    ).scalars().all()
    paid = 0
    for row in due:
        try:
            if give_reward(db, row, now=now) == "rewarded":
                paid += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("referral reward %s failed", row.id)
    return paid


# --------------------------------------------------------------------------
# partner commissions
# --------------------------------------------------------------------------


def paying_customers(db: Session, partner_id: int, month: str) -> int:
    return int(
        db.execute(
            select(func.count(func.distinct(AffiliateCommission.customer_id))).where(
                AffiliateCommission.partner_id == partner_id,
                AffiliateCommission.month == month,
                AffiliateCommission.kind == "sale",
                AffiliateCommission.status != "void",
            )
        ).scalar_one()
    )


def commission_rows(db: Session, partner_id: int, now: datetime | None = None) -> list[dict[str, Any]]:
    """Every commission line of a partner with its rate, amount and live status (pending/payable/paid/void)."""

    now = now or _now()
    program = get_program(db)
    rows = db.execute(
        select(AffiliateCommission)
        .where(AffiliateCommission.partner_id == partner_id)
        .order_by(AffiliateCommission.created_at.desc(), AffiliateCommission.id.desc())
    ).scalars().all()
    rates: dict[str, float] = {}
    out: list[dict[str, Any]] = []
    for row in rows:
        if row.commission_usd is not None:
            rate, commission = row.rate_pct or 0.0, row.commission_usd
        else:
            if row.month not in rates:
                rates[row.month] = tier_pct(program, paying_customers(db, partner_id, row.month))
            rate = rates[row.month]
            commission = round(row.amount_usd * rate / 100, 2)
        status = row.status
        if status == "pending" and aware(row.payable_at) <= now:
            status = "payable"
        out.append(
            {
                "id": row.id,
                "order_id": row.order_id,
                "customer_id": row.customer_id,
                "kind": row.kind,
                "amount": row.amount_usd,
                "month": row.month,
                "rate_pct": rate,
                "commission": commission,
                "status": status,
                "payable_at": aware(row.payable_at),
                "created_at": aware(row.created_at),
                "note": row.void_reason,
            }
        )
    return out


def commission_totals(rows: list[dict[str, Any]]) -> dict[str, float]:
    totals = {"pending": 0.0, "payable": 0.0, "paid": 0.0}
    for row in rows:
        if row["status"] in totals:
            totals[row["status"]] += row["commission"]
    return {key: round(value, 2) for key, value in totals.items()}


def monthly_statement(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    months: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["status"] == "void":
            continue
        entry = months.setdefault(
            row["month"], {"month": row["month"], "customers": set(), "revenue": 0.0, "commission": 0.0, "rate_pct": 0.0}
        )
        if row["kind"] == "sale":
            entry["customers"].add(row["customer_id"])
            entry["rate_pct"] = row["rate_pct"]
        entry["revenue"] += row["amount"]
        entry["commission"] += row["commission"]
    out = []
    for month in sorted(months, reverse=True):
        entry = months[month]
        out.append(
            {
                "month": month,
                "customers": len(entry["customers"]),
                "revenue": round(entry["revenue"], 2),
                "rate_pct": entry["rate_pct"],
                "commission": round(entry["commission"], 2),
            }
        )
    return out


class PayoutError(Exception):
    pass


def subscriber_name(user: User | None, referral_id: int) -> str:
    """Privacy-safe subscriber display name (never exposes emails or contact PII)."""

    raw = (user.display_name or "").strip() if user is not None else ""
    return raw if raw else f"Customer #{referral_id}"


def partner_customers(
    db: Session, partner_id: int, commissions: list[dict[str, Any]], now: datetime | None = None
) -> list[dict[str, Any]]:
    """Every customer attributed to this partner's code or link, with subscription/payment totals and name only."""

    from .tokens import get_token_plans, subscription_active

    now = now or _now()
    referrals = db.execute(
        select(Referral)
        .where(Referral.referrer_id == partner_id, Referral.channel == PARTNER)
        .order_by(Referral.created_at.desc(), Referral.id.desc())
        .limit(200)
    ).scalars().all()
    if not referrals:
        return []

    user_ids = list({r.referred_user_id for r in referrals})
    users = {
        u.id: u for u in db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    }
    orders = db.execute(
        select(Order)
        .where(Order.user_id.in_(user_ids), Order.status.in_(("paid", "refunded")))
        .order_by(Order.created_at.desc(), Order.paid_at.desc())
    ).scalars().all()
    orders_by_user: dict[int, list[Order]] = {}
    for order in orders:
        orders_by_user.setdefault(order.user_id, []).append(order)

    comms_by_user: dict[int, list[dict[str, Any]]] = {}
    for row in commissions:
        comms_by_user.setdefault(int(row["customer_id"]), []).append(row)

    plans = get_token_plans(db)
    out: list[dict[str, Any]] = []
    for ref in referrals:
        cust = users.get(ref.referred_user_id)
        cust_orders = orders_by_user.get(ref.referred_user_id, [])
        paid_orders = [o for o in cust_orders if o.status == "paid" and float(o.amount_usd or 0) > 0]
        refunded_orders = [o for o in cust_orders if o.status == "refunded"]
        cust_comms = comms_by_user.get(ref.referred_user_id, [])

        latest_paid = paid_orders[0] if paid_orders else (cust_orders[0] if cust_orders else None)
        plan_id = (cust.sub_plan if cust and cust.sub_plan else None) or (latest_paid.plan_id if latest_paid else "") or ""
        plan_obj = plans.get(plan_id) if plan_id else None
        plan_label = plan_obj.label if plan_obj else (plan_id.replace("_", " ").title() if plan_id else "—")

        is_active = bool(cust is not None and subscription_active(cust, now))
        if ref.status in ("blocked", "void"):
            status_label = "refunded" if (refunded_orders and not paid_orders) else ref.status
        elif ref.status == "ended":
            status_label = "ended"
        elif is_active:
            status_label = "cancelling" if (cust and cust.sub_cancelled_at is not None) else "active"
        elif paid_orders:
            status_label = "ended"
        elif refunded_orders:
            status_label = "refunded"
        else:
            status_label = "signed_up"

        used_promo = ref.source == "coupon" or (ref.source != "link" and any(bool(o.coupon_code) for o in paid_orders))
        source_kind = "promo_code" if used_promo else "link"
        last_paid = (paid_orders[0].paid_at or paid_orders[0].created_at) if paid_orders else None

        out.append(
            {
                "id": ref.id,
                "name": subscriber_name(cust, ref.id),
                "source": source_kind,
                "code": ref.code,
                "status": status_label,
                "plan_id": plan_id,
                "plan_label": plan_label,
                "subscription_active": is_active,
                "current_period_end": aware(cust.sub_period_end) if cust and cust.sub_period_end else None,
                "payments_count": len(paid_orders),
                "total_paid": round(sum(float(o.amount_usd or 0.0) for o in paid_orders), 2),
                "commission_earned": round(sum(float(c["commission"]) for c in cust_comms if c["status"] != "void"), 2),
                "commission_pending": round(sum(float(c["commission"]) for c in cust_comms if c["status"] == "pending"), 2),
                "commission_payable": round(sum(float(c["commission"]) for c in cust_comms if c["status"] == "payable"), 2),
                "commission_paid": round(sum(float(c["commission"]) for c in cust_comms if c["status"] == "paid"), 2),
                "joined_at": aware(ref.created_at),
                "first_paid_at": aware(ref.first_paid_at),
                "last_paid_at": aware(last_paid) if last_paid else None,
            }
        )
    return out


def pending_withdrawal_reserved(db: Session, partner_id: int) -> float:
    total = db.execute(
        select(func.coalesce(func.sum(AffiliatePayoutRequest.amount_usd), 0.0)).where(
            AffiliatePayoutRequest.partner_id == partner_id,
            AffiliatePayoutRequest.status == "pending",
        )
    ).scalar_one()
    return round(float(total or 0.0), 2)


def list_payout_requests(
    db: Session, partner_id: int | None = None, *, limit: int = 100
) -> list[AffiliatePayoutRequest]:
    query = select(AffiliatePayoutRequest).order_by(AffiliatePayoutRequest.created_at.desc(), AffiliatePayoutRequest.id.desc())
    if partner_id is not None:
        query = query.where(AffiliatePayoutRequest.partner_id == partner_id)
    return list(db.execute(query.limit(limit)).scalars().all())


def create_payout_request(
    db: Session,
    partner_id: int,
    *,
    amount: float | None,
    method: str,
    address: str,
    note: str = "",
) -> AffiliatePayoutRequest:
    partner = db.get(AffiliatePartner, partner_id)
    if partner is None or partner.status != "approved":
        raise PayoutError("Only approved active affiliates can request a withdrawal.")
    clean_method = method.strip()[:40]
    clean_address = address.strip()[:300]
    if len(clean_method) < 2 or len(clean_address) < 3:
        raise PayoutError("Enter your payout method and wallet or account details.")

    program = get_program(db)
    minimum = max(MIN_WITHDRAWAL_USD, float(program[PARTNER]["min_payout"]))
    totals = commission_totals(commission_rows(db, partner_id))
    reserved = pending_withdrawal_reserved(db, partner_id)
    available = round(max(0.0, totals["payable"] - reserved), 2)
    if available < minimum:
        raise PayoutError(
            f"You need at least ${minimum:g} available to request a withdrawal (currently ${available:.2f} available)."
        )

    requested = round(float(amount), 2) if amount is not None else available
    if requested < minimum:
        raise PayoutError(f"Minimum withdrawal amount is ${minimum:g}.")
    if requested > available + 0.01:
        raise PayoutError(f"You can withdraw up to ${available:.2f} right now.")
    requested = round(min(requested, available), 2)

    partner.payout_method = clean_method
    partner.payout_address = clean_address
    req = AffiliatePayoutRequest(
        partner_id=partner_id,
        amount_usd=requested,
        method=clean_method,
        address=clean_address,
        note=note.strip()[:500],
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def cancel_payout_request(db: Session, partner_id: int, request_id: int) -> AffiliatePayoutRequest:
    req = db.get(AffiliatePayoutRequest, request_id)
    if req is None or req.partner_id != partner_id:
        raise PayoutError("Withdrawal request not found.")
    if req.status != "pending":
        raise PayoutError("Only pending withdrawal requests can be cancelled.")
    req.status = "cancelled"
    req.decided_at = _now()
    db.commit()
    db.refresh(req)
    return req


def _claim_payout_rows(
    db: Session, partner_id: int, payout: AffiliatePayout, rows: list[dict[str, Any]], target_amount: float | None
) -> float:
    total_payable = round(sum(float(r["commission"]) for r in rows), 2)
    if target_amount is None or abs(target_amount - total_payable) <= 0.02:
        paid = 0.0
        for live in rows:
            claimed = db.execute(
                update(AffiliateCommission)
                .where(
                    AffiliateCommission.id == live["id"],
                    AffiliateCommission.status == "pending",
                    AffiliateCommission.payout_id.is_(None),
                )
                .values(status="paid", rate_pct=live["rate_pct"], commission_usd=live["commission"], payout_id=payout.id)
                .execution_options(synchronize_session=False)
            ).rowcount
            if claimed == 1:
                paid += float(live["commission"])
        return round(paid, 2)

    # Partial payout: claim clawbacks first, then oldest matured sales up to target_amount (splitting the boundary row if needed).
    ordered = sorted(rows, key=lambda r: (0 if r["kind"] == "clawback" else 1, r["created_at"], r["id"]))
    paid = 0.0
    for live in ordered:
        comm = float(live["commission"])
        if live["kind"] != "clawback" and paid >= target_amount - 0.005:
            break
        remaining = round(target_amount - paid, 2)
        if live["kind"] == "clawback" or comm <= remaining + 0.005:
            claimed = db.execute(
                update(AffiliateCommission)
                .where(
                    AffiliateCommission.id == live["id"],
                    AffiliateCommission.status == "pending",
                    AffiliateCommission.payout_id.is_(None),
                )
                .values(status="paid", rate_pct=live["rate_pct"], commission_usd=comm, payout_id=payout.id)
                .execution_options(synchronize_session=False)
            ).rowcount
            if claimed == 1:
                paid = round(paid + comm, 2)
        elif remaining >= 0.01:
            row_obj = db.get(AffiliateCommission, live["id"])
            if row_obj is None or row_obj.status != "pending" or row_obj.payout_id is not None:
                continue
            orig_amount = float(row_obj.amount_usd)
            take = round(remaining, 2)
            leftover_comm = round(comm - take, 2)
            paid_portion_usd = round(orig_amount * (take / comm), 2) if comm > 0 else orig_amount
            leftover_usd = round(orig_amount - paid_portion_usd, 2)
            claimed = db.execute(
                update(AffiliateCommission)
                .where(
                    AffiliateCommission.id == row_obj.id,
                    AffiliateCommission.status == "pending",
                    AffiliateCommission.payout_id.is_(None),
                )
                .values(
                    status="paid",
                    amount_usd=paid_portion_usd,
                    rate_pct=live["rate_pct"],
                    commission_usd=take,
                    payout_id=payout.id,
                )
                .execution_options(synchronize_session=False)
            ).rowcount
            if claimed == 1:
                if leftover_comm >= 0.01:
                    db.add(
                        AffiliateCommission(
                            partner_id=row_obj.partner_id,
                            referral_id=row_obj.referral_id,
                            customer_id=row_obj.customer_id,
                            order_id=row_obj.order_id,
                            kind=row_obj.kind,
                            amount_usd=leftover_usd,
                            month=row_obj.month,
                            rate_pct=live["rate_pct"],
                            commission_usd=leftover_comm,
                            status="pending",
                            payable_at=row_obj.payable_at,
                        )
                    )
                paid = round(paid + take, 2)
                break
    return round(paid, 2)


def decide_payout_request(
    db: Session,
    request_id: int,
    admin_email: str,
    *,
    action: str,
    reference: str = "",
    admin_note: str = "",
) -> AffiliatePayoutRequest:
    req = db.get(AffiliatePayoutRequest, request_id)
    if req is None:
        raise PayoutError("Withdrawal request not found.")
    if req.status != "pending":
        raise PayoutError(f"This withdrawal request is already {req.status}.")
    if action == "reject":
        req.status = "rejected"
        req.admin_note = admin_note.strip()[:2000]
        req.decided_at = _now()
        db.commit()
        db.refresh(req)
        return req

    rows = [row for row in commission_rows(db, req.partner_id) if row["status"] == "payable"]
    total_payable = round(sum(float(r["commission"]) for r in rows), 2)
    if total_payable < req.amount_usd - 0.02:
        raise PayoutError(
            f"Only ${total_payable:.2f} is currently payable (under requested ${req.amount_usd:.2f})."
        )
    payout = AffiliatePayout(
        partner_id=req.partner_id,
        amount_usd=req.amount_usd,
        method=req.method[:40],
        reference=reference.strip()[:300],
        note=admin_note.strip() or req.note,
        admin_email=admin_email,
    )
    db.add(payout)
    db.flush()
    paid = _claim_payout_rows(db, req.partner_id, payout, rows, req.amount_usd)
    if paid <= 0:
        db.rollback()
        raise PayoutError("Nothing is payable for this partner yet.")
    payout.amount_usd = paid
    req.amount_usd = paid
    req.status = "paid"
    req.payout_id = payout.id
    req.reference = reference.strip()[:300]
    req.admin_note = admin_note.strip()[:2000]
    req.decided_at = _now()
    db.commit()
    db.refresh(req)
    return req


def record_payout(
    db: Session, partner_id: int, admin_email: str, *, method: str, reference: str, note: str, force: bool = False
) -> AffiliatePayout:
    """Mark everything payable as paid in one payout the owner sent by hand."""

    program = get_program(db)
    rows = [row for row in commission_rows(db, partner_id) if row["status"] == "payable"]
    amount = round(sum(row["commission"] for row in rows), 2)
    if amount <= 0:
        raise PayoutError("Nothing is payable for this partner yet.")
    minimum = max(MIN_WITHDRAWAL_USD, float(program[PARTNER]["min_payout"]))
    if amount < minimum and not force:
        raise PayoutError(f"${amount:.2f} is under the ${minimum:g} minimum payout.")
    payout = AffiliatePayout(
        partner_id=partner_id,
        amount_usd=amount,
        method=method[:40],
        reference=reference[:300],
        note=note,
        admin_email=admin_email,
    )
    db.add(payout)
    db.flush()
    paid = _claim_payout_rows(db, partner_id, payout, rows, None)
    if paid <= 0:
        db.rollback()
        raise PayoutError("Nothing is payable for this partner yet.")
    payout.amount_usd = paid
    db.commit()
    return payout


def void_pending_commissions(db: Session, partner_id: int, reason: str) -> int:
    """A partner broke the rules: cancel what has not been paid out. Does not commit."""

    rows = db.execute(
        select(AffiliateCommission).where(
            AffiliateCommission.partner_id == partner_id,
            AffiliateCommission.status == "pending",
            AffiliateCommission.kind == "sale",
        )
    ).scalars().all()
    for row in rows:
        row.status = "void"
        row.void_reason = reason
    return len(rows)


# --------------------------------------------------------------------------
# summaries
# --------------------------------------------------------------------------


def code_stats(db: Session, code: ReferralCode) -> dict[str, int]:
    clicks = db.execute(select(func.count(ReferralClick.id)).where(ReferralClick.code_id == code.id)).scalar_one()
    signups = db.execute(
        select(func.count(Referral.id)).where(Referral.referrer_id == code.user_id, Referral.channel == code.channel)
    ).scalar_one()
    paying = db.execute(
        select(func.count(Referral.id)).where(
            Referral.referrer_id == code.user_id,
            Referral.channel == code.channel,
            Referral.first_order_id.is_not(None),
            Referral.status.notin_(("void", "blocked")),
        )
    ).scalar_one()
    return {"clicks": int(clicks), "signups": int(signups), "paying": int(paying)}


def reward_tokens_earned(db: Session, user_id: int) -> int:
    from .tokens import REFERRAL

    return int(
        db.execute(
            select(func.coalesce(func.sum(TokenLedger.amount), 0)).where(
                TokenLedger.user_id == user_id, TokenLedger.bucket == REFERRAL, TokenLedger.kind == "reward"
            )
        ).scalar_one()
    )


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(1, min(6, len(local) - 2))}@{domain}"
