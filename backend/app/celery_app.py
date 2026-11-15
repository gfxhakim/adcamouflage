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
        },
        "send-billing-reminders": {
            "task": "app.tasks.send_billing_reminders",
            # Hourly, not daily: beat restarts on every deploy and an interval
            # schedule starts counting again, so a daily one could never fire.
            # Each reminder is marked once sent, so running often is safe.
            "schedule": 3600.0,
        },
        "send-group-emails": {
            "task": "app.tasks.send_group_emails",
            # Each run sends for at most ~100s, one email at a time, and stops
            # at the daily cap; the next run carries on where it left off.
            "schedule": 120.0,
        },
        "scan-usdt-payments": {
            "task": "app.tasks.scan_usdt_payments",
            # Customers wait on the pay page; it also triggers a scan (at most
            # every 15 s) while it is open, so this is the fallback.
            "schedule": 60.0,
        },
        "open-waiting-support-tickets": {
            "task": "app.tasks.open_waiting_support_tickets",
            "schedule": 120.0,
        },
    },
)
