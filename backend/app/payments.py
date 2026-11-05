"""Transaction IDs, payment screenshots and the "I paid, check my ID" lookup.

Every order gets a short transaction ID (``BC-XXXX-XXXX``) the buyer sees on
the checkout panel and can paste to the support bot or the plan page. The
rules that keep this safe:

* A plan is only ever turned on by ``tokens.settle_order``: when the payment
  provider confirms the payment (Volet notification, BTCPay webhook or
  poll), or when an admin approves the order. Nothing else activates it.
* A screenshot is evidence for the admin, never proof on its own: anyone can
  edit an image. Uploading one puts the order in the admin's review list; the
  admin approves it with one click after checking the money arrived.
* The ID lookup only ever searches the signed-in buyer's own orders, so an
  ID from someone else's account answers "not found", and it is rate limited
  per account. The first successful check reports the activation; later
  checks of the same ID say it was already used.
* Screenshots live in a private folder (never served as static files), are
  checked to really be PNG/JPEG/WEBP images, re-encoded (which drops anything
  hidden inside), size limited, and readable only by their owner and admins.
"""

from __future__ import annotations

import io
import logging
import re
import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import settings
from .db import Order, User

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# transaction IDs
# --------------------------------------------------------------------------

# No 0/O, 1/I/L: the buyer may type the ID by hand.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
REF_PREFIX = "BC"
REF_RE = re.compile(r"\bBC[\s-]?([A-Z0-9]{4})[\s-]?([A-Z0-9]{4})\b", re.IGNORECASE)


def new_ref_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    return f"{REF_PREFIX}-{body[:4]}-{body[4:]}"


def unused_ref_code(db: Session) -> str:
    """A transaction ID no other order has (31^8 ≈ 850 billion, so a retry is rare)."""

    for _ in range(8):
        code = new_ref_code()
        if db.execute(select(Order.id).where(Order.ref_code == code)).first() is None:
            return code
    raise RuntimeError("could not make a unique transaction id")


def find_ref_code(text: str) -> str | None:
    """The first transaction ID written in a message, normalised, or None."""

    match = REF_RE.search(text or "")
    if not match:
        return None
    return f"{REF_PREFIX}-{match.group(1).upper()}-{match.group(2).upper()}"


# --------------------------------------------------------------------------
# rate limits (in-process, per account)
# --------------------------------------------------------------------------


class SlidingLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        """Record one use; False when the key is over its limit (the use is not recorded)."""

        now = time.monotonic()
        with self._lock:
            recent = [stamp for stamp in self._hits[key] if now - stamp < self.window]
            if len(recent) >= self.limit:
                self._hits[key] = recent
                return False
            recent.append(now)
            self._hits[key] = recent
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Ten ID checks per account per 10 minutes is plenty for a real buyer and
# makes guessing someone's ID pointless (it only searches your own orders anyway).
verify_limiter = SlidingLimiter(limit=10, window_seconds=600)
# Screenshots: ten uploads per account per hour.
proof_limiter = SlidingLimiter(limit=10, window_seconds=3600)


# --------------------------------------------------------------------------
# the lookup
# --------------------------------------------------------------------------


@dataclass
class CheckResult:
    # activated | already_used | pending | in_review | rejected | not_paid | not_found
    outcome: str
    message: str
    order: Order | None = None


def _lookup(db: Session, user: User, raw: str) -> Order | None:
    raw = (raw or "").strip()[:128]
    if not raw:
        return None
    code = find_ref_code(raw)
    matches = [Order.provider_ref == raw, Order.btcpay_invoice_id == raw]
    if code:
        matches.append(Order.ref_code == code)
    return db.execute(
        select(Order).where(Order.user_id == user.id, or_(*matches)).order_by(Order.created_at.desc()).limit(1)
    ).scalar_one_or_none()


