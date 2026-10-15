"""The activity log the admin panel reads."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .db import ActivityEvent

logger = logging.getLogger(__name__)


def log_activity(db: Session, user_id: int, kind: str, detail: str = "") -> None:
    """Record one event. Logging must never break the request it describes."""

    try:
        db.add(ActivityEvent(user_id=user_id, kind=kind, detail=detail[:2000]))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not record %s activity for user %s", kind, user_id, exc_info=True)
