"""Celery application used by the render workers."""

from __future__ import annotations

from celery import Celery

from .config import settings

celery_app = Celery(
    "adcamouflage",
    broker=settings.broker_url,
    backend=settings.result_backend,
    include=["app.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=24,
    result_expires=max(3600, settings.retention_hours * 3600),
    task_soft_time_limit=settings.job_timeout_seconds,
    task_time_limit=settings.job_timeout_seconds + 120,
    broker_connection_retry_on_startup=True,
    task_default_queue="mutations",
    beat_schedule={
        "purge-expired-assets": {
            "task": "app.tasks.purge_expired_assets",
            "schedule": 900.0,
        }
    },
)
