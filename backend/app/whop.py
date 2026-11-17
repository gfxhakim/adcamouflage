"""Whop as a payment provider.

Mirrors the single-provider payment adapter contract: knows whether Whop is set
up, verifies incoming Standard Webhooks deliveries, maps our internal tiers and
top-up amounts to Whop plan ids, and extracts order / plan / payment ids from a
verified event. The order lifecycle (create / settle / void) stays in
``tokens.py`` and ``billing_routes.py`` so every Whop payment settles through
``tokens.settle_order`` and is applied once.

Flow
----
1. ``POST /api/v1/billing/checkout`` creates a pending ``Order`` and returns
   ``{order_id, whop_plan}``.
2. The browser mounts Whop's checkout element for ``whop_plan``, carrying our
   ``order_id`` as ``metadata.order_id`` (see
   ``frontend/components/plan/WhopCheckout.tsx``).
3. The customer pays on Whop. No amount is ever asserted by the browser: the
   Whop plan fixes the price.
4. Whop sends ``payment.succeeded`` to ``/api/v1/billing/whop/webhook`` with
   our ``order_id`` echoed back in ``metadata``. That route verifies the
   signature here, checks that the paid Whop plan matches the order, and calls
   ``settle_order``. Fulfilment happens ONLY from the webhook.

Security
--------
``verify_webhook`` fails closed: any missing secret, missing SDK, bad signature
or unreadable body raises ``WhopError`` and the route answers 401, so a forged
call never settles an order. Verification uses Whop's official SDK helper
(``whop_sdk.lib.verify_webhook.unwrap``) rather than a hand-rolled HMAC.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from .config import settings

logger = logging.getLogger(__name__)

PROVIDER = "whop"

# payment.succeeded is the only event that grants access. Everything else is
# acknowledged and ignored (refunds/disputes are handled by hand for now).
SETTLED_EVENT = "payment.succeeded"


class WhopError(Exception):
    """Whop is not set up, or a webhook could not be trusted."""


def configured() -> bool:
    """True when both the API key and the webhook secret are set.

    The plan-id map is checked per purchase in ``plan_id_for`` so a missing
    mapping surfaces as a clear 503 at checkout rather than hiding the whole
    provider.
    """

    return settings.whop_configured


def plan_id_for(kind: str, plan_id: str, amount: float) -> str:
    """The Whop plan id (``plan_xxx``) that charges for one of our orders.

    * subscription -> the Whop plan for that tier (starter / pro / max)
    * topup        -> the Whop plan for that dollar amount (20 / 40 / 80 / ...)

    The maps live in config (``ADCAM_WHOP_PLAN_SUBSCRIPTION`` /
    ``ADCAM_WHOP_PLAN_TOPUP``) and are filled with the plan ids copied from the
    Whop dashboard. A missing entry raises so checkout fails loudly instead of
    sending the customer to the wrong plan.
    """

    if kind == "subscription":
        mapped = settings.whop_plan_subscription.get(plan_id.strip().lower())
    elif kind == "topup":
        mapped = settings.whop_plan_topup.get(str(int(round(amount))))
    else:
        mapped = None
    if not mapped:
        who = plan_id if kind == "subscription" else str(int(round(amount)))
        raise WhopError(f"No Whop plan is configured for {kind} '{who}'.")
    return mapped.strip()


def verify_webhook(raw_body: bytes, headers: Any) -> dict[str, Any]:
    """Return the parsed, verified Whop event, or raise ``WhopError``.

    ``headers`` is the request's header mapping (``request.headers``). The raw
    body must be passed exactly as received, before any JSON parsing, because
    the signature covers those bytes.
    """

    secret = settings.whop_webhook_secret.get_secret_value().strip() if settings.whop_webhook_secret else ""
    if not secret:
        raise WhopError("The Whop webhook secret is not set.")

    # Official SDK verification (`whop-sdk` >= 1.x exposes
    # `whop_sdk.lib.verify_webhook.unwrap`, while legacy 0.x exposed
    # `whop.webhooks.unwrap`). Fails closed if neither is available.
    try:
        from whop_sdk.lib.verify_webhook import unwrap  # type: ignore[import-not-found]
    except ImportError:
        try:
            from whop.webhooks import unwrap  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001
            raise WhopError("The Whop SDK is not installed; cannot verify the webhook.") from exc

    try:
        event = unwrap(raw_body, headers=dict(headers), key=secret)
    except Exception as exc:  # noqa: BLE001 - any verification failure is a rejection
        logger.warning("Whop webhook rejected: %s", exc)
        raise WhopError("Bad Whop webhook signature.") from exc

    if isinstance(event, (bytes, str)):
        try:
            event = json.loads(event)
        except ValueError as exc:
            raise WhopError("The Whop webhook body is not JSON.") from exc
    if not isinstance(event, dict):
        raise WhopError("The Whop webhook body is not an event.")
    return event


def _event_data(event: dict[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    return data if isinstance(data, dict) else event


def order_id_from_event(event: dict[str, Any]) -> str:
    """Pull our ``order_id`` out of a verified event's metadata.

    Whop nests the payment under ``data`` and copies the metadata we set on the
    checkout to the payment. Both shapes (flat and nested) are read so a minor
    SDK/account difference does not drop the id.
    """

    data = _event_data(event)
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    return str(metadata.get("order_id") or "").strip()


def payment_id_from_event(event: dict[str, Any]) -> str:
    """Pull Whop's payment id (``pay_...``) from a verified event, if present."""

    data = _event_data(event)
    if data is not event and data.get("id"):
        return str(data["id"]).strip()
    pid = event.get("payment_id") or data.get("payment_id")
    return str(pid or "").strip()


