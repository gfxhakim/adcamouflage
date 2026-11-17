"""HTTP routes for the referral and partner program (logic in affiliates.py, costs in costs.py)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import affiliates, audit, costs, meta_capi, whop
from .accounts import current_user, is_affiliate_only, optional_user, require_admin, require_studio_user
from .activity import log_activity
from .app_settings import currency
from .config import settings
from .db import (
    AffiliateCommission,
    AffiliatePartner,
    AffiliatePayout,
    Order,
    Referral,
    ReferralCode,
    User,
    get_db,
)
from .plans import aware
from .tokens import get_token_plans, referral_balance, subscription_active

router = APIRouter(prefix="/api/v1/referrals", tags=["referrals"])
admin_router = APIRouter(
    prefix="/api/v1/admin/affiliates", tags=["admin"], dependencies=[Depends(require_admin)]
)

FRIEND, PARTNER = affiliates.FRIEND, affiliates.PARTNER


def _fingerprint(request: Request) -> tuple[str, str]:
    return (
        affiliates.device_hash(request.headers.get("x-device-id")),
        affiliates.ip_hash(meta_capi._client_ip(request)),
    )


def _offer(db: Session, code: ReferralCode, program: dict[str, Any]) -> dict[str, Any]:
    """A code's discount with the price each covered plan comes to."""

    offer = affiliates.offer_for_code(db, code, program)
    plans = get_token_plans(db)
    offer["prices"] = {
        plan_id: round(plans[plan_id].price * (100 - offer["discount_pct"]) / 100, 2)
        for plan_id in offer["plans"]
        if plan_id in plans
    }
    return offer


# --------------------------------------------------------------------------
# public / customer
# --------------------------------------------------------------------------


class ClickIn(BaseModel):
    code: str = Field(max_length=40)


