"""Free generations for every account, the friend sign-up reward and the free-trial follow-up email."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from app import affiliates, broadcast, tokens
from app.db import Referral
from app.main import app
from app.tokens import REFERRAL, bucket_totals

from .test_affiliates import (  # noqa: F401 - fixtures and helpers
    PASSWORD,
    _clean,
    _database,
    address,
    admin,
    checkout,
    friend_code,
    pay,
    referral,
    session,
    subscribe,
    user_of,
)


def joined(email: str, *, ip: str, device: str, ref: str | None = None) -> TestClient:
    client = TestClient(app)
    client.headers["x-device-id"] = device
    client.headers["x-forwarded-for"] = ip
    if ref:
        assert client.post("/api/v1/referrals/click", json={"code": ref}).json()["valid"] is True
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client


def referral_tokens(email: str) -> int:
    with session() as db:
        return bucket_totals(db, user_of(db, email))[REFERRAL]


# --------------------------------------------------------------------------
# friend referral: 200 on sign-up, 400 on subscribe
# --------------------------------------------------------------------------


def test_any_customer_can_invite_and_earns_200_then_400():
    referrer_email = address("inviter")
    referrer = joined(referrer_email, ip="10.1.0.1", device="dev-inviter-1")
    me = referrer.get("/api/v1/referrals/me").json()["friend"]
    assert me["eligible"] is True and me["code"] and me["signup_reward_tokens"] == 200
    code = me["code"]

    friend_email = address("pal")
    friend = joined(friend_email, ip="10.2.0.1", device="dev-pal-1", ref=code)
    row = referral(friend_email)
    assert row.status == "signed_up" and row.signup_reward_tokens == 200 and row.signup_reward_given_at
    assert referral_tokens(referrer_email) == 200

    # Typing the same code again (or the link firing twice) pays nothing more.
    assert friend.post("/api/v1/referrals/apply", json={"code": code}).status_code == 200
    with session() as db:
        affiliates.on_email_verified(db, user_of(db, friend_email))
    assert referral_tokens(referrer_email) == 200

    pay(friend_email, checkout(friend, "pro").json()["order_id"])
    assert referral(friend_email).reward_tokens == 400
    with session() as db:
        affiliates.process_due_rewards(db, datetime.now(timezone.utc) + timedelta(days=8))
    assert referral(friend_email).status == "rewarded"
    assert referral_tokens(referrer_email) == 600
    friends = referrer.get("/api/v1/referrals/me").json()["friend"]["friends"]
    assert friends[0]["signup_reward_tokens"] == 200 and friends[0]["reward_tokens"] == 400


def test_no_signup_reward_for_self_referral_or_same_network():
    referrer_email = address("solo")
    referrer = joined(referrer_email, ip="10.3.0.1", device="dev-solo-1")
    code = friend_code(referrer)

    same_device = address("solo-alt")
    joined(same_device, ip="10.3.0.2", device="dev-solo-1", ref=code)
    assert referral(same_device).status == "blocked"

    same_network = address("solo-net")
    joined(same_network, ip="10.3.0.1", device="dev-solo-net", ref=code)
    assert referral(same_network).signup_reward_given_at is None
    assert referral_tokens(referrer_email) == 0
    assert referrer.post("/api/v1/referrals/apply", json={"code": code}).status_code == 422


def test_signup_reward_waits_for_a_confirmed_email_and_follows_admin_numbers(admin):
    program = admin.get("/api/v1/admin/affiliates").json()["program"]
    program["friend"]["signup_reward_tokens"] = 150
    program["friend"]["signup_monthly_cap"] = 1
    saved = admin.put("/api/v1/admin/affiliates/settings", json=program)
    assert saved.status_code == 200 and saved.json()["friend"]["signup_reward_tokens"] == 150

    referrer_email = address("waiter")
    referrer = joined(referrer_email, ip="10.4.0.1", device="dev-waiter")
    code = friend_code(referrer)
    friend_email = address("unconfirmed")
    joined_friend = address("unconfirmed-b")
    # A friend whose email is not confirmed yet: no reward until they confirm.
    friend = joined(friend_email, ip="10.4.0.2", device="dev-unconf")
    with session() as db:
        user = user_of(db, friend_email)
        user.email_verified = False
        db.commit()
    assert friend.post("/api/v1/referrals/apply", json={"code": code}).status_code == 200
    assert referral_tokens(referrer_email) == 0
    with session() as db:
        user = user_of(db, friend_email)
        user.email_verified = True
        db.commit()
        affiliates.on_email_verified(db, user)
    assert referral_tokens(referrer_email) == 150

    # The monthly cap of 1 stops the next one.
    joined(joined_friend, ip="10.4.0.3", device="dev-unconf-b", ref=code)
    assert referral(joined_friend).signup_reward_given_at is None
    assert referral_tokens(referrer_email) == 150


def test_subscribers_only_mode_still_works(admin):
    program = admin.get("/api/v1/admin/affiliates").json()["program"]
    program["friend"]["open_to_all"] = False
    assert admin.put("/api/v1/admin/affiliates/settings", json=program).status_code == 200
    email = address("closed")
    client = joined(email, ip="10.5.0.1", device="dev-closed")
    assert client.get("/api/v1/referrals/me").json()["friend"]["eligible"] is False
    subscribe(email)
    assert client.get("/api/v1/referrals/me").json()["friend"]["eligible"] is True


def test_old_saved_rewards_move_to_200_and_400():
    with session() as db:
        affiliates.save_program(db, {"friend": {"reward_tokens": {"starter": 300, "pro": 750, "max": 1250}}})
        affiliates.set_setting(db, "migration.friend_rewards_200_400_v1", False)
        db.commit()
        affiliates.ensure_friend_rewards_v2(db)
        program = affiliates.get_program(db)
    assert program["friend"]["reward_tokens"] == {"starter": 400, "pro": 400, "max": 400}
    assert program["friend"]["signup_reward_tokens"] == 200


# --------------------------------------------------------------------------
# free generations
# --------------------------------------------------------------------------


def test_admin_controls_free_generations_and_grants_existing_accounts_once(admin):
    assert admin.get("/api/v1/admin/free-trial").json()["count"] == 3

    old_email = address("oldtimer")
    joined(old_email, ip="10.6.0.1", device="dev-old")
    with session() as db:
        user = user_of(db, old_email)
        user.free_generations = 0
        user.free_generations_granted = 0  # an account made before free generations existed
        db.commit()
    used_email = address("used-up")
    joined(used_email, ip="10.6.0.2", device="dev-used")
    with session() as db:
        user = user_of(db, used_email)
        user.free_generations = 0  # spent its 3
        db.commit()

    out = admin.post("/api/v1/admin/free-trial/grant-existing").json()
    assert out["given"] >= 1
    with session() as db:
        assert user_of(db, old_email).free_generations == 3
        assert user_of(db, used_email).free_generations == 0
    assert admin.post("/api/v1/admin/free-trial/grant-existing").json()["given"] == 0
    with session() as db:
        assert user_of(db, old_email).free_generations == 3

    assert admin.put("/api/v1/admin/free-trial", json={"enabled": True, "count": 5}).json()["count"] == 5
    five = address("five")
    joined(five, ip="10.6.0.3", device="dev-five")
    with session() as db:
        assert user_of(db, five).free_generations == 5
    admin.put("/api/v1/admin/free-trial", json={"enabled": False, "count": 5})
    none = address("none")
    joined(none, ip="10.6.0.4", device="dev-none")
    with session() as db:
        assert user_of(db, none).free_generations == 0
        tokens.save_free_trial(db, enabled=True, count=3)
        db.commit()


def test_free_trial_settings_need_an_admin():
    client = joined(address("nosy"), ip="10.7.0.1", device="dev-nosy")
    assert client.get("/api/v1/admin/free-trial").status_code in (401, 403, 404)
    assert client.post("/api/v1/admin/free-trial/grant-existing").status_code in (401, 403, 404)


# --------------------------------------------------------------------------
# the follow-up email
# --------------------------------------------------------------------------


def test_follow_up_email_shows_free_box_old_prices_and_big_button(admin):
    status = admin.get("/api/v1/admin/emails/groups").json()
    draft = next(d for d in status["drafts"] if d["id"] == "free_trial_offer")
    assert draft["big_button"] is True and "free_left" in draft["groups"]
    assert any(g["id"] == "free_left" for g in status["groups"])
    assert {p["id"]: p["was"] for p in status["offer"]["plans"]} == {"starter": 37.0, "pro": 89.0, "max": 149.0}

    email = address("lead")
    joined(email, ip="10.8.0.1", device="dev-lead")
    with session() as db:
        uid = user_of(db, email).id
    people = admin.get("/api/v1/admin/emails/groups").json()["people"]
    assert "free_left" in next(p for p in people if p["id"] == uid)["groups"]

    body = {k: draft[k] for k in ("subject", "body", "button", "big_button")} | {"user_id": uid}
    preview = admin.post("/api/v1/admin/emails/groups/preview", json=body).json()
    html, text = preview["html"], preview["text"]
    assert "Try your 3 free generations" in html and "https://app.example.test/app" in html
    assert "font-size:20px" in html  # the big button
    assert "line-through" in html and "$37" in html and "$29" in html and "Save 22%" in html
    assert "free generations waiting for you" in html
    assert "{price_offer}" not in html and "{free_offer}" not in html
    assert "$37 -> $29/month" in text and "{price_offer}" not in text
    assert "bypass" not in (html + text).lower() and "undetect" not in (html + text).lower()

    saved = admin.put("/api/v1/admin/emails/groups/offer", json={"was": {"starter": 0}}).json()
    starter = next(p for p in saved["plans"] if p["id"] == "starter")
    assert starter["was"] == 0 and starter["off_pct"] == 0
    admin.put("/api/v1/admin/emails/groups/offer", json={"was": {"starter": 37}})


def test_free_box_hidden_for_someone_who_used_their_generations(admin):
    email = address("spent")
    joined(email, ip="10.9.0.1", device="dev-spent")
    with session() as db:
        user = user_of(db, email)
        user.free_generations = 0
        db.commit()
        uid = user.id
    preview = admin.post(
        "/api/v1/admin/emails/groups/preview",
        json={"subject": "Hi", "body": "Hi\n\n{free_offer}\n\n{price_offer}", "button": "", "user_id": uid},
    ).json()
    assert "free generations waiting" not in preview["html"] and "New lower prices" in preview["html"]


def test_referral_row_columns_exist():
    with session() as db:
        assert db.query(Referral).filter(Referral.signup_reward_given_at.is_not(None)).count() >= 0
    assert broadcast.PRICE_MARKER == "{price_offer}"
