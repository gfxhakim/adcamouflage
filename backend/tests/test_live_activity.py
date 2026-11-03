"""The landing ticker's public activity feed: real events only, nothing identifying."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import live_activity
from app.db import BatchRecord, Order, User, get_session_factory, init_db
from app.main import app

RUN_ID = uuid.uuid4().hex[:10]


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


def _user(db, tag: str) -> User:
    user = User(email=f"ticker-{tag}-{RUN_ID}@example.com", password_hash="x", display_name="Secret Name")
    db.add(user)
    db.flush()
    return user


def test_feed_reports_real_paid_subscriptions_and_active_batches():
    # A moment ahead of every other test's rows, so ours are the newest in the window.
    now = datetime.now(timezone.utc) + timedelta(days=1)
    factory = get_session_factory()
    with factory() as db:
        before = live_activity.collect(db, now)
        buyer = _user(db, "buyer")
        comp = _user(db, "comp")
        worker = _user(db, "worker")
        db.add_all(
            [
                Order(id=f"o1-{RUN_ID}", user_id=buyer.id, kind="subscription", plan_id="pro", amount_usd=89.0, status="paid", paid_at=now - timedelta(minutes=3)),
                # Admin grant ($0), unpaid order, a top-up and an old one: none count.
                Order(id=f"o2-{RUN_ID}", user_id=comp.id, kind="subscription", plan_id="max", amount_usd=0.0, status="paid", paid_at=now),
                Order(id=f"o3-{RUN_ID}", user_id=buyer.id, kind="subscription", plan_id="max", amount_usd=149.0, status="pending"),
                Order(id=f"o4-{RUN_ID}", user_id=buyer.id, kind="topup", plan_id="pro", amount_usd=40.0, status="paid", paid_at=now),
                Order(id=f"o5-{RUN_ID}", user_id=buyer.id, kind="subscription", plan_id="starter", amount_usd=37.5, status="paid", paid_at=now - timedelta(days=30)),
                BatchRecord(id=f"b1-{RUN_ID}", user_id=worker.id, asset_count=1, created_at=now - timedelta(minutes=2)),
                BatchRecord(id=f"b2-{RUN_ID}", user_id=worker.id, asset_count=1, created_at=now - timedelta(minutes=1)),
                BatchRecord(id=f"b3-{RUN_ID}", user_id=comp.id, asset_count=1, created_at=now - timedelta(hours=2)),
            ]
        )
        db.commit()
        after = live_activity.collect(db, now)

    assert after["active_now"] == before["active_now"] + 1
    assert len(after["subscribers"]) == min(len(before["subscribers"]) + 1, live_activity.SUBSCRIBER_LIMIT)
    newest = after["subscribers"][0]
    assert newest["plan"] == "Pro"
    assert 170 <= newest["seconds_ago"] <= 190
    assert set(newest) == {"plan", "seconds_ago"}


def test_public_endpoint_never_leaks_identities():
    live_activity.clear_cache()
    response = TestClient(app).get("/api/v1/live-activity")
    assert response.status_code == 200
    body = response.text
    assert "@" not in body and "Secret Name" not in body
    data = response.json()
    assert isinstance(data["active_now"], int)
    assert isinstance(data["subscribers"], list)
