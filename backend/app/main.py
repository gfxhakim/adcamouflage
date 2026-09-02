"""AdCamouflage HTTP API."""

from __future__ import annotations

import asyncio
import logging
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .config import settings
from .ffmpeg import ffmpeg_available, ffmpeg_version
from .mutator import IMAGE_CONTAINERS, VIDEO_CONTAINERS
from .queue import cancel_asset, enqueue_asset, queue_depth, worker_mode
from .schemas import (
    PRESET_DEFAULTS,
    AssetJob,
    AssetKind,
    Batch,
    BatchCreated,
    BatchStatus,
    HealthReport,
    JobStatus,
    MutationOptions,
    Preset,
    UploadRejection,
    new_id,
)
from .security import require_api_key, sign_download, verify_download
from .storage import StorageError, classify, get_store, resolve_within, sanitize_filename

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s :: %(message)s",
)
logger = logging.getLogger("adcamouflage.api")

CHUNK_SIZE = 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    store = get_store()
    if not ffmpeg_available():
        logger.error(
            "ffmpeg/ffprobe were not found on PATH - mutation jobs will fail until they are installed."
        )
    if store.using_memory and not settings.inline_worker:
        logger.error(
            "Redis is unreachable while running in Celery mode; the API and workers cannot share job state."
        )
    removed = await asyncio.to_thread(store.purge_expired)
    if removed:
        logger.info("startup purge removed %s stale files", removed)
    yield