def plan_id_from_event(event: dict[str, Any]) -> str:
    """Pull the Whop variant/plan id (``plan_...``) that was charged, if present."""

    data = _event_data(event)
    plan = data.get("plan")
    if isinstance(plan, dict) and plan.get("id"):
        return str(plan["id"]).strip()
    if data.get("variant_id"):
        return str(data["variant_id"]).strip()
    if data.get("plan_id"):
        return str(data["plan_id"]).strip()
    items = data.get("line_items")
    if isinstance(items, list) and items and isinstance(items[0], dict):
        vid = items[0].get("variant_id") or items[0].get("plan_id")
        if vid:
            return str(vid).strip()
    return ""


def payer_id_from_event(event: dict[str, Any]) -> str:
    """Pull a stable Whop buyer identifier (user id or email) from a verified event, if present."""

    data = _event_data(event)
    user = data.get("user")
    if isinstance(user, dict):
        uid = user.get("id") or user.get("email") or user.get("username")
        if uid:
            return str(uid).strip()
    for key in ("user_id", "user_email", "email"):
        if data.get(key):
            return str(data[key]).strip()
    return ""


def promo_code_from_event(event: dict[str, Any]) -> str:
    """Pull a coupon / promo code echoed by Whop metadata or ``promo_code`` field."""

    data = _event_data(event)
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    for key in ("coupon_code", "promo_code", "referral_code"):
        val = str(metadata.get(key) or "").strip()
        if val:
            return val.upper()
    raw_promo = data.get("promo_code")
    if isinstance(raw_promo, dict) and raw_promo.get("code"):
        return str(raw_promo["code"]).strip().upper()
    if isinstance(raw_promo, str) and raw_promo.strip():
        return raw_promo.strip().upper()
    promo_id = str(data.get("promo_code_id") or "").strip()
    if promo_id and _has_live_api_key():
        try:
            promo = _sdk_client().promo_codes.retrieve(id=promo_id)
            if getattr(promo, "code", None):
                return str(promo.code).strip().upper()
        except Exception:  # noqa: BLE001 - best effort lookup only
            logger.debug("Could not retrieve Whop promo code %s", promo_id, exc_info=True)
    return ""


def membership_id_from_event(event: dict[str, Any]) -> str:
    """Pull Whop's membership id (``mem_...``) from a payment or membership event."""

    data = _event_data(event)
    mid = data.get("membership_id")
    if mid:
        return str(mid).strip()
    membership = data.get("membership")
    if isinstance(membership, dict) and membership.get("id"):
        return str(membership["id"]).strip()
    etype = event_type(event)
    if etype.startswith("membership.") and data.get("id"):
        return str(data["id"]).strip()
    return ""


