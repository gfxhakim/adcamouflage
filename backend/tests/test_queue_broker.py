"""The Celery transport must accept the installed redis-py.

kombu 5.7 started refusing redis-py < 6.1, which made every enqueue fail with
"render queue unreachable" while Redis itself was fine. This pins that down.
"""

from __future__ import annotations

import types

import redis
from kombu.transport import redis as kombu_redis


def test_kombu_redis_transport_accepts_installed_redis_py():
    client = kombu_redis.Channel._get_client(types.SimpleNamespace(global_keyprefix=""))
    assert client is redis.Redis


def test_broker_status_reports_failure_without_raising(monkeypatch):
    from app import queue
    from app.config import settings

    monkeypatch.setattr(settings, "inline_worker", False)
    monkeypatch.setattr(settings, "celery_broker_url", "redis://127.0.0.1:1/0")
    monkeypatch.setattr(queue, "_broker_cache", None)

    from app.celery_app import celery_app

    monkeypatch.setattr(celery_app.conf, "broker_url", "redis://127.0.0.1:1/0")
    ok, reason = queue.broker_status(force=True)
    assert ok is False
    assert reason
