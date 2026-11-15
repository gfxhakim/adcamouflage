"""Direct USDT (TRC-20) payments: unique amounts, blockchain matching, pay page, transaction ids.

TronGrid is never called: ``usdt.incoming`` is replaced by a list of
transfers the test controls, and the TronGrid parser is fed a canned page
through ``httpx.MockTransport``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import usdt
from app.config import settings
from app.db import Order, PaymentNotice, get_session_factory, init_db
from app.main import app
from app.tokens import balances

RUN_ID = uuid.uuid4().hex[:10]
PASSWORD = "correct-horse-battery"
ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
CHECKOUT = "/api/v1/billing/checkout"


def address(name: str) -> str:
    return f"usdt-{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(settings, "btcpay_url", "")
    monkeypatch.setattr(settings, "volet_account_email", "")
    monkeypatch.setattr(settings, "usdt_trc20_address", ADDRESS)
    usdt.reset()
    from app import billing_routes

    billing_routes._txid_hits.clear()
    yield
    usdt.reset()


@pytest.fixture
def chain(monkeypatch):
    """The transfers 'on the blockchain'; append Transfer objects to it."""

    transfers: list[usdt.Transfer] = []

    def fake_incoming(since, client=None):
        return [t for t in transfers if t.at >= since]

    monkeypatch.setattr(usdt, "incoming", fake_incoming)
    return transfers


@pytest.fixture
def alerts(monkeypatch):
    from app import notify

    sent: list[tuple[str, str, list[str]]] = []

    def record(event, title, lines, *, key=None, priority="default", buttons=None):
        sent.append((event, title, [line for line in lines if line]))
        return True

    monkeypatch.setattr(notify, "alert", record)
    return sent


def _signed_in(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _checkout(client: TestClient, plan_id: str = "starter") -> dict:
    response = client.post(CHECKOUT, json={"kind": "subscription", "plan_id": plan_id, "provider": "usdt"})
    assert response.status_code == 201, response.text
    return response.json()


def _order(order_id: str) -> Order:
    with get_session_factory()() as db:
        return db.get(Order, order_id)


def _balances(email: str) -> tuple[int, int]:
    from app.db import User

    with get_session_factory()() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        return balances(db, user)


def _tx(amount: str, *, at: datetime | None = None, txid: str | None = None, to: str = ADDRESS) -> usdt.Transfer:
    return usdt.Transfer(
        txid=txid or uuid.uuid4().hex + uuid.uuid4().hex,
        sender="TSenderWalletxxxxxxxxxxxxxxxxxxxxx",
        to=to,
        value=usdt.units(amount),
        at=at or datetime.now(timezone.utc),
    )


def test_checkout_gives_a_unique_exact_amount_and_the_pay_page(chain):
    client = _signed_in(address("page"))
    body = _checkout(client)
    assert body["provider"] == "usdt" and body["checkout_url"] == f"/app/pay/{body['order_id']}"
    pay_amount = _order(body["order_id"]).pay_amount
    assert pay_amount and 37.5 < float(pay_amount) < 38.5 and len(pay_amount.split(".")[1]) == 2

    page = client.get(f"/api/v1/billing/orders/{body['order_id']}/usdt").json()
    assert page["address"] == ADDRESS and page["pay_amount"] == pay_amount and page["status"] == "pending"
    assert page["network"] == "TRON (TRC-20)" and page["plan_label"] == "Starter"
    qr = client.get(f"/api/v1/billing/orders/{body['order_id']}/usdt/qr.svg")
    assert qr.status_code == 200 and qr.headers["content-type"].startswith("image/svg+xml") and b"<svg" in qr.content
    # Someone else's order is not found.
    assert _signed_in(address("nosy")).get(f"/api/v1/billing/orders/{body['order_id']}/usdt").status_code == 404
    # The same checkout again reuses the open order and its amount.
    assert _checkout(client)["order_id"] == body["order_id"]


def test_amounts_never_collide_between_open_orders(chain):
    amounts = set()
    for i in range(25):
        order_id = _checkout(_signed_in(address(f"many{i}")))["order_id"]
        amounts.add(_order(order_id).pay_amount)
    assert len(amounts) == 25


def test_exact_transfer_activates_once_and_alerts_with_the_customer(chain, alerts):
    email = address("paid")
    client = _signed_in(email)
    order_id = _checkout(client)["order_id"]
    pay_amount = _order(order_id).pay_amount
    tx = _tx(pay_amount)
    chain.append(tx)

    assert client.get(f"/api/v1/billing/orders/{order_id}").json()["status"] == "paid"
    assert _balances(email) == (1500, 0)
    assert _order(order_id).provider_ref == tx.txid
    paid = [a for a in alerts if a[0] == "paid"]
    assert len(paid) == 1 and any(email in line for line in paid[0][2])
    assert "Plan activated automatically, nothing to approve." in paid[0][2]

    # Scanning again (beat task, other page polls) never credits twice.
    with get_session_factory()() as db:
        assert usdt.scan(db, force=True) == 0
    assert _balances(email) == (1500, 0)
    page = client.get(f"/api/v1/billing/orders/{order_id}/usdt").json()
    assert page["status"] == "paid" and page["txid"] == tx.txid


def test_wrong_amount_early_transfer_and_other_address_do_not_activate(chain, alerts):
    email = address("wrong")
    client = _signed_in(email)
    order_id = _checkout(client)["order_id"]
    order = _order(order_id)
    created = order.created_at if order.created_at.tzinfo else order.created_at.replace(tzinfo=timezone.utc)
    chain.append(_tx("37.50"))  # the round price, not the order's exact amount
    chain.append(_tx(order.pay_amount, at=created - timedelta(hours=1)))  # before the order existed
    with get_session_factory()() as db:
        assert usdt.scan(db, force=True) == 0
    assert _order(order_id).status == "pending" and _balances(email) == (0, 0)
    unmatched = [a for a in alerts if a[1].startswith("💵 USDT received, no order matched")]
    assert len(unmatched) == 1  # the early one is outside the scan window
    # Alerted once per transaction, however often the scan runs.
    with get_session_factory()() as db:
        usdt.scan(db, force=True)
    assert len([a for a in alerts if a[1].startswith("💵")]) == 1


def test_late_payment_outside_the_window_is_not_matched(chain, alerts, monkeypatch):
    email = address("late")
    order_id = _checkout(_signed_in(email))["order_id"]
    order = _order(order_id)
    created = order.created_at if order.created_at.tzinfo else order.created_at.replace(tzinfo=timezone.utc)
    late = _tx(order.pay_amount, at=created + timedelta(hours=25))
    with get_session_factory()() as db:
        usdt.apply(db, [late], now=created + timedelta(hours=25))
    assert _order(order_id).status == "pending"


def test_buyer_gives_the_transaction_id(chain, alerts):
    email = address("txid")
    client = _signed_in(email)
    order_id = _checkout(client)["order_id"]
    url = f"/api/v1/billing/orders/{order_id}/usdt/txid"

    missing = uuid.uuid4().hex * 2
    assert client.post(url, json={"txid": missing}).json()["result"] == "not_found"
    assert client.post(url, json={"txid": "not-a-txid"}).status_code == 422

    # Exchange took its fee from the amount: found, but sent to the owner, not activated.
    short = _tx("37.40")
    chain.append(short)
    reply = client.post(url, json={"txid": short.txid}).json()
    assert reply["result"] == "review" and reply["status"] == "pending"
    review = [a for a in alerts if a[0] == "review" and a[1] == "⚠️ Payment needs a look"]
    assert review and any(email in line for line in review[-1][2])
    assert _balances(email) == (0, 0)

    exact = _tx(_order(order_id).pay_amount)
    chain.append(exact)
    reply = client.post(url, json={"txid": "0x" + exact.txid.upper()}).json()
    assert reply["result"] == "paid" and reply["status"] == "paid"
    assert _balances(email) == (1500, 0)

    # The same transaction cannot pay someone else's order.
    other = _signed_in(address("thief"))
    other_order = _checkout(other)["order_id"]
    assert other.post(f"/api/v1/billing/orders/{other_order}/usdt/txid", json={"txid": exact.txid}).json()["result"] == "used"
    assert _order(other_order).status == "pending"


def test_transaction_id_checks_are_rate_limited(chain):
    client = _signed_in(address("limit"))
    order_id = _checkout(client)["order_id"]
    url = f"/api/v1/billing/orders/{order_id}/usdt/txid"
    for _ in range(10):
        assert client.post(url, json={"txid": "a" * 64}).status_code == 200
    assert client.post(url, json={"txid": "a" * 64}).status_code == 429


def test_trongrid_page_is_parsed_strictly(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/v1/accounts/{ADDRESS}/transactions/trc20"
        assert request.url.params["only_to"] == "true" and request.url.params["only_confirmed"] == "true"
        good = {
            "transaction_id": "AB" * 32,
            "token_info": {"address": settings.usdt_trc20_contract, "decimals": 6, "symbol": "USDT"},
            "block_timestamp": 1_762_700_000_000,
            "from": "TFrom",
            "to": ADDRESS,
            "type": "Transfer",
            "value": "37530000",
        }
        fake_token = {**good, "transaction_id": "cd" * 32, "token_info": {"address": "TFakeToken", "decimals": 6}}
        elsewhere = {**good, "transaction_id": "ef" * 32, "to": "TSomeoneElse"}
        broken = {"transaction_id": "00" * 32}
        return httpx.Response(200, json={"success": True, "data": [good, fake_token, elsewhere, broken], "meta": {}})

    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="https://api.trongrid.io")
    found = usdt.incoming(datetime.now(timezone.utc), client=client)
    assert [(t.txid, t.value) for t in found] == [("ab" * 32, 37_530_000)]
    assert str(found[0].amount) == "37.53"

    def down(request):
        return httpx.Response(503)

    with pytest.raises(usdt.TronError):
        usdt.incoming(datetime.now(timezone.utc), client=httpx.Client(transport=httpx.MockTransport(down)))


def test_usdt_is_offered_only_with_a_valid_address(monkeypatch):
    client = _signed_in(address("offer"))
    providers = client.get("/api/v1/auth/subscription").json()["payment_providers"]
    assert providers[0] == {"id": "usdt", "label": "USDT (TRC-20)"}
    monkeypatch.setattr(settings, "usdt_trc20_address", "not-an-address")
    assert client.post(CHECKOUT, json={"kind": "subscription", "plan_id": "starter", "provider": "usdt"}).status_code == 503


def test_admin_lists_usdt_transfers(chain, alerts, monkeypatch):
    boss = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [boss])
    admin = _signed_in(boss)
    email = address("listed")
    client = _signed_in(email)
    order_id = _checkout(client)["order_id"]
    chain.append(_tx(_order(order_id).pay_amount))
    client.get(f"/api/v1/billing/orders/{order_id}")
    body = admin.get("/api/v1/admin/payment-notices").json()
    assert body["usdt_ready"] is True and body["usdt_address"] == ADDRESS
    row = next(n for n in body["notices"] if n["order_id"] == order_id)
    assert row["provider"] == "usdt" and row["outcome"] == "activated" and row["email"] == email
    with get_session_factory()() as db:
        assert db.execute(select(PaymentNotice).where(PaymentNotice.order_id == order_id)).scalar_one().currency == "USDT"
