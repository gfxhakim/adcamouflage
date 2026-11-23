"""Celery tasks that drive the mutation engine."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from celery.exceptions import SoftTimeLimitExceeded
from celery.signals import task_failure

from . import costs
from .celery_app import celery_app
from .config import settings
from .db import get_session_factory
from .mailer import send_billing_reminders as _send_billing_reminders
from .mutator import MutationError, mutate
from .schemas import AssetJob, AssetKind, JobStatus
from .security import sign_download
from .storage import get_store, resolve_within
from .tokens import refund_asset

logger = logging.getLogger(__name__)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fail(asset_id: str, **fields: object) -> bool:
    """Mark an asset FAILED and hand back the tokens it cost.

    Never overwrites a user-initiated cancellation (`CANCELLED`), and never
    refunds user-stopped renders. Never raises for the refund.
    """

    store = get_store()
    with store._lock:
        current = store.get_asset(asset_id)
        if current is not None and current.status is JobStatus.CANCELLED:
            return False
        store.update_asset(asset_id, status=JobStatus.FAILED, finished_at=datetime.now(timezone.utc), **fields)
    try:
        refund_asset(asset_id)
    except Exception:  # noqa: BLE001 - belt and braces; refund_asset catches its own errors
        logger.warning("refund hook failed for %s", asset_id, exc_info=True)
    return True


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
        _fail(asset_id, stage="failed", error="The batch record expired before this asset was processed.")
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
        _fail(asset_id, error="The uploaded file is no longer available (retention window elapsed).")
        return {"asset_id": asset_id, "status": "failed"}

    # The stored upload carries the flattened extension; the display name may not.
    suffix = Path(asset.stored_filename).suffix.lower() or (".mp4" if asset.kind is AssetKind.VIDEO else ".jpg")
    target = settings.outputs_dir / f"{asset.id}{suffix}"

    # Each variant of the same upload gets a distinct deterministic seed so the
    # copies differ from each other as well as from the original.
    seed = None
    if options.seed is not None:
        seed = (options.seed + asset.variant_index * 7919) % (2**31)

    started = time.monotonic()
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
        _fail(
            asset_id,
            stage="timeout",
            error="Rendering exceeded the configured time limit; your tokens have been refunded.",
        )
        raise
    except MutationError as exc:
        logger.warning("mutation failed for %s: %s", asset_id, exc)
        _fail(asset_id, stage="failed", error=str(exc))
        return {"asset_id": asset_id, "status": "failed", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("unexpected worker error for %s", asset_id)
        _fail(asset_id, stage="failed", error=f"Internal worker error: {exc}")
        return {"asset_id": asset_id, "status": "failed", "error": str(exc)}
    except BaseException:
        current = store.get_asset(asset_id)
        if current is None or current.status is not JobStatus.CANCELLED:
            _fail(
                asset_id,
                stage="interrupted",
                error="The render was interrupted on our server before finishing; your tokens have been refunded.",
            )
        raise

    latest = store.get_asset(asset_id)
    if latest is not None and latest.status is JobStatus.CANCELLED:
        report.output_path.unlink(missing_ok=True)
        if report.poster_filename:
            resolve_within(settings.outputs_dir, report.poster_filename).unlink(missing_ok=True)
        return {"asset_id": asset_id, "status": "cancelled"}

    output = report.output_path
    token = sign_download(asset.id)
    poster_url = (
        f"/api/v1/assets/{asset.id}/poster?token={token}" if report.poster_filename else None
    )
    store.update_asset(
        asset_id,
        status=JobStatus.COMPLETED,
        stage="done",
        progress=100.0,
        output_filename=output.name,
        output_size_bytes=output.stat().st_size,
        download_url=f"/api/v1/assets/{asset.id}/download?token={token}",
        poster_filename=report.poster_filename,
        poster_url=poster_url,
        applied=report.applied,
        metrics=report.metrics,
        finished_at=datetime.now(timezone.utc),
        error=None,
    )
    # Hosting-cost bookkeeping only (Admin > Sales > Batch costs).
    costs.record_render(
        asset_id,
        asset.batch_id,
        kind=asset.kind.value,
        render_seconds=time.monotonic() - started,
        output_bytes=output.stat().st_size,
        resolution=str((report.metrics or {}).get("output_resolution", "")),
        duration=float((report.metrics or {}).get("duration", 0) or 0),
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


@task_failure.connect(sender=process_asset)
def _on_process_asset_failure(args=None, kwargs=None, exception=None, **_extra: object) -> None:
    """Catch worker crashes / SIGKILLs where `run_asset_job` could not run `_fail`."""

    asset_id = None
    if args:
        asset_id = args[0]
    elif kwargs:
        asset_id = kwargs.get("asset_id")
    if not isinstance(asset_id, str) or not asset_id:
        return
    asset = get_store().get_asset(asset_id)
    if asset is None or asset.is_terminal:
        return
    reason = str(exception).strip() if exception else "Render worker stopped unexpectedly."
    _fail(
        asset_id,
        stage="failed",
        error=f"Rendering stopped on our server ({reason[:200]}); your tokens have been refunded.",
    )


def reap_asset_if_stalled(
    asset: AssetJob,
    *,
    now: datetime | None = None,
    inline_reset: bool = False,
) -> AssetJob:
    """Fail and refund an active asset if our worker stalled, crashed or got killed."""

    if asset.is_terminal:
        return asset

    now = now or datetime.now(timezone.utc)
    store = get_store()

    if asset.status is JobStatus.PROCESSING:
        last_touch = _utc(asset.updated_at) or _utc(asset.started_at) or _utc(asset.created_at) or now
        started = _utc(asset.started_at) or last_touch
        idle_s = (now - last_touch).total_seconds()
        elapsed_s = (now - started).total_seconds()
        if (
            inline_reset
            or idle_s > settings.stale_processing_seconds
            or elapsed_s > settings.job_timeout_seconds + 180
        ):
            _fail(
                asset.id,
                stage="stalled",
                error="Rendering stalled or stopped on our server before finishing; your tokens have been refunded.",
            )
            return store.get_asset(asset.id) or asset
    elif asset.status is JobStatus.QUEUED:
        created = _utc(asset.created_at) or _utc(asset.updated_at) or now
        wait_s = (now - created).total_seconds()
        if inline_reset or wait_s > settings.stale_queued_seconds:
            _fail(
                asset.id,
                stage="stalled",
                error="The render waited too long in the queue without starting; your tokens have been refunded.",
            )
            return store.get_asset(asset.id) or asset

    return asset


@celery_app.task(name="app.tasks.reap_stalled_assets")
def reap_stalled_assets(*, inline_reset: bool = False) -> dict[str, int]:
    """Fail and refund queued/processing jobs whose worker disappeared or stalled."""

    store = get_store()
    now = datetime.now(timezone.utc)
    reaped = 0
    for key in store.backend.scan_iter("adcam:asset:*"):
        asset_id = str(key).removeprefix("adcam:asset:")
        asset = store.get_asset(asset_id)
        if asset is None or asset.is_terminal:
            continue
        updated = reap_asset_if_stalled(asset, now=now, inline_reset=inline_reset)
        if updated.status is JobStatus.FAILED:
            reaped += 1
    if reaped:
        logger.warning("reaped %s stalled render job(s) and refunded tokens", reaped)
    return {"reaped": reaped}


@celery_app.task(name="app.tasks.pay_referral_rewards")
def pay_referral_rewards() -> dict[str, int]:
    """Give friend-referral token rewards whose hold period has passed."""

    from .affiliates import process_due_rewards
    from .db import get_session_factory

    with get_session_factory()() as db:
        return {"rewarded": process_due_rewards(db)}


@celery_app.task(name="app.tasks.purge_expired_assets")
def purge_expired_assets() -> dict[str, int]:
    removed = get_store().purge_expired()
    if removed:
        logger.info("purged %s expired files", removed)
    return {"removed": removed}


@celery_app.task(name="app.tasks.send_billing_reminders")
def send_billing_reminders() -> dict[str, int]:
    """Daily: email token-mode users whose period ends soon or has just ended."""

    with get_session_factory()() as db:
        result = _send_billing_reminders(db)
    if result["sent"] or result["skipped"]:
        logger.info("billing reminders: %s sent, %s not emailed", result["sent"], result["skipped"])
    return result


@celery_app.task(name="app.tasks.send_group_emails")
def send_group_emails() -> dict[str, int]:
    """Every two minutes (and right after an admin sends): send queued group emails, throttled."""

    from .broadcast import process

    with get_session_factory()() as db:
        result = process(db)
    if any(result.values()):
        logger.info("group emails: %s sent, %s failed, %s skipped", result["sent"], result["failed"], result["skipped"])
    return result


@celery_app.task(name="app.tasks.open_waiting_support_tickets")
def open_waiting_support_tickets() -> dict[str, int]:
    """Every few minutes: customers stuck in the support bot for 30 min get a ticket in Admin."""

    from .support_routes import open_waiting_tickets

    with get_session_factory()() as db:
        opened = open_waiting_tickets(db)
    if opened:
        logger.info("support: opened %s ticket(s) for customers waiting in the bot", opened)
    return {"opened": opened}
