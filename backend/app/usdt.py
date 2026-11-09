"""Direct USDT (TRC-20) payments to the owner's own address, matched on the TRON blockchain.

Customers who pay by sending USDT to a wallet address leave no order id
anywhere: the deposit lands in the owner's Volet (or any) wallet and the
only record is the transfer on the TRON blockchain. So each order gets its
own exact amount to send, the price plus a few cents that no other open
order uses (``pay_amount``, e.g. 37.53), and the app reads the incoming
USDT transfers to that address from TronGrid's public API. A confirmed
transfer of exactly that amount, made after the order was created and
within the payment window, pays that order; nothing else does by itself.

Safety:
- The blockchain is the source of truth; a screenshot or a pasted id alone
  never activates anything.
- A transaction id pays at most one order (stored as ``provider_ref``).
- Amounts are compared in the token's smallest unit (6 decimals), never as
  floats.
- A transfer with no matching order, or a pasted transaction whose amount is
  not exact, goes to the owner's phone with Approve buttons instead.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, Decimal
from typing import Any, Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import Order, PaymentNotice, User

logger = logging.getLogger(__name__)

PROVIDER = "usdt"
LABEL = "USDT (TRC-20)"
DECIMALS = 6
UNIT = Decimal(10) ** DECIMALS
# A transfer this long before the order was made cannot be its payment
# (clock skew between the chain and this server is far smaller).
EARLY_SKEW = timedelta(minutes=5)
# How long a scan may be skipped after the last one, across the whole app.
SCAN_EVERY = timedelta(seconds=15)
MAX_PAGES = 5
PAGE_SIZE = 200

_scan_lock = threading.Lock()
_last_scan = 0.0


class TronError(Exception):
    """TronGrid could not be read; the next scan tries again."""


@dataclass(frozen=True)
class Transfer:
    txid: str
    sender: str
    to: str
    value: int  # smallest unit
    at: datetime

    @property
    def amount(self) -> Decimal:
        return Decimal(self.value) / UNIT


def configured() -> bool:
    return settings.usdt_configured


def address() -> str:
    return settings.usdt_trc20_address.strip()


def window() -> timedelta:
    return timedelta(hours=max(1, int(settings.usdt_pay_window_hours)))


def units(amount: str | Decimal | float) -> int:
    """An amount in the token's smallest unit."""

    return int((Decimal(str(amount)) * UNIT).to_integral_value(rounding=ROUND_DOWN))


def text(amount: str | Decimal | float) -> str:
    """Two-decimal display of an amount (the pay amounts are whole cents)."""

    return f"{Decimal(str(amount)):.2f}"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# unique amounts
# --------------------------------------------------------------------------


def assign_pay_amount(db: Session, price: float) -> str:
    """The price plus cents no other open USDT order uses, as a string such as ``37.53``.

    Orders made within two payment windows count as open, so an amount is
    never handed out again while a late payment for the old order could
    still arrive. Overflows into the next dollar in the unlikely case that
    all 99 cent tags of a price are taken.
    """

    since = _now() - 2 * window()
    taken = {
        units(row)
        for row in db.execute(
            select(Order.pay_amount).where(
                Order.provider == PROVIDER, Order.pay_amount.is_not(None), Order.created_at >= since
            )
        ).scalars()
        if row
    }
    base = Decimal(str(price)).quantize(Decimal("0.01"))
    for extra_dollars in range(0, 20):
        cents = list(range(1, 100))
        random.shuffle(cents)
        for cent in cents:
            candidate = base + extra_dollars + Decimal(cent) / 100
            if units(candidate) not in taken:
                return text(candidate)
    raise TronError("Too many open USDT orders; try again later.")


# --------------------------------------------------------------------------
# TronGrid
# --------------------------------------------------------------------------


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    key = settings.trongrid_api_key.get_secret_value() if settings.trongrid_api_key else ""
    if key.strip():
        headers["TRON-PRO-API-KEY"] = key.strip()
    return headers


