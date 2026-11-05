"""Payment check and payment proofs.

Every checkout already creates an order with its own id, and the payment
provider's signed notification (Volet) or webhook (BTCPay) marks it paid and
activates the plan the moment the money arrives. This module adds the
customer-facing side of that:

* **Check my payment** (``POST /api/v1/payments/verify``, and the support bot
  when a message carries an id): the customer pastes their order id or the
  provider's transaction id. If that payment is confirmed in the database the
  plan is already on and the customer is told so; a BTCPay invoice is
  re-checked with BTCPay on the spot.
* **Payment proof** (``POST /api/v1/payments/proof``): the customer uploads a
  screenshot of the transaction with its transaction id. It is stored with
  their account. It never activates anything by itself, because a screenshot
  can be faked: if the provider has already confirmed the order the proof is
  marked ``matched``; otherwise it waits for an admin, who approves it with
  one click in Admin > Payments (which settles the order exactly once) or
  rejects it.
"""

from __future__ import annotations

import html
import logging
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .accounts import current_user, is_admin, require_admin
from .activity import log_activity
from .config import settings
from .db import Order, PaymentProof, User, get_db
from .hardening import rate_limit, sniff_media
from .mailer import send_email
from .tokens import settle_order

logger = logging.getLogger(__name__)

MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
SCREENSHOT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
_SHOT_NAME_RE = re.compile(r"^pay_[a-f0-9]{24}\.(png|jpg|jpeg|webp)$")
# Order ids, Volet transfer ids and BTCPay invoice ids are all letters,
# digits and dashes; anything else is a typo or an attack.
_CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{3,127}$")
_CODE_IN_TEXT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_\-]{5,127}")
_PAYMENT_WORDS = re.compile(r"\b(paid|pay|payment|transaction|txn|tx|order|invoice|receipt|activate|subscription)\b", re.I)

user_router = APIRouter(prefix="/api/v1/payments", tags=["payments"])
admin_router = APIRouter(
    prefix="/api/v1/admin/payments", tags=["admin-payments"], dependencies=[Depends(require_admin)]
)


def proofs_dir() -> Path:
    path = settings.storage_root / "payment-proofs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _now() -> datetime:
    return datetime.now(timezone.utc)


def clean_code(value: str) -> str:
    code = (value or "").strip().strip("#").strip()
    if not _CODE_RE.match(code):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter the transaction id exactly as shown on your receipt (letters, numbers and dashes).",
        )
    return code


