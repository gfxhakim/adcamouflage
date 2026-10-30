"""Token plans, top-ups, BTCPay checkout and the subscription lifecycle.

The rules here are the owner's price list (see docs in app/tokens.py); the
numbers asserted are the ones that must come out exactly.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app import btcpay, tokens
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
def btcpay_env(monkeypatch):
    """BTCPay 'configured' with placeholder values; no network is ever touched."""

    monkeypatch.setattr(settings, "btcpay_url", "https://pay.example.test/")
    monkeypatch.setattr(settings, "btcpay_store_id", "store123")
    monkeypatch.setattr(settings, "btcpay_api_key", SecretStr("api-key-placeholder"))
    monkeypatch.setattr(settings, "btcpay_webhook_secret", SecretStr("webhook-secret-placeholder"))
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


def _signed_body(body: dict, secret: str = "webhook-secret-placeholder") -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode("utf-8")
    return raw, {"BTCPay-Sig": btcpay.sign(secret, raw), "Content-Type": "application/json"}


def _mock_btcpay(monkeypatch, handler):
    """Route every BTCPay call through ``handler(request) -> httpx.Response``."""

    monkeypatch.setattr(btcpay, "_transport", httpx.MockTransport(handler))


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
    [("starter", 37.5, 1500, 100, 15, 0), ("pro", 89, 4500, 90, 50, 4500), ("max", 149, 9600, 80, 120, 19200)],
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
    assert card["generations"] == 50 and card["price_per_generation"] == 1.78
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
    user = _load(email)
    assert user.sub_plan is None and user.sub_period_end is None


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


# --------------------------------------------------------------------------
# checkout and BTCPay
# --------------------------------------------------------------------------


def test_checkout_needs_payments_configured(monkeypatch):
    monkeypatch.setattr(settings, "btcpay_url", "")
    client = _signed_in(address("unconfigured"))
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 503 and response.json()["detail"] == "Payments are not set up yet."
    assert client.get("/api/v1/auth/subscription").json()["payments_enabled"] is False


def test_checkout_creates_an_order_and_an_invoice(btcpay_env, monkeypatch):
    email = address("checkout")
    client = _signed_in(email)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "inv_" + RUN_ID, "checkoutLink": "https://pay.example.test/i/x"})

    _mock_btcpay(monkeypatch, handler)
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["checkout_url"] == "https://pay.example.test/i/x"
    assert body["amount"] == 89 and body["tokens"] == 4500

    request = seen[0]
    assert request.method == "POST" and request.url.path == "/api/v1/stores/store123/invoices"
    assert request.headers["authorization"] == "token api-key-placeholder"
    sent = json.loads(request.content)
    assert sent["amount"] == "89.00" and sent["currency"]
    assert sent["metadata"]["orderId"] == body["order_id"] and sent["metadata"]["kind"] == "subscription"
    assert sent["checkout"]["redirectURL"] == f"https://app.example.test/app/plan?order={body['order_id']}"
    assert sent["checkout"]["redirectAutomatically"] is True

    order = client.get(f"/api/v1/billing/orders/{body['order_id']}").json()
    assert order["status"] == "pending" and order["kind"] == "subscription" and order["plan_id"] == "pro"
    assert [o["id"] for o in client.get("/api/v1/billing/orders").json()] == [body["order_id"]]
    assert _balances(email) == (0, 0)  # nothing is credited until it is paid

    # Another user cannot read it.
    assert _signed_in(address("nosy")).get(f"/api/v1/billing/orders/{body['order_id']}").status_code == 404


def test_checkout_reports_a_btcpay_outage_as_502(btcpay_env, monkeypatch):
    client = _signed_in(address("outage"))

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("no route")

    _mock_btcpay(monkeypatch, handler)
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"})
    assert response.status_code == 502
    assert "payment server" in response.json()["detail"]
    assert client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "gold"}).status_code == 422


def test_topup_checkout_requires_an_active_subscription(btcpay_env, monkeypatch):
    email = address("topup-checkout")
    client = _signed_in(email)
    refused = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 40})
    assert refused.status_code == 402

    _grant(email, "max")
    _mock_btcpay(
        monkeypatch,
        lambda request: httpx.Response(200, json={"id": "inv_top_" + RUN_ID, "checkoutLink": "https://pay/x"}),
    )
    assert client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 50}).status_code == 422
    ok = client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 240})
    assert ok.status_code == 201, ok.text
    assert ok.json()["tokens"] == 18700 and ok.json()["amount"] == 240


def test_webhook_rejects_bad_signatures(btcpay_env):
    anonymous = TestClient(app)
    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": "x"}, secret="wrong-secret")
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 401
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw).status_code == 401
    # The signature covers the raw bytes, so a changed body fails too.
    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": "x"})
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw + b" ", headers=headers).status_code == 401


def test_verify_signature_unit():
    raw = b'{"type":"InvoiceSettled"}'
    good = btcpay.sign("s3cret", raw)
    assert btcpay.verify_signature(raw, good, "s3cret")
    assert not btcpay.verify_signature(raw, good, "other")
    assert not btcpay.verify_signature(raw, None, "s3cret")
    assert not btcpay.verify_signature(raw, good, "")


def test_webhook_settles_an_order_exactly_once(btcpay_env, monkeypatch, admin):
    email = address("webhook")
    client = _signed_in(email)
    invoice_id = "inv_settle_" + RUN_ID
    _mock_btcpay(monkeypatch, lambda request: httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"}))
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()["order_id"]

    anonymous = TestClient(app)
    # Earlier events in the invoice's life change nothing.
    raw, headers = _signed_body({"type": "InvoiceReceivedPayment", "invoiceId": invoice_id})
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json() == {"ok": True}
    assert _balances(email) == (0, 0)

    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": invoice_id, "metadata": {"orderId": order_id}})
    first = anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers)
    assert first.status_code == 200 and first.json() == {"ok": True, "applied": True}
    assert _balances(email) == (4500, 0)
    user = _load(email)
    assert user.sub_plan == "pro" and user.billing_mode == "tokens"

    again = anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers)
    assert again.status_code == 200 and again.json() == {"ok": True, "applied": False}
    assert _balances(email) == (4500, 0)

    order = client.get(f"/api/v1/billing/orders/{order_id}").json()
    assert order["status"] == "paid" and order["paid_at"]
    with _session() as db:
        assert db.get(Order, order_id).applied_at is not None
    feed = admin.get("/api/v1/admin/activity", params={"kind": "payment"}).json()
    assert any(e["user_id"] == user.id and "Paid $89 for Pro period (BTCPay)" == e["detail"] for e in feed)

    # Unknown invoices and unknown event types are acknowledged, never applied.
    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": "inv_nobody"})
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 200
    raw, headers = _signed_body({"type": "SomethingNew", "invoiceId": invoice_id})
    assert anonymous.post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["ok"] is True


def test_webhook_settles_a_topup_with_its_bonus(btcpay_env, monkeypatch):
    email = address("webhook-topup")
    client = _signed_in(email)
    _grant(email, "pro")
    invoice_id = "inv_topup_" + RUN_ID
    _mock_btcpay(monkeypatch, lambda request: httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"}))
    assert client.post("/api/v1/billing/checkout", json={"kind": "topup", "amount": 80}).status_code == 201

    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": invoice_id})
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 200
    assert _balances(email) == (4500, 4400)
    kinds = [(e.kind, e.amount) for e in _ledger(email) if e.bucket == "topup"]
    assert kinds == [("topup", 4000), ("bonus", 400)]


def test_webhook_expires_a_pending_order(btcpay_env, monkeypatch):
    email = address("expired-order")
    client = _signed_in(email)
    invoice_id = "inv_exp_" + RUN_ID
    _mock_btcpay(monkeypatch, lambda request: httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"}))
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "starter"}).json()["order_id"]

    raw, headers = _signed_body({"type": "InvoiceExpired", "invoiceId": invoice_id})
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 200
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "expired"
    assert _balances(email) == (0, 0)

    # A payment that lands after the invoice expired is still credited, once
    # BTCPay confirms it, and only once.
    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": invoice_id, "manuallyMarked": True})
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["applied"] is True
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"
    assert _balances(email) == (1500, 0)
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["applied"] is False
    assert _balances(email) == (1500, 0)
    # ...and a late expiry event cannot undo a paid order.
    raw, headers = _signed_body({"type": "InvoiceExpired", "invoiceId": invoice_id})
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 200
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"


def test_order_poll_settles_a_missed_webhook(btcpay_env, monkeypatch):
    email = address("poll")
    client = _signed_in(email)
    invoice_id = "inv_poll_" + RUN_ID
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if request.method == "POST":
            return httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"})
        assert request.url.path == f"/api/v1/stores/store123/invoices/{invoice_id}"
        return httpx.Response(200, json={"id": invoice_id, "status": "Settled"})

    _mock_btcpay(monkeypatch, handler)
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()["order_id"]

    polled = client.get(f"/api/v1/billing/orders/{order_id}").json()
    assert polled["status"] == "paid"
    assert _balances(email) == (9600, 0)
    assert _load(email).sub_plan == "max"

    # Once paid, polling no longer asks BTCPay.
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"
    assert calls == ["POST", "GET"]


def test_settlement_is_applied_once_when_a_poll_and_the_webhook_overlap(btcpay_env, monkeypatch, admin):
    """A poll that loaded the order before the webhook settled it must not credit it again."""

    email = address("race")
    client = _signed_in(email)
    invoice_id = "inv_race_" + RUN_ID
    _mock_btcpay(monkeypatch, lambda request: httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"}))
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()["order_id"]

    with _session() as stale:
        order_seen_pending = stale.get(Order, order_id)
        assert order_seen_pending.status == "pending"

        # The webhook settles it meanwhile, in its own session.
        raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": invoice_id})
        assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["applied"] is True
        assert _balances(email) == (4500, 0)

        # The poll now tries with the object it loaded earlier.
        assert tokens.settle_order(stale, order_seen_pending, source="BTCPay poll") is False
        assert order_seen_pending.status == "paid"

    assert _balances(email) == (4500, 0)
    entries = _ledger(email)
    assert [e.kind for e in entries] == ["grant"]
    user = _load(email)
    assert abs((user.sub_period_end.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)) - timedelta(days=30)) < timedelta(minutes=1)
    feed = admin.get("/api/v1/admin/activity", params={"kind": "payment", "limit": 200}).json()
    assert sum(1 for e in feed if e["user_id"] == user.id) == 1


def test_settlement_credits_what_the_order_quoted(btcpay_env, monkeypatch, admin):
    """Admin price edits between checkout and payment do not change what the buyer gets."""

    email = address("quoted")
    client = _signed_in(email)
    _grant(email, "pro")
    counter = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        counter["n"] += 1
        return httpx.Response(200, json={"id": f"inv_quoted_{counter['n']}_{RUN_ID}", "checkoutLink": "https://pay/x"})

    _mock_btcpay(monkeypatch, handler)
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

        raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": f"inv_quoted_1_{RUN_ID}"})
        assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["applied"] is True
        assert _balances(email) == (4500, 4400)
        assert [(e.kind, e.amount) for e in _ledger(email) if e.bucket == "topup"] == [("topup", 4000), ("bonus", 400)]

        raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": f"inv_quoted_2_{RUN_ID}"})
        assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).json()["applied"] is True
        assert _balances(email) == (4500 + 4500, 4400)
        assert _load(email).sub_tokens_per_generation == 90
        orders = {o["id"]: o for o in client.get("/api/v1/billing/orders").json()}
        assert orders[topup["order_id"]]["tokens"] == 4400 and orders[renewal["order_id"]]["tokens"] == 4500
    finally:
        _clear_setting("token_plans")
        _clear_setting("token_topups")


def test_checkout_reuses_the_open_invoice(btcpay_env, monkeypatch):
    email = address("reuse")
    client = _signed_in(email)
    posts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posts.append(request.method)
        return httpx.Response(200, json={"id": f"inv_reuse_{len(posts)}_{RUN_ID}", "checkoutLink": f"https://pay/{len(posts)}"})

    _mock_btcpay(monkeypatch, handler)
    first = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()
    again = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).json()
    assert again == first
    # A different purchase is a new invoice.
    other = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "pro"}).json()
    assert other["order_id"] != first["order_id"]
    assert posts == ["POST", "POST"]
    assert len(client.get("/api/v1/billing/orders").json()) == 2


def test_order_poll_asks_btcpay_at_most_every_few_seconds(btcpay_env, monkeypatch):
    email = address("poll-throttle")
    client = _signed_in(email)
    invoice_id = "inv_throttle_" + RUN_ID
    gets: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"})
        gets.append(request.url.path)
        return httpx.Response(200, json={"id": invoice_id, "status": "Processing"})

    _mock_btcpay(monkeypatch, handler)
    order_id = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "starter"}).json()["order_id"]
    for _ in range(5):
        assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert len(gets) == 1

    # Once the throttle window has passed it asks again.
    def age(db, user):
        order = db.get(Order, order_id)
        order.checked_at = datetime.now(timezone.utc) - timedelta(seconds=30)

    _with_user(email, age)
    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "pending"
    assert len(gets) == 2


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
    assert [p["id"] for p in data["token_plans"]] == ["starter", "pro", "max"]
    assert data["topups"] == {"amounts": [20, 40, 80, 160, 240], "options": []}
    assert [a["code"] for a in data["alerts"]] == ["no_subscription"]
    assert data["grace_days"] == 7
    # The legacy fields are still there for older clients.
    assert "used_this_month" in data and len(data["daily"]) == 30

    _grant(email, "pro")
    data = client.get("/api/v1/auth/subscription").json()
    sub = data["subscription"]
    assert sub["plan_id"] == "pro" and sub["plan_label"] == "Pro" and sub["price"] == 89
    assert sub["active"] is True and sub["days_left"] == 30 and sub["in_grace"] is False
    assert sub["tokens_per_generation"] == 90 and sub["cancelled"] is False
    assert data["balance"]["usable_tokens"] == 4500 and data["balance"]["generations_left"] == 50
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
    assert admin.get("/api/v1/admin/billing/config").json()["plans"]["pro"]["price"] == 89


def _clear_setting(key: str) -> None:
    from app.db import AppSetting

    with _session() as db:
        row = db.get(AppSetting, key)
        if row is not None:
            db.delete(row)
            db.commit()


def test_overview_counts_token_revenue_and_live_subscriptions(admin, btcpay_env, monkeypatch):
    email = address("revenue")
    client = _signed_in(email)
    invoice_id = "inv_rev_" + RUN_ID
    _mock_btcpay(monkeypatch, lambda request: httpx.Response(200, json={"id": invoice_id, "checkoutLink": "https://pay/x"}))
    assert client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": "max"}).status_code == 201
    before = admin.get("/api/v1/admin/overview").json()

    raw, headers = _signed_body({"type": "InvoiceSettled", "invoiceId": invoice_id})
    assert TestClient(app).post("/api/v1/billing/btcpay/webhook", content=raw, headers=headers).status_code == 200
    after = admin.get("/api/v1/admin/overview").json()
    assert after["token_revenue_30d"] - before["token_revenue_30d"] == pytest.approx(149)
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
    assert mine[ending][0] == "ending" and mine[ending][1].startswith("Your Pro period ends on ")
    assert mine[ended] == ("ended", "Your period ended")

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
    assert entry["schedule"] == 86400.0