def billing_reason_from_event(event: dict[str, Any]) -> str:
    """Return Whop's payment billing reason (e.g. ``subscription_create`` or ``subscription_cycle``)."""

    return str(_event_data(event).get("billing_reason") or "").strip().lower()


def _parse_money(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict) and isinstance(value.get("amount"), (int, float)):
        return float(value["amount"])
    return None


def usd_amount_from_event(event: dict[str, Any]) -> float | None:
    """Return the USD payment total from a payment event, if present."""

    data = _event_data(event)
    for key in ("usd_total", "total", "subtotal"):
        parsed = _parse_money(data.get(key))
        if parsed is not None:
            return parsed
    return None


def plan_for_whop_id(whop_plan_id: str) -> tuple[str, str] | None:
    """Reverse lookup a Whop ``plan_xxx`` back to ``('subscription' | 'topup', key)``."""

    target = (whop_plan_id or "").strip()
    if not target:
        return None
    for plan_id, mapped in settings.whop_plan_subscription.items():
        if mapped.strip() == target:
            return ("subscription", plan_id)
    for amount, mapped in settings.whop_plan_topup.items():
        if mapped.strip() == target:
            return ("topup", amount)
    return None


def refund_id_from_event(event: dict[str, Any]) -> str:
    """Pull Whop's refund id (``rf_...``) from a refund webhook event."""

    data = _event_data(event)
    return str(data.get("id") or "").strip()


def refund_payment_id_from_event(event: dict[str, Any]) -> str:
    """Pull the related Whop payment id (``pay_...``) from a refund or dispute webhook event."""

    data = _event_data(event)
    if data.get("payment_id"):
        return str(data["payment_id"]).strip()
    payment = data.get("payment")
    if isinstance(payment, dict) and payment.get("id"):
        return str(payment["id"]).strip()
    return ""


def refund_status_from_event(event: dict[str, Any]) -> str:
    """Return the refund's processing status (``pending``, ``succeeded``, ``failed``, etc.)."""

    return str(_event_data(event).get("status") or "").strip().lower()


def dispute_status_from_event(event: dict[str, Any]) -> str:
    """Return a dispute's lifecycle status (``needs_response``, ``won``, ``lost``, etc.)."""

    return str(_event_data(event).get("status") or "").strip().lower()


def dispute_reason_from_event(event: dict[str, Any]) -> str:
    """Return the dispute reason string, if present."""

    data = _event_data(event)
    if data.get("reason"):
        return str(data["reason"]).strip()
    dispute = data.get("dispute")
    if isinstance(dispute, dict) and dispute.get("reason"):
        return str(dispute["reason"]).strip()
    return ""


def _sdk_client():
    key = settings.whop_api_key.get_secret_value().strip() if settings.whop_api_key else ""
    if not key:
        raise WhopError("The Whop API key is not set.")
    try:
        from whop_sdk import Whop  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        raise WhopError("The Whop SDK is not installed.") from exc
    return Whop(token=key, timeout=15.0)


def _error_detail(exc: Exception) -> str:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        if body.get("message"):
            return str(body["message"])
    return str(exc) or exc.__class__.__name__


def retrieve_payment_membership_id(payment_id: str) -> str:
    """Fetch a payment from Whop and return its ``membership_id`` (``mem_...``), or empty string."""

    if not payment_id:
        return ""
    client = _sdk_client()
    try:
        payment = client.payments.retrieve(id=payment_id)
    except Exception as exc:  # noqa: BLE001
        raise WhopError(f"Could not read payment from Whop: {_error_detail(exc)}") from exc
    return str(getattr(payment, "membership_id", None) or "").strip()


def cancel_membership(membership_id: str, *, at_period_end: bool = True, reason: str = "") -> None:
    """Cancel a Whop membership either at period end (stops auto-renewal) or immediately."""

    if not membership_id:
        raise WhopError("Missing Whop membership id.")
    client = _sdk_client()
    kwargs: dict[str, Any] = {"cancel_at_period_end": at_period_end}
    cleaned = reason.strip()[:200]
    if cleaned:
        kwargs["reason"] = cleaned
    try:
        client.memberships.cancel(id=membership_id, **kwargs)
    except Exception as exc:  # noqa: BLE001
        detail = _error_detail(exc)
        if "already cancel" in detail.lower() or "already ended" in detail.lower():
            logger.info("Whop membership %s was already cancelled (%s)", membership_id, detail)
            return
        raise WhopError(f"Whop cancellation failed: {detail}") from exc