def find_user_order(db: Session, user: User, code: str) -> Order | None:
    """The user's own order matching an order id, provider transaction id or BTCPay invoice id."""

    return db.execute(
        select(Order)
        .where(
            Order.user_id == user.id,
            or_(Order.id == code, Order.provider_ref == code, Order.btcpay_invoice_id == code),
        )
        .order_by(Order.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def _refresh_from_provider(db: Session, order: Order) -> None:
    """Re-ask BTCPay about a pending invoice (Volet has no lookup; its notification is the source)."""

    if order.status != "pending":
        return
    try:
        from .billing_routes import _settle_from_btcpay

        _settle_from_btcpay(db, order)
        db.refresh(order)
    except Exception:  # noqa: BLE001 - a failed re-check must not fail the answer
        db.rollback()
        logger.warning("payment re-check for order %s failed", order.id, exc_info=True)


# --------------------------------------------------------------------------
# check my payment
# --------------------------------------------------------------------------


class VerifyIn(BaseModel):
    code: str = Field(min_length=1, max_length=160)


class VerifyOut(BaseModel):
    found: bool
    paid: bool
    status: str
    order_id: str | None = None
    message: str


def verify_code(db: Session, user: User, code: str) -> VerifyOut:
    order = find_user_order(db, user, code)
    if order is None:
        return VerifyOut(
            found=False,
            paid=False,
            status="not_found",
            message=(
                "No payment with that id is linked to your account yet. If you just paid, wait a minute "
                "and try again, or send the transaction id and a screenshot with \"I paid: send proof\" on the My plan page."
            ),
        )
    _refresh_from_provider(db, order)
    if order.status == "paid":
        return VerifyOut(
            found=True,
            paid=True,
            status="paid",
            order_id=order.id,
            message="Payment confirmed. Your plan is active and your tokens are in your account.",
        )
    if order.status == "pending":
        message = (
            "We found your order, but the payment is not confirmed yet. Confirmation usually takes a "
            "few minutes. If you already paid, send the transaction id and a screenshot with \"I paid: send proof\" on the My plan page."
        )
    else:
        message = "That order was cancelled or expired. Start a new checkout from the plan page."
    return VerifyOut(found=True, paid=False, status=order.status, order_id=order.id, message=message)


@user_router.post(
    "/verify",
    response_model=VerifyOut,
    dependencies=[Depends(rate_limit("payment-verify", limit=20, window_seconds=600))],
)
def verify_payment(payload: VerifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> VerifyOut:
    return verify_code(db, user, clean_code(payload.code))


def bot_payment_reply(db: Session, user: User, text: str) -> tuple[str, list[str]] | None:
    """The support bot's answer when a message carries one of the user's payment ids.

    Returns None when the message is not about a payment, so the normal bot
    answers instead.
    """

    if not text:
        return None
    candidates = [c for c in _CODE_IN_TEXT_RE.findall(text) if any(ch.isdigit() for ch in c)]
    if not candidates:
        return None
    for code in candidates[:5]:
        order = find_user_order(db, user, code)
        if order is not None:
            result = verify_code(db, user, code)
            return (f"I checked payment **{code}**.\n\n{result.message}", _bot_suggestions(result.paid))
    if _PAYMENT_WORDS.search(text):
        return (
            "I couldn't find a payment with that id on your account yet. Copy the transaction id from "
            "your payment receipt and paste it here, or open **My plan** and use **I paid: send proof** "
            "to send your screenshot.",
            _bot_suggestions(False),
        )
    return None


def _bot_suggestions(paid: bool) -> list[str]:
    if paid:
        return ["How do I use BluCloaking step by step?", "How do tokens, variants & refunds work?"]
    return ["How do tokens, variants & refunds work?", "My render or upload has an error"]


# --------------------------------------------------------------------------
# payment proofs
# --------------------------------------------------------------------------


class ProofOut(BaseModel):
    id: int
    order_id: str
    transaction_id: str
    status: str
    note: str
    admin_note: str
    screenshot_url: str | None
    created_at: datetime
    reviewed_at: datetime | None
    # Filled for admins only.
    user_email: str | None = None
    order_status: str | None = None
    order_amount: float | None = None
    order_plan: str | None = None
    order_kind: str | None = None
    order_provider: str | None = None
    order_transaction_id: str | None = None
    duplicate_transaction: bool = False


def _proof_out(db: Session, proof: PaymentProof, admin: bool = False) -> ProofOut:
    out = ProofOut(
        id=proof.id,
        order_id=proof.order_id,
        transaction_id=proof.transaction_id,
        status=proof.status,
        note=proof.note,
        admin_note=proof.admin_note,
        screenshot_url=f"/api/v1/payments/proofs/{proof.id}/screenshot" if proof.screenshot_name else None,
        created_at=proof.created_at,
        reviewed_at=proof.reviewed_at,
    )
    if admin:
        user = db.get(User, proof.user_id)
        order = db.get(Order, proof.order_id)
        others = db.execute(
            select(PaymentProof.id).where(
                PaymentProof.transaction_id == proof.transaction_id, PaymentProof.id != proof.id
            ).limit(1)
        ).first()
        used_elsewhere = db.execute(
            select(Order.id).where(Order.provider_ref == proof.transaction_id, Order.id != proof.order_id).limit(1)
        ).first()
        out.user_email = user.email if user else None
        if order is not None:
            out.order_status = order.status
            out.order_amount = order.amount_usd
            out.order_plan = order.plan_id
            out.order_kind = order.kind
            out.order_provider = order.provider
            out.order_transaction_id = order.provider_ref
        out.duplicate_transaction = bool(others or used_elsewhere)
    return out


async def _save_screenshot(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in SCREENSHOT_TYPES:
        content_type = (upload.content_type or "").lower()
        suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(content_type, "")
        if not suffix:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Upload the screenshot as PNG, JPG or WEBP.",
            )
    name = f"pay_{secrets.token_hex(12)}{suffix}"
    target = proofs_dir() / name
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_SCREENSHOT_BYTES:
                    raise HTTPException(status_code=413, detail="The screenshot must be 10 MB or smaller.")
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    if size == 0 or sniff_media(target) != "image":
        target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="That file is not a valid image."
        )
    return name


def _notify_admins(db: Session, user: User, proof: PaymentProof, order: Order) -> None:
    recipients = {email for email in settings.admin_emails if email}
    recipients.update(
        db.execute(select(User.email).where(User.is_admin.is_(True), User.is_active.is_(True))).scalars()
    )
    if not recipients:
        return
    body = (
        "<p>A customer sent a payment proof that needs your review in Admin &gt; Payments.</p>"
        f"<p>Customer: {html.escape(user.email)}<br/>"
        f"Order: {html.escape(order.id)} ({html.escape(order.kind)}, {html.escape(order.plan_id)}, "
        f"${order.amount_usd:g})<br/>"
        f"Transaction id: {html.escape(proof.transaction_id)}</p>"
    )
    for email in sorted(recipients):
        send_email(email, "Payment proof to review", body)


@user_router.post(
    "/proof",
    response_model=ProofOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("payment-proof", limit=10, window_seconds=3600))],
)
async def submit_proof(
    order_id: str = Form(..., max_length=64),
    transaction_id: str = Form(..., max_length=160),
    note: str = Form(default="", max_length=500),
    screenshot: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ProofOut:
    code = clean_code(transaction_id)
    order = db.get(Order, (order_id or "").strip())
    if order is None or order.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That order was not found on your account.")
    open_proofs = db.execute(
        select(PaymentProof.id).where(PaymentProof.user_id == user.id, PaymentProof.status == "pending")
    ).all()
    if len(open_proofs) >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You already have proofs waiting for review. We'll check them shortly.",
        )

    name = await _save_screenshot(screenshot)
    _refresh_from_provider(db, order)
    proof = PaymentProof(
        user_id=user.id,
        order_id=order.id,
        transaction_id=code,
        screenshot_name=name,
        note=(note or "").strip()[:500],
        status="matched" if order.status == "paid" else "pending",
    )
    db.add(proof)
    db.commit()
    db.refresh(proof)
    log_activity(db, user.id, "payment", f"Sent a payment proof for order {order.id} (transaction {code})")
    if proof.status == "pending":
        try:
            _notify_admins(db, user, proof, order)
        except Exception:  # noqa: BLE001 - email is best effort
            logger.warning("payment proof email could not be sent", exc_info=True)
    return _proof_out(db, proof)