def _parse(item: dict[str, Any]) -> Transfer | None:
    try:
        token = item.get("token_info") or {}
        if str(token.get("address") or "") != settings.usdt_trc20_contract:
            return None
        if int(token.get("decimals", DECIMALS)) != DECIMALS:
            return None
        if str(item.get("type") or "Transfer") != "Transfer":
            return None
        return Transfer(
            txid=str(item["transaction_id"]).strip().lower(),
            sender=str(item.get("from") or ""),
            to=str(item.get("to") or ""),
            value=int(str(item["value"])),
            at=datetime.fromtimestamp(int(item["block_timestamp"]) / 1000, tz=timezone.utc),
        )
    except (KeyError, TypeError, ValueError):
        return None


def incoming(since: datetime, client: httpx.Client | None = None) -> list[Transfer]:
    """Confirmed USDT transfers into the owner's address since ``since``, newest first."""

    base = settings.trongrid_url.rstrip("/")
    url: str | None = f"{base}/v1/accounts/{address()}/transactions/trc20"
    params: dict[str, Any] | None = {
        "only_to": "true",
        "only_confirmed": "true",
        "contract_address": settings.usdt_trc20_contract,
        "min_timestamp": int(since.timestamp() * 1000),
        "limit": PAGE_SIZE,
    }
    own = client is None
    http = client or httpx.Client(timeout=10.0, headers=_headers())
    found: list[Transfer] = []
    try:
        for _ in range(MAX_PAGES):
            if url is None:
                break
            try:
                response = http.get(url, params=params)
            except httpx.HTTPError as exc:
                raise TronError(f"TronGrid unreachable: {exc}") from exc
            if response.status_code != 200:
                raise TronError(f"TronGrid answered {response.status_code}")
            body = response.json()
            if not body.get("success", True):
                raise TronError("TronGrid refused the request")
            for item in body.get("data") or []:
                transfer = _parse(item)
                if transfer is not None and transfer.to == address():
                    found.append(transfer)
            url = ((body.get("meta") or {}).get("links") or {}).get("next")
            params = None  # the next link carries them
    finally:
        if own:
            http.close()
    return found


# --------------------------------------------------------------------------
# matching
# --------------------------------------------------------------------------


def _used(db: Session, txid: str) -> Order | None:
    return db.execute(
        select(Order).where(Order.provider == PROVIDER, Order.provider_ref == txid).limit(1)
    ).scalar_one_or_none()