app = FastAPI(
    title="AdCamouflage API",
    version=__version__,
    description=(
        "Asset camouflage pipeline: micro-crop and resample geometry, inject temporal noise, "
        "stagger frame rates, shift audio pitch and strip every provenance tag from the container."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(StorageError)
async def _storage_error_handler(_: Request, exc: StorageError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled API error", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal error occurred while handling the request."},
    )


# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------


@app.get("/api/v1/health", response_model=HealthReport, tags=["meta"])
async def health() -> HealthReport:
    store = get_store()
    redis_ok = await asyncio.to_thread(lambda: store.redis_healthy)
    ffmpeg_ok = await asyncio.to_thread(ffmpeg_available)
    version = await asyncio.to_thread(ffmpeg_version) if ffmpeg_ok else None
    active = await asyncio.to_thread(store.count_active)
    healthy = ffmpeg_ok and (redis_ok or settings.inline_worker)
    return HealthReport(
        status="ok" if healthy else "degraded",
        version=__version__,
        environment=settings.environment,
        ffmpeg=ffmpeg_ok,
        ffmpeg_version=version,
        redis=redis_ok,
        worker_mode=worker_mode(),
        active_jobs=active,
        queue_depth=queue_depth(),
    )


@app.get("/api/v1/presets", tags=["meta"])
async def presets() -> dict[str, Any]:
    return {
        "presets": [
            {
                "id": preset.value,
                "label": preset.value.title(),
                "defaults": PRESET_DEFAULTS.get(preset, {}),
            }
            for preset in Preset
        ],
        "limits": {
            "max_upload_mb": settings.max_upload_mb,
            "max_batch_files": settings.max_batch_files,
            "max_video_seconds": settings.video_max_duration,
            "retention_hours": settings.retention_hours,
        },
        "formats": {
            "video": sorted(VIDEO_CONTAINERS),
            "image": sorted(IMAGE_CONTAINERS),
        },
    }


# ---------------------------------------------------------------------------
# batches
# ---------------------------------------------------------------------------


async def _persist_upload(upload: UploadFile, destination: Path) -> int:
    """Stream an upload to disk, aborting if it exceeds the configured cap."""

    import aiofiles

    written = 0
    try:
        async with aiofiles.open(destination, "wb") as handle:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise StorageError(f"file exceeds the {settings.max_upload_mb}MB limit")
                await handle.write(chunk)
    except StorageError:
        destination.unlink(missing_ok=True)
        raise
    except OSError as exc:
        destination.unlink(missing_ok=True)
        raise StorageError(f"could not write upload to disk: {exc}") from exc
    finally:
        await upload.close()
    return written


@app.post(
    "/api/v1/batches",
    response_model=BatchCreated,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    tags=["batches"],
)
async def create_batch(
    files: Annotated[list[UploadFile], File(description="One or more media assets to camouflage.")],
    options: Annotated[str | None, Form(description="JSON-encoded MutationOptions.")] = None,
) -> BatchCreated:
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one asset.")
    if len(files) > settings.max_batch_files:
        raise HTTPException(
            status_code=400,
            detail=f"A batch is limited to {settings.max_batch_files} files; received {len(files)}.",
        )

    try:
        parsed = MutationOptions.model_validate_json(options) if options else MutationOptions()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid options payload: {exc}") from exc

    resolved = parsed.resolved()
    batch = Batch(options=resolved)

    accepted: list[AssetJob] = []
    rejected: list[UploadRejection] = []
    store = get_store()

    for upload in files:
        original = sanitize_filename(upload.filename or "asset")
        kind = classify(original, upload.content_type)
        if kind is None:
            rejected.append(
                UploadRejection(filename=original, reason="Unsupported file type - upload a video or an image.")
            )
            await upload.close()
            continue

        asset_id = new_id("asset")
        suffix = Path(original).suffix.lower()
        stored_name = f"{asset_id}{suffix}"
        destination = resolve_within(settings.uploads_dir, stored_name)

        try:
            size = await _persist_upload(upload, destination)
        except StorageError as exc:
            rejected.append(UploadRejection(filename=original, reason=str(exc)))
            continue

        if size == 0:
            destination.unlink(missing_ok=True)
            rejected.append(UploadRejection(filename=original, reason="The file was empty."))
            continue

        for variant_index in range(resolved.variants):
            job = AssetJob(
                id=asset_id if variant_index == 0 else new_id("asset"),
                batch_id=batch.id,
                original_filename=original,
                stored_filename=stored_name,
                kind=kind,
                size_bytes=size,
                variant_index=variant_index,
                variants_total=resolved.variants,
            )
            store.save_asset(job)
            accepted.append(job)

    if not accepted:
        raise HTTPException(
            status_code=422,
            detail={"message": "No usable assets in this batch.", "rejected": [r.model_dump() for r in rejected]},
        )

    batch.asset_ids = [job.id for job in accepted]
    store.save_batch(batch)
    store.attach_assets(batch.id, batch.asset_ids)

    for job in accepted:
        task_id = await asyncio.to_thread(enqueue_asset, job.id)
        if task_id:
            store.update_asset(job.id, task_id=task_id)
            job.task_id = task_id

    logger.info("batch %s accepted %s assets (%s rejected)", batch.id, len(accepted), len(rejected))
    return BatchCreated(batch_id=batch.id, accepted=accepted, rejected=rejected, options=resolved)


def _summarise(batch: Batch, assets: list[AssetJob]) -> BatchStatus:
    total = len(assets)
    completed = sum(1 for a in assets if a.status is JobStatus.COMPLETED)
    failed = sum(1 for a in assets if a.status is JobStatus.FAILED)
    cancelled = sum(1 for a in assets if a.status is JobStatus.CANCELLED)
    progress = round(sum(a.progress for a in assets) / total, 2) if total else 0.0

    if total and completed + failed + cancelled == total:
        if completed:
            overall = JobStatus.COMPLETED
        elif failed:
            overall = JobStatus.FAILED
        else:
            overall = JobStatus.CANCELLED
    elif any(a.status is JobStatus.PROCESSING for a in assets):
        overall = JobStatus.PROCESSING
    else:
        overall = JobStatus.QUEUED

    archive_url = None
    if completed:
        archive_url = f"/api/v1/batches/{batch.id}/archive?token={sign_download(batch.id)}"

    return BatchStatus(
        batch=batch,
        assets=assets,
        status=overall,
        progress=progress,
        completed=completed,
        failed=failed,
        total=total,
        archive_url=archive_url,
    )


@app.get("/api/v1/batches/{batch_id}", response_model=BatchStatus, tags=["batches"])
async def get_batch(batch_id: str) -> BatchStatus:
    store = get_store()
    batch = store.get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found or expired.")
    asset_ids = batch.asset_ids or store.list_asset_ids(batch_id)
    assets = await asyncio.to_thread(store.get_assets, asset_ids)
    return _summarise(batch, assets)


@app.get("/api/v1/assets/{asset_id}", response_model=AssetJob, tags=["assets"])
async def get_asset(asset_id: str) -> AssetJob:
    asset = get_store().get_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found or expired.")
    return asset


@app.post("/api/v1/assets/{asset_id}/cancel", tags=["assets"], dependencies=[Depends(require_api_key)])
async def cancel(asset_id: str) -> dict[str, str]:
    if not await asyncio.to_thread(cancel_asset, asset_id):
        raise HTTPException(status_code=409, detail="This asset has already finished or does not exist.")
    return {"asset_id": asset_id, "status": JobStatus.CANCELLED.value}


def _output_filename(asset: AssetJob) -> str:
    """Human-friendly download name that keeps the mutated extension."""

    stem = Path(asset.original_filename).stem or "asset"
    suffix = Path(asset.output_filename or asset.original_filename).suffix or ".bin"
    marker = f"_v{asset.variant_index + 1}" if asset.variants_total > 1 else ""
    return f"{stem}{marker}_camouflaged{suffix}"


@app.get("/api/v1/assets/{asset_id}/download", tags=["assets"])
async def download_asset(
    asset_id: str,
    token: Annotated[str, Query(description="Signed download token.")],
) -> FileResponse:
    if not verify_download(token, asset_id):
        raise HTTPException(status_code=403, detail="This download link is invalid or has expired.")

    asset = get_store().get_asset(asset_id)
    if asset is None or asset.status is not JobStatus.COMPLETED or not asset.output_filename:
        raise HTTPException(status_code=404, detail="No mutated output is available for this asset.")

    path = resolve_within(settings.outputs_dir, asset.output_filename)
    if not path.exists():
        raise HTTPException(status_code=410, detail="The output file has been purged by the retention policy.")

    return FileResponse(
        path,
        filename=_output_filename(asset),
        media_type="application/octet-stream",
    )


def _build_archive(batch_id: str, assets: list[AssetJob], destination: Path) -> Path:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as archive:
        used: set[str] = set()
        for asset in assets:
            if asset.status is not JobStatus.COMPLETED or not asset.output_filename:
                continue
            source = resolve_within(settings.outputs_dir, asset.output_filename)
            if not source.exists():
                continue
            name = _output_filename(asset)
            counter = 1
            while name in used:
                stem, _, suffix = name.rpartition(".")
                name = f"{stem}_{counter}.{suffix}" if suffix else f"{name}_{counter}"
                counter += 1
            used.add(name)
            archive.write(source, arcname=name)

        manifest = [
            {
                "original": asset.original_filename,
                "output": _output_filename(asset),
                "status": asset.status.value,
                "applied": asset.applied,
                "metrics": asset.metrics,
                "error": asset.error,
            }
            for asset in assets
        ]
        import json

        archive.writestr(
            "camouflage-manifest.json",
            json.dumps(
                {
                    "batch_id": batch_id,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "assets": manifest,
                },
                indent=2,
            ),
        )
    return destination


@app.get("/api/v1/batches/{batch_id}/archive", tags=["batches"])
async def download_archive(
    batch_id: str,
    token: Annotated[str, Query(description="Signed download token.")],
    background: BackgroundTasks = None,  # type: ignore[assignment]
) -> FileResponse:
    if not verify_download(token, batch_id):
        raise HTTPException(status_code=403, detail="This download link is invalid or has expired.")

    store = get_store()
    batch = store.get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found or expired.")

    assets = await asyncio.to_thread(store.get_assets, batch.asset_ids or store.list_asset_ids(batch_id))
    if not any(a.status is JobStatus.COMPLETED for a in assets):
        raise HTTPException(status_code=409, detail="No assets in this batch have finished processing yet.")

    destination = settings.work_dir / f"{batch_id}.zip"
    await asyncio.to_thread(_build_archive, batch_id, assets, destination)

    if background is not None:
        background.add_task(destination.unlink, missing_ok=True)

    return FileResponse(
        destination,
        filename=f"adcamouflage_{batch_id}.zip",
        media_type="application/zip",
        background=background,
    )


@app.delete("/api/v1/batches/{batch_id}", tags=["batches"], dependencies=[Depends(require_api_key)])
async def delete_batch(batch_id: str) -> dict[str, Any]:
    store = get_store()
    batch = store.get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found or expired.")

    asset_ids = batch.asset_ids or store.list_asset_ids(batch_id)
    assets = await asyncio.to_thread(store.get_assets, asset_ids)
    removed = 0
    for asset in assets:
        if not asset.is_terminal:
            await asyncio.to_thread(cancel_asset, asset.id)
        for directory, name in (
            (settings.uploads_dir, asset.stored_filename),
            (settings.outputs_dir, asset.output_filename),
        ):
            if not name:
                continue
            path = resolve_within(directory, name)
            if path.exists():
                path.unlink(missing_ok=True)
                removed += 1
        store.backend.delete(f"adcam:asset:{asset.id}")

    store.backend.delete(f"adcam:batch:{batch_id}", f"adcam:batch:{batch_id}:assets")
    (settings.work_dir / f"{batch_id}.zip").unlink(missing_ok=True)
    return {"batch_id": batch_id, "deleted_files": removed}


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "AdCamouflage API", "version": __version__, "docs": "/api/docs"}