def resume_membership(membership_id: str) -> None:
    """Reverse a pending period-end cancellation on Whop so auto-renewal resumes."""

    if not membership_id:
        raise WhopError("Missing Whop membership id.")
    client = _sdk_client()
    try:
        client.memberships.update(id=membership_id, cancel_at_period_end=False)
    except Exception as exc:  # noqa: BLE001
        raise WhopError(f"Could not resume Whop subscription: {_error_detail(exc)}") from exc


def refund_payment(
    payment_id: str,
    *,
    amount: float | None = None,
    metadata: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Refund a Whop payment back to the buyer's original payment method."""

    if not payment_id:
        raise WhopError("This order has no Whop payment id to refund.")
    client = _sdk_client()
    kwargs: dict[str, Any] = {}
    if amount is not None:
        kwargs["partial_amount"] = float(amount)
    if metadata:
        kwargs["metadata"] = metadata
    try:
        payment = client.payments.refund(id=payment_id, **kwargs)
    except Exception as exc:  # noqa: BLE001
        raise WhopError(f"Whop refund failed: {_error_detail(exc)}") from exc

    refund_id = ""
    try:
        page = client.refunds.list(payment_id=payment_id)
        data = getattr(page, "data", None) or []
        if data:
            refund_id = str(getattr(data[0], "id", "") or "").strip()
    except Exception:  # noqa: BLE001 - refund already succeeded; id lookup is best-effort
        logger.debug("Could not look up Whop refund id for payment %s", payment_id, exc_info=True)

    return {
        "payment_id": str(getattr(payment, "id", payment_id) or payment_id),
        "refund_id": refund_id,
        "substatus": str(getattr(payment, "substatus", "") or ""),
    }


_VARIANT_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_VARIANT_TTL_SECONDS = 600.0


def _has_live_api_key() -> bool:
    key = settings.whop_api_key.get_secret_value().strip() if settings.whop_api_key else ""
    return bool(key) and "placeholder" not in key.lower()


def retrieve_variant_meta(whop_plan_id: str) -> dict[str, str]:
    """Read and cache (account_id, product_id, currency) from an existing Whop plan/variant."""

    plan_id = (whop_plan_id or "").strip()
    if not plan_id:
        raise WhopError("Missing base Whop plan id.")
    cached = _VARIANT_CACHE.get(plan_id)
    now = time.monotonic()
    if cached and now - cached[0] < _VARIANT_TTL_SECONDS:
        return cached[1]

    client = _sdk_client()
    try:
        variant = client.variants.retrieve(id=plan_id)
    except Exception as exc:  # noqa: BLE001
        raise WhopError(f"Could not read Whop variant {plan_id}: {_error_detail(exc)}") from exc

    account = getattr(variant, "account", None)
    account_id = str(getattr(account, "id", "") or "").strip()
    product = getattr(variant, "product", None)
    product_id = str((product.get("id") if isinstance(product, dict) else getattr(product, "id", "")) or "").strip()
    currency_code = str(getattr(variant, "currency", None) or "usd").strip().lower()
    if not account_id or not product_id:
        raise WhopError(f"Whop variant {plan_id} did not include account/product ids.")
    info = {"account_id": account_id, "product_id": product_id, "currency": currency_code}
    _VARIANT_CACHE[plan_id] = (now, info)
    return info


def ensure_promo_code(
    *,
    account_id: str,
    code: str,
    discount_pct: float,
    base_currency: str,
    variant_id: str,
) -> bool:
    """Ensure a single-use-per-customer percentage promo code exists on Whop for ``variant_id``."""

    client = _sdk_client()
    clean_code = (code or "").strip().upper()
    if not clean_code:
        return False
    try:
        client.promo_codes.create(
            account_id=account_id,
            amount_off=float(discount_pct),
            base_currency=base_currency or "usd",
            code=clean_code,
            new_users_only=False,
            one_per_customer=True,
            promo_duration_months=1,
            promo_type="percentage",
            unlimited_stock=True,
            variant_ids=[variant_id],
        )
        return True
    except Exception as exc:  # noqa: BLE001
        detail = _error_detail(exc).lower()
        if "already" in detail or "taken" in detail or "exists" in detail:
            return True
        logger.warning("Could not create Whop promo code %s: %s", clean_code, _error_detail(exc))
        return False


def create_discounted_checkout(
    *,
    base_whop_plan: str,
    order_id: str,
    amount: float,
    original_amount: float,
    plan_label: str,
    period_days: int,
    return_url: str = "",
    coupon_code: str | None = None,
    affiliate_channel: str | None = None,
    discount_pct: float = 0.0,
    discount_usd: float = 0.0,
) -> dict[str, Any]:
    """Build a discounted Whop checkout configuration (and sync promo fallback when needed).

    When a coupon/affiliate discount is active and we have a live Whop API key:
    1. Retrieves ``account_id`` & ``product_id`` from ``base_whop_plan``.
    2. Creates a ``CheckoutConfiguration`` with an inline renewal variant whose
       ``initial_price`` is the discounted first-payment total and
       ``renewal_price`` is the full plan price, carrying full promo/affiliate
       attribution in Whop ``metadata``.
    3. If inline variant creation is unavailable on the key/account, falls back
       to syncing a Whop PromoCode (``ensure_promo_code``) and instructing the
       frontend embed to prefill ``promoCode``.
    """

    metadata: dict[str, str] = {
        "order_id": order_id,
        "base_whop_plan": base_whop_plan,
        "original_amount_usd": f"{original_amount:.2f}",
    }
    if coupon_code:
        metadata.update(
            {
                "coupon_code": coupon_code,
                "promo_code": coupon_code,
                "affiliate_channel": affiliate_channel or "",
                "referral_code": coupon_code,
                "discount_pct": f"{discount_pct:g}",
                "discount_usd": f"{discount_usd:.2f}",
            }
        )

    fallback: dict[str, Any] = {
        "whop_plan": base_whop_plan,
        "checkout_url": "",
        "metadata": metadata,
        "promo_to_prefill": coupon_code if discount_usd > 0 and coupon_code else None,
    }

    if not coupon_code or discount_usd <= 0 or not _has_live_api_key():
        return fallback

    try:
        info = retrieve_variant_meta(base_whop_plan)
    except WhopError as exc:
        logger.warning("Whop variant lookup skipped for order %s: %s", order_id, exc)
        return fallback

    client = _sdk_client()
    try:
        kwargs: dict[str, Any] = {
            "account_id": info["account_id"],
            "variant": {
                "account_id": info["account_id"],
                "product_id": info["product_id"],
                "initial_price": round(float(amount), 2),
                "renewal_price": round(float(original_amount), 2),
                "billing_type": "renewal",
                "billing_period": max(1, int(period_days or 30)),
                "currency": info["currency"],
                "title": f"{plan_label} ({coupon_code} -{discount_pct:g}%)"[:100],
                "visibility": "hidden",
                "unlimited_stock": True,
            },
            "metadata": metadata,
        }
        if return_url:
            kwargs["redirect_url"] = return_url
        cfg = client.checkout_configurations.create(**kwargs)
        variant_obj = getattr(cfg, "variant", None)
        variant_id = str(getattr(variant_obj, "id", "") or "").strip()
        if variant_id:
            return {
                "whop_plan": variant_id,
                "checkout_url": str(getattr(cfg, "purchase_url", "") or "").strip(),
                "metadata": metadata,
                # Discount already baked into initial_price of the checkout variant;
                # avoid prefilling a Whop promo code so the buyer isn't discounted twice.
                "promo_to_prefill": None,
            }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Whop CheckoutConfiguration create failed for order %s: %s", order_id, _error_detail(exc))

    ensure_promo_code(
        account_id=info["account_id"],
        code=coupon_code,
        discount_pct=discount_pct,
        base_currency=info["currency"],
        variant_id=base_whop_plan,
    )
    return fallback


def event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or event.get("event") or "").strip()
