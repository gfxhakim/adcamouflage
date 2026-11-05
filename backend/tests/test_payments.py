"""Transaction IDs, payment screenshots, the ID check and the admin review.

The rule under test: a plan turns on only when the provider confirms the
payment or an admin approves it. A screenshot never activates anything, and
an ID check only ever looks at the signed-in buyer's own orders.
"""

from __future__ import annotations

import io
import re
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app import payments
from app.auth_routes import login_limiter, register_limiter
from app.config import settings
from app.db import Order, User, get_session_factory, init_db
from app.main import app

from .test_volet import (  # noqa: F401 - fixtures
    SCI_NAME,
    STATUS_PATH,
    _notification,
    _volet,
    volet_env,
)

RUN_ID = uuid.uuid4().hex[:12]
PASSWORD = "correct-horse-battery"
CODE_RE = re.compile(r"^BC-[A-Z2-9]{4}-[A-Z2-9]{4}$")


def address(name: str) -> str:
    return f"pay-{name}-{RUN_ID}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _database():
    init_db()
    yield


@pytest.fixture(autouse=True)
def _reset_limits():
    login_limiter._hits.clear()
    register_limiter._hits.clear()
    payments.verify_limiter.reset()
    payments.proof_limiter.reset()
    yield


@pytest.fixture
def admin(monkeypatch):
    email = address("boss")
    monkeypatch.setattr(settings, "admin_emails", [email])
    return _signed_in(email)


def _signed_in(email: str) -> TestClient:
    client = TestClient(app)
    credentials = {"email": email, "password": PASSWORD}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _checkout(client: TestClient, plan_id: str = "starter") -> dict:
    response = client.post("/api/v1/billing/checkout", json={"kind": "subscription", "plan_id": plan_id})
    assert response.status_code == 201, response.text
    return response.json()


def _order(order_id: str) -> Order:
    with get_session_factory()() as db:
        return db.get(Order, order_id)


def _user(email: str) -> User:
    with get_session_factory()() as db:
        return db.execute(select(User).where(User.email == email.lower())).scalar_one()


def _png(color=(10, 120, 240)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 40), color).save(out, format="PNG")
    return out.getvalue()


def _upload(client: TestClient, order_id: str, data: bytes, name: str = "shot.png", ctype: str = "image/png"):
    return client.post(
        f"/api/v1/billing/orders/{order_id}/proof",
        files={"file": (name, data, ctype)},
        data={"note": "paid from my Volet wallet"},
    )


# --------------------------------------------------------------------------
# transaction IDs
# --------------------------------------------------------------------------


def test_every_checkout_gets_a_readable_transaction_id(volet_env):
    client = _signed_in(address("code"))
    body = _checkout(client)
    assert CODE_RE.match(body["ref_code"])
    order = client.get(f"/api/v1/billing/orders/{body['order_id']}").json()
    assert order["ref_code"] == body["ref_code"]
    # The same open order is reused, with the same ID.
    assert _checkout(client)["ref_code"] == body["ref_code"]


def test_transaction_id_is_in_the_volet_comment(volet_env):
    client = _signed_in(address("comment"))
    body = _checkout(client)
    page = client.get(body["checkout_url"]).text
    assert body["ref_code"] in page


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("my id is bc-abcd-ef23 thanks", "BC-ABCD-EF23"),
        ("BC ABCD EF23", "BC-ABCD-EF23"),
        ("BCABCDEF23", "BC-ABCD-EF23"),
        ("no id here", None),
    ],
)
def test_find_ref_code(text, expected):
    assert payments.find_ref_code(text) == expected


# --------------------------------------------------------------------------
# the ID check
# --------------------------------------------------------------------------


def test_unpaid_id_does_not_activate(volet_env):
    email = address("unpaid")
    client = _signed_in(email)
    body = _checkout(client)
    result = client.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()
    assert result["outcome"] == "pending"
    assert _user(email).sub_plan is None


def test_confirmed_payment_reports_activation_once(volet_env):
    email = address("paid")
    client = _signed_in(email)
    body = _checkout(client)
    _volet().post(STATUS_PATH, data=_notification(body["order_id"]))
    assert _order(body["order_id"]).status == "paid"

    first = client.post("/api/v1/billing/verify", json={"code": body["ref_code"].lower()}).json()
    assert first["outcome"] == "activated"
    assert _user(email).sub_plan == "starter"
    second = client.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()
    assert second["outcome"] == "already_used"


def test_someone_elses_id_is_not_found(volet_env):
    owner = _signed_in(address("owner"))
    body = _checkout(owner)
    _volet().post(STATUS_PATH, data=_notification(body["order_id"]))

    stranger_email = address("stranger")
    stranger = _signed_in(stranger_email)
    result = stranger.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()
    assert result["outcome"] == "not_found"
    assert result["order"] is None
    assert _user(stranger_email).sub_plan is None


def test_id_checks_are_rate_limited(volet_env):
    client = _signed_in(address("limit"))
    for _ in range(payments.verify_limiter.limit):
        assert client.post("/api/v1/billing/verify", json={"code": "BC-AAAA-AAAA"}).status_code == 200
    assert client.post("/api/v1/billing/verify", json={"code": "BC-AAAA-AAAA"}).status_code == 429


def test_check_needs_sign_in():
    assert TestClient(app).post("/api/v1/billing/verify", json={"code": "BC-AAAA-AAAA"}).status_code == 401