def check_transaction(db: Session, user: User, raw: str) -> CheckResult:
    """Answer "is the payment behind this ID confirmed?" for the signed-in buyer.

    Never activates anything on its own say-so: a pending BTCPay order is
    asked about at BTCPay (the same poll the plan page uses), and only a
    provider confirmation or an admin approval has moved an order to paid.
    """

    if not verify_limiter.hit(f"user:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many checks. Wait a few minutes and try again.",
        )
    order = _lookup(db, user, raw)
    if order is None:
        return CheckResult(
            "not_found",
            "I can't find that transaction ID on your account. Copy it exactly from the checkout panel "
            "(it looks like BC-XXXX-XXXX) and make sure you are signed in with the account that paid.",
        )

    if order.status == "pending":
        from .billing_routes import _settle_from_btcpay  # late import: billing_routes imports this module

        _settle_from_btcpay(db, order)
        db.refresh(order)

    if order.status == "paid":
        if order.verified_at is None:
            order.verified_at = datetime.now(timezone.utc)
            db.commit()
            return CheckResult(
                "activated",
                f"Payment {order.ref_code or ''} is confirmed. "
                + ("Your plan is active" if order.kind == "subscription" else "Your top-up was added")
                + f" and {order.tokens:,} tokens are on your account. You can start rendering now.",
                order,
            )
        return CheckResult(
            "already_used",
            f"Transaction {order.ref_code or ''} was already used, and its payment is applied to your account.",
            order,
        )

    if order.status in ("expired", "invalid") and order.review_status != "submitted":
        return CheckResult(
            "not_paid",
            "This order was closed without a confirmed payment. If you did pay, upload the payment screenshot "
            "on your plan page (Orders) and our team will check it.",
            order,
        )
    if order.review_status == "submitted":
        return CheckResult(
            "in_review",
            "We have your payment screenshot. The payment isn't confirmed yet, so our team is checking it; "
            "your plan turns on as soon as it's approved.",
            order,
        )
    if order.review_status == "rejected":
        return CheckResult(
            "rejected",
            "Our team couldn't match your screenshot to a payment"
            + (f" ({order.review_note})" if order.review_note else "")
            + ". Upload a clearer screenshot or contact a live agent.",
            order,
        )
    return CheckResult(
        "pending",
        "That payment isn't confirmed yet. Crypto payments can take a few minutes. If you already paid, "
        "upload the payment screenshot on the checkout panel and our team will check it.",
        order,
    )


# --------------------------------------------------------------------------
# screenshots
# --------------------------------------------------------------------------

MAX_PROOF_BYTES = 8 * 1024 * 1024
MAX_PROOF_PIXELS = 40_000_000
_PROOF_NAME_RE = re.compile(r"^proof_[a-f0-9]{24}\.(png|jpg|webp)$")
_PROOF_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
_PIL_FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}


def proof_dir() -> Path:
    path = settings.storage_root / "payment-proofs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sniff_image(head: bytes) -> str | None:
    """'png', 'jpg' or 'webp' from the file's first bytes; None for anything else."""

    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def clean_image(data: bytes) -> tuple[bytes, str]:
    """Check that ``data`` is a real PNG/JPEG/WEBP image and re-encode it.

    Re-encoding keeps only the pixels, so nothing hidden in the file (extra
    payloads, scripts in metadata) is ever stored or served back.
    """

    kind = sniff_image(data[:16])
    if kind is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload the screenshot as a PNG, JPG or WEBP image.",
        )
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            if _PIL_FORMATS.get(image.format or "") != kind:
                raise HTTPException(status_code=415, detail="The file is not the image type it claims to be.")
            if image.width * image.height > MAX_PROOF_PIXELS:
                raise HTTPException(status_code=413, detail="That image is too large.")
            image.load()
            out = io.BytesIO()
            if kind == "jpg":
                image.convert("RGB").save(out, format="JPEG", quality=90)
            elif kind == "webp":
                image.save(out, format="WEBP", quality=90)
            else:
                image.save(out, format="PNG", optimize=True)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="That file could not be read as an image.") from exc
    return out.getvalue(), kind


def store_proof(data: bytes, kind: str) -> str:
    name = f"proof_{secrets.token_hex(12)}.{kind}"
    (proof_dir() / name).write_bytes(data)
    return name


def proof_path(name: str | None) -> Path | None:
    if not name or not _PROOF_NAME_RE.match(name):
        return None
    path = proof_dir() / name
    return path if path.is_file() else None


def proof_media_type(name: str) -> str:
    return _PROOF_TYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream")


def remove_proof(name: str | None) -> None:
    path = proof_path(name)
    if path is not None:
        try:
            path.unlink()
        except OSError:
            logger.warning("could not remove old payment screenshot %s", name)
