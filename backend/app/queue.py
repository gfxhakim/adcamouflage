"""Job dispatch.

Production runs Celery workers against Redis. Setting ``ADCAM_INLINE_WORKER=1``
swaps in a bounded local thread pool instead, which keeps `docker compose`-free
development and the test suite honest without a second process.
"""

from __future__ import annotations

import atexit
import logging
from concurrent.futures import Future, ThreadPoolExecutor

from .config import settings
from .schemas import JobStatus
from .storage import get_store
from .tasks import process_asset, run_asset_job

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_pending: dict[str, Future] = {}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(
            max_workers=max(1, settings.inline_worker_concurrency),
            thread_name_prefix="adcam-inline",
        )
        atexit.register(lambda: _executor.shutdown(wait=False, cancel_futures=True) if _executor else None)
    return _executor


def queue_depth() -> int:
    if settings.inline_worker:
        return sum(1 for future in _pending.values() if not future.done())
    store = get_store()
    try:
        backend = store.backend
        depth = backend.llen("mutations") if hasattr(backend, "llen") else 0  # type: ignore[union-attr]
        return int(depth or 0)
    except Exception:  # noqa: BLE001
        return 0


def worker_mode() -> str:
    return "inline" if settings.inline_worker else "celery"


def enqueue_asset(asset_id: str) -> str | None:
    """Schedule one asset for mutation and return the task id, if any."""

    if settings.inline_worker:
        future = _get_executor().submit(_run_guarded, asset_id)
        _pending[asset_id] = future
        return f"inline:{asset_id}"

    try:
        result = process_asset.apply_async(args=[asset_id], queue="mutations")
        return result.id
    except Exception as exc:  # noqa: BLE001 - broker down
        logger.error("could not enqueue %s: %s", asset_id, exc)
        get_store().update_asset(
            asset_id,
            status=JobStatus.FAILED,
            stage="failed",
            error="The render queue is unreachable. Check that Redis and the Celery worker are running.",
        )
        return None


def _run_guarded(asset_id: str) -> None:
    try:
        run_asset_job(asset_id, task_id=f"inline:{asset_id}")
    except Exception:  # noqa: BLE001
        logger.exception("inline worker crashed on %s", asset_id)
    finally:
        _pending.pop(asset_id, None)


def cancel_asset(asset_id: str) -> bool:
    """Best-effort cancellation of a queued job."""

    store = get_store()
    asset = store.get_asset(asset_id)
    if asset is None or asset.is_terminal:
        return False

    if settings.inline_worker:
        future = _pending.get(asset_id)
        if future is not None:
            future.cancel()
    elif asset.task_id:
        try:
            from .celery_app import celery_app

            celery_app.control.revoke(asset.task_id, terminate=True, signal="SIGTERM")
        except Exception:  # noqa: BLE001
            logger.warning("could not revoke celery task %s", asset.task_id)

    store.update_asset(asset_id, status=JobStatus.CANCELLED, stage="cancelled", error=None)
    return True
