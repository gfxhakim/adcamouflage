"""Admin audit trail: one row per admin change to a customer's plan or tokens."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .db import AdminAudit, User

logger = logging.getLogger(__name__)


def record(db: Session, admin: User, user: User | None, action: str, detail: str) -> None:
    """Write one audit row. Like the activity log, it must never break the request."""

    try:
        db.add(
            AdminAudit(
                admin_id=admin.id,
                admin_email=admin.email,
                user_id=user.id if user else None,
                user_email=user.email if user else "",
                action=action[:32],
                detail=detail[:2000],
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not record admin audit %s", action, exc_info=True)
