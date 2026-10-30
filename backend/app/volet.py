"""Volet.com Hosted Checkout (the "SCI"): the signed payment form and its callback.

Volet has no call that starts a payment. The customer's browser posts a form
to Volet's hosted page, pays there, and Volet later sends a status
notification to this API in the background. So the only work on this side
is to build and sign that form and to check the hash on what comes back;
nothing here touches the network, which is also why the tests need no mock
server.

The field names, the two hash formulas and the limits are those of Volet's
SCI specification v1.0 (``volet-sci-v1.0-en.pdf``).
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
from typing import Iterable, Mapping

from .config import settings
from .db import Order

PROVIDER = "volet"
# ``ac_transaction_status`` values a notification may carry. The money has
# reached the merchant's balance only on COMPLETED.
COMPLETED = "COMPLETED"
CANCELED = "CANCELED"
STATUSES = ("PENDING", "PROCESS", COMPLETED, CANCELED)
# Limits from the specification.
MAX_URL_LENGTH = 100
MAX_COMMENT_LENGTH = 255
# The notification fields that go into ``ac_hash``, in the documented order;
# the SCI password comes last.
STATUS_HASH_FIELDS = (
    "ac_transfer",
    "ac_start_date",
    "ac_sci_name",
    "ac_src_wallet",
    "ac_dest_wallet",
    "ac_order_id",
    "ac_amount",
    "ac_merchant_currency",
)


class VoletError(Exception):
    """The payment form cannot be built with the current settings."""


def configured() -> bool:
    return settings.volet_configured


def account_email() -> str:
    return settings.volet_account_email.strip()


def sci_name() -> str:
    return settings.volet_sci_name.strip()


def _secret() -> str:
    return settings.volet_sci_secret.get_secret_value() if settings.volet_sci_secret else ""


def _digest(parts: Iterable[str]) -> str:
    """Lower-case hex SHA-256 of the parts joined with colons, which is how every Volet hash is made."""

    return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()


def sign_payment(email: str, sci_name: str, amount: str, currency: str, order_id: str, secret: str) -> str:
    """``ac_sign`` for the payment form: ``email:name:amount:currency:password:order``."""

    return _digest((email, sci_name, amount, currency, secret, order_id))


def status_hash(fields: Mapping[str, str], secret: str) -> str:
    """The ``ac_hash`` Volet should have sent with a status notification.

    A field Volet left out counts as an empty string, so a notification that
    omits one hashes the way Volet hashed it instead of raising here.
    """

    return _digest([str(fields.get(name) or "") for name in STATUS_HASH_FIELDS] + [secret])


def verify_status(fields: Mapping[str, str], secret: str | None = None) -> bool:
    """Check a notification's ``ac_hash``. A missing secret or hash always fails.

    Compared in constant time on the lower-cased hex: the spec's examples are
    lower case, but nothing stops a sender from upper-casing it.
    """

    if secret is None:
        secret = _secret()
    given = str(fields.get("ac_hash") or "").strip().lower()
    if not secret or not given:
        return False
    return hmac.compare_digest(status_hash(fields, secret).encode("utf-8"), given.encode("utf-8"))


def sender_allowed(address: str, allowed: Iterable[str] | None = None) -> bool:
    """Whether a notification from ``address`` may be acted on.

    ``ac_hash`` does not cover ``ac_transaction_status``, so a correctly
    hashed PENDING or CANCELED notification, which the buyer can have Volet
    send to a page of their own by editing the form's status URL, would pass
    ``verify_status`` again with the status changed to COMPLETED. The hash
    proves the fields; only the sender proves it is Volet reporting them.

    ``allowed`` holds addresses or networks (``ADCAM_VOLET_NOTIFY_IPS``); an
    empty list turns the check off. An address that is not an IP, or an
    entry that is not one, never matches.
    """

    entries = [entry.strip() for entry in (settings.volet_notify_ips if allowed is None else allowed)]
    entries = [entry for entry in entries if entry]
    if not entries:
        return True
    try:
        ip = ipaddress.ip_address(address.strip())
    except ValueError:
        return False
    # A server bound to :: sees an IPv4 peer as ::ffff:a.b.c.d.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    for entry in entries:
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            continue
        if ip.version == network.version and ip in network:
            return True
    return False


def payment_fields(
    *,
    order: Order,
    currency: str,
    success_url: str,
    fail_url: str,
    status_url: str,
    comment: str,
) -> dict[str, str]:
    """Every ``ac_*`` field of the form the customer's browser posts to Volet.

    The customer comes back by GET so the plan page can read the order id
    from the query string; the status notification comes by POST so the
    order id and hash do not end up in an access log line. Volet needs the
    three URLs absolute (it calls the status one from its own servers, so a
    bare path would leave the order pending for good) and caps each at 100
    characters, which a missing or long ``ADCAM_PUBLIC_URL`` would break; both
    are checked here rather than found out on Volet's page.
    """

    for label, url in (("success", success_url), ("fail", fail_url), ("status", status_url)):
        if not url.startswith(("https://", "http://")):
            raise VoletError(
                f"The {label} link has no site address. Set ADCAM_PUBLIC_URL to the public address of this app."
            )
        if len(url) > MAX_URL_LENGTH:
            raise VoletError(
                f"The {label} link is longer than Volet allows ({MAX_URL_LENGTH} characters). "
                "Set a shorter ADCAM_PUBLIC_URL."
            )
    amount = f"{order.amount_usd:.2f}"
    code = currency.upper()
    email = account_email()
    name = sci_name()
    return {
        "ac_account_email": email,
        "ac_sci_name": name,
        "ac_amount": amount,
        "ac_currency": code,
        "ac_order_id": order.id,
        "ac_sign": sign_payment(email, name, amount, code, order.id, _secret()),
        "ac_success_url": success_url,
        "ac_success_url_method": "GET",
        "ac_fail_url": fail_url,
        "ac_fail_url_method": "GET",
        "ac_status_url": status_url,
        "ac_status_url_method": "POST",
        "ac_client_lang": "en",
        "ac_comments": comment[:MAX_COMMENT_LENGTH],
    }
