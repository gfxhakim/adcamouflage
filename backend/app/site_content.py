"""Admin-editable site content: the landing page and the signed-in workspace.

Each page ("namespace") keeps two copies of its overrides in app_settings:
a draft the admin edits and previews, and the published copy every visitor
gets. Only overrides are stored; anything left out falls back to the text,
media and colours built into the frontend, so an empty document means the
page looks exactly as shipped.

Uploaded media (images, videos, fonts) lives in <storage_root>/site-media,
outside the upload/output folders the retention purge empties.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .accounts import require_admin
from .activity import log_activity
from .app_settings import get_setting, set_setting
from .config import settings
from .db import User, get_db

NAMESPACES = ("landing", "workspace")

# A whole document, overrides only. Generous: a fully rewritten page with
# custom CSS is still far below this.
MAX_DOCUMENT_BYTES = 512 * 1024
MAX_MEDIA_BYTES = 150 * 1024 * 1024

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
}

_MEDIA_NAME = re.compile(r"^[a-f0-9]{24}\.[a-z0-9]{2,5}$")

public_router = APIRouter(prefix="/api/v1", tags=["site-content"])
admin_router = APIRouter(
    prefix="/api/v1/admin/site-content", tags=["admin"], dependencies=[Depends(require_admin)]
)


def media_dir() -> Path:
    path = settings.storage_root / "site-media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _key(namespace: str) -> str:
    return f"site_content:{namespace}"


def _check_namespace(namespace: str) -> None:
    if namespace not in NAMESPACES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict[str, Any]:
    return {"draft": {}, "published": {}, "draft_updated_at": None, "published_at": None}


def _load(db: Session, namespace: str) -> dict[str, Any]:
    stored = get_setting(db, _key(namespace), None)
    record = _empty()
    if isinstance(stored, dict):
        for field in record:
            if field in stored:
                record[field] = stored[field]
    for field in ("draft", "published"):
        if not isinstance(record[field], dict):
            record[field] = {}
    return record


def _validated(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise HTTPException(status_code=422, detail="The content must be a JSON object.")
    if len(json.dumps(document)) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="The content is too large to save.")
    return document


def published_content(db: Session, namespace: str) -> dict[str, Any]:
    return _load(db, namespace)["published"]


# --------------------------------------------------------------------------
# public
# --------------------------------------------------------------------------


@public_router.get("/site-content/{namespace}")
def read_published(namespace: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check_namespace(namespace)
    record = _load(db, namespace)
    return {"content": record["published"], "published_at": record["published_at"]}


@public_router.get("/site-media/{name}")
def read_media(name: str) -> FileResponse:
    if not _MEDIA_NAME.match(name):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    path = media_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    headers = {"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
    if path.suffix == ".svg":
        # An SVG opened on its own must not be able to run script on this origin.
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix, "application/octet-stream"), headers=headers)


# --------------------------------------------------------------------------
# admin
# --------------------------------------------------------------------------


@admin_router.get("/{namespace}")
def read_record(namespace: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check_namespace(namespace)
    return _load(db, namespace)


@admin_router.put("/{namespace}/draft")
def save_draft(namespace: str, document: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    _check_namespace(namespace)
    record = _load(db, namespace)
    record["draft"] = _validated(document)
    record["draft_updated_at"] = _now()
    set_setting(db, _key(namespace), record)
    db.commit()
    return record


@admin_router.post("/{namespace}/publish")
def publish(
    namespace: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _check_namespace(namespace)
    record = _load(db, namespace)
    record["published"] = record["draft"]
    record["published_at"] = _now()
    set_setting(db, _key(namespace), record)
    db.commit()
    log_activity(db, admin.id, "site_content_published", f"{namespace} page published")
    return record


@admin_router.post("/{namespace}/discard")
def discard_draft(namespace: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Throw the draft away and start again from what is live."""

    _check_namespace(namespace)
    record = _load(db, namespace)
    record["draft"] = record["published"]
    record["draft_updated_at"] = _now()
    set_setting(db, _key(namespace), record)
    db.commit()
    return record


@admin_router.post("/media", status_code=status.HTTP_201_CREATED)
async def upload_media(file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in MEDIA_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Upload an image (png, jpg, gif, webp, avif, svg, ico), a video (mp4, webm, mov) or a font (woff, woff2, ttf, otf).",
        )
    name = f"{secrets.token_hex(12)}{suffix}"
    target = media_dir() / name
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_MEDIA_BYTES:
                    raise HTTPException(status_code=413, detail="That file is larger than 150 MB.")
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)
        raise
    return {
        "url": f"/api/v1/site-media/{name}",
        "name": file.filename or name,
        "type": MEDIA_TYPES[suffix],
        "size": size,
    }
