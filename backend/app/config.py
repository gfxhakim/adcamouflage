"""Runtime configuration for the AdCamouflage backend.

Every value can be overridden through environment variables (or a local
``.env`` file) so the same image runs unchanged in dev, staging and prod.
"""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        env_prefix="ADCAM_",
        extra="ignore",
    )

    # --- service identity -------------------------------------------------
    app_name: str = "AdCamouflage"
    environment: str = "development"
    debug: bool = False

    # --- storage ----------------------------------------------------------
    storage_root: Path = Field(default=Path("/tmp/adcamouflage"))
    retention_hours: int = 24
    max_upload_mb: int = 2048
    max_batch_files: int = 25

    # --- redis / celery ---------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    # When true the API executes mutation jobs on a local thread pool instead
    # of handing them to Celery. Useful for laptops, CI and smoke tests.
    inline_worker: bool = False
    inline_worker_concurrency: int = 2

    # --- security ---------------------------------------------------------
    # Signing key for download tokens. Generated per-process when unset, which
    # is fine for a single dev server but MUST be pinned in production so the
    # API and any replica agree on token signatures.
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    download_token_ttl: int = 3600
    api_key: str | None = None
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    # --- media engine -----------------------------------------------------
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    ffmpeg_threads: int = 0  # 0 => let ffmpeg pick
    job_timeout_seconds: int = 60 * 45
    video_max_duration: int = 60 * 30

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("storage_root", mode="before")
    @classmethod
    def _expand_path(cls, value: object) -> object:
        if isinstance(value, str):
            return Path(os.path.expanduser(value))
        return value

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def uploads_dir(self) -> Path:
        return self.storage_root / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.storage_root / "outputs"

    @property
    def work_dir(self) -> Path:
        return self.storage_root / "work"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def ensure_dirs(self) -> None:
        for path in (self.uploads_dir, self.outputs_dir, self.work_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
