"""Meta (Facebook) Pixel + Conversions API.

The browser fires the Pixel and this module sends the same events from the
server through the Conversions API (CAPI). Both carry the same ``event_id``,
so Meta counts each event once (deduplication) while the server copy still
arrives when an ad blocker or a closed tab stops the browser one.

Event ids are built from ids both sides already know:

- ``signup-<user id>``      CompleteRegistration (register route)
- ``checkout-<order id>``   InitiateCheckout (checkout route)
- ``payinfo-<order id>``    AddPaymentInfo (checkout route: the payment method
                            is picked when the order is made)
- ``purchase-<order id>``   Purchase (sent only when a payment is confirmed:
                            the Volet notification, the BTCPay webhook or the
                            BTCPay poll settles the order)
- PageView / ViewContent ids are random ones made by the browser, which posts
  them to ``POST /api/v1/meta/event`` so the server copy can be sent.

Nothing is sent unless ADCAM_META_PIXEL_ID and ADCAM_META_CAPI_TOKEN are set,
and nothing is sent for a visitor who declined the cookie banner (the
``bc_consent`` cookie). Personal data is SHA-256 hashed as Meta requires.
Sending runs on a background thread so a slow Graph API never slows a page,
a sign-up or a payment notification.

Delayed payments (Volet, BTCPay, admin approval) are why the order keeps the
buyer's browser data: the Purchase goes out at the moment the payment is
confirmed, maybe hours after the click, from a server request that carries
none of it. Meta matches it to the ad click through the saved fbp / fbc /
IP / user agent plus the hashed email, so cost per purchase stays right.
The Purchase is retried a few times if the Graph API is down, and how it
went is written back on the order (``tracking.purchase``) for the admin.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any, Mapping

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .config import settings

logger = logging.getLogger(__name__)

CONSENT_COOKIE = "bc_consent"
GRANTED = "granted"

# Events the browser may ask the server to forward. Money events are only ever
# sent by the server itself, so a visitor cannot invent a Purchase.
BROWSER_EVENTS = {"PageView", "ViewContent"}


def enabled() -> bool:
    return bool(settings.meta_pixel_id.strip()) and settings.meta_capi_token is not None and bool(
        settings.meta_capi_token.get_secret_value().strip()
    )


def _sha256(value: str | None) -> str | None:
    value = (value or "").strip().lower()
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value else None


def consent_granted(request: Request) -> bool:
    return request.cookies.get(CONSENT_COOKIE) == GRANTED


def _client_ip(request: Request) -> str:
    # The visitor is the FIRST X-Forwarded-For entry (Railway edge -> web
    # rewrite -> api). Only used to help Meta match the event to an ad click.
    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    if forwarded.strip():
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else ""


def browser_context(request: Request) -> dict[str, str]:
    """What Meta needs from the visitor's own request to match an event to an ad click.

    Saved on an order at checkout, because the Purchase is sent later from the
    payment provider's notification, which carries none of this.
    """

    context = {
        "consent": GRANTED if consent_granted(request) else "",
        "fbp": request.cookies.get("_fbp", ""),
        "fbc": request.cookies.get("_fbc", ""),
        "ip": _client_ip(request),
        "ua": request.headers.get("user-agent", ""),
        "url": request.headers.get("referer", ""),
    }
    return {key: value[:512] for key, value in context.items() if value}


def order_tracking(request: Request, order: Any, previous: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Everything kept on an order for its later Purchase: browser data plus the event ids.

    ``previous`` is the order's earlier tracking when a pending order is
    reused: fresh browser data wins, but an fbp / fbc seen the first time is
    not lost if the cookie is gone now.
    """

    tracking: dict[str, Any] = {}
    if previous:
        tracking.update({k: v for k, v in previous.items() if k in ("fbp", "fbc", "ip", "ua", "url", "consent")})
    tracking.update(browser_context(request))
    tracking["checkout_event_id"] = f"checkout-{order.id}"
    tracking["payinfo_event_id"] = f"payinfo-{order.id}"
    tracking["purchase_event_id"] = f"purchase-{order.id}"
    tracking["captured_at"] = int(time.time())
    return tracking


