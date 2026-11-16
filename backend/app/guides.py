"""Guides (the public /guides articles), editable from Admin > Guides.

The frontend ships a few built-in guides. This module only stores what an
admin saves: a new guide, an edited copy of a built-in one (same slug), or a
built-in one switched off (published = false). Deleting a saved guide brings a
built-in guide with that slug back to its shipped text.

Everything lives in one app_settings row, so no table or migration is needed.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .accounts import require_admin
from .activity import log_activity
from .app_settings import get_setting, set_setting
from .db import User, get_db

SETTING_KEY = "guides"
MAX_GUIDES = 200
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

public_router = APIRouter(prefix="/api/v1", tags=["guides"])
admin_router = APIRouter(prefix="/api/v1/admin/guides", tags=["admin"], dependencies=[Depends(require_admin)])


class GuideIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(default="", max_length=320)
    body: str = Field(default="", max_length=60_000)
    category: str = Field(default="", max_length=60)
    cover: str = Field(default="", max_length=500)
    cover_alt: str = Field(default="", max_length=200)
    published: bool = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load(db: Session) -> dict[str, dict[str, Any]]:
    stored = get_setting(db, SETTING_KEY, None)
    items = stored.get("items") if isinstance(stored, dict) else None
    if not isinstance(items, dict):
        return {}
    return {slug: guide for slug, guide in items.items() if isinstance(guide, dict) and SLUG.match(slug)}


def _save(db: Session, items: dict[str, dict[str, Any]]) -> None:
    set_setting(db, SETTING_KEY, {"items": items})
    db.commit()


def _check_slug(slug: str) -> str:
    slug = slug.strip().lower()
    if len(slug) > 80 or not SLUG.match(slug):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Use lowercase letters, numbers and dashes for the address (for example resize-video-for-reels).",
        )
    return slug


def _clean_cover(cover: str) -> str:
    cover = cover.strip()
    if cover and not (cover.startswith("https://") or cover.startswith("/")):
        raise HTTPException(status_code=422, detail="The cover picture must be an uploaded file or an https:// link.")
    return cover


def _sorted(items: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items.values(), key=lambda guide: guide.get("updated_at") or "", reverse=True)


# --------------------------------------------------------------------------
# public
# --------------------------------------------------------------------------


@public_router.get("/guides")
def list_public(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Published guides, plus the slugs an admin switched off (so built-in ones stay hidden)."""

    items = _load(db)
    return {
        "guides": [guide for guide in _sorted(items) if guide.get("published")],
        "unpublished": sorted(slug for slug, guide in items.items() if not guide.get("published")),
    }


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


@admin_router.get("")
def list_all(db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"guides": _sorted(_load(db))}


@admin_router.put("/{slug}")
def save_guide(
    slug: str,
    guide: GuideIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    slug = _check_slug(slug)
    items = _load(db)
    if slug not in items and len(items) >= MAX_GUIDES:
        raise HTTPException(status_code=409, detail=f"You can keep up to {MAX_GUIDES} guides.")
    previous = items.get(slug, {})
    now = _now()
    record = {
        "slug": slug,
        "title": guide.title.strip(),
        "description": guide.description.strip(),
        "body": guide.body.replace("\r\n", "\n"),
        "category": guide.category.strip(),
        "cover": _clean_cover(guide.cover),
        "cover_alt": guide.cover_alt.strip(),
        "published": guide.published,
        "created_at": previous.get("created_at") or now,
        "updated_at": now,
    }
    items[slug] = record
    _save(db, items)
    log_activity(db, admin.id, "guide_saved", f"guide {slug} saved ({'published' if guide.published else 'hidden'})")
    return record


@admin_router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_guide(slug: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> Response:
    slug = _check_slug(slug)
    items = _load(db)
    if items.pop(slug, None) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    _save(db, items)
    log_activity(db, admin.id, "guide_deleted", f"guide {slug} deleted")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
