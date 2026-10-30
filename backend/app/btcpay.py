"""A thin client for the BTCPay Server Greenfield API.

Only three things are needed: create an invoice for an order, read an invoice
back (to settle an order whose webhook never arrived) and check a webhook's
signature. Every HTTP call has a short timeout and raises ``BTCPayError`` on
any failure, so a route can turn it into one plain 502.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15.0
INVOICE_EXPIRY_MINUTES = 60
SIGNATURE_HEADER = "BTCPay-Sig"


class BTCPayError(Exception):
    """BTCPay could not be reached or answered with an error."""


def configured() -> bool:
    return settings.billing_configured


# Tests put an httpx.MockTransport here so no request leaves the process.
_transport: httpx.BaseTransport | None = None


def _client() -> httpx.Client:
    """An httpx client aimed at the configured store."""

    key = settings.btcpay_api_key.get_secret_value() if settings.btcpay_api_key else ""
    return httpx.Client(
        base_url=settings.btcpay_base_url,
        headers={"Authorization": f"token {key}", "Accept": "application/json"},
        timeout=TIMEOUT_SECONDS,
        transport=_transport,
    )


def _store_path(suffix: str) -> str:
    return f"/api/v1/stores/{settings.btcpay_store_id.strip()}{suffix}"


def _call(method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
    if not configured():
        raise BTCPayError("Payments are not set up yet.")
    try:
        with _client() as client:
            response = client.request(method, path, json=json)
    except httpx.HTTPError as exc:
        logger.warning("BTCPay request failed: %s %s: %s", method, path, exc)
        raise BTCPayError("The payment server could not be reached. Try again in a moment.") from exc
    if response.status_code >= 400:
        logger.warning("BTCPay answered %s for %s %s: %s", response.status_code, method, path, response.text[:300])
        raise BTCPayError("The payment server refused the request. Try again in a moment.")
    try:
        body = response.json()
    except ValueError as exc:
        raise BTCPayError("The payment server sent an unreadable answer.") from exc
    if not isinstance(body, dict):
        raise BTCPayError("The payment server sent an unexpected answer.")
    return body


def create_invoice(
    *,
    order_id: str,
    user_id: int,
    kind: str,
    plan_id: str,
    amount: float,
    currency: str,
    redirect_url: str,
) -> tuple[str, str]:
    """Create an invoice for an order and return ``(invoice id, checkout link)``."""

    payload = {
        "amount": f"{amount:.2f}",
        "currency": currency,
        "metadata": {"orderId": order_id, "userId": user_id, "kind": kind, "planId": plan_id},
        "checkout": {
            "redirectURL": redirect_url,
            "redirectAutomatically": True,
            "expirationMinutes": INVOICE_EXPIRY_MINUTES,
        },
    }
    body = _call("POST", _store_path("/invoices"), json=payload)
    invoice_id = str(body.get("id") or "")
    checkout = str(body.get("checkoutLink") or "")
    if not invoice_id or not checkout:
        raise BTCPayError("The payment server did not return a checkout link.")
    return invoice_id, checkout


def get_invoice(invoice_id: str) -> dict[str, Any]:
    """Fetch one invoice; the caller reads its ``status`` (Settled, Expired, ...)."""

    return _call("GET", _store_path(f"/invoices/{invoice_id}"))


def sign(secret: str, raw_body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def verify_signature(raw_body: bytes, header: str | None, secret: str | None = None) -> bool:
    """Check a webhook's ``BTCPay-Sig`` header against the raw request body.

    BTCPay signs the exact bytes it sends, so the body must be compared before
    any JSON parsing. A missing secret or header always fails.
    """

    if secret is None:
        secret = settings.btcpay_webhook_secret.get_secret_value() if settings.btcpay_webhook_secret else ""
    if not secret or not header:
        return False
    expected = sign(secret, raw_body)
    return hmac.compare_digest(expected.encode("utf-8"), header.strip().encode("utf-8"))