def load_tracking(order: Any) -> dict[str, Any]:
    try:
        data = json.loads(order.tracking or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _user_data(context: Mapping[str, str], email: str | None, external_id: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if email:
        data["em"] = [_sha256(email)]
    if external_id:
        data["external_id"] = [_sha256(external_id)]
    if context.get("ip"):
        data["client_ip_address"] = context["ip"]
    if context.get("ua"):
        data["client_user_agent"] = context["ua"]
    if context.get("fbp"):
        data["fbp"] = context["fbp"]
    if context.get("fbc"):
        data["fbc"] = context["fbc"]
    return data


def build_event(
    name: str,
    event_id: str,
    context: Mapping[str, str],
    *,
    email: str | None = None,
    external_id: str | None = None,
    custom_data: Mapping[str, Any] | None = None,
    source_url: str | None = None,
    event_time: int | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event_name": name,
        "event_time": int(event_time or time.time()),
        "event_id": event_id,
        "action_source": "website",
        "user_data": _user_data(context, email, external_id),
    }
    url = source_url or context.get("url") or settings.public_url.strip() or None
    if url:
        event["event_source_url"] = url
    if custom_data:
        event["custom_data"] = dict(custom_data)
    return event


def _post(events: list[dict[str, Any]]) -> bool:
    """POST events to the Graph API. True when Meta accepted them."""

    if not enabled():
        return False
    pixel = settings.meta_pixel_id.strip()
    token = settings.meta_capi_token.get_secret_value().strip()  # type: ignore[union-attr]
    payload: dict[str, Any] = {"data": events}
    if settings.meta_test_event_code.strip():
        payload["test_event_code"] = settings.meta_test_event_code.strip()
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{pixel}/events"
    try:
        response = httpx.post(url, params={"access_token": token}, json=payload, timeout=10)
        if response.status_code >= 400:
            logger.warning("Meta CAPI refused %s: %s %s", [e["event_name"] for e in events], response.status_code, response.text[:300])
            return False
        logger.info("Meta CAPI sent %s", ", ".join(f"{e['event_name']}({e['event_id']})" for e in events))
        return True
    except httpx.HTTPError as exc:
        logger.warning("Meta CAPI unreachable: %s", exc)
        return False


# Waits between Purchase attempts. A sale is worth retrying; page events are not.
PURCHASE_RETRY_DELAYS = (5, 30, 120)


def send(event: dict[str, Any], *, consent: bool) -> None:
    """Send one event in the background. Silently skipped without consent or setup."""

    if not consent or not enabled():
        return
    threading.Thread(target=_post, args=([event],), daemon=True, name="meta-capi").start()


# --------------------------------------------------------------------------
# the events the app fires
# --------------------------------------------------------------------------


def complete_registration(request: Request, user_id: int, email: str) -> None:
    context = browser_context(request)
    send(
        build_event("CompleteRegistration", f"signup-{user_id}", context, email=email, external_id=str(user_id),
                    custom_data={"status": "registered"}),
        consent=context.get("consent") == GRANTED,
    )


def _order_custom(order: Any, currency: str) -> dict[str, Any]:
    return {
        "value": round(float(order.amount_usd), 2),
        "currency": currency,
        "content_ids": [order.plan_id],
        "content_type": "product",
        "content_name": f"{order.plan_id} {order.kind}",
        "num_items": 1,
    }


def initiate_checkout(request: Request, order: Any, email: str, currency: str) -> dict[str, Any]:
    """Send InitiateCheckout + AddPaymentInfo and return the tracking to keep on the order.

    Both are early signals Meta can optimise on while the payment itself is
    still waiting to be confirmed.
    """

    tracking = order_tracking(request, order)
    consent = tracking.get("consent") == GRANTED
    custom = _order_custom(order, currency)
    send(
        build_event("InitiateCheckout", tracking["checkout_event_id"], tracking, email=email,
                    external_id=str(order.user_id), custom_data=custom),
        consent=consent,
    )
    provider = getattr(order, "provider", None)
    send(
        build_event("AddPaymentInfo", tracking["payinfo_event_id"], tracking, email=email,
                    external_id=str(order.user_id),
                    custom_data={**custom, **({"payment_method": provider} if provider else {})}),
        consent=consent,
    )
    return tracking


def refresh_checkout(request: Request, order: Any) -> str | None:
    """New tracking JSON for a reused pending order, e.g. the buyer accepted cookies since.

    Returns None when nothing changed. No events are sent again: the
    InitiateCheckout for this order already went out (or was not allowed).
    """

    previous = load_tracking(order)
    fresh = order_tracking(request, order, previous)
    keys = ("fbp", "fbc", "ip", "ua", "consent")
    if all(fresh.get(k) == previous.get(k) for k in keys) and "purchase_event_id" in previous:
        return None
    return json.dumps(fresh)


def _record_purchase(order_id: str, outcome: str) -> None:
    """Write how the Purchase went onto the order, for the admin's order list."""

    from .db import Order, get_session_factory

    try:
        with get_session_factory()() as db:
            row = db.get(Order, order_id)
            if row is None:
                return
            tracking = load_tracking(row)
            tracking["purchase"] = outcome
            tracking["purchase_at"] = int(time.time())
            row.tracking = json.dumps(tracking)
            db.commit()
    except Exception:  # noqa: BLE001 - bookkeeping only
        logger.exception("could not record the Meta Purchase outcome for order %s", order_id)


def _send_purchase(order_id: str, event: dict[str, Any]) -> None:
    for attempt, delay in enumerate((0, *PURCHASE_RETRY_DELAYS)):
        if delay:
            time.sleep(delay)
        if _post([event]):
            _record_purchase(order_id, "sent")
            return
        logger.warning("Meta Purchase for order %s not accepted (attempt %d)", order_id, attempt + 1)
    _record_purchase(order_id, "failed")


def purchase_event(order: Any, email: str, currency: str) -> tuple[dict[str, Any], bool]:
    """The Purchase event for a confirmed order, and whether the buyer allowed tracking."""

    tracking = load_tracking(order)
    event = build_event(
        "Purchase",
        tracking.get("purchase_event_id") or f"purchase-{order.id}",
        tracking,
        email=email,
        external_id=str(order.user_id),
        custom_data={**_order_custom(order, currency), "order_id": order.id},
        # The page the buyer returns to, so it matches the browser copy.
        source_url=(settings.public_url.strip().rstrip("/") + "/app/plan") if settings.public_url.strip() else None,
        # Confirmation time: when the sale really happened. Meta still ties it
        # to the earlier ad click through fbc / fbp / email (7-day click window).
        event_time=int(time.time()),
    )
    return event, tracking.get("consent") == GRANTED


def purchase(order: Any, email: str, currency: str) -> None:
    """Send the Purchase for an order whose payment was just confirmed.

    Called from settlement, which claims an order once, so this runs once per
    order whichever way the payment was confirmed (provider notification,
    webhook, poll or an admin approval of a real payment).
    """

    if not order.amount_usd or float(order.amount_usd) <= 0:
        return  # admin grants and free periods are not sales
    event, consent = purchase_event(order, email, currency)
    if not enabled():
        return
    if not consent:
        _record_purchase(order.id, "no consent")
        return
    threading.Thread(target=_send_purchase, args=(order.id, event), daemon=True, name="meta-capi-purchase").start()


def purchase_status(order: Any) -> str:
    """Short label for the admin: sent / failed / no consent / sending / ''."""

    if order.status != "paid" or not order.amount_usd or not enabled():
        return ""
    tracking = load_tracking(order)
    return str(tracking.get("purchase") or ("sending" if tracking else "no data"))


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------

router = APIRouter(prefix="/api/v1/meta", tags=["meta"])


class MetaConfig(BaseModel):
    pixel_id: str


class BrowserEvent(BaseModel):
    event_name: str = Field(max_length=32)
    event_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    url: str | None = Field(default=None, max_length=1024)
    content_name: str | None = Field(default=None, max_length=128)


@router.get("/config", response_model=MetaConfig)
def meta_config() -> MetaConfig:
    """The Pixel id the browser loads. Empty while Meta is not set up."""

    return MetaConfig(pixel_id=settings.meta_pixel_id.strip())


@router.post("/event", status_code=202)
def browser_event(payload: BrowserEvent, request: Request) -> dict[str, bool]:
    """Server copy of a PageView / ViewContent the browser just fired with the same event id."""

    if payload.event_name not in BROWSER_EVENTS:
        return {"sent": False}
    context = browser_context(request)
    custom = {"content_name": payload.content_name} if payload.content_name else None
    send(
        build_event(payload.event_name, payload.event_id, context, custom_data=custom, source_url=payload.url),
        consent=context.get("consent") == GRANTED,
    )
    return {"sent": enabled() and context.get("consent") == GRANTED}