def _record(db: Session, transfer: Transfer, order: Order | None, outcome: str, detail: str) -> None:
    try:
        db.add(
            PaymentNotice(
                provider=PROVIDER,
                sender=transfer.sender[:64],
                order_id=order.id if order is not None else "",
                transfer_id=transfer.txid[:128],
                status="CONFIRMED",
                amount=f"{transfer.amount:.6f}".rstrip("0").rstrip("."),
                currency="USDT",
                outcome=outcome,
                detail=detail[:500],
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 - the record is a convenience
        db.rollback()
        logger.exception("Could not record a USDT transfer")


def _seen(db: Session, txid: str) -> bool:
    return (
        db.execute(
            select(PaymentNotice.id)
            .where(PaymentNotice.provider == PROVIDER, PaymentNotice.transfer_id == txid)
            .limit(1)
        ).scalar_one_or_none()
        is not None
    )


def _pending(db: Session, now: datetime) -> list[Order]:
    since = now - window() - timedelta(hours=1)
    return list(
        db.execute(
            select(Order).where(
                Order.provider == PROVIDER,
                Order.status == "pending",
                Order.pay_amount.is_not(None),
                Order.created_at >= since,
            )
        ).scalars()
    )


def _fits(order: Order, transfer: Transfer) -> bool:
    created = _aware(order.created_at)
    return (
        created is not None
        and created - EARLY_SKEW <= transfer.at <= created + window()
        and units(order.pay_amount or "0") == transfer.value
    )


def _settle(db: Session, order: Order, transfer: Transfer, how: str) -> bool:
    from .tokens import settle_order

    order.provider_ref = transfer.txid
    db.commit()
    done = settle_order(db, order, source=LABEL)
    _record(
        db,
        transfer,
        order,
        "activated" if done else "already_paid",
        how if done else f"Order was already {order.status}",
    )
    return done


def _unmatched_alert(transfer: Transfer, why: str) -> None:
    from . import notify

    notify.alert(
        "review",
        f"💵 USDT received, no order matched: {transfer.amount:g} USDT",
        [
            f"Why: {why}",
            f"From wallet: {transfer.sender}",
            f"Transaction: {transfer.txid}",
            "Find the customer in Admin > Users and give the plan by hand if it is theirs.",
        ],
        key=f"usdt-unmatched:{transfer.txid}",
        priority="high",
    )


def apply(db: Session, transfers: Iterable[Transfer], now: datetime | None = None) -> int:
    """Pay every pending USDT order whose exact amount arrived. Returns how many were activated."""

    now = now or _now()
    orders = _pending(db, now)
    activated = 0
    for transfer in sorted(transfers, key=lambda t: t.at):
        if _used(db, transfer.txid) is not None or _seen(db, transfer.txid):
            continue
        matches = [order for order in orders if order.status == "pending" and _fits(order, transfer)]
        if len(matches) == 1:
            if _settle(db, matches[0], transfer, "Matched automatically"):
                activated += 1
            continue
        # Nothing (or, impossibly, more than one order) fits: leave it to the owner.
        why = "no open order has this exact amount" if not matches else "more than one order has this amount"
        _record(db, transfer, None, "unmatched", why)
        _unmatched_alert(transfer, why)
    return activated


def scan(db: Session, *, force: bool = False, client: httpx.Client | None = None) -> int:
    """Read new USDT transfers and settle the orders they pay. Throttled app-wide; never raises."""

    global _last_scan
    if not configured():
        return 0
    if not _scan_lock.acquire(blocking=False):
        return 0
    try:
        now_mono = time.monotonic()
        if not force and now_mono - _last_scan < SCAN_EVERY.total_seconds():
            return 0
        _last_scan = now_mono
        now = _now()
        orders = _pending(db, now)
        if not orders:
            return 0
        oldest = min(_aware(order.created_at) or now for order in orders)
        try:
            transfers = incoming(oldest - EARLY_SKEW, client=client)
        except TronError as exc:
            logger.warning("USDT scan failed: %s", exc)
            return 0
        return apply(db, transfers, now)
    except Exception:  # noqa: BLE001 - a scan must never break the caller
        logger.exception("USDT scan failed")
        db.rollback()
        return 0
    finally:
        _scan_lock.release()


def reset() -> None:
    """Forget the throttle (tests)."""

    global _last_scan
    _last_scan = 0.0


def check_txid(db: Session, order: Order, txid: str, client: httpx.Client | None = None) -> str:
    """The buyer's own transaction id for their order. Returns one of:

    ``paid`` (activated now or already), ``used`` (pays another order),
    ``not_found`` (not a confirmed USDT transfer to the address since the
    order was made, or not yet), ``review`` (found but the amount is not the
    exact one: the owner is asked to approve).
    """

    from . import notify

    txid = txid.strip().lower()
    if order.status == "paid":
        return "paid"
    other = _used(db, txid)
    if other is not None:
        return "paid" if other.id == order.id else "used"
    created = _aware(order.created_at) or _now()
    try:
        transfers = incoming(created - EARLY_SKEW, client=client)
    except TronError as exc:
        logger.warning("USDT transaction check failed: %s", exc)
        return "not_found"
    transfer = next((t for t in transfers if t.txid == txid), None)
    if transfer is None:
        return "not_found"
    if _fits(order, transfer):
        _settle(db, order, transfer, "Transaction id given by the buyer")
        return "paid"
    owner = db.get(User, order.user_id)
    if not _seen(db, txid):
        _record(
            db,
            transfer,
            order,
            "set_aside",
            f"Buyer says this pays the order, but {transfer.amount:g} USDT is not the exact {order.pay_amount}",
        )
    notify.needs_review(
        order,
        owner.email if owner else None,
        f"USDT {transfer.amount:g} received (expected exactly {order.pay_amount}), tx {txid}",
        name=owner.display_name if owner else None,
    )
    return "review"
