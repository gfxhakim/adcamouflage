"""Thin, dependency-free wrapper around the ffmpeg/ffprobe binaries.

The wrapper adds three things the raw ``subprocess`` API does not give us:

* structured probing of container/stream metadata,
* incremental progress reporting parsed from ``-progress pipe:1``,
* deterministic cleanup and readable errors when a render fails.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from .config import settings

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]


class MediaError(RuntimeError):
    """Raised when ffmpeg/ffprobe cannot process an asset."""


@dataclass(slots=True)
class VideoStream:
    index: int
    codec: str
    width: int
    height: int
    fps: float
    pix_fmt: str | None = None
    rotation: int = 0
    nb_frames: int | None = None


@dataclass(slots=True)
class AudioStream:
    index: int
    codec: str
    sample_rate: int
    channels: int


@dataclass(slots=True)
class MediaInfo:
    path: Path
    duration: float
    size_bytes: int
    format_name: str
    video: VideoStream | None = None
    audio: AudioStream | None = None
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def has_video(self) -> bool:
        return self.video is not None

    @property
    def has_audio(self) -> bool:
        return self.audio is not None


def _parse_fraction(value: str | None, fallback: float = 0.0) -> float:
    if not value:
        return fallback
    if "/" in value:
        num, _, den = value.partition("/")
        try:
            numerator = float(num)
            denominator = float(den)
        except ValueError:
            return fallback
        if denominator == 0:
            return fallback
        return numerator / denominator
    try:
        return float(value)
    except ValueError:
        return fallback


def ffmpeg_available() -> bool:
    return shutil.which(settings.ffmpeg_binary) is not None and shutil.which(settings.ffprobe_binary) is not None


def ffmpeg_version() -> str | None:
    binary = shutil.which(settings.ffmpeg_binary)
    if not binary:
        return None
    try:
        result = subprocess.run(
            [binary, "-version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    first_line = result.stdout.splitlines()[0] if result.stdout else ""
    return first_line.strip() or None


def require_ffmpeg() -> None:
    if not ffmpeg_available():
        raise MediaError(
            "ffmpeg/ffprobe not found on PATH. Install ffmpeg (see README) or set "
            "ADCAM_FFMPEG_BINARY / ADCAM_FFPROBE_BINARY."
        )


def probe(path: Path) -> MediaInfo:
    """Return container and stream information for ``path``."""

    require_ffmpeg()
    command = [
        settings.ffprobe_binary,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120, check=False)
    except subprocess.TimeoutExpired as exc:  # pragma: no cover - depends on host
        raise MediaError(f"ffprobe timed out on {path.name}") from exc

    if result.returncode != 0:
        raise MediaError(f"ffprobe failed on {path.name}: {result.stderr.strip()[:400]}")

    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise MediaError(f"ffprobe returned malformed JSON for {path.name}") from exc

    fmt = payload.get("format") or {}
    streams = payload.get("streams") or []

    video: VideoStream | None = None
    audio: AudioStream | None = None

    for stream in streams:
        codec_type = stream.get("codec_type")
        if codec_type == "video" and video is None:
            # Cover art in an audio file is reported as a video stream; skip it.
            if stream.get("disposition", {}).get("attached_pic"):
                continue
            fps = _parse_fraction(stream.get("avg_frame_rate")) or _parse_fraction(
                stream.get("r_frame_rate"), 30.0
            )
            rotation = 0
            for side_data in stream.get("side_data_list", []) or []:
                if "rotation" in side_data:
                    try:
                        rotation = int(float(side_data["rotation"]))
                    except (TypeError, ValueError):
                        rotation = 0
            nb_frames = stream.get("nb_frames")
            video = VideoStream(
                index=int(stream.get("index", 0)),
                codec=str(stream.get("codec_name", "unknown")),
                width=int(stream.get("width") or 0),
                height=int(stream.get("height") or 0),
                fps=round(fps, 4) if fps else 30.0,
                pix_fmt=stream.get("pix_fmt"),
                rotation=rotation,
                nb_frames=int(nb_frames) if nb_frames and str(nb_frames).isdigit() else None,
            )
        elif codec_type == "audio" and audio is None:
            audio = AudioStream(
                index=int(stream.get("index", 0)),
                codec=str(stream.get("codec_name", "unknown")),
                sample_rate=int(_parse_fraction(stream.get("sample_rate"), 44100.0)),
                channels=int(stream.get("channels") or 2),
            )

    duration = _parse_fraction(fmt.get("duration"), 0.0)
    tags = {str(k): str(v) for k, v in (fmt.get("tags") or {}).items()}

    return MediaInfo(
        path=path,
        duration=duration,
        size_bytes=int(_parse_fraction(fmt.get("size"), float(path.stat().st_size if path.exists() else 0))),
        format_name=str(fmt.get("format_name", "")),
        video=video,
        audio=audio,
        tags=tags,
    )


def _pump_progress(
    process: subprocess.Popen[str],
    total_duration: float,
    on_progress: ProgressCallback | None,
    stage: str,
) -> None:
    """Translate ffmpeg's key=value progress stream into 0..1 fractions."""

    if process.stdout is None:
        return
    last_emitted = -1.0
    for line in process.stdout:
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key not in {"out_time_ms", "out_time_us"}:
            continue
        try:
            micros = float(value)
        except ValueError:
            continue
        if micros < 0 or total_duration <= 0:
            continue
        fraction = min(max(micros / 1_000_000.0 / total_duration, 0.0), 1.0)
        if on_progress and fraction - last_emitted >= 0.01:
            last_emitted = fraction
            try:
                on_progress(fraction, stage)
            except Exception:  # pragma: no cover - progress must never kill a render
                logger.debug("progress callback raised", exc_info=True)


