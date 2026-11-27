"""Token plans, top-ups, Whop checkout and the subscription lifecycle.

The rules here are the owner's price list (see docs in app/tokens.py); the
numbers asserted are the ones that must come out exactly.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import tokens
from app.auth_routes import login_limiter
from app.config import settings
from app.db import ActivityEvent, Order, TokenLedger, User, get_session_factory, init_db
from app.mailer import due_reminders, send_billing_reminders
from app.main import app
from app.tokens import (
    DEFAULT_PLANS,
    activate_period,
    balances,
    consume,
    generation_cost,
    get_token_plans,
    quote_batch,
    topup_tokens,
)

from .conftest import make_legacy
from .test_whop import _install_standardwebhooks_stub_if_missing, _post_whop, _whop_event  # noqa: F401

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"


def address(name: str) -> str:
    return f"{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield


@pytest.fixture
def admin(monkeypatch):
    email = address("billing-boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    client = _signed_in(email)
    make_legacy(email)
    return client


@pytest.fixture
def whop_env(monkeypatch):
    """Whop configured with placeholder secrets & plan maps; no network calls."""

    _install_standardwebhooks_stub_if_missing(monkeypatch)
    monkeypatch.setattr(settings, "whop_api_key", SecretStr("whop-api-key-placeholder"))
    monkeypatch.setattr(settings, "whop_webhook_secret", SecretStr("ws_webhook-secret-placeholder"))
    monkeypatch.setattr(settings, "whop_plan_subscription", {"starter": "plan_starter", "pro": "plan_pro", "max": "plan_max"})
    monkeypatch.setattr(
        settings,
        "whop_plan_topup",
        {"20": "plan_top20", "40": "plan_top40", "80": "plan_top80", "160": "plan_top160", "240": "plan_top240"},
    )
    monkeypatch.setattr(settings, "public_url", "https://app.example.test")
    yield


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _signed_in(email: str) -> TestClient:
    """A signed-in account on token billing (the default for new sign-ups)."""

    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _user_id(client: TestClient) -> int:
    return client.get("/api/v1/auth/me").json()["id"]


def _load(email: str) -> User:
    with get_session_factory()() as db:
        return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def _session():
    return get_session_factory()()


def _with_user(email: str, fn):
    """Run ``fn(db, user)`` in a session and commit."""

    with _session() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        result = fn(db, user)
        db.commit()
        return result


def _grant(email: str, plan_id: str, **kwargs):
    return _with_user(
        email, lambda db, user: activate_period(db, user, get_token_plans(db)[plan_id], **kwargs)
    )


def _balances(email: str) -> tuple[int, int]:
    return _with_user(email, lambda db, user: balances(db, user))


def _ledger(email: str) -> list[TokenLedger]:
    with _session() as db:
        user = db.execute(select(User).where(User.email == email.lower())).scalar_one()
        return (
            db.execute(select(TokenLedger).where(TokenLedger.user_id == user.id).order_by(TokenLedger.id))
            .scalars()
            .all()
        )


def _set_period_end(email: str, when: datetime) -> None:
    def apply(db, user):
        user.sub_period_end = when

    _with_user(email, apply)


def _upload(client: TestClient, image, count: int = 1, variants: int = 1):
    files = [("files", (f"a{i}.jpg", image.read_bytes(), "image/jpeg")) for i in range(count)]
    data = {"options": json.dumps({"variants": variants})} if variants > 1 else {}
    return client.post("/api/v1/batches", files=files, data=data)


# --------------------------------------------------------------------------
# pricing
# --------------------------------------------------------------------------


EXPECTED_TOTALS = {
    "starter": {20: 800, 40: 1700, 80: 3500, 160: 7400, 240: 11500},
    "pro": {20: 1000, 40: 2100, 80: 4400, 160: 9200, 240: 14400},
    "max": {20: 1300, 40: 2750, 80: 5700, 160: 11950, 240: 18700},
}


@pytest.mark.parametrize(
    ("plan_id", "amount", "total"),
    [(p, a, t) for p, table in EXPECTED_TOTALS.items() for a, t in table.items()],
)
def test_topup_totals_are_exact(plan_id, amount, total):
    assert topup_tokens(DEFAULT_PLANS[plan_id], amount) == total


@pytest.mark.parametrize(
    ("plan_id", "price", "tokens", "per_generation", "generations", "cap"),
    [("starter", 29.0, 1500, 100, 15, 0), ("pro", 69, 4500, 90, 50, 4500), ("max", 115, 9600, 80, 120, 19200)],
)
def test_plan_cards(plan_id, price, tokens, per_generation, generations, cap):
    plan = DEFAULT_PLANS[plan_id]
    assert (plan.price, plan.tokens, plan.tokens_per_generation) == (price, tokens, per_generation)
    assert plan.generations == generations and plan.rollover_cap == cap
    assert plan.price_per_generation == round(price / generations, 2)


def test_generation_cost_follows_the_plan_bought():
    email = address("cost")
    _signed_in(email)
    for plan_id in ("starter", "pro", "max"):
        _grant(email, plan_id)
        assert generation_cost(_load(email)) == DEFAULT_PLANS[plan_id].tokens_per_generation


def test_public_plans_endpoint_shape():
    body = TestClient(app).get("/api/v1/plans").json()
    assert body["currency"]
    assert [p["id"] for p in body["plans"]] == ["starter", "pro", "max"]
    card = body["plans"][1]
    assert set(card) >= {
        "id", "label", "price", "tokens", "tokens_per_generation", "generations",
        "price_per_generation", "rollover_months", "topup_rate",
    }
    assert card["generations"] == 50 and card["price_per_generation"] == 1.38
    assert body["topups"]["amounts"] == [20, 40, 80, 160, 240]
    assert body["topups"]["bonus"]["max"]["240"] == 3100
    assert body["rules"] == {"grace_days": 7, "period_days": 30}


# --------------------------------------------------------------------------
# lifecycle
# --------------------------------------------------------------------------


def test_new_signups_start_on_tokens_with_nothing():
    email = address("fresh")
    me = _signed_in(email).get("/api/v1/auth/me").json()
    assert me["billing_mode"] == "tokens"
    assert me["tokens_usable"] == 0 and me["subscription_active"] is False
    assert me["free_generations"] == 3
    user = _load(email)
    assert user.sub_plan is None and user.sub_period_end is None
    assert user.free_generations == 3


def test_subscribe_grants_tokens_and_a_30_day_period():
    email = address("subscribe")
    _signed_in(email)
    before = datetime.now(timezone.utc)
    result = _grant(email, "pro")
    assert result == {"granted": 4500, "rollover": 0, "expired": 0}

    user = _load(email)
    assert user.billing_mode == "tokens" and user.sub_plan == "pro"
    assert user.sub_tokens_per_generation == 90 and user.sub_cancelled_at is None
    end = user.sub_period_end.replace(tzinfo=timezone.utc)
    assert timedelta(days=29, hours=23) < end - before < timedelta(days=30, minutes=1)
    assert _balances(email) == (4500, 0)
    assert [(e.bucket, e.kind, e.amount) for e in _ledger(email)] == [("subscription", "grant", 4500)]


@pytest.mark.parametrize(
    ("plan_id", "periods", "expected_rollover"),
    [("pro", 2, 4500), ("max", 3, 19200), ("starter", 2, 0)],
)
def test_renewing_the_same_plan_rolls_over_up_to_the_cap(plan_id, periods, expected_rollover):
    email = address(f"renew-{plan_id}")
    _signed_in(email)
    plan = DEFAULT_PLANS[plan_id]
    _grant(email, plan_id, periods=periods)
    leftover = plan.tokens * periods
    assert _balances(email)[0] == leftover

    result = _grant(email, plan_id)
    assert result["rollover"] == expected_rollover
    assert result["expired"] == leftover - expected_rollover
    assert _balances(email)[0] == expected_rollover + plan.tokens
    # Only what is lost is written off; rolled-over tokens never leave the bucket.
    entries = _ledger(email)
    expired = [e.amount for e in entries if e.kind == "expire"]
    assert expired == ([-(leftover - expected_rollover)] if leftover > expected_rollover else [])
    assert "rollover" not in {e.kind for e in entries}
    grant = [e for e in entries if e.kind == "grant"][-1]
    assert (f"({expected_rollover} rolled over)" in grant.note) == (expected_rollover > 0)


def test_upgrade_keeps_the_rollover_under_the_new_cap():
    email = address("upgrade")
    _signed_in(email)
    _grant(email, "pro")
    assert _grant(email, "max")["rollover"] == 4500
    assert _balances(email)[0] == 4500 + 9600
    assert _load(email).sub_tokens_per_generation == 80


def test_downgrade_drops_the_rollover():
    email = address("downgrade")
    _signed_in(email)
    _grant(email, "max")
    assert _grant(email, "pro")["rollover"] == 0
    assert _balances(email)[0] == 4500


def test_cancelled_subscription_gets_no_rollover():
    email = address("cancelled")
    client = _signed_in(email)
    _grant(email, "pro")
    assert client.post("/api/v1/billing/cancel").status_code == 200
    assert _load(email).sub_cancelled_at is not None
    assert _grant(email, "pro")["rollover"] == 0
    assert _balances(email)[0] == 4500
    assert _load(email).sub_cancelled_at is None  # buying again un-cancels


def test_renewal_after_the_grace_window_loses_the_rollover():
    email = address("late")
    _signed_in(email)
    now = datetime.now(timezone.utc)
    _grant(email, "pro")
    _set_period_end(email, now - timedelta(days=8))
    assert _grant(email, "pro")["rollover"] == 0

    # Inside the window the leftover survives.
    _set_period_end(email, now - timedelta(days=3))
    assert _grant(email, "pro")["rollover"] == 4500


def test_period_end_extends_from_the_old_end():
    email = address("extend")
    _signed_in(email)
    _grant(email, "max")
    first = _load(email).sub_period_end.replace(tzinfo=timezone.utc)
    _grant(email, "max")
    second = _load(email).sub_period_end.replace(tzinfo=timezone.utc)
    assert abs((second - first) - timedelta(days=30)) < timedelta(seconds=5)


def test_lapsed_period_counts_from_now_and_grant_months_multiply():
    email = address("lapsed-extend")
    _signed_in(email)
    _grant(email, "starter")
    _set_period_end(email, datetime.now(timezone.utc) - timedelta(days=2))
    before = datetime.now(timezone.utc)
    result = _grant(email, "starter", periods=3)
    assert result["granted"] == 4500
    end = _load(email).sub_period_end.replace(tzinfo=timezone.utc)
    assert timedelta(days=89, hours=23) < end - before < timedelta(days=90, minutes=1)


# --------------------------------------------------------------------------
# consumption
# --------------------------------------------------------------------------


def test_consumption_takes_subscription_tokens_before_topups():
    email = address("consume")
    _signed_in(email)
    _grant(email, "pro")
    _with_user(
        email,
        lambda db, user: db.add(TokenLedger(user_id=user.id, bucket="topup", kind="admin", amount=1000, note="t")),
    )
    assert _balances(email) == (4500, 1000)

    cost = _with_user(email, lambda db, user: consume(db, user, 51, "batch_consume_test"))
    assert cost == 51 * 90 == 4590
    assert _balances(email) == (0, 910)
    consumed = [(e.bucket, e.amount) for e in _ledger(email) if e.kind == "consume"]
    assert consumed == [("subscription", -4500), ("topup", -90)]
    assert all(e.batch_id == "batch_consume_test" for e in _ledger(email) if e.kind == "consume")


def test_quote_reports_cost_and_refusals():
    email = address("quote")
    _signed_in(email)
    with _session() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        free_quote = quote_batch(db, user, 1, 3)
        assert (free_quote.generations, free_quote.cost, free_quote.available, free_quote.refusal) == (3, 0, 3, None)
        over_trial = quote_batch(db, user, 2, 2)
        assert over_trial.refusal is not None and "3 free generations left" in over_trial.refusal and "Subscribe to a plan" in over_trial.refusal
        user.free_generations = 0
        assert quote_batch(db, user, 2, 2).refusal == "Subscribe to a plan to start generating."
    _grant(email, "starter")
    with _session() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        quote = quote_batch(db, user, 2, 3)
        assert (quote.generations, quote.cost, quote.available, quote.refusal) == (6, 600, 1500, None)
        assert "needs 1600 tokens (16 generations) but you have 1500" in quote_batch(db, user, 4, 4).refusal


def test_batches_are_refused_without_tokens_and_charged_with_them(sample_image):
    email = address("paywall")
    client = _signed_in(email)

    first_free = _upload(client, sample_image, count=1)
    assert first_free.status_code == 202, first_free.text
    assert client.get("/api/v1/auth/me").json()["free_generations"] == 2
    assert _balances(email) == (0, 0)

    next_two_free = _upload(client, sample_image, count=1, variants=2)
    assert next_two_free.status_code == 202, next_two_free.text
    assert client.get("/api/v1/auth/me").json()["free_generations"] == 0

    refused = _upload(client, sample_image)
    assert refused.status_code == 402
    assert refused.json()["detail"] == "Subscribe to a plan to start generating."

    _grant(email, "starter")
    accepted = _upload(client, sample_image, count=2, variants=2)
    assert accepted.status_code == 202, accepted.text
    assert len(accepted.json()["accepted"]) == 4
    assert _balances(email) == (1500 - 400, 0)
    assert client.get("/api/v1/auth/me").json()["tokens_usable"] == 1100

    too_big = _upload(client, sample_image, count=3, variants=4)  # 12 x 100 > 1100
    assert too_big.status_code == 402
    assert "needs 1200 tokens (12 generations) but you have 1100" in too_big.json()["detail"]
    assert "Top up or upgrade" in too_big.json()["detail"]
    assert _balances(email) == (1100, 0)  # a refused batch costs nothing

    _set_period_end(email, datetime.now(timezone.utc) - timedelta(hours=1))
    lapsed = _upload(client, sample_image)
    assert lapsed.status_code == 402
    assert lapsed.json()["detail"].startswith("Your Starter period ended on ")
    assert lapsed.json()["detail"].endswith(". Renew to continue.")


def test_two_batches_cannot_spend_the_same_tokens(sample_image, monkeypatch):
    """The deduction re-checks the balance, so a batch that slipped in after the quote is refused."""

    from app import main as main_module

    email = address("overspend")
    client = _signed_in(email)
    _grant(email, "starter")  # 1500 tokens = 15 generations
    original = main_module.check_billing

    def check_then_spend_elsewhere(db, user, files, variants):
        refusal = original(db, user, files, variants)
        # Another request for the same account lands between the quote and the deduction.
        _with_user(email, lambda other_db, other_user: consume(other_db, other_user, 15, "batch_elsewhere"))
        return refusal

    monkeypatch.setattr(main_module, "check_billing", check_then_spend_elsewhere)
    uploads_before = {p.name for p in settings.uploads_dir.iterdir()}
    refused = _upload(client, sample_image)
    assert refused.status_code == 402, refused.text
    assert "needs 100 tokens" in refused.json()["detail"] and "you have 0" in refused.json()["detail"]
    assert _balances(email) == (0, 0)  # never negative
    assert {p.name for p in settings.uploads_dir.iterdir()} == uploads_before  # the upload was removed
    assert client.get("/api/v1/auth/subscription").json()["balance"]["usable_tokens"] == 0

    # A debt an admin puts on one bucket is not hidden by the other.
    monkeypatch.setattr(main_module, "check_billing", original)
    _with_user(
        email,
        lambda db, user: db.add(TokenLedger(user_id=user.id, bucket="topup", kind="admin", amount=-300, note="debt")),
    )
    _grant(email, "starter")
    assert _balances(email) == (1500, -300)
    assert client.get("/api/v1/auth/subscription").json()["balance"]["usable_tokens"] == 1200
    assert _upload(client, sample_image, count=2, variants=1).status_code == 202
    assert _upload(client, sample_image, count=11, variants=1).status_code == 402


def test_batch_cost_is_in_the_activity_log(admin, sample_image):
    email = address("logged")
    client = _signed_in(email)
    _grant(email, "pro")
    assert _upload(client, sample_image, count=2).status_code == 202
    feed = admin.get("/api/v1/admin/activity", params={"kind": "batch", "limit": 100}).json()
    mine = [e for e in feed if e["user_id"] == _user_id(client)]
    assert mine and "for 180 tokens" in mine[0]["detail"]


def test_legacy_accounts_keep_their_quota(sample_image):
    email = address("legacy")
    client = _signed_in(email)
    make_legacy(email)
    assert client.get("/api/v1/auth/me").json()["billing_mode"] == "legacy"
    assert _upload(client, sample_image).status_code == 202
    assert _ledger(email) == []
    data = client.get("/api/v1/auth/subscription").json()
    assert data["billing_mode"] == "legacy" and data["subscription"] is None
    assert data["alerts"] == [] and data["monthly_quota"] is None


def test_failed_render_refunds_one_generation_once(sample_image, monkeypatch):
    from app import tasks
    from app.mutator import MutationError

    email = address("refund")
    client = _signed_in(email)
    _grant(email, "pro")
    created = _upload(client, sample_image, count=2)
    assert created.status_code == 202, created.text
    batch_id = created.json()["batch_id"]
    asset_id = created.json()["accepted"][0]["id"]
    assert _balances(email)[0] == 4500 - 180

    def boom(*_args, **_kwargs):
        raise MutationError("simulated failure")

    monkeypatch.setattr(tasks, "mutate", boom)
    assert tasks.run_asset_job(asset_id)["status"] == "failed"
    assert _balances(email)[0] == 4500 - 90

    # A second failure report for the same asset does not refund again.
    assert tasks.run_asset_job(asset_id)["status"] == "failed"
    assert tokens.refund_asset(asset_id) == 0
    assert _balances(email)[0] == 4500 - 90
    refunds = [e for e in _ledger(email) if e.kind == "refund"]
    assert len(refunds) == 1 and refunds[0].batch_id == batch_id and refunds[0].note == f"refund {asset_id}"


def test_refund_never_raises():
    assert tokens.refund_asset("asset_does_not_exist") == 0


def test_cancelled_render_is_not_refunded_even_on_worker_interrupt(sample_image, monkeypatch):
    from app import main as main_module
    from app import tasks
    from app.schemas import JobStatus
    from app.storage import get_store

    monkeypatch.setattr(main_module, "enqueue_asset", lambda _asset_id: "celery-stub-task")

    email = address("user-cancel-no-refund")
    client = _signed_in(email)
    _grant(email, "pro")
    created = _upload(client, sample_image, count=2)
    assert created.status_code == 202, created.text
    asset_id = created.json()["accepted"][0]["id"]
    assert _balances(email)[0] == 4500 - 180

    cancelled = client.post(f"/api/v1/assets/{asset_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert _balances(email)[0] == 4500 - 180
    assert tokens.refund_asset(asset_id) == 0

    # Even if the worker throws during teardown after user cancel, keep CANCELLED and never refund.
    def interrupt(*_args, **_kwargs):
        raise SystemExit(1)

    monkeypatch.setattr(tasks, "mutate", interrupt)
    assert tasks.run_asset_job(asset_id)["status"] == "cancelled"
    tasks._fail(asset_id, error="should not overwrite cancel")
    assert get_store().get_asset(asset_id).status is JobStatus.CANCELLED
    assert _balances(email)[0] == 4500 - 180


def test_blocked_and_interrupted_renders_refund_automatically(sample_image, monkeypatch):
    from app import main as main_module
    from app import queue, tasks
    from app.celery_app import celery_app
    from app.schemas import JobStatus
    from app.storage import get_store

    # 1. Enqueue failure (queue unreachable) must fail + refund immediately.
    monkeypatch.setattr(settings, "inline_worker", False)

    class DeadTask:
        def apply_async(self, **_kw):
            raise ConnectionError("redis down")

    monkeypatch.setattr(queue, "process_asset", DeadTask())
    monkeypatch.setattr(queue.time, "sleep", lambda _s: None)

    email_q = address("enqueue-fail")
    client_q = _signed_in(email_q)
    _grant(email_q, "pro")
    created_q = _upload(client_q, sample_image, count=1)
    assert created_q.status_code == 202, created_q.text
    asset_q = created_q.json()["accepted"][0]["id"]
    assert get_store().get_asset(asset_q).status is JobStatus.FAILED
    assert _balances(email_q)[0] == 4500  # fully refunded

    # 2. Prevent auto-execution so we can test stalled, expired-batch, BaseException, and worker crash.
    monkeypatch.setattr(main_module, "enqueue_asset", lambda _asset_id: "celery-stub-task")

    email = address("server-fail-refund")
    client = _signed_in(email)
    _grant(email, "pro")
    created = _upload(client, sample_image, count=4)
    assert created.status_code == 202, created.text
    batch_id = created.json()["batch_id"]
    a_expire, a_interrupt, a_worker_lost, a_stalled = [a["id"] for a in created.json()["accepted"]]
    assert _balances(email)[0] == 4500 - 360

    store = get_store()

    # 2a. Batch record missing before processing.
    orig_get_batch = store.get_batch
    monkeypatch.setattr(store, "get_batch", lambda bid: None if bid == batch_id else orig_get_batch(bid))
    # Point a_expire to missing batch check once:
    assert tasks.run_asset_job(a_expire)["status"] == "failed"
    assert _balances(email)[0] == 4500 - 270
    monkeypatch.setattr(store, "get_batch", orig_get_batch)

    # 2b. Server interrupt (BaseException / deploy shutdown, NOT cancelled by user).
    def crash_sigterm(*_args, **_kwargs):
        raise SystemExit(15)

    monkeypatch.setattr(tasks, "mutate", crash_sigterm)
    with pytest.raises(SystemExit):
        tasks.run_asset_job(a_interrupt)
    assert store.get_asset(a_interrupt).status is JobStatus.FAILED
    assert _balances(email)[0] == 4500 - 180

    # 2c. Celery worker crash (WorkerLostError / OOM SIGKILL signal).
    tasks._on_process_asset_failure(args=[a_worker_lost], exception=RuntimeError("Worker exited prematurely"))
    assert store.get_asset(a_worker_lost).status is JobStatus.FAILED
    assert _balances(email)[0] == 4500 - 90

    # 2d. Stalled PROCESSING asset reaped when batch is polled -> refunded cleanly.
    stalled_rec = store.get_asset(a_stalled)
    stalled_rec.status = JobStatus.PROCESSING
    stalled_rec.started_at = datetime.now(timezone.utc) - timedelta(seconds=settings.stale_processing_seconds + 120)
    stalled_rec.updated_at = stalled_rec.started_at
    # Save directly without save_asset bumping updated_at:
    store.backend.set(f"adcam:asset:{a_stalled}", stalled_rec.model_dump_json(), ex=3600)

    polled = client.get(f"/api/v1/batches/{batch_id}")
    assert polled.status_code == 200
    assert polled.json()["failed"] == 4
    assert store.get_asset(a_stalled).stage == "stalled"
    assert _balances(email)[0] == 4500
    # Verify Celery Beat schedule includes stalled reaper.
    assert "reap-stalled-assets" in celery_app.conf.beat_schedule


# --------------------------------------------------------------------------
# checkout and Whop
# --------------------------------------------------------------------------


def test_checkout_needs_payments_configured(monkeypatch):
    monkeypatch.setattr(settings, "whop_api_key", None)
    monkeypatch.setattr(settings, "whop_webhook_secret", None)
    client = _signed_in(address("unconfigured"))
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 503 and response.json()["detail"] == "Payments are not set up yet."
    assert client.get("/api/v1/auth/subscription").json()["payments_enabled"] is False


def test_checkout_creates_an_order_and_returns_whop_plan(whop_env):
    email = address("checkout")
    client = _signed_in(email)
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["whop_plan"] == "plan_pro"
    assert body["provider"] == "whop"
    assert body["amount"] == 69 and body["tokens"] == 4500

    order = client.get(f"/api/v1/billing/orders/{body['order_id']}").json()
    assert order["status"] == "pending" and order["kind"] == "subscription" and order["plan_id"] == "pro"
    assert [o["id"] for o in client.get("/api/v1/billing/orders").json()] == [body["order_id"]]
    assert _balances(email) == (0, 0)  # nothing is credited until it is paid

    # Another user cannot read it.
    assert _signed_in(address("nosy")).get(f"/api/v1/billing/orders/{body['order_id']}").status_code == 404
    assert client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "gold"}).status_code == 422


def test_topup_checkout_requires_an_active_subscription(whop_env):
    email = address("topup-checkout")
    client = _signed_in(email)
    refused = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 40})
    assert refused.status_code == 402

    _grant(email, "max")
    assert client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 50}).status_code == 422
    ok = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 240})
    assert ok.status_code == 201, ok.text
    assert ok.json()["whop_plan"] == "plan_top240"
    assert ok.json()["tokens"] == 18700 and ok.json()["amount"] == 240


def test_webhook_settles_an_order_exactly_once(whop_env, admin):
    email = address("webhook")
    client = _signed_in(email)
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()["order_id"]

    # Non-settlement events change nothing.
    assert _post_whop(_whop_event(order_id, event_type="payment.pending", variant_id="plan_pro")).json() == {
        "ok": True,
        "ignored": "payment.pending",
    }
    assert _balances(email) == (0, 0)

    event = _whop_event(order_id, variant_id="plan_pro")
    first = _post_whop(event)
    assert first.status_code == 200 and first.json() == {"ok": True, "applied": True}
    assert _balances(email) == (4500, 0)
    user = _load(email)
    assert user.sub_plan == "pro" and user.billing_mode == "tokens"

    again = _post_whop(event)
    assert again.status_code == 200 and again.json() == {"ok": True, "applied": False}
    assert _balances(email) == (4500, 0)

    order = client.get(f"/api/v1/billing/orders/{order_id}").json()
    assert order["status"] == "paid" and order["paid_at"]
    with _session() as db:
        assert db.get(Order, order_id).applied_at is not None
    feed = admin.get("/api/v1/admin/activity", params={"kind": "payment"}).json()
    assert any(e["user_id"] == user.id and "Paid $69 for Pro period (Whop)" == e["detail"] for e in feed)


def test_webhook_settles_a_topup_with_its_bonus(whop_env):
    email = address("webhook-topup")
    client = _signed_in(email)
    _grant(email, "pro")
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 80}).json()["order_id"]

    assert _post_whop(_whop_event(order_id, variant_id="plan_top80")).status_code == 200
    assert _balances(email) == (4500, 4400)
    kinds = [(e.kind, e.amount) for e in _ledger(email) if e.bucket == "topup"]
    assert kinds == [("topup", 4000), ("bonus", 400)]


def test_settlement_is_applied_once_when_admin_and_webhook_overlap(whop_env):
    """A stale order reference cannot settle again once the webhook has settled it."""

    email = address("race")
    client = _signed_in(email)
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()["order_id"]

    with _session() as stale:
        order_seen_pending = stale.get(Order, order_id)
        assert order_seen_pending.status == "pending"

        assert _post_whop(_whop_event(order_id, variant_id="plan_pro")).json()["applied"] is True
        assert _balances(email) == (4500, 0)

        assert tokens.settle_order(stale, order_seen_pending, source="Whop") is False
        assert order_seen_pending.status == "paid"

    assert _balances(email) == (4500, 0)
    assert [e.kind for e in _ledger(email)] == ["grant"]


def test_settlement_credits_what_the_order_quoted(whop_env, admin):
    """Admin price edits between checkout and payment do not change what the buyer gets."""

    email = address("quoted")
    client = _signed_in(email)
    _grant(email, "pro")
    topup = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 80}).json()
    assert topup["tokens"] == 4400
    renewal = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()
    assert renewal["tokens"] == 4500

    config = admin.get("/api/v1/admin/billing/config").json()
    pro = {k: config["plans"]["pro"][k] for k in ("label", "price", "tokens", "tokens_per_generation", "rollover_months", "topup_rate")}
    try:
        changed = admin.put(
            "/api/v1/admin/billing/config",
            json={
                "plans": {"pro": {**pro, "tokens": 6000, "tokens_per_generation": 5, "topup_rate": 1}},
                "topups": {"amounts": config["topups"]["amounts"], "bonus": {"pro": {"80": 0}}},
            },
        )
        assert changed.status_code == 200, changed.text

        assert _post_whop(_whop_event(topup["order_id"], variant_id="plan_top80")).json()["applied"] is True
        assert _balances(email) == (4500, 4400)
        assert [(e.kind, e.amount) for e in _ledger(email) if e.bucket == "topup"] == [("topup", 4000), ("bonus", 400)]

        assert _post_whop(_whop_event(renewal["order_id"], variant_id="plan_pro")).json()["applied"] is True
        assert _balances(email) == (4500 + 4500, 4400)
        assert _load(email).sub_tokens_per_generation == 90
        orders = {o["id"]: o for o in client.get("/api/v1/billing/orders").json()}
        assert orders[topup["order_id"]]["tokens"] == 4400 and orders[renewal["order_id"]]["tokens"] == 4500
    finally:
        _clear_setting("token_plans")
        _clear_setting("token_topups")


def test_checkout_reuses_the_open_order(whop_env):
    email = address("reuse")
    client = _signed_in(email)
    first = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()
    again = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()
    assert again == first
    other = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()
    assert other["order_id"] != first["order_id"]
    assert len(client.get("/api/v1/billing/orders").json()) == 2


def test_cancel_and_resume():
    email = address("cancel")
    client = _signed_in(email)
    assert client.post("/api/v1/billing/cancel").status_code == 409
    _grant(email, "starter")
    cancelled = client.post("/api/v1/billing/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["cancelled"] is True
    data = client.get("/api/v1/auth/subscription").json()
    assert data["subscription"]["cancelled"] is True
    assert any(a["code"] == "cancelled" for a in data["alerts"])
    resumed = client.post("/api/v1/billing/resume")
    assert resumed.status_code == 200 and resumed.json()["cancelled"] is False
    assert client.get("/api/v1/auth/subscription").json()["subscription"]["cancelled"] is False


# --------------------------------------------------------------------------
# client payload
# --------------------------------------------------------------------------


def test_subscription_payload_for_a_token_user():
    email = address("payload")
    client = _signed_in(email)
    data = client.get("/api/v1/auth/subscription").json()
    assert data["billing_mode"] == "tokens" and data["subscription"] is None
    assert data["balance"] == {
        "subscription_tokens": 0, "topup_tokens": 0, "usable_tokens": 0, "generations_left": 0, "frozen_topup": False,
    }
    assert data["free_generations"] == 3 and data["free_generations_total"] == 3
    assert [p["id"] for p in data["token_plans"]] == ["starter", "pro", "max"]
    assert data["topups"] == {"amounts": [20, 40, 80, 160, 240], "options": []}
    assert [a["code"] for a in data["alerts"]] == ["free_trial"]
    assert "3 free generations" in data["alerts"][0]["text"]
    assert data["grace_days"] == 7
    # The legacy fields are still there for older clients.
    assert "used_this_month" in data and len(data["daily"]) == 30

    def zero_free(db, user):
        user.free_generations = 0

    _with_user(email, zero_free)
    exhausted = client.get("/api/v1/auth/subscription").json()
    assert exhausted["free_generations"] == 0
    assert [a["code"] for a in exhausted["alerts"]] == ["no_subscription"]

    _grant(email, "pro")
    data = client.get("/api/v1/auth/subscription").json()
    sub = data["subscription"]
    assert sub["plan_id"] == "pro" and sub["plan_label"] == "Pro" and sub["price"] == 69
    assert sub["active"] is True and sub["days_left"] == 30 and sub["in_grace"] is False
    assert sub["tokens_per_generation"] == 90 and sub["cancelled"] is False
    assert data["balance"]["usable_tokens"] == 4500 and data["balance"]["generations_left"] == 50
    assert data["free_generations"] == 0
    assert data["alerts"] == []
    options = data["topups"]["options"]
    assert [o["amount"] for o in options] == [20, 40, 80, 160, 240]
    assert options[2] == {"amount": 80, "tokens": 4000, "bonus": 400, "total": 4400, "generations": 48}

    me = client.get("/api/v1/auth/me").json()
    assert me["tokens_usable"] == 4500 and me["subscription_active"] is True


def test_subscription_alerts():
    email = address("alerts")
    client = _signed_in(email)
    _grant(email, "starter")
    now = datetime.now(timezone.utc)

    _set_period_end(email, now + timedelta(days=3))
    codes = {a["code"]: a for a in client.get("/api/v1/auth/subscription").json()["alerts"]}
    assert set(codes) == {"ends_soon"} and codes["ends_soon"]["level"] == "warning"
    assert "ends in 3 days" in codes["ends_soon"]["text"]

    # Spend down to one generation.
    _with_user(email, lambda db, user: consume(db, user, 14, "batch_alerts"))
    codes = {a["code"] for a in client.get("/api/v1/auth/subscription").json()["alerts"]}
    assert codes == {"ends_soon", "low_tokens"}

    _set_period_end(email, now - timedelta(days=2))
    data = client.get("/api/v1/auth/subscription").json()
    assert [a["code"] for a in data["alerts"]] == ["ended"]
    assert "Renew within 5 days" in data["alerts"][0]["text"]
    assert data["subscription"]["active"] is False and data["subscription"]["in_grace"] is True
    assert data["balance"]["usable_tokens"] == 0 and data["balance"]["subscription_tokens"] == 100
    assert client.get("/api/v1/auth/me").json()["subscription_active"] is False


def test_topups_freeze_while_lapsed_and_return_on_renewal():
    email = address("frozen")
    client = _signed_in(email)
    _grant(email, "pro")
    _with_user(email, lambda db, user: tokens.apply_topup(db, user, DEFAULT_PLANS["pro"], 40))
    assert _balances(email) == (4500, 2100)

    _set_period_end(email, datetime.now(timezone.utc) - timedelta(days=1))
    balance = client.get("/api/v1/auth/subscription").json()["balance"]
    assert balance["frozen_topup"] is True and balance["usable_tokens"] == 0 and balance["topup_tokens"] == 2100

    _grant(email, "pro")
    balance = client.get("/api/v1/auth/subscription").json()["balance"]
    assert balance["frozen_topup"] is False and balance["usable_tokens"] == 4500 + 4500 + 2100


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


def test_admin_grants_adjusts_and_switches_mode(admin):
    email = address("granted")
    client = _signed_in(email)
    user_id = _user_id(client)
    make_legacy(email)

    assert admin.post(f"/api/v1/admin/users/{user_id}/billing/grant", json={"plan_id": "gold"}).status_code == 422
    assert admin.post(f"/api/v1/admin/users/{user_id}/billing/grant", json={"plan_id": "pro", "months": 0}).status_code == 422

    granted = admin.post(f"/api/v1/admin/users/{user_id}/billing/grant", json={"plan_id": "pro", "months": 2})
    assert granted.status_code == 200, granted.text
    body = granted.json()
    assert body["billing_mode"] == "tokens" and body["subscription"]["plan_id"] == "pro"
    assert body["balance"]["subscription_tokens"] == 9000 and body["subscription"]["days_left"] == 60
    assert body["orders"][0]["status"] == "paid" and body["orders"][0]["amount"] == 0
    assert body["orders"][0]["kind"] == "subscription" and body["orders"][0]["tokens"] == 9000
    assert any(e["kind"] == "grant" and "granted by admin" in e["note"] for e in body["ledger"])

    adjusted = admin.post(f"/api/v1/admin/users/{user_id}/billing/tokens", json={"amount": -500, "note": "refund dispute"})
    assert adjusted.status_code == 200, adjusted.text
    assert adjusted.json()["balance"]["topup_tokens"] == -500
    assert adjusted.json()["ledger"][0]["kind"] == "admin" and adjusted.json()["ledger"][0]["note"] == "refund dispute"
    assert admin.post(f"/api/v1/admin/users/{user_id}/billing/tokens", json={"amount": 0}).status_code == 422

    assert admin.post(f"/api/v1/admin/users/{user_id}/billing/mode", json={"mode": "gold"}).status_code == 422
    switched = admin.post(f"/api/v1/admin/users/{user_id}/billing/mode", json={"mode": "legacy"})
    assert switched.status_code == 200 and switched.json()["billing_mode"] == "legacy"
    assert client.get("/api/v1/auth/me").json()["billing_mode"] == "legacy"

    detail = admin.get(f"/api/v1/admin/users/{user_id}/billing").json()
    assert detail["user_id"] == user_id and len(detail["ledger"]) == 2 and len(detail["orders"]) == 1
    row = admin.get(f"/api/v1/admin/users/{user_id}").json()["user"]
    assert row["sub_plan"] == "pro" and row["subscription_active"] is True

    # A plain user cannot reach any of it.
    assert client.get(f"/api/v1/admin/users/{user_id}/billing").status_code == 404
    assert admin.get("/api/v1/admin/users/999999/billing").status_code == 404


def test_admin_billing_config_is_validated_and_applied(admin):
    config = admin.get("/api/v1/admin/billing/config").json()
    assert set(config["plans"]) == {"starter", "pro", "max"} and config["rules"]["grace_days"] == 7
    pro = {k: config["plans"]["pro"][k] for k in ("label", "price", "tokens", "tokens_per_generation", "rollover_months", "topup_rate")}

    def put(body):
        return admin.put("/api/v1/admin/billing/config", json=body)

    try:
        assert put({"plans": {"pro": {**pro, "price": -1}}}).status_code == 422
        assert put({"plans": {"pro": {**pro, "tokens": 0}}}).status_code == 422
        assert put({"plans": {"pro": {**pro, "tokens_per_generation": 0}}}).status_code == 422
        assert put({"plans": {"pro": {**pro, "rollover_months": 13}}}).status_code == 422
        assert put({"plans": {"pro": {**pro, "topup_rate": 0}}}).status_code == 422
        assert put({"plans": {"gold": pro}}).status_code == 422
        assert put({"topups": {"amounts": [0, 20]}}).status_code == 422
        assert put({"topups": {"amounts": [20], "bonus": {"pro": {"20": -5}}}}).status_code == 422
        assert put({"topups": {"amounts": [20], "bonus": {"gold": {"20": 5}}}}).status_code == 422
        assert put({"rules": {"grace_days": -1, "period_days": 30}}).status_code == 422

        saved = put(
            {
                "plans": {"pro": {**pro, "price": 99, "rollover_months": 2}},
                "topups": {"amounts": [25, 50], "bonus": {"pro": {"25": 10, "50": 30}}},
                "rules": {"grace_days": 10, "period_days": 30},
            }
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["plans"]["pro"]["price"] == 99 and body["plans"]["pro"]["rollover_cap"] == 9000
        assert body["topups"]["amounts"] == [25, 50] and body["topups"]["bonus"]["pro"] == {"25": 10, "50": 30}
        assert body["rules"]["grace_days"] == 10

        with _session() as db:
            plan = get_token_plans(db)["pro"]
            assert topup_tokens(plan, 50, tokens.get_topups(db)) == 50 * 50 + 30
        public = TestClient(app).get("/api/v1/plans").json()
        assert next(p for p in public["plans"] if p["id"] == "pro")["price"] == 99
        feed = admin.get("/api/v1/admin/activity", params={"kind": "admin"}).json()
        assert any("Token billing updated" in e["detail"] for e in feed)
    finally:
        for key in ("token_plans", "token_topups", "billing_rules"):
            _clear_setting(key)
    assert admin.get("/api/v1/admin/billing/config").json()["plans"]["pro"]["price"] == 69


def _clear_setting(key: str) -> None:
    from app.db import AppSetting

    with _session() as db:
        row = db.get(AppSetting, key)
        if row is not None:
            db.delete(row)
            db.commit()


def test_overview_counts_token_revenue_and_live_subscriptions(admin, whop_env):
    email = address("revenue")
    client = _signed_in(email)
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()["order_id"]
    before = admin.get("/api/v1/admin/overview").json()

    assert _post_whop(_whop_event(order_id, variant_id="plan_max")).status_code == 200
    after = admin.get("/api/v1/admin/overview").json()
    assert after["token_revenue_30d"] - before["token_revenue_30d"] == pytest.approx(115)
    assert after["active_subscriptions"] == before["active_subscriptions"] + 1
    assert "mrr" in after  # the legacy figures stay


# --------------------------------------------------------------------------
# reminders
# --------------------------------------------------------------------------


def test_reminders_pick_the_right_users_once():
    now = datetime.now(timezone.utc)
    ending = address("rem-ending")
    ended = address("rem-ended")
    long_gone = address("rem-gone")
    far_off = address("rem-far")
    legacy = address("rem-legacy")
    for email in (ending, ended, long_gone, far_off, legacy):
        _signed_in(email)
        _grant(email, "pro")
    _set_period_end(ending, now + timedelta(days=2))
    _set_period_end(ended, now - timedelta(hours=12))
    _set_period_end(long_gone, now - timedelta(days=3))
    _set_period_end(far_off, now + timedelta(days=10))
    _set_period_end(legacy, now + timedelta(days=1))
    make_legacy(legacy)

    with _session() as db:
        due = {user.email: (code, subject) for user, code, subject, _html in due_reminders(db, now)}
    # Other tests in this run leave lapsed accounts behind too, so check
    # membership rather than the whole set.
    mine = {k: v for k, v in due.items() if k.endswith(f"-{RUN_ID}@example.com")}
    assert {ending, ended} <= set(mine)
    assert not {long_gone, far_off, legacy} & set(mine)
    assert mine[ending][0] == "ending" and mine[ending][1].startswith("Your Pro plan ends on ")
    assert mine[ended] == ("ended", "Your Pro plan has ended")

    sent: list[tuple[str, str]] = []

    def fake_send(to: str, subject: str, html: str) -> bool:
        sent.append((to, subject))
        return True

    with _session() as db:
        result = send_billing_reminders(db, now, send=fake_send)
        assert result["sent"] >= 2
        assert {to for to, _ in sent} >= {ending, ended}
        # Marked as sent, so the next run skips them...
        assert not {u.email for u, *_ in due_reminders(db, now)} & {ending, ended}
        events = db.execute(
            select(ActivityEvent).where(ActivityEvent.kind == "reminder", ActivityEvent.user_id == _load(ending).id)
        ).scalars().all()
        assert len(events) == 1 and events[0].detail.startswith("[")

    # ...until the period is renewed, which is a new period end.
    _grant(ending, "pro")
    _set_period_end(ending, now + timedelta(days=1))
    with _session() as db:
        assert ending in {u.email for u, *_ in due_reminders(db, now)}


def test_reminders_are_a_noop_without_a_mail_key(monkeypatch):
    from app.mailer import send_email

    monkeypatch.setattr(settings, "resend_api_key", None)
    assert send_email("someone@example.com", "hi", "<p>hi</p>") is False

    email = address("rem-silent")
    _signed_in(email)
    _grant(email, "starter")
    _set_period_end(email, datetime.now(timezone.utc) + timedelta(days=1))
    with _session() as db:
        assert send_billing_reminders(db) == {"sent": 0, "skipped": 0}
        # Nobody is marked, so the reminder goes out once a key is added...
        assert email in {u.email for u, *_ in due_reminders(db)}
        # ...and a send the provider refuses is retried on the next run too.
        assert send_billing_reminders(db, send=lambda *_: False)["skipped"] >= 1
        assert email in {u.email for u, *_ in due_reminders(db)}
        assert send_billing_reminders(db, send=lambda *_: True)["sent"] >= 1
        assert email not in {u.email for u, *_ in due_reminders(db)}


def test_reminder_task_is_scheduled():
    from app.celery_app import celery_app
    from app.tasks import send_billing_reminders as task

    entry = celery_app.conf.beat_schedule["send-billing-reminders"]
    assert entry["task"] == task.name == "app.tasks.send_billing_reminders"
    assert entry["schedule"] == 3600.0


def test_new_signups_receive_three_free_generations_and_exhaust_cleanly(sample_image, monkeypatch):
    from starlette.requests import Request
    from app import main as main_module
    from app.oauth import find_or_create_user

    # 1. New customer signup receives 3 free generations and zero locked studio features.
    email = address("trial-flow")
    client = _signed_in(email)
    sub = client.get("/api/v1/auth/subscription").json()
    assert sub["free_generations"] == 3 and sub["free_generations_total"] == 3
    assert sub["locked_features"] == []

    # 2. Affiliate-only signups receive 0 free generations.
    aff_email = address("trial-aff")
    aff_client = TestClient(app)
    aff_res = aff_client.post(
        "/api/v1/auth/register",
        json={"email": aff_email, "password": PASSWORD, "account_role": "affiliate"},
    )
    assert aff_res.status_code == 201, aff_res.text
    assert _load(aff_email).free_generations == 0

    # 3. Google OAuth new customer receives 3 free generations.
    oauth_email = address("trial-oauth")
    req = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
    with _session() as db:
        oauth_user, opened = find_or_create_user(
            db,
            req,
            provider="google",
            subject=f"sub-{oauth_email}",
            email=oauth_email,
            email_verified=True,
            name="OAuth Trial",
        )
        assert opened is True and oauth_user.free_generations == 3

    # 4. Requesting more than 3 free generations fails without deducting.
    too_many = _upload(client, sample_image, count=2, variants=2)
    assert too_many.status_code == 402
    assert "3 free generations left" in too_many.json()["detail"]
    assert _load(email).free_generations == 3

    # 5. Concurrent spend between quote and consume never lets free_generations go negative.
    original_check = main_module.check_billing

    def drain_between(db, user, files, variants):
        refusal = original_check(db, user, files, variants)
        _with_user(email, lambda d, u: tokens.consume_batch(d, u, 2, "batch_trial_elsewhere"))
        return refusal

    monkeypatch.setattr(main_module, "check_billing", drain_between)
    uploads_before = {p.name for p in settings.uploads_dir.iterdir()}
    raced = _upload(client, sample_image, count=2, variants=1)
    assert raced.status_code == 402, raced.text
    assert "1 free generation left" in raced.json()["detail"]
    assert _load(email).free_generations == 1
    assert {p.name for p in settings.uploads_dir.iterdir()} == uploads_before

    monkeypatch.setattr(main_module, "check_billing", original_check)
    last_free = _upload(client, sample_image, count=1, variants=1)
    assert last_free.status_code == 202, last_free.text
    assert _load(email).free_generations == 0

    # 6. Once subscribed and later expired, account never falls back to free trial.
    _grant(email, "starter")
    _set_period_end(email, datetime.now(timezone.utc) - timedelta(days=1))
    after_sub = client.get("/api/v1/auth/subscription").json()
    assert after_sub["free_generations"] == 0
    assert _upload(client, sample_image, count=1).status_code == 402


def test_failed_free_trial_render_refunds_once_and_cancel_does_not(sample_image, monkeypatch):
    from app import main as main_module
    from app import tasks
    from app.mutator import MutationError
    from app.schemas import JobStatus
    from app.storage import get_store

    monkeypatch.setattr(main_module, "enqueue_asset", lambda _asset_id: "celery-stub-task")

    email = address("trial-refund")
    client = _signed_in(email)
    created = _upload(client, sample_image, count=2)
    assert created.status_code == 202, created.text
    failed_id, cancelled_id = [a["id"] for a in created.json()["accepted"]]
    assert _load(email).free_generations == 1

    def boom(*_args, **_kwargs):
        raise MutationError("simulated trial failure")

    monkeypatch.setattr(tasks, "mutate", boom)
    assert tasks.run_asset_job(failed_id)["status"] == "failed"
    assert _load(email).free_generations == 2

    # Second failure/refund attempt is idempotent.
    assert tasks.run_asset_job(failed_id)["status"] == "failed"
    assert tokens.refund_asset(failed_id) == 0
    assert _load(email).free_generations == 2

    # User cancel does NOT refund free trial generation.
    assert client.post(f"/api/v1/assets/{cancelled_id}/cancel").status_code == 200
    assert get_store().get_asset(cancelled_id).status is JobStatus.CANCELLED
    assert tokens.refund_asset(cancelled_id) == 0
    assert _load(email).free_generations == 2
    assert _ledger(email) == []


def test_ensure_plan_prices_migration_updates_stored_overrides_once():
    try:
        with _session() as db:
            tokens.save_token_plans(
                db,
                {
                    "starter": {
                        "label": "Starter",
                        "price": 37.0,
                        "tokens": 1500,
                        "tokens_per_generation": 100,
                        "rollover_months": 0,
                        "topup_rate": 40,
                        "seats": 1,
                    },
                    "pro": {
                        "label": "Pro",
                        "price": 89.0,
                        "tokens": 4500,
                        "tokens_per_generation": 90,
                        "rollover_months": 1,
                        "topup_rate": 50,
                        "seats": 1,
                    },
                    "max": {
                        "label": "Max",
                        "price": 149.0,
                        "tokens": 9600,
                        "tokens_per_generation": 80,
                        "rollover_months": 2,
                        "topup_rate": 65,
                        "seats": 5,
                    },
                },
            )
            db.commit()
        _clear_setting("migration.plan_prices_29_69_115_v1")

        with _session() as db:
            tokens.ensure_plan_prices_29_69_115(db)
            plans = get_token_plans(db)
            assert (plans["starter"].price, plans["pro"].price, plans["max"].price) == (29.0, 69.0, 115.0)

            # Subsequent admin edits are preserved when startup runs again.
            tokens.save_token_plans(db, {"pro": {"price": 75.0}})
            db.commit()
            tokens.ensure_plan_prices_29_69_115(db)
            assert get_token_plans(db)["pro"].price == 75.0
    finally:
        _clear_setting("token_plans")
        _clear_setting("migration.plan_prices_29_69_115_v1")