# --------------------------------------------------------------------------
# screenshots
# --------------------------------------------------------------------------


def test_screenshot_is_stored_but_does_not_activate(volet_env):
    email = address("shot")
    client = _signed_in(email)
    body = _checkout(client)
    response = _upload(client, body["order_id"], _png())
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["has_proof"] and out["review_status"] == "submitted"
    assert out["status"] == "pending"
    assert _user(email).sub_plan is None

    check = client.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()
    assert check["outcome"] == "in_review"

    image = client.get(f"/api/v1/billing/orders/{body['order_id']}/proof")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert "sandbox" in image.headers["content-security-policy"]


def test_screenshot_must_be_a_real_image(volet_env):
    client = _signed_in(address("fake"))
    body = _checkout(client)
    html_file = b"<html><script>alert(1)</script></html>"
    assert _upload(client, body["order_id"], html_file, "shot.png").status_code == 415
    # PNG header but garbage after it.
    assert _upload(client, body["order_id"], b"\x89PNG\r\n\x1a\n" + b"x" * 200).status_code == 422
    too_big = b"\x89PNG\r\n\x1a\n" + b"0" * (payments.MAX_PROOF_BYTES + 10)
    assert _upload(client, body["order_id"], too_big).status_code == 413


def test_screenshot_only_on_your_own_order(volet_env):
    owner = _signed_in(address("own"))
    body = _checkout(owner)
    _upload(owner, body["order_id"], _png())
    other = _signed_in(address("peek"))
    assert _upload(other, body["order_id"], _png()).status_code == 404
    assert other.get(f"/api/v1/billing/orders/{body['order_id']}/proof").status_code == 404


# --------------------------------------------------------------------------
# admin review
# --------------------------------------------------------------------------


def test_admin_approves_a_screenshot_and_the_plan_turns_on(volet_env, admin):
    email = address("approve")
    client = _signed_in(email)
    body = _checkout(client, "pro")
    _upload(client, body["order_id"], _png())

    queue = admin.get("/api/v1/admin/payments").json()
    row = next(r for r in queue if r["order_id"] == body["order_id"])
    assert row["ref_code"] == body["ref_code"] and row["email"] == email.lower()
    assert admin.get(row["proof_url"]).status_code == 200

    found = admin.get("/api/v1/admin/payments", params={"q": body["ref_code"]}).json()
    assert [r["order_id"] for r in found] == [body["order_id"]]

    approved = admin.post(f"/api/v1/admin/payments/{body['order_id']}/approve", json={"note": "checked wallet"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["review_status"] == "approved"
    assert _order(body["order_id"]).status == "paid"
    assert _user(email).sub_plan == "pro"
    # Applied once: a second approval or a late provider notification changes nothing.
    assert admin.post(f"/api/v1/admin/payments/{body['order_id']}/approve", json={}).status_code == 409
    _volet().post(STATUS_PATH, data=_notification(body["order_id"], amount="89.00"))
    assert client.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()["outcome"] == "activated"


def test_admin_rejects_a_screenshot(volet_env, admin):
    email = address("reject")
    client = _signed_in(email)
    body = _checkout(client)
    _upload(client, body["order_id"], _png())
    response = admin.post(f"/api/v1/admin/payments/{body['order_id']}/reject", json={"note": "no payment found"})
    assert response.status_code == 200
    assert _order(body["order_id"]).status == "pending"
    assert _user(email).sub_plan is None
    check = client.post("/api/v1/billing/verify", json={"code": body["ref_code"]}).json()
    assert check["outcome"] == "rejected" and "no payment found" in check["message"]


def test_customers_cannot_use_the_review_api(volet_env):
    client = _signed_in(address("sneaky"))
    body = _checkout(client)
    assert client.get("/api/v1/admin/payments").status_code == 404
    assert client.post(f"/api/v1/admin/payments/{body['order_id']}/approve", json={}).status_code == 404
    assert _order(body["order_id"]).status == "pending"


# --------------------------------------------------------------------------
# support bot
# --------------------------------------------------------------------------


def test_bot_checks_a_pasted_transaction_id(volet_env):
    email = address("bot")
    client = _signed_in(email)
    body = _checkout(client)
    _volet().post(STATUS_PATH, data=_notification(body["order_id"]))

    thread = client.post("/api/v1/support/thread/message", json={"body": f"I paid, my id is {body['ref_code']}"}).json()
    reply = thread["messages"][-1]
    assert reply["sender_role"] == "bot"
    assert "confirmed" in reply["body"]
    assert thread["bot_attempts"] == 0


def test_bot_asks_for_the_id(volet_env):
    client = _signed_in(address("botask"))
    thread = client.post("/api/v1/support/thread/message", json={"body": "I paid, check my transaction ID"}).json()
    assert "BC-XXXX-XXXX" in thread["messages"][-1]["body"]


def test_bot_does_not_reveal_other_accounts(volet_env):
    owner = _signed_in(address("botowner"))
    body = _checkout(owner)
    _volet().post(STATUS_PATH, data=_notification(body["order_id"]))
    other = _signed_in(address("botother"))
    thread = other.post("/api/v1/support/thread/message", json={"body": body["ref_code"]}).json()
    assert "can't find" in thread["messages"][-1]["body"]