def run_ffmpeg(
    args: Sequence[str],
    *,
    total_duration: float = 0.0,
    on_progress: ProgressCallback | None = None,
    stage: str = "encoding",
    timeout: int | None = None,
) -> None:
    """Run ffmpeg with ``args`` (without the binary name) and stream progress."""

    require_ffmpeg()
    command = [
        settings.ffmpeg_binary,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-progress",
        "pipe:1",
        *args,
    ]
    logger.debug("ffmpeg %s", " ".join(command))

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    # stdout carries the progress stream and stderr the diagnostics; both are
    # drained by dedicated threads so neither pipe can fill up and deadlock.
    # (Popen.communicate() must not be used here - it would consume stdout and
    # starve the progress reader.)
    stderr_chunks: list[str] = []

    def drain_stderr() -> None:
        if process.stderr is None:
            return
        for line in process.stderr:
            stderr_chunks.append(line)

    pump = threading.Thread(
        target=_pump_progress,
        args=(process, total_duration, on_progress, stage),
        daemon=True,
    )
    collector = threading.Thread(target=drain_stderr, daemon=True)
    pump.start()
    collector.start()

    try:
        returncode = process.wait(timeout=timeout or settings.job_timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.wait()
        raise MediaError("ffmpeg exceeded the configured job timeout") from exc
    finally:
        pump.join(timeout=10)
        collector.join(timeout=10)
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                try:
                    stream.close()
                except OSError:  # pragma: no cover - stream already gone
                    pass

    if returncode != 0:
        detail = "".join(stderr_chunks).strip().splitlines()
        message = detail[-1] if detail else f"exit code {returncode}"
        raise MediaError(f"ffmpeg failed: {message}")

    if on_progress:
        on_progress(1.0, stage)


def open_ffmpeg_writer(args: Sequence[str]) -> subprocess.Popen[bytes]:
    """Start an ffmpeg process that accepts raw frames on stdin."""

    require_ffmpeg()
    command = [
        settings.ffmpeg_binary,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        *args,
    ]
    logger.debug("ffmpeg (pipe) %s", " ".join(command))
    return subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
