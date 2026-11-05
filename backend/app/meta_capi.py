"""Meta (Facebook) Pixel + Conversions API.

The browser fires the Pixel and this module sends the same events from the
server through the Conversions API (CAPI). Both carry the same ``event_id``,
so Meta counts each event once (deduplication) while the server copy still
arrives when an ad blocker or a closed tab stops the browser one.

Event ids are built from ids both sides already know:

- ``signup-<user id>``      CompleteRegistration (register route)
- ``checkout-<order id>``   InitiateCheckout (checkout route)
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


def _post(events: list[dict[str, Any]]) -> None:
    if not enabled():
        return
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
        else:
            logger.info("Meta CAPI sent %s", ", ".join(f"{e['event_name']}({e['event_id']})" for e in events))
    except httpx.HTTPError as exc:
        logger.warning("Meta CAPI unreachable: %s", exc)


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


def initiate_checkout(request: Request, order: Any, email: str, currency: str) -> dict[str, str]:
    """Send InitiateCheckout and return the context to keep on the order for the Purchase."""

    context = browser_context(request)
    send(
        build_event(
            "InitiateCheckout",
            f"checkout-{order.id}",
            context,
            email=email,
            external_id=str(order.user_id),
            custom_data={
                "value": round(float(order.amount_usd), 2),
                "currency": currency,
                "content_ids": [order.plan_id],
                "content_type": "product",
                "content_name": f"{order.plan_id} {order.kind}",
                "num_items": 1,
            },
        ),
        consent=context.get("consent") == GRANTED,
    )
    return context


def purchase(order: Any, email: str, currency: str) -> None:
    """Send the Purchase for an order whose payment was just confirmed."""

    if not order.amount_usd or float(order.amount_usd) <= 0:
        return  # admin grants and free periods are not sales
    try:
        context = json.loads(order.tracking or "{}")
    except ValueError:
        context = {}
    if not isinstance(context, dict):
        context = {}
    send(
        build_event(
            "Purchase",
            f"purchase-{order.id}",
            context,
            email=email,
            external_id=str(order.user_id),
            custom_data={
                "value": round(float(order.amount_usd), 2),
                "currency": currency,
                "content_ids": [order.plan_id],
                "content_type": "product",
                "content_name": f"{order.plan_id} {order.kind}",
                "num_items": 1,
                "order_id": order.id,
            },
            # The page the buyer returns to, so it matches the browser copy.
            source_url=(settings.public_url.strip().rstrip("/") + "/app/plan") if settings.public_url.strip() else None,
        ),
        consent=context.get("consent") == GRANTED,
    )


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

