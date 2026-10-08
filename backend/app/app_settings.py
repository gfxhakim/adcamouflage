"""Settings an admin can change from the panel without a redeploy.

Each value falls back to its environment setting (app/config.py) until an
admin saves it, so a fresh install behaves exactly as configured.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from .config import settings
from .db import AppSetting


def get_setting(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    try:
        return json.loads(row.value)
    except ValueError:
        return default


def set_setting(db: Session, key: str, value: Any) -> None:
    row = db.get(AppSetting, key)
    encoded = json.dumps(value)
    if row is None:
        db.add(AppSetting(key=key, value=encoded))
    else:
        row.value = encoded


def registration_open(db: Session) -> bool:
    # ADCAM_ALLOW_REGISTRATION=false is a hard off switch the panel cannot override.
    return settings.allow_registration and bool(get_setting(db, "registration_open", True))


def announcement(db: Session) -> str:
    return str(get_setting(db, "announcement", "") or "")


def currency(db: Session) -> str:
    return str(get_setting(db, "currency", "USD") or "USD")
