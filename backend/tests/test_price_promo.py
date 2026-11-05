"""The limited-time launch offer: countdown data, admin editing, and that a
checkout bills exactly the price the pricing page shows before and after the
offer ends."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import tokens
from app.db import Order
from app.main import app
from app.tokens import get_token_plans, save_price_promo

from .test_billing import (  # noqa: F401  (fixtures)
    _clear_setting,
    _database,
    _mock_btcpay,
    _reset_limiter,
    _session,
    _signed_in,
    address,
    admin,
    btcpay_env,
)


@pytest.fixture(autouse=True)
def _no_offer_left_behind():
    yield
    _clear_setting(tokens.PROMO_SETTING)


def _offer(ends_at: datetime, enabled: bool = True, regular=None) -> None:
    with _session() as db:
        save_price_promo(
            db,
            {"enabled": enabled, "ends_at": ends_at, "regular": regular or {"starter": 59, "pro": 129, "max": 199}},
        )
        db.commit()


def _public_plan(plan_id: str) -> dict:
    body = TestClient(app).get("/api/v1/plans").json()
    return next(p for p in body["plans"] if p["id"] == plan_id) | {"_promo": body["promo"]}


def test_running_offer_shows_launch_and_regular_prices():
    ends = datetime.now(timezone.utc) + timedelta(days=2)
    _offer(ends)
    for plan_id, launch, regular in (("starter", 37.5, 59), ("pro", 89, 129), ("max", 149, 199)):
        plan = _public_plan(plan_id)
        assert plan["price"] == launch and plan["regular_price"] == regular
        assert plan["launch_price"] == launch
        assert datetime.fromisoformat(plan["offer_ends_at"]) == ends.replace(microsecond=ends.microsecond)
        # Token amounts are untouched by the offer.
        assert plan["tokens"] == tokens.DEFAULT_PLANS[plan_id].tokens
    promo = _public_plan("pro")["_promo"]
    assert promo["active"] is True and promo["enabled"] is True and promo["server_time"]


def test_ended_offer_switches_to_regular_prices():
    _offer(datetime.now(timezone.utc) - timedelta(seconds=1))
    plan = _public_plan("pro")
    assert plan["price"] == 129 and plan["regular_price"] is None and plan["offer_ends_at"] is None
    assert plan["launch_price"] == 89
    assert plan["_promo"]["active"] is False


def test_switched_off_offer_keeps_the_typed_prices():
    _offer(datetime.now(timezone.utc) - timedelta(days=1), enabled=False)
    plan = _public_plan("starter")
    assert plan["price"] == 37.5 and plan["regular_price"] is None


def test_regular_price_not_above_launch_price_is_no_offer():
    _offer(datetime.now(timezone.utc) + timedelta(days=1), regular={"starter": 30, "pro": 129, "max": 149})
    assert _public_plan("starter")["regular_price"] is None and _public_plan("starter")["price"] == 37.5
    assert _public_plan("max")["regular_price"] is None and _public_plan("max")["price"] == 149
    assert _public_plan("pro")["regular_price"] == 129


def test_price_flips_exactly_at_the_end_time():
    ends = datetime(2030, 1, 1, tzinfo=timezone.utc)
    _offer(ends)
    with _session() as db:
        assert get_token_plans(db, now=ends - timedelta(seconds=1))["max"].price == 149
        assert get_token_plans(db, now=ends)["max"].price == 199


def test_checkout_bills_the_shown_price_before_and_after(btcpay_env, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": f"inv_{len(sent)}", "checkoutLink": "https://pay.example.test/i/x"})

    sent: list[dict] = []
    _mock_btcpay(monkeypatch, handler)

    _offer(datetime.now(timezone.utc) + timedelta(hours=1))
    early = _signed_in(address("promo-early"))
    response = early.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "starter"})
    assert response.status_code == 201, response.text
    assert response.json()["amount"] == 37.5 and sent[-1]["amount"] == "37.50"

    _offer(datetime.now(timezone.utc) - timedelta(seconds=1))
    late = _signed_in(address("promo-late"))
    response = late.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "starter"})
    assert response.status_code == 201, response.text
    assert response.json()["amount"] == 59 and sent[-1]["amount"] == "59.00"
    assert response.json()["tokens"] == 1500

    # The earlier order keeps the price it was quoted.
    with _session() as db:
        orders = db.query(Order).filter(Order.amount_usd.in_([37.5, 59])).all()
        assert sorted(o.amount_usd for o in orders if o.plan_id == "starter")[-2:] == [37.5, 59]


def test_admin_edits_the_offer(admin):
    config = admin.get("/api/v1/admin/billing/config").json()
    assert set(config["promo"]) >= {"enabled", "active", "ends_at", "regular", "server_time"}

    def put(promo):
        return admin.put("/api/v1/admin/billing/config", json={"promo": promo})

    assert put({"enabled": True, "ends_at": "2030-01-01T00:00:00Z", "regular": {"gold": 10}}).status_code == 422
    assert put({"enabled": True, "ends_at": "2030-01-01T00:00:00Z", "regular": {"pro": -1}}).status_code == 422
    assert put({"enabled": True, "ends_at": "not a date"}).status_code == 422

    saved = put({"enabled": True, "ends_at": "2030-01-01T00:00:00", "regular": {"pro": 139}})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["promo"]["active"] is True and body["promo"]["ends_at"].startswith("2030-01-01T00:00:00")
    assert body["promo"]["regular"]["pro"] == 139 and body["promo"]["regular"]["starter"] == 59
    assert body["plans"]["pro"]["regular_price"] == 139 and body["plans"]["pro"]["price"] == 89

    off = put({"enabled": False, "ends_at": "2030-01-01T00:00:00Z"}).json()
    assert off["promo"]["active"] is False and off["plans"]["pro"]["regular_price"] is None
    feed = admin.get("/api/v1/admin/activity", params={"kind": "admin"}).json()
    assert any("launch offer off" in e["detail"] for e in feed)


def test_shipped_default_offer_ends_8_november():
    ends = datetime.fromisoformat(tokens.DEFAULT_PROMO["ends_at"])
    assert ends == datetime(2026, 11, 8, 23, 59, 59, tzinfo=timezone.utc)
    assert tokens.DEFAULT_PROMO["regular"] == {"starter": 59.0, "pro": 129.0, "max": 199.0}
