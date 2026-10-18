"""Startup resilience for the database connection.

On Railway the api container can boot before its managed Postgres is ready, so
``_wait_for_database`` retries the first connection with backoff instead of
letting application startup crash-loop out. These tests drive that loop with a
fake engine so they stay fast and need no real database.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import OperationalError

from app import db


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, _stmt):
        return None


class _FakeEngine:
    """Fails its first ``fail_times`` connects, then succeeds."""

    def __init__(self, fail_times: int):
        self.fail_times = fail_times
        self.calls = 0

    def connect(self):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise OperationalError("SELECT 1", {}, Exception("not ready"))
        return _FakeConn()


@pytest.fixture(autouse=True)
def _fast_backoff(monkeypatch):
    # Don't actually sleep between attempts.
    monkeypatch.setattr(db.time, "sleep", lambda _s: None)


def test_wait_for_database_recovers_when_db_comes_up(monkeypatch):
    monkeypatch.setattr(db.settings, "database_url", "postgresql+psycopg://u:p@db/app")
    monkeypatch.setattr(db.settings, "db_connect_max_attempts", 5)
    engine = _FakeEngine(fail_times=3)

    db._wait_for_database(engine)  # must not raise

    assert engine.calls == 4  # three failures, then success


def test_wait_for_database_raises_after_exhausting_attempts(monkeypatch):
    monkeypatch.setattr(db.settings, "database_url", "postgresql+psycopg://u:p@db/app")
    monkeypatch.setattr(db.settings, "db_connect_max_attempts", 3)
    engine = _FakeEngine(fail_times=99)

    with pytest.raises(OperationalError):
        db._wait_for_database(engine)

    assert engine.calls == 3


def test_wait_for_database_skips_sqlite(monkeypatch):
    monkeypatch.setattr(db.settings, "database_url", "sqlite:////tmp/does-not-matter.db")
    engine = _FakeEngine(fail_times=99)

    db._wait_for_database(engine)  # returns immediately, no connect attempted

    assert engine.calls == 0
