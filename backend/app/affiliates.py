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
BTCPay, Volet, manual approvals and Telegram approvals all count the same.
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

from .app_settings import get_setting, set_setting
from .config import settings
from .db import (
    AffiliateCommission,
    AffiliatePartner,
    AffiliatePayout,
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

DEFAULTS: dict[str, Any] = {
    # Days a clicked link keeps counting.
    "link_days": 30,
    "friend": {
        "enabled": True,
        "discount_pct": 10.0,
        "plans": ["pro", "max"],  # plans the friend's coupon works on
        "reward_tokens": {"starter": 300, "pro": 750, "max": 1250},  # by the friend's plan
        "hold_days": 7,
        "monthly_cap": 10,
    },
    "partner": {
        "enabled": True,
        "applications_open": True,
        "discount_pct": 15.0,
        "plans": ["starter", "pro", "max"],
        # Share of collected revenue by paying customers in the month.
        "tiers": [{"min": 0, "pct": 25.0}, {"min": 20, "pct": 30.0}, {"min": 50, "pct": 35.0}],
        "hold_days": 30,
        "min_payout": 50.0,
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
        program[channel] = merged
    tiers = sorted(program[PARTNER]["tiers"], key=lambda tier: tier["min"])
    program[PARTNER]["tiers"] = tiers or DEFAULTS[PARTNER]["tiers"]
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
    """Hash of the account a payment came from (Volet's wallet id), when the provider gives one."""

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


def offer_for_code(db: Session, code: ReferralCode, program: dict[str, Any] | None = None) -> dict[str, Any]:
    program = program or get_program(db)
    channel = program[code.channel]
    return {
        "code": code.code,
        "channel": code.channel,
        "discount_pct": float(channel["discount_pct"]),
        "plans": list(channel["plans"]),
    }


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
    """The coupon that comes off ``user``'s first subscription payment on ``plan_id``, if any."""

    row = referral_of(db, user.id)
    if row is None or row.status != "signed_up" or row.first_order_id is not None or has_paid(db, user):
        return None
    program = get_program(db)
    channel = program[row.channel]
    code = db.get(ReferralCode, row.code_id) if row.code_id else None
    if code is None or code_usable(db, code, program) or plan_id not in channel["plans"]:
        return None
    pct = max(0.0, min(90.0, float(channel["discount_pct"])))
    if pct <= 0:
        return None
    amount = round(price * (100 - pct) / 100, 2)
    return {"code": row.code, "channel": row.channel, "pct": pct, "amount": amount, "discount": round(price - amount, 2)}


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


def record_payout(
    db: Session, partner_id: int, admin_email: str, *, method: str, reference: str, note: str, force: bool = False
) -> AffiliatePayout:
    """Mark everything payable as paid in one payout the owner sent by hand."""

    program = get_program(db)
    rows = [row for row in commission_rows(db, partner_id) if row["status"] == "payable"]
    amount = round(sum(row["commission"] for row in rows), 2)
    if amount <= 0:
        raise PayoutError("Nothing is payable for this partner yet.")
    minimum = float(program[PARTNER]["min_payout"])
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
    # Each line is claimed on its own (still unpaid -> paid), so a payout
    # recorded twice at the same moment cannot pay a commission twice.
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
            paid += live["commission"]
    paid = round(paid, 2)
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
