"""Persistence for job state and uploaded/rendered files.

Job state lives in Redis so the API process and the Celery workers observe the
same view. When Redis is unavailable *and* the service is configured for the
inline worker (local dev, CI) we transparently fall back to a process-local
store so the app still runs end to end.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import redis

from .config import settings
from .schemas import AssetJob, AssetKind, Batch, JobStatus

logger = logging.getLogger(__name__)

BATCH_KEY = "adcam:batch:{}"
ASSET_KEY = "adcam:asset:{}"
BATCH_ASSETS_KEY = "adcam:batch:{}:assets"
ACTIVE_KEY = "adcam:active"

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mpg", ".mpeg", ".wmv", ".flv", ".ts", ".3gp"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".gif"}

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class StorageError(RuntimeError):
    """Raised for unrecoverable storage problems."""


def sanitize_filename(name: str) -> str:
    """Reduce an arbitrary upload name to a safe, flat filename."""

    name = unicodedata.normalize("NFKD", name or "")
    name = name.replace("\\", "/").split("/")[-1]
    name = _SAFE_NAME.sub("_", name).strip("._") or "asset"
    if len(name) > 120:
        stem, dot, suffix = name.rpartition(".")
        stem = (stem or name)[:100]
        name = f"{stem}{dot}{suffix[:15]}" if dot else stem
    return name


def classify(filename: str, content_type: str | None = None) -> AssetKind | None:
    suffix = Path(filename).suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return AssetKind.VIDEO
    if suffix in IMAGE_EXTENSIONS:
        return AssetKind.IMAGE
    if content_type:
        if content_type.startswith("video/"):
            return AssetKind.VIDEO
        if content_type.startswith("image/"):
            return AssetKind.IMAGE
    return None


def resolve_within(root: Path, name: str) -> Path:
    """Join ``name`` onto ``root``, refusing anything that escapes the root."""

    candidate = (root / name).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise StorageError("path traversal detected")
    return candidate


class _MemoryBackend:
    """Minimal, thread-safe stand-in for Redis used in inline/dev mode."""

    def __init__(self) -> None:
        self._data: dict[str, str] = {}
        self._lists: dict[str, list[str]] = {}
        self._expiry: dict[str, float] = {}
        self._lock = threading.RLock()

    def _expired(self, key: str) -> bool:
        deadline = self._expiry.get(key)
        if deadline is not None and deadline < time.time():
            self._data.pop(key, None)
            self._lists.pop(key, None)
            self._expiry.pop(key, None)
            return True
        return False

    def get(self, key: str) -> str | None:
        with self._lock:
            if self._expired(key):
                return None
            return self._data.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        with self._lock:
            self._data[key] = value
            if ex:
                self._expiry[key] = time.time() + ex

    def delete(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._data.pop(key, None)
                self._lists.pop(key, None)
                self._expiry.pop(key, None)

    def rpush(self, key: str, *values: str) -> None:
        with self._lock:
            self._expired(key)
            self._lists.setdefault(key, []).extend(values)

    def lrange(self, key: str, start: int, end: int) -> list[str]:
        with self._lock:
            if self._expired(key):
                return []
            items = self._lists.get(key, [])
            if end == -1:
                return list(items[start:])
            return list(items[start : end + 1])

    def expire(self, key: str, seconds: int) -> None:
        with self._lock:
            if key in self._data or key in self._lists:
                self._expiry[key] = time.time() + seconds

    def ping(self) -> bool:
        return True

    def scan_iter(self, match: str) -> Iterable[str]:
        prefix = match.rstrip("*")
        with self._lock:
            return [k for k in list(self._data) if k.startswith(prefix)]


class JobStore:
    """Read/write access to batch and asset records."""

    def __init__(self) -> None:
        self._redis: redis.Redis | None = None
        self._memory = _MemoryBackend()
        self._using_memory = False
        self._lock = threading.RLock()
        self._connect()

    # -- backend ---------------------------------------------------------
    def _connect(self) -> None:
        try:
            client = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=5,
                health_check_interval=30,
            )
            client.ping()
            self._redis = client
            self._using_memory = False
            logger.info("job store connected to redis at %s", settings.redis_url)
        except Exception as exc:  # noqa: BLE001 - any redis failure means fallback
            if not settings.inline_worker:
                logger.error("redis unavailable (%s); job state will not be shared across processes", exc)
            else:
                logger.warning("redis unavailable (%s); using in-process job store", exc)
            self._redis = None
            self._using_memory = True

    @property
    def backend(self):
        if self._redis is not None:
            return self._redis
        return self._memory

    @property
    def redis_healthy(self) -> bool:
        if self._redis is None:
            return False
        try:
            return bool(self._redis.ping())
        except Exception:  # noqa: BLE001
            return False

    @property
    def using_memory(self) -> bool:
        return self._using_memory

    def _ttl(self) -> int:
        return max(300, settings.retention_hours * 3600)

    # -- batches ---------------------------------------------------------
    def save_batch(self, batch: Batch) -> None:
        self.backend.set(BATCH_KEY.format(batch.id), batch.model_dump_json(), ex=self._ttl())

    def get_batch(self, batch_id: str) -> Batch | None:
        raw = self.backend.get(BATCH_KEY.format(batch_id))
        if not raw:
            return None
        try:
            return Batch.model_validate_json(raw)
        except Exception:  # noqa: BLE001
            logger.warning("corrupt batch record %s", batch_id)
            return None

    def attach_assets(self, batch_id: str, asset_ids: list[str]) -> None:
        if not asset_ids:
            return
        key = BATCH_ASSETS_KEY.format(batch_id)
        self.backend.rpush(key, *asset_ids)
        self.backend.expire(key, self._ttl())

    def list_asset_ids(self, batch_id: str) -> list[str]:
        return list(self.backend.lrange(BATCH_ASSETS_KEY.format(batch_id), 0, -1))

    # -- assets ----------------------------------------------------------
    def save_asset(self, asset: AssetJob) -> None:
        asset.updated_at = datetime.now(timezone.utc)
        self.backend.set(ASSET_KEY.format(asset.id), asset.model_dump_json(), ex=self._ttl())

    def get_asset(self, asset_id: str) -> AssetJob | None:
        raw = self.backend.get(ASSET_KEY.format(asset_id))
        if not raw:
            return None
        try:
            return AssetJob.model_validate_json(raw)
        except Exception:  # noqa: BLE001
            logger.warning("corrupt asset record %s", asset_id)
            return None

    def get_assets(self, asset_ids: list[str]) -> list[AssetJob]:
        assets = [self.get_asset(asset_id) for asset_id in asset_ids]
        return [asset for asset in assets if asset is not None]

    def update_asset(self, asset_id: str, **changes: object) -> AssetJob | None:
        """Atomically merge ``changes`` into a stored asset record."""

        with self._lock:
            asset = self.get_asset(asset_id)
            if asset is None:
                return None
            for key, value in changes.items():
                if hasattr(asset, key):
                    setattr(asset, key, value)
            self.save_asset(asset)
            return asset

    def count_active(self) -> int:
        total = 0
        for key in self.backend.scan_iter("adcam:asset:*"):
            raw = self.backend.get(key)
            if not raw:
                continue
            try:
                status = json.loads(raw).get("status")
            except json.JSONDecodeError:
                continue
            if status in {JobStatus.QUEUED.value, JobStatus.PROCESSING.value}:
                total += 1
        return total

    # -- files -----------------------------------------------------------
    def purge_expired(self) -> int:
        """Delete uploads/outputs past the retention window. Returns the count."""

        cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.retention_hours)
        removed = 0
        for directory in (settings.uploads_dir, settings.outputs_dir, settings.work_dir):
            if not directory.exists():
                continue
            for path in directory.iterdir():
                try:
                    if not path.is_file():
                        continue
                    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                    if modified < cutoff:
                        path.unlink(missing_ok=True)
                        removed += 1
                except OSError:  # pragma: no cover - racing cleanup is fine
                    logger.debug("could not purge %s", path, exc_info=True)
        return removed


_store: JobStore | None = None
_store_lock = threading.Lock()


def get_store() -> JobStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = JobStore()
    return _store