@router.post("/click")
def click(
    payload: ClickIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """A visitor arrived through a link or typed a promo code: remember it for ``link_days`` and count the click."""

    program = affiliates.get_program(db)
    code = affiliates.find_code(db, payload.code)
    if code is None or affiliates.code_usable(db, code, program):
        return {"valid": False}
    device, ip = _fingerprint(request)
    if user is not None and not is_affiliate_only(user) and not affiliates.has_paid(db, user):
        try:
            affiliates.attribute(db, user, code, source="link", device=device, ip=ip)
        except affiliates.AttributionError:
            pass
    affiliates.record_click(db, code, device, ip)
    response.set_cookie(
        key=affiliates.COOKIE,
        value=affiliates.cookie_value(code),
        max_age=int(program["link_days"]) * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        domain=settings.cookie_domain,
        path="/",
    )
    return {"valid": True, "offer": _offer(db, code, program)}


class ApplyIn(BaseModel):
    code: str = Field(max_length=40)


@router.post("/apply")
def apply_code(
    payload: ApplyIn, request: Request, user: User = Depends(require_studio_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """A signed-in customer types a coupon before their first payment."""

    code = affiliates.find_code(db, payload.code)
    if code is None:
        raise HTTPException(status_code=422, detail="That code does not exist.")
    device, ip = _fingerprint(request)
    try:
        affiliates.attribute(db, user, code, source="coupon", device=device, ip=ip)
    except affiliates.AttributionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"offer": _offer(db, code, affiliates.get_program(db))}


class PartnerApplyIn(BaseModel):
    code: str = Field(min_length=3, max_length=24)
    audience: str = Field(min_length=10, max_length=2000)
    payout_method: str = Field(default="", max_length=40)
    payout_address: str = Field(default="", max_length=300)


class PayoutDetailsIn(BaseModel):
    payout_method: str = Field(max_length=40)
    payout_address: str = Field(max_length=300)


def _my_offer(db: Session, user: User, program: dict[str, Any]) -> dict[str, Any] | None:
    """The coupon waiting on this customer's first payment, if any."""

    row = affiliates.referral_of(db, user.id)
    if row is None or row.status != "signed_up" or affiliates.has_paid(db, user) or not row.code_id:
        return None
    code = db.get(ReferralCode, row.code_id)
    if code is None or affiliates.code_usable(db, code, program):
        return None
    return _offer(db, code, program)


def _friend_block(db: Session, user: User, program: dict[str, Any]) -> dict[str, Any]:
    settings_ = program[FRIEND]
    active = subscription_active(user)
    block: dict[str, Any] = {
        "enabled": bool(settings_["enabled"]),
        "eligible": active,
        "discount_pct": settings_["discount_pct"],
        "plans": settings_["plans"],
        "reward_tokens": settings_["reward_tokens"],
        "hold_days": settings_["hold_days"],
        "monthly_cap": settings_["monthly_cap"],
        "code": None,
        "stats": {"clicks": 0, "signups": 0, "paying": 0},
        "rewards_this_month": affiliates.rewards_this_month(db, user.id),
        "tokens_earned": affiliates.reward_tokens_earned(db, user.id),
        "tokens_left": referral_balance(db, user),
        "friends": [],
    }
    if not settings_["enabled"] or not active:
        return block
    affiliates.process_due_rewards(db)
    code = affiliates.friend_code(db, user)
    block["code"] = code.code
    block["stats"] = affiliates.code_stats(db, code)
    rows = db.execute(
        select(Referral, User.email)
        .join(User, User.id == Referral.referred_user_id)
        .where(Referral.referrer_id == user.id, Referral.channel == FRIEND)
        .order_by(Referral.created_at.desc())
        .limit(50)
    ).all()
    block["friends"] = [
        {
            "email": affiliates.mask_email(email),
            "status": row.status,
            "reward_tokens": row.reward_tokens,
            "reward_due_at": aware(row.reward_due_at),
            "created_at": aware(row.created_at),
        }
        for row, email in rows
    ]
    return block


def _partner_block(db: Session, user: User, program: dict[str, Any]) -> dict[str, Any]:
    settings_ = program[PARTNER]
    partner = db.get(AffiliatePartner, user.id)
    block: dict[str, Any] = {
        "enabled": bool(settings_["enabled"]),
        "applications_open": bool(settings_["applications_open"]),
        "discount_pct": settings_["discount_pct"],
        "tiers": settings_["tiers"],
        "hold_days": settings_["hold_days"],
        "min_payout": settings_["min_payout"],
        "status": partner.status if partner else None,
    }
    if partner is None:
        return block
    block.update(
        requested_code=partner.requested_code,
        payout_method=partner.payout_method,
        payout_address=partner.payout_address,
    )
    if partner.status not in ("approved", "suspended"):
        return block
    code = affiliates.partner_code(db, user.id)
    rows = affiliates.commission_rows(db, user.id)
    month = f"{datetime.now(timezone.utc):%Y-%m}"
    customers = affiliates.paying_customers(db, user.id, month)
    payouts = db.execute(
        select(AffiliatePayout).where(AffiliatePayout.partner_id == user.id).order_by(AffiliatePayout.created_at.desc())
    ).scalars().all()
    block.update(
        code=code.code if code else None,
        stats=affiliates.code_stats(db, code) if code else {"clicks": 0, "signups": 0, "paying": 0},
        totals=affiliates.commission_totals(rows),
        month={"month": month, "customers": customers, "rate_pct": affiliates.tier_pct(program, customers)},
        statement=affiliates.monthly_statement(rows),
        commissions=[{key: row[key] for key in ("id", "kind", "amount", "month", "rate_pct", "commission", "status", "payable_at", "created_at")} for row in rows[:100]],
        payouts=[
            {"id": p.id, "amount": p.amount_usd, "method": p.method, "reference": p.reference, "created_at": aware(p.created_at)}
            for p in payouts
        ],
    )
    return block


@router.get("/public-program")
def public_program(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Live partner affiliate strategy numbers for the public /affiliates and landing pages."""

    program = affiliates.get_program(db)
    partner_cfg = program[PARTNER]
    plans = get_token_plans(db)
    return {
        "link_days": program["link_days"],
        "currency": currency(db),
        "plans": [
            {"id": p.id, "label": p.label, "price": p.price}
            for p in plans.values()
            if p.id in partner_cfg["plans"]
        ],
        "partner": {
            "enabled": bool(partner_cfg["enabled"]),
            "applications_open": bool(partner_cfg["applications_open"]),
            "discount_pct": partner_cfg["discount_pct"],
            "plans": partner_cfg["plans"],
            "tiers": partner_cfg["tiers"],
            "hold_days": partner_cfg["hold_days"],
            "min_payout": partner_cfg["min_payout"],
        },
    }


@router.get("/visitor-offer")
def visitor_offer(
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict[str, Any]:
    """Return the active first-payment discount for this visitor or unpaid signed-in user."""

    program = affiliates.get_program(db)
    if user is not None:
        if is_affiliate_only(user) or affiliates.has_paid(db, user):
            return {"offer": None}
        offer = _my_offer(db, user, program)
        if offer is not None:
            return {"offer": offer}
    code = affiliates.code_from_cookie(db, request.cookies.get(affiliates.COOKIE), program)
    if code is None or affiliates.code_usable(db, code, program):
        return {"offer": None}
    return {"offer": _offer(db, code, program)}


@router.get("/me")
def my_program(
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    program = affiliates.get_program(db)
    if is_affiliate_only(user):
        friend = _friend_block(db, user, program)
        friend["enabled"] = False
        friend["eligible"] = False
        return {
            "link_days": program["link_days"],
            "my_offer": None,
            "friend": friend,
            "partner": _partner_block(db, user, program),
        }
    # If a pre-existing unpaid user arrived via an affiliate link cookie, tie attribution safely.
    if affiliates.referral_of(db, user.id) is None and not affiliates.has_paid(db, user):
        device, ip = _fingerprint(request)
        affiliates.attribute_signup(db, user, request.cookies.get(affiliates.COOKIE), device, ip)
    return {
        "link_days": program["link_days"],
        "my_offer": _my_offer(db, user, program),
        "friend": _friend_block(db, user, program),
        "partner": _partner_block(db, user, program),
    }


@router.post("/partner/apply")
def partner_apply(
    payload: PartnerApplyIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    program = affiliates.get_program(db)
    if not program[PARTNER]["enabled"] or not program[PARTNER]["applications_open"]:
        raise HTTPException(status_code=403, detail="Partner applications are closed right now.")
    code = affiliates.normalise_code(payload.code)
    if not affiliates.valid_code(code):
        raise HTTPException(status_code=422, detail="Use 3 to 24 letters or numbers for your code.")
    taken = affiliates.find_code(db, code)
    if taken is not None and taken.user_id != user.id:
        raise HTTPException(status_code=409, detail="That code is taken. Try another one.")
    partner = db.get(AffiliatePartner, user.id)
    if partner is not None and partner.status in ("approved", "suspended"):
        raise HTTPException(status_code=409, detail="You already have a partner account.")
    if partner is None:
        partner = AffiliatePartner(user_id=user.id)
        db.add(partner)
    partner.status = "pending"
    partner.requested_code = code
    partner.audience = payload.audience.strip()
    partner.payout_method = payload.payout_method.strip()
    partner.payout_address = payload.payout_address.strip()
    partner.decided_at = None
    db.commit()
    log_activity(db, user.id, "partner", f"Applied to the partner program with code {code}")
    try:
        from . import notify

        notify.alert("review", "New partner application", [f"{user.email} applied with code {code}."])
    except Exception:  # noqa: BLE001 - an alert must never fail the application
        pass
    return _partner_block(db, user, program)


@router.put("/partner/payout")
def partner_payout_details(
    payload: PayoutDetailsIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    partner = db.get(AffiliatePartner, user.id)
    if partner is None:
        raise HTTPException(status_code=404, detail="Apply to the partner program first.")
    partner.payout_method = payload.payout_method.strip()
    partner.payout_address = payload.payout_address.strip()
    db.commit()
    return _partner_block(db, user, affiliates.get_program(db))


@router.get("/code/{code}")
def code_info(code: str, db: Session = Depends(get_db), _user: User | None = Depends(optional_user)) -> dict[str, Any]:
    program = affiliates.get_program(db)
    row = affiliates.find_code(db, code)
    if row is None or affiliates.code_usable(db, row, program):
        return {"valid": False}
    return {"valid": True, "offer": _offer(db, row, program)}


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


class TierIn(BaseModel):
    min: int = Field(ge=0, le=100_000)
    pct: float = Field(ge=0, le=90)


class FriendSettingsIn(BaseModel):
    enabled: bool
    discount_pct: float = Field(ge=0, le=90)
    plans: list[str]
    reward_tokens: dict[str, int]
    hold_days: int = Field(ge=0, le=365)
    monthly_cap: int = Field(ge=0, le=10_000)


class PartnerSettingsIn(BaseModel):
    enabled: bool
    applications_open: bool
    discount_pct: float = Field(ge=0, le=90)
    plans: list[str]
    tiers: list[TierIn] = Field(min_length=1, max_length=10)
    hold_days: int = Field(ge=0, le=365)
    min_payout: float = Field(ge=0, le=1_000_000)


class ProgramIn(BaseModel):
    link_days: int = Field(ge=1, le=365)
    friend: FriendSettingsIn
    partner: PartnerSettingsIn


def _partner_row(db: Session, partner: AffiliatePartner, user: User | None, program: dict[str, Any]) -> dict[str, Any]:
    code = affiliates.partner_code(db, partner.user_id)
    rows = affiliates.commission_rows(db, partner.user_id) if partner.status in ("approved", "suspended") else []
    month = f"{datetime.now(timezone.utc):%Y-%m}"
    customers = affiliates.paying_customers(db, partner.user_id, month)
    return {
        "user_id": partner.user_id,
        "email": user.email if user else "",
        "name": (user.display_name if user else "") or "",
        "status": partner.status,
        "requested_code": partner.requested_code,
        "code": code.code if code else None,
        "audience": partner.audience,
        "payout_method": partner.payout_method,
        "payout_address": partner.payout_address,
        "admin_note": partner.admin_note,
        "created_at": aware(partner.created_at),
        "stats": affiliates.code_stats(db, code) if code else {"clicks": 0, "signups": 0, "paying": 0},
        "totals": affiliates.commission_totals(rows),
        "month_customers": customers,
        "month_rate_pct": affiliates.tier_pct(program, customers),
    }


@admin_router.get("")
def admin_overview(db: Session = Depends(get_db)) -> dict[str, Any]:
    affiliates.process_due_rewards(db)
    program = affiliates.get_program(db)
    partners = db.execute(select(AffiliatePartner).order_by(AffiliatePartner.created_at.desc())).scalars().all()
    users = {u.id: u for u in db.execute(select(User).where(User.id.in_([p.user_id for p in partners] or [0]))).scalars()}
    partner_rows = [_partner_row(db, p, users.get(p.user_id), program) for p in partners]

    def count(*where: Any) -> int:
        return int(db.execute(select(func.count(Referral.id)).where(*where)).scalar_one())

    from .db import TokenLedger
    from .tokens import REFERRAL

    reward_tokens = int(
        db.execute(
            select(func.coalesce(func.sum(TokenLedger.amount), 0)).where(
                TokenLedger.bucket == REFERRAL, TokenLedger.kind == "reward"
            )
        ).scalar_one()
    )
    totals = {"pending": 0.0, "payable": 0.0, "paid": 0.0}
    for row in partner_rows:
        for key in totals:
            totals[key] = round(totals[key] + row["totals"][key], 2)
    plans = get_token_plans(db)
    return {
        "program": program,
        "plans": [{"id": p.id, "label": p.label, "price": p.price} for p in plans.values()],
        "summary": {
            "friend_signups": count(Referral.channel == FRIEND),
            "friend_paying": count(Referral.channel == FRIEND, Referral.first_order_id.is_not(None)),
            "friend_rewards": count(Referral.channel == FRIEND, Referral.status == "rewarded"),
            "friend_reward_tokens": reward_tokens,
            "partner_signups": count(Referral.channel == PARTNER),
            "partner_paying": count(Referral.channel == PARTNER, Referral.first_order_id.is_not(None)),
            "flagged": count(Referral.flags != ""),
            "applications": sum(1 for p in partners if p.status == "pending"),
            "commission": totals,
        },
        "partners": partner_rows,
    }


@admin_router.put("/settings")
def admin_save_settings(
    payload: ProgramIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    plans = get_token_plans(db)
    program = payload.model_dump()
    for channel in (FRIEND, PARTNER):
        program[channel]["plans"] = [plan for plan in program[channel]["plans"] if plan in plans]
    program[FRIEND]["reward_tokens"] = {
        plan: max(0, int(tokens)) for plan, tokens in program[FRIEND]["reward_tokens"].items() if plan in plans
    }
    program[PARTNER]["tiers"] = sorted(program[PARTNER]["tiers"], key=lambda tier: tier["min"])
    if program[PARTNER]["tiers"][0]["min"] != 0:
        raise HTTPException(status_code=422, detail="The first tier must start at 0 paying customers.")
    affiliates.save_program(db, program)
    db.commit()
    audit.record(db, admin, None, "affiliate_settings", "Changed the referral / partner program settings")
    return affiliates.get_program(db)


class PartnerDecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject|suspend|reinstate|note)$")
    code: str | None = Field(default=None, max_length=24)
    note: str | None = Field(default=None, max_length=2000)


@admin_router.post("/partners/{user_id}")
def admin_partner_decision(
    user_id: int, payload: PartnerDecisionIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    partner = db.get(AffiliatePartner, user_id)
    user = db.get(User, user_id)
    if partner is None or user is None:
        raise HTTPException(status_code=404, detail="No such partner.")
    if payload.note is not None:
        partner.admin_note = payload.note.strip()
    detail = ""
    if payload.action in ("approve", "reinstate"):
        wanted = affiliates.normalise_code(payload.code or partner.requested_code)
        code = affiliates.partner_code(db, user_id)
        if payload.action == "approve" or payload.code:
            if not affiliates.valid_code(wanted):
                raise HTTPException(status_code=422, detail="The code needs 3 to 24 letters or numbers.")
            taken = affiliates.find_code(db, wanted)
            if taken is not None and (taken.user_id != user_id or taken.channel != PARTNER):
                raise HTTPException(status_code=409, detail=f"The code {wanted} is already in use.")
            if code is None:
                code = ReferralCode(user_id=user_id, code=wanted, channel=PARTNER)
                db.add(code)
            else:
                code.code = wanted
        if code is not None:
            code.status = "active"
        partner.status = "approved"
        partner.decided_at = datetime.now(timezone.utc)
        detail = f"Partner approved with code {code.code if code else wanted}"
    elif payload.action == "reject":
        partner.status = "rejected"
        partner.decided_at = datetime.now(timezone.utc)
        detail = "Partner application rejected"
    elif payload.action == "suspend":
        partner.status = "suspended"
        code = affiliates.partner_code(db, user_id)
        if code is not None:
            code.status = "disabled"
        voided = affiliates.void_pending_commissions(db, user_id, "Partnership suspended")
        detail = f"Partner suspended; {voided} pending commissions cancelled"
    else:
        detail = "Partner note updated"
    program = affiliates.get_program(db)
    db.commit()
    final_code = code.code if code is not None else wanted if payload.action in ("approve", "reinstate") else ""
    if payload.action in ("approve", "reinstate") and final_code:
        whop.sync_partner_promo_code(
            code=final_code,
            discount_pct=float(program[PARTNER]["discount_pct"]),
            plan_ids=list(program[PARTNER]["plans"]),
            active=True,
        )
    elif payload.action == "suspend" and code is not None:
        whop.sync_partner_promo_code(
            code=code.code,
            discount_pct=float(program[PARTNER]["discount_pct"]),
            plan_ids=list(program[PARTNER]["plans"]),
            active=False,
        )
    audit.record(db, admin, user, f"partner_{payload.action}", detail)
    return _partner_row(db, partner, user, program)


@admin_router.get("/partners/{user_id}")
def admin_partner_detail(user_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    partner = db.get(AffiliatePartner, user_id)
    user = db.get(User, user_id)
    if partner is None:
        raise HTTPException(status_code=404, detail="No such partner.")
    program = affiliates.get_program(db)
    rows = affiliates.commission_rows(db, user_id)
    emails = dict(
        db.execute(select(User.id, User.email).where(User.id.in_({row["customer_id"] for row in rows} or {0}))).all()
    )
    for row in rows:
        row["customer_email"] = emails.get(row["customer_id"], "")
    payouts = db.execute(
        select(AffiliatePayout).where(AffiliatePayout.partner_id == user_id).order_by(AffiliatePayout.created_at.desc())
    ).scalars().all()
    return {
        "partner": _partner_row(db, partner, user, program),
        "statement": affiliates.monthly_statement(rows),
        "commissions": rows[:300],
        "payouts": [
            {
                "id": p.id,
                "amount": p.amount_usd,
                "method": p.method,
                "reference": p.reference,
                "note": p.note,
                "admin_email": p.admin_email,
                "created_at": aware(p.created_at),
            }
            for p in payouts
        ],
    }


class PayoutIn(BaseModel):
    method: str = Field(default="", max_length=40)
    reference: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=2000)
    # Pay even though the total is under the minimum payout.
    force: bool = False


@admin_router.post("/partners/{user_id}/payout")
def admin_record_payout(
    user_id: int, payload: PayoutIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    user = db.get(User, user_id)
    if db.get(AffiliatePartner, user_id) is None:
        raise HTTPException(status_code=404, detail="No such partner.")
    try:
        payout = affiliates.record_payout(
            db, user_id, admin.email, method=payload.method, reference=payload.reference, note=payload.note, force=payload.force
        )
    except affiliates.PayoutError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit.record(db, admin, user, "partner_payout", f"Recorded a ${payout.amount_usd:.2f} partner payout ({payload.method})")
    return {"id": payout.id, "amount": payout.amount_usd}


@admin_router.get("/referrals")
def admin_referrals(
    channel: str | None = Query(default=None, pattern="^(friend|partner)$"),
    flagged: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = select(Referral).order_by(Referral.created_at.desc()).limit(limit)
    if channel:
        query = query.where(Referral.channel == channel)
    if flagged:
        query = query.where(Referral.flags != "")
    rows = db.execute(query).scalars().all()
    ids = {r.referred_user_id for r in rows} | {r.referrer_id for r in rows}
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(ids or {0}))).all())
    return [
        {
            "id": r.id,
            "channel": r.channel,
            "code": r.code,
            "source": r.source,
            "status": r.status,
            "flags": [flag for flag in r.flags.split(",") if flag],
            "referrer_id": r.referrer_id,
            "referrer_email": emails.get(r.referrer_id, ""),
            "customer_id": r.referred_user_id,
            "customer_email": emails.get(r.referred_user_id, ""),
            "reward_tokens": r.reward_tokens,
            "reward_due_at": aware(r.reward_due_at),
            "reward_given_at": aware(r.reward_given_at),
            "first_paid_at": aware(r.first_paid_at),
            "note": r.void_reason,
            "created_at": aware(r.created_at),
        }
        for r in rows
    ]


class ReferralActionIn(BaseModel):
    action: str = Field(pattern="^(void|allow|reward_now)$")
    reason: str = Field(default="", max_length=500)


@admin_router.post("/referrals/{referral_id}")
def admin_referral_action(
    referral_id: int, payload: ReferralActionIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    row = db.get(Referral, referral_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such referral.")
    customer = db.get(User, row.referred_user_id)
    if payload.action == "void":
        if row.status == "rewarded":
            raise HTTPException(status_code=409, detail="The reward was already given. Use Mark refunded on the order to take it back.")
        row.status = "void"
        row.void_reason = payload.reason.strip() or "Cancelled by admin"
        for sale in db.execute(
            select(AffiliateCommission).where(
                AffiliateCommission.referral_id == row.id, AffiliateCommission.status == "pending"
            )
        ).scalars():
            sale.status = "void"
            sale.void_reason = row.void_reason
        db.commit()
    elif payload.action == "allow":
        if row.status not in ("blocked", "void", "capped", "ended"):
            raise HTTPException(status_code=409, detail="This referral is not blocked.")
        row.flags = ""
        row.void_reason = ""
        if row.first_order_id is None:
            row.status = "signed_up"
        else:
            row.status = "waiting" if row.channel == FRIEND else "active"
        db.commit()
    else:
        if row.channel != FRIEND or row.status not in ("waiting", "capped") or not row.first_order_id:
            raise HTTPException(status_code=409, detail="There is no reward waiting on this referral.")
        if affiliates.give_reward(db, row, force=True) != "rewarded":
            raise HTTPException(status_code=409, detail=row.void_reason or "The reward could not be given.")
    audit.record(db, admin, customer, f"referral_{payload.action}", f"Referral {row.code}: {payload.action} {payload.reason}".strip())
    return {"id": row.id, "status": row.status}


class RefundIn(BaseModel):
    note: str = Field(default="", max_length=500)


@admin_router.post("/orders/{order_id}/refund")
def admin_mark_refunded(
    order_id: str, payload: RefundIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The owner refunded this payment outside the app: record it and undo what it earned others.

    The customer's own tokens and period are not touched here; Cancel now in
    the plan tools does that.
    """

    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="No such order.")
    if order.status != "paid":
        raise HTTPException(status_code=409, detail="Only a paid order can be marked refunded.")
    order.status = "refunded"
    db.commit()
    reversed_ = affiliates.on_order_refunded(db, order)
    user = db.get(User, order.user_id)
    detail = f"Marked the ${order.amount_usd:g} order refunded" + (f"; {reversed_}" if reversed_ else "")
    if payload.note:
        detail += f" ({payload.note})"
    audit.record(db, admin, user, "order_refunded", detail)
    if user is not None:
        log_activity(db, user.id, "payment", f"Order of ${order.amount_usd:g} marked refunded")
    return {"id": order.id, "status": order.status, "reversed": reversed_}


# --------------------------------------------------------------------------
# admin: batch costs
# --------------------------------------------------------------------------


class RatesIn(BaseModel):
    vcpu_per_minute: float = Field(ge=0, le=10)
    gb_ram_per_minute: float = Field(ge=0, le=10)
    egress_per_gb: float = Field(ge=0, le=100)
    vcpus_busy: float = Field(ge=0, le=128)
    ram_gb: float = Field(ge=0, le=1024)


@admin_router.get("/batch-costs")
def admin_batch_costs(days: int = Query(default=30, ge=1, le=366), db: Session = Depends(get_db)) -> dict[str, Any]:
    return costs.batch_costs(db, days=days)


@admin_router.put("/batch-costs/rates")
def admin_save_rates(
    payload: RatesIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict[str, float]:
    costs.save_rates(db, payload.model_dump())
    db.commit()
    audit.record(db, admin, None, "cost_rates", "Changed the hosting cost rates")
    return costs.get_rates(db)
