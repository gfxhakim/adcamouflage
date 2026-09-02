"""Pydantic models shared by the API, the queue and the mutation engine."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class AssetKind(str, Enum):
    VIDEO = "video"
    IMAGE = "image"


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


class Preset(str, Enum):
    """Named intensity profiles.

    ``stealth`` keeps the asset visually identical to the human eye while still
    breaking perceptual hashes; ``nuclear`` maximises divergence and accepts a
    visible difference in exchange.
    """

    STEALTH = "stealth"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"
    NUCLEAR = "nuclear"
    CUSTOM = "custom"


class MutationOptions(BaseModel):
    """User-facing knobs for a single batch."""

    preset: Preset = Preset.BALANCED

    # Intensity is a 0..100 dial; presets seed it but the user can override.
    intensity: int = Field(default=45, ge=0, le=100)

    micro_crop: bool = True
    frame_rate_stagger: bool = True
    noise_injection: bool = True
    color_drift: bool = True
    audio_mutation: bool = True
    strip_metadata: bool = True
    deep_scramble: bool = False
    mirror: bool = False
    temporal_trim: bool = True

    target_fps: float | None = Field(default=None, gt=1, le=240)
    audio_pitch_ratio: float | None = Field(default=None, ge=0.8, le=1.25)
    output_format: str | None = Field(default=None)

    # Deterministic runs are handy for regression tests and for re-creating a
    # variant a customer liked. ``None`` means "fresh entropy per asset".
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)

    # Number of distinct mutated copies to emit per uploaded asset.
    variants: int = Field(default=1, ge=1, le=5)

    @field_validator("output_format")
    @classmethod
    def _normalise_format(cls, value: str | None) -> str | None:
        if not value:
            return None
        cleaned = value.strip().lower().lstrip(".")
        allowed = {"mp4", "mov", "webm", "mkv", "jpg", "jpeg", "png", "webp"}
        if cleaned not in allowed:
            raise ValueError(f"unsupported output format: {value}")
        return cleaned

    def resolved(self) -> "MutationOptions":
        """Apply preset defaults for anything the caller did not pin."""

        if self.preset is Preset.CUSTOM:
            return self.model_copy(deep=True)

        defaults = PRESET_DEFAULTS[self.preset]
        data = self.model_dump()
        fields_set = self.model_fields_set
        for key, value in defaults.items():
            if key not in fields_set:
                data[key] = value
        return MutationOptions.model_validate(data)


PRESET_DEFAULTS: dict[Preset, dict[str, Any]] = {
    Preset.STEALTH: {
        "intensity": 22,
        "micro_crop": True,
        "frame_rate_stagger": True,
        "noise_injection": True,
        "color_drift": True,
        "audio_mutation": True,
        "strip_metadata": True,
        "deep_scramble": False,
        "mirror": False,
        "temporal_trim": True,
    },
    Preset.BALANCED: {
        "intensity": 48,
        "micro_crop": True,
        "frame_rate_stagger": True,
        "noise_injection": True,
        "color_drift": True,
        "audio_mutation": True,
        "strip_metadata": True,
        "deep_scramble": False,
        "mirror": False,
        "temporal_trim": True,
    },
    Preset.AGGRESSIVE: {
        "intensity": 72,
        "micro_crop": True,
        "frame_rate_stagger": True,
        "noise_injection": True,
        "color_drift": True,
        "audio_mutation": True,
        "strip_metadata": True,
        "deep_scramble": True,
        "mirror": False,
        "temporal_trim": True,
    },
    Preset.NUCLEAR: {
        "intensity": 92,
        "micro_crop": True,
        "frame_rate_stagger": True,
        "noise_injection": True,
        "color_drift": True,
        "audio_mutation": True,
        "strip_metadata": True,
        "deep_scramble": True,
        "mirror": True,
        "temporal_trim": True,
    },
}


class AssetJob(BaseModel):
    """State of one uploaded asset as it moves through the pipeline."""

    id: str = Field(default_factory=lambda: new_id("asset"))
    batch_id: str
    original_filename: str
    stored_filename: str
    kind: AssetKind
    size_bytes: int
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    stage: str = "queued"
    variant_index: int = 0
    variants_total: int = 1
    task_id: str | None = None
    output_filename: str | None = None
    output_size_bytes: int | None = None
    download_url: str | None = None
    error: str | None = None
    applied: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


class Batch(BaseModel):
    id: str = Field(default_factory=lambda: new_id("batch"))
    options: MutationOptions
    asset_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def expires_at_hint(self) -> datetime:
        return self.created_at


class BatchStatus(BaseModel):
    batch: Batch
    assets: list[AssetJob]
    status: JobStatus
    progress: float
    completed: int
    failed: int
    total: int
    archive_url: str | None = None


class UploadRejection(BaseModel):
    filename: str
    reason: str


class BatchCreated(BaseModel):
    batch_id: str
    accepted: list[AssetJob]
    rejected: list[UploadRejection] = Field(default_factory=list)
    options: MutationOptions


class HealthReport(BaseModel):
    status: str
    version: str
    environment: str
    ffmpeg: bool
    ffmpeg_version: str | None = None
    redis: bool
    worker_mode: str
    active_jobs: int
    queue_depth: int
