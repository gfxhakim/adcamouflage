"""Referral and partner program: coupons, rewards, commissions, payouts and the batch cost view.

The numbers asserted are the owner's program sheet: 10% off Pro/Max for a
friend, 300/750/1,250 reward tokens after 7 days, 15% off for a creator's
audience and 25/30/35% of collected revenue by paying customers a month.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import affiliates, costs, tokens
from app.auth_routes import login_limiter
from app.config import settings
from app.db import (
    AffiliateCommission,
    BatchRecord,
    Order,
    Referral,
    RenderStat,
    User,
    get_session_factory,
    init_db,
)
from app.main import app
from app.tokens import REFERRAL, activate_period, bucket_totals, consume, get_token_plans, new_order, settle_order

from .conftest import make_legacy

RUN_ID = uuid.uuid4().hex[:10]
PASSWORD = "correct-horse-battery"
_counter = iter(range(10_000))


def address(name: str) -> str:
    return f"{name}{next(_counter)}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    login_limiter._hits.clear()
    monkeypatch.setattr(settings, "volet_account_email", "shop@example.test", raising=False)
    monkeypatch.setattr(settings, "volet_sci_name", "shop", raising=False)
    monkeypatch.setattr(settings, "volet_sci_secret", SecretStr("pw"), raising=False)
    monkeypatch.setattr(settings, "public_url", "https://app.example.test")
    with get_session_factory()() as db:
        affiliates.save_program(db, {})
        db.commit()
    yield


def client_for(email: str, device: str | None = None, ref: str | None = None) -> TestClient:
    client = TestClient(app)
    if device:
        client.headers["x-device-id"] = device
    if ref:
        assert client.post("/api/v1/referrals/click", json={"code": ref}).json()["valid"] is True
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def session():
    return get_session_factory()()


def user_of(db, email: str) -> User:
    return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def subscribe(email: str, plan_id: str = "pro") -> None:
    with session() as db:
        activate_period(db, user_of(db, email), get_token_plans(db)[plan_id], note="test")
        db.commit()


def pay(email: str, order_id: str) -> None:
    with session() as db:
        assert settle_order(db, db.get(Order, order_id), source="test")


def referral(email: str) -> Referral | None:
    with session() as db:
        return affiliates.referral_of(db, user_of(db, email).id)


def checkout(client: TestClient, plan_id: str, coupon: str | None = None):
    body = {"kind": "subscription", "plan_id": plan_id, "provider": "volet"}
    if coupon:
        body["coupon"] = coupon
    return client.post("/api/v1/billing/checkout", json=body)


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    client = client_for(email)
    make_legacy(email)
    return client


def friend_code(client: TestClient) -> str:
    return client.get("/api/v1/referrals/me").json()["friend"]["code"]


def make_partner(admin: TestClient, code: str) -> tuple[TestClient, str]:
    email = address("creator")
    creator = client_for(email, device=f"creator-device-{code}")
    applied = creator.post(
        "/api/v1/referrals/partner/apply",
        json={"code": code, "audience": "youtube.com/@creator, 40k subscribers", "payout_method": "USDT TRC-20", "payout_address": "Txyz"},
    )
    assert applied.status_code == 200 and applied.json()["status"] == "pending"
    with session() as db:
        uid = user_of(db, email).id
    approved = admin.post(f"/api/v1/admin/affiliates/partners/{uid}", json={"action": "approve"})
    assert approved.status_code == 200 and approved.json()["code"] == code
    return creator, email


# --------------------------------------------------------------------------
# friend referral
# --------------------------------------------------------------------------


def test_only_active_subscribers_get_a_friend_code():
    email = address("nosub")
    client = client_for(email)
    friend = client.get("/api/v1/referrals/me").json()["friend"]
    assert friend["eligible"] is False and friend["code"] is None
    subscribe(email)
    friend = client.get("/api/v1/referrals/me").json()["friend"]
    assert friend["eligible"] is True and len(friend["code"]) >= 6
    assert friend_code(client) == friend["code"]  # stable


def test_friend_link_gives_10_percent_on_pro_and_max_but_not_starter():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-referrer-a")
    subscribe(referrer_email)
    code = friend_code(referrer)

    friend_email = address("friend")
    friend = client_for(friend_email, device="device-friend-a", ref=code.lower())
    row = referral(friend_email)
    assert row.channel == "friend" and row.status == "signed_up" and row.source == "link"
    offer = friend.get("/api/v1/referrals/me").json()["my_offer"]
    assert offer["discount_pct"] == 10 and offer["prices"] == {"pro": 80.10, "max": 134.10}

    starter = checkout(friend, "starter")
    assert starter.status_code == 201 and starter.json()["amount"] == 37.0
    pro = checkout(friend, "pro")
    assert pro.json()["amount"] == 80.10
    with session() as db:
        order = db.get(Order, pro.json()["order_id"])
        assert order.coupon_code == code and order.discount_usd == 8.90


def test_reward_comes_after_seven_days_and_is_spent_after_subscription_tokens():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-referrer-b")
    subscribe(referrer_email, "starter")
    code = friend_code(referrer)
    friend_email = address("friend")
    friend = client_for(friend_email, device="device-friend-b", ref=code)
    order_id = checkout(friend, "max").json()["order_id"]
    pay(friend_email, order_id)

    row = referral(friend_email)
    assert row.status == "waiting" and row.reward_tokens == 1250
    with session() as db:
        affiliates.process_due_rewards(db)  # still inside the hold
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 0
        assert affiliates.process_due_rewards(db, datetime.now(timezone.utc) + timedelta(days=7, minutes=1)) >= 1
        user = user_of(db, referrer_email)
        assert bucket_totals(db, user)[REFERRAL] == 1250
        # 1,500 subscription tokens go first, then the reward, before any top-up.
        tokens.grant_bonus(db, user, 500, "test top-up")
        db.commit()
        db.add(BatchRecord(id=f"b-{uuid.uuid4().hex}", user_id=user.id, asset_count=17))
        db.commit()
        consume(db, user, 17, "spend-order-test")  # 1,700 tokens at 100 each
        totals = bucket_totals(db, user)
        assert totals == {"subscription": 0, "referral": 1050, "topup": 500}
    assert referral(friend_email).status == "rewarded"
    # The second payment earns nothing more.
    pay(friend_email, checkout(friend, "max").json()["order_id"])
    with session() as db:
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 1050


def test_reward_amounts_follow_the_friends_plan_and_the_monthly_cap():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-referrer-c")
    subscribe(referrer_email)
    code = friend_code(referrer)
    with session() as db:
        program = affiliates.get_program(db)
        program["friend"]["monthly_cap"] = 2
        affiliates.save_program(db, program)
        db.commit()
    later = datetime.now(timezone.utc) + timedelta(days=8)
    statuses = []
    for index, plan in enumerate(("starter", "pro", "max")):
        email = address("friend")
        friend = client_for(email, device=f"device-friend-c{index}", ref=code)
        pay(email, checkout(friend, plan).json()["order_id"])
        with session() as db:
            affiliates.process_due_rewards(db, later)
        row = referral(email)
        statuses.append((row.status, row.reward_tokens))
    assert statuses == [("rewarded", 300), ("rewarded", 750), ("capped", 1250)]
    with session() as db:
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 1050


def test_same_device_or_mailbox_is_blocked_as_self_referral():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-shared-d")
    subscribe(referrer_email)
    code = friend_code(referrer)

    same_device = address("alt")
    alt = client_for(same_device, device="device-shared-d", ref=code)
    assert referral(same_device).status == "blocked"
    assert alt.get("/api/v1/referrals/me").json()["my_offer"] is None
    assert checkout(alt, "pro").json()["amount"] == 89.0

    local, domain = referrer_email.split("@")
    tagged = f"{local}+second@{domain}"
    other = client_for(tagged, device="device-other-d")
    refused = other.post("/api/v1/referrals/apply", json={"code": code})
    assert refused.status_code == 422 and referral(tagged).status == "blocked"
    assert referrer.post("/api/v1/referrals/apply", json={"code": code}).status_code == 422  # own code


def test_codes_are_for_new_customers_and_the_last_code_wins(admin):
    first_email, second_email = address("ref"), address("ref")
    first = client_for(first_email, device="device-e1")
    second = client_for(second_email, device="device-e2")
    subscribe(first_email)
    subscribe(second_email)
    buyer_email = address("buyer")
    buyer = client_for(buyer_email, device="device-e3", ref=friend_code(first))
    assert buyer.post("/api/v1/referrals/apply", json={"code": friend_code(second)}).status_code == 200
    with session() as db:
        assert referral(buyer_email).referrer_id == user_of(db, second_email).id
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])
    # Paid: the attribution is fixed and the coupon is used up.
    assert buyer.post("/api/v1/referrals/apply", json={"code": friend_code(first)}).status_code == 422
    assert checkout(buyer, "max").json()["amount"] == 149.0
    # An existing customer cannot use a code at all.
    assert second.post("/api/v1/referrals/apply", json={"code": friend_code(first)}).status_code == 422


def test_a_refund_cancels_the_reward_or_takes_it_back(admin):
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-f0")
    subscribe(referrer_email)
    code = friend_code(referrer)
    later = datetime.now(timezone.utc) + timedelta(days=8)

    early = address("friend")
    order_a = checkout(client_for(early, device="device-f1", ref=code), "pro").json()["order_id"]
    pay(early, order_a)
    refunded = admin.post(f"/api/v1/admin/affiliates/orders/{order_a}/refund", json={"note": "asked"})
    assert refunded.status_code == 200 and refunded.json()["status"] == "refunded"
    with session() as db:
        affiliates.process_due_rewards(db, later)
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 0
    assert referral(early).status == "void"

    late = address("friend")
    order_b = checkout(client_for(late, device="device-f2", ref=code), "pro").json()["order_id"]
    pay(late, order_b)
    with session() as db:
        affiliates.process_due_rewards(db, later)
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 750
    assert "750" in admin.post(f"/api/v1/admin/affiliates/orders/{order_b}/refund", json={}).json()["reversed"]
    with session() as db:
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 0
    assert admin.post(f"/api/v1/admin/affiliates/orders/{order_b}/refund", json={}).status_code == 409


def test_reward_tokens_are_lost_when_the_referrer_cancels():
    email = address("ref")
    client_for(email)
    subscribe(email)
    with session() as db:
        user = user_of(db, email)
        tokens._entry(db, user.id, REFERRAL, "reward", 750, note="test")
        db.commit()
        tokens.cancel_period(db, user, immediately=True)
        db.commit()
        assert bucket_totals(db, user)[REFERRAL] == 0


# --------------------------------------------------------------------------
# creator partners
# --------------------------------------------------------------------------


def test_partner_coupon_and_commission_on_everything_the_customer_pays(admin):
    code = f"MAYA{RUN_ID[:4].upper()}"
    creator, creator_email = make_partner(admin, code)
    buyer_email = address("fan")
    buyer = client_for(buyer_email, device="device-g1")
    first = checkout(buyer, "pro", coupon=code)
    assert first.status_code == 201 and first.json()["amount"] == 75.65
    pay(buyer_email, first.json()["order_id"])
    renewal = checkout(buyer, "pro")
    assert renewal.json()["amount"] == 89.0  # the coupon is for the first payment only
    pay(buyer_email, renewal.json()["order_id"])
    topup = buyer.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 80, "provider": "volet"})
    pay(buyer_email, topup.json()["order_id"])

    partner = creator.get("/api/v1/referrals/me").json()["partner"]
    assert partner["status"] == "approved" and partner["code"] == code
    assert partner["stats"]["paying"] == 1 and partner["month"]["rate_pct"] == 25
    amounts = sorted(row["commission"] for row in partner["commissions"])
    assert amounts == [18.91, 20.0, 22.25]
    assert partner["totals"] == {"pending": 61.16, "payable": 0.0, "paid": 0.0}


def test_starter_takes_the_partner_coupon(admin):
    code = f"STAR{RUN_ID[:4].upper()}"
    make_partner(admin, code)
    buyer = client_for(address("fan"), device="device-g2", ref=code)
    assert checkout(buyer, "starter").json()["amount"] == 31.45
    assert checkout(buyer, "max").json()["amount"] == 126.65


def test_tier_follows_paying_customers_in_the_month():
    with session() as db:
        program = affiliates.get_program(db)
    assert [affiliates.tier_pct(program, n) for n in (0, 1, 19, 20, 49, 50, 100)] == [25, 25, 25, 30, 30, 35, 35]


def test_month_rate_applies_to_all_of_that_months_revenue(admin):
    code = f"TIER{RUN_ID[:4].upper()}"
    creator, creator_email = make_partner(admin, code)
    with session() as db:
        partner_id = user_of(db, creator_email).id
        now = datetime.now(timezone.utc)
        for index in range(20):
            db.add(
                AffiliateCommission(
                    partner_id=partner_id,
                    referral_id=0,
                    customer_id=900_000 + index,
                    order_id=f"tier-{RUN_ID}-{index}",
                    amount_usd=89.0,
                    month=f"{now:%Y-%m}",
                    payable_at=now - timedelta(days=1),
                )
            )
        db.commit()
        rows = affiliates.commission_rows(db, partner_id)
        assert {row["rate_pct"] for row in rows} == {30.0} and {row["status"] for row in rows} == {"payable"}
        assert affiliates.commission_totals(rows)["payable"] == round(20 * 89 * 0.30, 2)


def test_payout_needs_the_minimum_then_marks_commissions_paid(admin):
    code = f"PAY{RUN_ID[:4].upper()}"
    creator, creator_email = make_partner(admin, code)
    buyer_email = address("fan")
    buyer = client_for(buyer_email, device="device-h1", ref=code)
    order_id = checkout(buyer, "max").json()["order_id"]
    pay(buyer_email, order_id)
    with session() as db:
        partner_id = user_of(db, creator_email).id
    url = f"/api/v1/admin/affiliates/partners/{partner_id}/payout"
    assert admin.post(url, json={"method": "USDT"}).status_code == 409  # still on hold
    with session() as db:
        for row in db.execute(select(AffiliateCommission).where(AffiliateCommission.partner_id == partner_id)).scalars():
            row.payable_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    under = admin.post(url, json={"method": "USDT"})
    assert under.status_code == 409 and "minimum" in under.json()["detail"]  # 126.65 x 25% = 31.66
    paid = admin.post(url, json={"method": "USDT", "reference": "tx123", "force": True})
    assert paid.status_code == 200 and paid.json()["amount"] == 31.66
    partner = creator.get("/api/v1/referrals/me").json()["partner"]
    assert partner["totals"] == {"pending": 0.0, "payable": 0.0, "paid": 31.66}
    assert partner["payouts"][0]["reference"] == "tx123"

    # A refund after the payout comes off the next one.
    assert "31.66" in admin.post(f"/api/v1/admin/affiliates/orders/{order_id}/refund", json={}).json()["reversed"]
    partner = creator.get("/api/v1/referrals/me").json()["partner"]
    assert partner["totals"]["payable"] == -31.66


def test_suspending_a_partner_cancels_pending_commissions_and_the_code(admin):
    code = f"SUS{RUN_ID[:4].upper()}"
    creator, creator_email = make_partner(admin, code)
    buyer_email = address("fan")
    buyer = client_for(buyer_email, device="device-i1", ref=code)
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])
    with session() as db:
        partner_id = user_of(db, creator_email).id
    assert admin.post(f"/api/v1/admin/affiliates/partners/{partner_id}", json={"action": "suspend"}).json()["status"] == "suspended"
    assert creator.get("/api/v1/referrals/me").json()["partner"]["totals"]["pending"] == 0.0
    assert TestClient(app).post("/api/v1/referrals/click", json={"code": code}).json() == {"valid": False}
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])  # no new commission
    with session() as db:
        live = db.execute(
            select(AffiliateCommission).where(AffiliateCommission.partner_id == partner_id, AffiliateCommission.status != "void")
        ).scalars().all()
        assert live == []


def test_partner_code_must_be_free_and_applications_can_be_closed(admin):
    code = f"DUP{RUN_ID[:4].upper()}"
    make_partner(admin, code)
    other = client_for(address("creator"))
    body = {"code": code, "audience": "instagram.com/other with 10k"}
    assert other.post("/api/v1/referrals/partner/apply", json=body).status_code == 409
    settings_ = admin.get("/api/v1/admin/affiliates").json()["program"]
    settings_["partner"]["applications_open"] = False
    assert admin.put("/api/v1/admin/affiliates/settings", json=settings_).status_code == 200
    body["code"] = f"NEW{RUN_ID[:4].upper()}"
    assert other.post("/api/v1/referrals/partner/apply", json=body).status_code == 403


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


def test_admin_can_change_every_number_and_customers_cannot_see_the_panel(admin):
    assert client_for(address("nosy")).get("/api/v1/admin/affiliates").status_code == 404
    data = admin.get("/api/v1/admin/affiliates").json()
    program = data["program"]
    assert program["friend"]["reward_tokens"] == {"starter": 300, "pro": 750, "max": 1250}
    program["friend"].update(discount_pct=20, plans=["starter", "pro", "max"], hold_days=3)
    program["partner"]["tiers"] = [{"min": 0, "pct": 10}, {"min": 5, "pct": 40}]
    program["link_days"] = 14
    saved = admin.put("/api/v1/admin/affiliates/settings", json=program).json()
    assert saved["friend"]["discount_pct"] == 20 and saved["link_days"] == 14
    assert affiliates.tier_pct(saved, 5) == 40

    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-j1")
    subscribe(referrer_email)
    friend = client_for(address("friend"), device="device-j2", ref=friend_code(referrer))
    assert checkout(friend, "starter").json()["amount"] == 29.6

    program["friend"]["enabled"] = False
    admin.put("/api/v1/admin/affiliates/settings", json=program)
    assert checkout(friend, "pro").json()["amount"] == 89.0
    listed = admin.get("/api/v1/admin/affiliates/referrals?channel=friend").json()
    assert any(row["referrer_email"] == referrer_email for row in listed)


def test_admin_can_allow_a_blocked_referral_and_reward_now(admin):
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-k-shared")
    subscribe(referrer_email)
    friend_email = address("friend")
    friend = client_for(friend_email, device="device-k-shared", ref=friend_code(referrer))
    row = referral(friend_email)
    assert row.status == "blocked" and "device" in row.flags
    assert admin.post(f"/api/v1/admin/affiliates/referrals/{row.id}", json={"action": "allow"}).json()["status"] == "signed_up"
    pay(friend_email, checkout(friend, "pro").json()["order_id"])
    assert admin.post(f"/api/v1/admin/affiliates/referrals/{row.id}", json={"action": "reward_now"}).json()["status"] == "rewarded"
    with session() as db:
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 750


# --------------------------------------------------------------------------
# batch costs
# --------------------------------------------------------------------------


def test_batch_cost_adds_worker_time_and_download_bandwidth(admin):
    batch_id = f"cost-{RUN_ID}"
    with session() as db:
        owner = user_of(db, admin.get("/api/v1/auth/me").json()["email"])
        db.add(BatchRecord(id=batch_id, user_id=owner.id, asset_count=5))
        db.commit()
    for index in range(5):
        costs.record_render(
            f"{batch_id}-{index}", batch_id, kind="video", render_seconds=210, output_bytes=150 * 1024**2, resolution="3840x2160", duration=30
        )
    data = admin.get("/api/v1/admin/affiliates/batch-costs").json()
    row = next(b for b in data["batches"] if b["batch_id"] == batch_id)
    # 5 x 3.5 min x (2 vCPU + 0.55 GB) + 5 x 150 MB at $0.05/GB
    assert row["outputs"] == 5 and row["compute"] == pytest.approx(0.0184, abs=0.0002)
    assert row["egress"] == pytest.approx(0.0366, abs=0.0002) and row["total"] == pytest.approx(0.055, abs=0.0005)

    with session() as db:
        costs.record_download(db, f"{batch_id}-0", 150 * 1024**2)
        costs.record_download(db, f"{batch_id}-0", 150 * 1024**2)
        assert db.get(RenderStat, f"{batch_id}-0").downloads == 2
    estimate = {row["seconds"]: row for row in data["estimate"]}
    assert estimate[30]["4K"] == pytest.approx(0.056, abs=0.002) and estimate[30]["1080p"] == pytest.approx(0.02, abs=0.002)

    rates = dict(data["rates"], egress_per_gb=0.10)
    assert admin.put("/api/v1/admin/affiliates/batch-costs/rates", json=rates).json()["egress_per_gb"] == 0.10
    doubled = next(b for b in admin.get("/api/v1/admin/affiliates/batch-costs").json()["batches"] if b["batch_id"] == batch_id)
    assert doubled["egress"] > row["egress"] * 1.9
    admin.put("/api/v1/admin/affiliates/batch-costs/rates", json=data["rates"])


# --------------------------------------------------------------------------
# hardening
# --------------------------------------------------------------------------


def test_paying_from_the_referrers_own_payment_account_blocks_the_reward():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-m1")
    own = checkout(referrer, "pro").json()["order_id"]
    wallet = affiliates.payer_hash("U123456789012")
    with session() as db:
        db.get(Order, own).payer_hash = wallet
        db.commit()
    pay(referrer_email, own)
    friend_email = address("friend")
    friend = client_for(friend_email, device="device-m2", ref=friend_code(referrer))
    order_id = checkout(friend, "pro").json()["order_id"]
    with session() as db:
        db.get(Order, order_id).payer_hash = affiliates.payer_hash(" u123456789012 ")
        db.commit()
    pay(friend_email, order_id)
    row = referral(friend_email)
    assert row.status == "blocked" and "payment" in row.flags and row.reward_tokens == 0


def test_commission_stops_once_the_customer_has_left(admin):
    code = f"END{RUN_ID[:4].upper()}"
    creator, creator_email = make_partner(admin, code)
    buyer_email = address("fan")
    buyer = client_for(buyer_email, device="device-n1", ref=code)
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])  # renewed in time: still earning
    assert len(creator.get("/api/v1/referrals/me").json()["partner"]["commissions"]) == 2
    with session() as db:
        user_of(db, buyer_email).sub_period_end = datetime.now(timezone.utc) - timedelta(days=30)
        db.commit()
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])  # came back after the plan had ended
    assert referral(buyer_email).status == "ended"
    pay(buyer_email, checkout(buyer, "pro").json()["order_id"])
    assert len(creator.get("/api/v1/referrals/me").json()["partner"]["commissions"]) == 2


def test_reloading_a_link_counts_one_click():
    email = address("ref")
    referrer = client_for(email, device="device-o1")
    subscribe(email)
    code = friend_code(referrer)
    visitor = TestClient(app, headers={"x-device-id": "device-o2-visitor"})
    for _ in range(3):
        assert visitor.post("/api/v1/referrals/click", json={"code": code}).json()["valid"] is True
    assert referrer.get("/api/v1/referrals/me").json()["friend"]["stats"]["clicks"] == 1


def test_a_reward_is_only_ever_given_once():
    referrer_email = address("ref")
    referrer = client_for(referrer_email, device="device-p1")
    subscribe(referrer_email)
    friend_email = address("friend")
    friend = client_for(friend_email, device="device-p2", ref=friend_code(referrer))
    pay(friend_email, checkout(friend, "pro").json()["order_id"])
    later = datetime.now(timezone.utc) + timedelta(days=8)
    with session() as first, session() as second:
        row_a = affiliates.referral_of(first, user_of(first, friend_email).id)
        row_b = affiliates.referral_of(second, user_of(second, friend_email).id)
        assert affiliates.give_reward(first, row_a, now=later) == "rewarded"
        assert affiliates.give_reward(second, row_b, now=later) == "rewarded"  # sees it is done, pays nothing
    with session() as db:
        assert bucket_totals(db, user_of(db, referrer_email))[REFERRAL] == 750