@user_router.get("/proofs", response_model=list[ProofOut])
def my_proofs(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[ProofOut]:
    rows = db.execute(
        select(PaymentProof).where(PaymentProof.user_id == user.id).order_by(PaymentProof.created_at.desc()).limit(50)
    ).scalars()
    return [_proof_out(db, row) for row in rows]


@user_router.get("/proofs/{proof_id}/screenshot")
def proof_screenshot(proof_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> FileResponse:
    proof = db.get(PaymentProof, proof_id)
    if proof is None or (proof.user_id != user.id and not is_admin(user)) or not proof.screenshot_name:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not _SHOT_NAME_RE.match(proof.screenshot_name):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    path = proofs_dir() / proof.screenshot_name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return FileResponse(
        path,
        media_type=SCREENSHOT_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox"},
    )


# --------------------------------------------------------------------------
# admin review
# --------------------------------------------------------------------------


class ReviewIn(BaseModel):
    note: str = Field(default="", max_length=500)


@admin_router.get("/proofs", response_model=list[ProofOut])
def admin_list_proofs(status_filter: str = "pending", db: Session = Depends(get_db)) -> list[ProofOut]:
    query = select(PaymentProof).order_by(PaymentProof.created_at.desc()).limit(200)
    if status_filter in {"pending", "matched", "approved", "rejected"}:
        query = query.where(PaymentProof.status == status_filter)
    return [_proof_out(db, row, admin=True) for row in db.execute(query).scalars()]


@admin_router.get("/proofs/count")
def admin_pending_count(db: Session = Depends(get_db)) -> dict[str, int]:
    pending = db.execute(select(PaymentProof.id).where(PaymentProof.status == "pending")).all()
    return {"pending": len(pending)}


def _reviewable(db: Session, proof_id: int) -> PaymentProof:
    proof = db.get(PaymentProof, proof_id)
    if proof is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proof not found.")
    if proof.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This proof is already {proof.status}.")
    return proof


@admin_router.post("/proofs/{proof_id}/approve", response_model=ProofOut)
def admin_approve_proof(
    proof_id: int, payload: ReviewIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> ProofOut:
    proof = _reviewable(db, proof_id)
    order = db.get(Order, proof.order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The order no longer exists.")
    if order.status != "paid":
        if not order.provider_ref:
            order.provider_ref = proof.transaction_id[:128]
            db.commit()
        settle_order(db, order, source=f"Approved by {admin.email}")
        db.refresh(order)
    if order.status != "paid":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The order could not be applied.")
    proof.status = "approved"
    proof.admin_note = (payload.note or "").strip()
    proof.reviewed_by = admin.id
    proof.reviewed_at = _now()
    db.commit()
    db.refresh(proof)
    log_activity(db, proof.user_id, "payment", f"Payment proof for order {order.id} approved")
    return _proof_out(db, proof, admin=True)


@admin_router.post("/proofs/{proof_id}/reject", response_model=ProofOut)
def admin_reject_proof(
    proof_id: int, payload: ReviewIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> ProofOut:
    proof = _reviewable(db, proof_id)
    proof.status = "rejected"
    proof.admin_note = (payload.note or "").strip()
    proof.reviewed_by = admin.id
    proof.reviewed_at = _now()
    db.commit()
    db.refresh(proof)
    log_activity(db, proof.user_id, "payment", f"Payment proof for order {proof.order_id} rejected")
    return _proof_out(db, proof, admin=True)
