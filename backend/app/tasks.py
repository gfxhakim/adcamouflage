"""Celery tasks that drive the mutation engine."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from celery.exceptions import SoftTimeLimitExceeded

from .celery_app import celery_app
from .config import settings
from .mutator import MutationError, mutate
from .schemas import AssetKind, JobStatus
from .security import sign_download
from .storage import get_store, resolve_within

logger = logging.getLogger(__name__)


class _ProgressThrottle:
    """Rate-limit progress writes so a 4K render does not hammer Redis."""

    def __init__(self, asset_id: str, min_interval: float = 0.6, min_delta: float = 0.02) -> None:
        self.asset_id = asset_id
        self.min_interval = min_interval
        self.min_delta = min_delta
        self._last_time = 0.0
        self._last_value = -1.0

    def __call__(self, fraction: float, stage: str) -> None:
        fraction = max(0.0, min(float(fraction), 1.0))
        now = time.monotonic()
        if fraction < 1.0 and now - self._last_time < self.min_interval and fraction - self._last_value < self.min_delta:
            return
        self._last_time = now
        self._last_value = fraction
        try:
            get_store().update_asset(
                self.asset_id,
                progress=round(fraction * 100, 2),
                stage=stage,
                status=JobStatus.PROCESSING,
            )
        except Exception:  # noqa: BLE001 - never let telemetry kill a render
            logger.debug("progress write failed for %s", self.asset_id, exc_info=True)


def run_asset_job(asset_id: str, task_id: str | None = None) -> dict[str, object]:
    """Mutate one asset and record the outcome. Safe to call from any worker."""

    store = get_store()
    asset = store.get_asset(asset_id)
    if asset is None:
        logger.warning("asset %s vanished before processing", asset_id)
        return {"asset_id": asset_id, "status": "missing"}

    if asset.status is JobStatus.CANCELLED:
        return {"asset_id": asset_id, "status": asset.status.value}

    batch = store.get_batch(asset.batch_id)
    if batch is None:
        store.update_asset(
            asset_id,
            status=JobStatus.FAILED,
            error="The batch record expired before this asset was processed.",
            finished_at=datetime.now(timezone.utc),
        )
        return {"asset_id": asset_id, "status": "failed"}

    options = batch.options.resolved()

    store.update_asset(
        asset_id,
        status=JobStatus.PROCESSING,
        stage="preparing",
        progress=1.0,
        task_id=task_id or asset.task_id,
        started_at=datetime.now(timezone.utc),
        error=None,
    )

    source = resolve_within(settings.uploads_dir, asset.stored_filename)
    if not source.exists():
        store.update_asset(
            asset_id,
            status=JobStatus.FAILED,
            error="The uploaded file is no longer available (retention window elapsed).",
            finished_at=datetime.now(timezone.utc),
        )
        return {"asset_id": asset_id, "status": "failed"}

    suffix = Path(asset.original_filename).suffix.lower() or (".mp4" if asset.kind is AssetKind.VIDEO else ".jpg")
    target = settings.outputs_dir / f"{asset.id}{suffix}"

    # Each variant of the same upload gets a distinct deterministic seed so the
    # copies differ from each other as well as from the original.
    seed = None
    if options.seed is not None:
        seed = (options.seed + asset.variant_index * 7919) % (2**31)

    try:
        report = mutate(
            source,
            target,
            asset.kind,
            options,
            seed=seed,
            on_progress=_ProgressThrottle(asset_id),
        )
    except SoftTimeLimitExceeded:
        store.update_asset(
            asset_id,
            status=JobStatus.FAILED,
            stage="timeout",
            error="Rendering exceeded the configured time limit.",
            finished_at=datetime.now(timezone.utc),
        )
        raise
    except MutationError as exc:
        logger.warning("mutation failed for %s: %s", asset_id, exc)
        store.update_asset(
            asset_id,
            status=JobStatus.FAILED,
            stage="failed",
            error=str(exc),
            finished_at=datetime.now(timezone.utc),
        )
        return {"asset_id": asset_id, "status": "failed", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("unexpected worker error for %s", asset_id)
        store.update_asset(
            asset_id,
            status=JobStatus.FAILED,
            stage="failed",
            error=f"Internal worker error: {exc}",
            finished_at=datetime.now(timezone.utc),
        )
        return {"asset_id": asset_id, "status": "failed", "error": str(exc)}

    output = report.output_path
    token = sign_download(asset.id)
    store.update_asset(
        asset_id,
        status=JobStatus.COMPLETED,
        stage="done",
        progress=100.0,
        output_filename=output.name,
        output_size_bytes=output.stat().st_size,
        download_url=f"/api/v1/assets/{asset.id}/download?token={token}",
        applied=report.applied,
        metrics=report.metrics,
        finished_at=datetime.now(timezone.utc),
        error=None,
    )
    logger.info("mutated %s -> %s", asset.original_filename, output.name)
    return {"asset_id": asset_id, "status": "completed", "output": output.name}


@celery_app.task(
    bind=True,
    name="app.tasks.process_asset",
    max_retries=2,
    autoretry_for=(OSError,),
    retry_backoff=5,
    retry_jitter=True,
)
def process_asset(self, asset_id: str) -> dict[str, object]:
    return run_asset_job(asset_id, task_id=self.request.id)


@celery_app.task(name="app.tasks.purge_expired_assets")
def purge_expired_assets() -> dict[str, int]:
    removed = get_store().purge_expired()
    if removed:
        logger.info("purged %s expired files", removed)
    return {"removed": removed}
