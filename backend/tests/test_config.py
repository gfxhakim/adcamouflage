"""Settings parsing tests.

These exercise Settings() against real environment variables rather than
constructor kwargs, because that is the path a deployed process actually takes
and the one where pydantic-settings applies its own JSON pre-parsing.
"""

from __future__ import annotations

import pytest

from app.config import Settings


@pytest.fixture
def env(monkeypatch):
    def _set(**values: str):
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        return Settings()

    return _set


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # The form documented in .env.example and used by docker-compose.
        ("http://localhost:3000,http://127.0.0.1:3000", ["http://localhost:3000", "http://127.0.0.1:3000"]),
        ("http://solo.test", ["http://solo.test"]),
        (" http://a.test , http://b.test ", ["http://a.test", "http://b.test"]),
        ('["http://a.test","http://b.test"]', ["http://a.test", "http://b.test"]),
        ("", []),
    ],
)
def test_cors_origins_accepts_env_forms(env, raw, expected):
    assert env(ADCAM_CORS_ORIGINS=raw).cors_origins == expected


def test_numeric_and_boolean_settings_from_env(env):
    settings = env(
        ADCAM_MAX_UPLOAD_MB="512",
        ADCAM_INLINE_WORKER="true",
        ADCAM_RETENTION_HOURS="6",
    )
    assert settings.max_upload_mb == 512
    assert settings.max_upload_bytes == 512 * 1024 * 1024
    assert settings.inline_worker is True
    assert settings.retention_hours == 6


def test_storage_paths_derive_from_root(env, tmp_path):
    settings = env(ADCAM_STORAGE_ROOT=str(tmp_path / "media"))
    assert settings.uploads_dir == tmp_path / "media" / "uploads"
    assert settings.outputs_dir == tmp_path / "media" / "outputs"
    assert settings.work_dir == tmp_path / "media" / "work"

    settings.ensure_dirs()
    assert settings.uploads_dir.is_dir()
    assert settings.outputs_dir.is_dir()
    assert settings.work_dir.is_dir()


def test_broker_falls_back_to_redis_url(env):
    settings = env(ADCAM_REDIS_URL="redis://cache:6379/4")
    assert settings.broker_url == "redis://cache:6379/4"
    assert settings.result_backend == "redis://cache:6379/4"


def test_explicit_broker_overrides_redis_url(env):
    settings = env(
        ADCAM_REDIS_URL="redis://cache:6379/4",
        ADCAM_CELERY_BROKER_URL="redis://broker:6379/1",
        ADCAM_CELERY_RESULT_BACKEND="redis://results:6379/2",
    )
    assert settings.broker_url == "redis://broker:6379/1"
    assert settings.result_backend == "redis://results:6379/2"


def test_env_example_is_loadable(env, monkeypatch):
    """Every ADCAM_* line in .env.example must actually parse."""

    import pathlib

    example = pathlib.Path(__file__).resolve().parents[2] / ".env.example"
    applied = 0
    for line in example.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if not key.startswith("ADCAM_"):
            continue
        monkeypatch.setenv(key, value)
        applied += 1

    assert applied > 5, "expected .env.example to set several ADCAM_ variables"
    settings = Settings()
    assert settings.cors_origins
    assert settings.max_upload_mb > 0
