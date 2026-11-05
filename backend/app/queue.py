"""Job dispatch.

Production runs Celery workers against Redis. Setting ``ADCAM_INLINE_WORKER=1``
swaps in a bounded local thread pool instead, which keeps `docker compose`-free
development and the test suite honest without a second process.
"""

from __future__ import annotations

import atexit
import logging
import threading
import time
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


_broker_lock = threading.Lock()
_broker_cache: tuple[float, bool, str | None] | None = None
_BROKER_CACHE_SECONDS = 20.0


def broker_status(force: bool = False) -> tuple[bool, str | None]:
    """Can the API actually hand a job to Celery right now?

    Redis answering PING is not enough: the Celery transport can still refuse
    to publish (a library version clash did exactly that once). So this opens a
    real broker channel, the same path ``apply_async`` takes. Cached briefly so
    the health endpoint stays cheap.
    """

    global _broker_cache
    if settings.inline_worker:
        return True, None
    now = time.monotonic()
    with _broker_lock:
        if not force and _broker_cache and now - _broker_cache[0] < _BROKER_CACHE_SECONDS:
            return _broker_cache[1], _broker_cache[2]
    ok, reason = True, None
    try:
        from .celery_app import celery_app

        with celery_app.connection_for_write() as conn:
            conn.ensure_connection(max_retries=1, timeout=3)
            conn.default_channel  # noqa: B018 - opening the channel is the check
    except Exception as exc:  # noqa: BLE001
        ok, reason = False, f"{type(exc).__name__}: {exc}"[:300]
        logger.error("render queue check failed: %s", reason)
    with _broker_lock:
        _broker_cache = (time.monotonic(), ok, reason)
    return ok, reason


def worker_mode() -> str:
    return "inline" if settings.inline_worker else "celery"


def enqueue_asset(asset_id: str) -> str | None:
    """Schedule one asset for mutation and return the task id, if any."""

    if settings.inline_worker:
        future = _get_executor().submit(_run_guarded, asset_id)
        _pending[asset_id] = future
        return f"inline:{asset_id}"

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            result = process_asset.apply_async(args=[asset_id], queue="mutations")
            return result.id
        except Exception as exc:  # noqa: BLE001 - broker down or transport error
            last_exc = exc
            logger.error(
                "could not enqueue %s (attempt %s/3): %s: %s",
                asset_id, attempt + 1, type(exc).__name__, exc,
            )
            if attempt < 2:
                time.sleep(0.5 * (2**attempt))
    global _broker_cache
    with _broker_lock:
        _broker_cache = (time.monotonic(), False, f"{type(last_exc).__name__}: {last_exc}"[:300])
    get_store().update_asset(
        asset_id,
        status=JobStatus.FAILED,
        stage="failed",
        error="The render queue is unreachable right now. Press retry in a minute; if it keeps failing, Admin > Overview shows the reason.",
    )
    return None


def _run_guarded(asset_id: str) -> None:
    try:
        run_asset_job(asset_id, task_id=f"inline:{asset_id}")
    except Exception:  # noqa: BLE001
        logger.exception("inline worker crashed on %s", asset_id)
    finally:
        _pending.pop(asset_id, None)


def shutdown_inline_workers(wait: bool = True, timeout: float = 60.0) -> None:
    """Drain the inline thread pool.

    Tests call this before removing the storage root, so a render still in
    flight cannot fail on a directory that has just been deleted.
    """

    global _executor
    if _executor is None:
        return
    if wait:
        deadline = __import__("time").monotonic() + timeout
        for future in list(_pending.values()):
            remaining = deadline - __import__("time").monotonic()
            if remaining <= 0:
                break
            try:
                future.result(timeout=remaining)
            except Exception:  # noqa: BLE001 - we only care that it finished
                pass
    _executor.shutdown(wait=wait, cancel_futures=not wait)
    _executor = None
    _pending.clear()


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
