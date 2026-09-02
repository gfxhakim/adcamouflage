"""Shared fixtures. Every test runs against an isolated storage root."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="adcam-tests-"))
os.environ.setdefault("ADCAM_STORAGE_ROOT", str(_TMP_ROOT))
os.environ.setdefault("ADCAM_INLINE_WORKER", "1")
# Point at a port nothing is listening on so the store exercises its fallback.
os.environ.setdefault("ADCAM_REDIS_URL", "redis://127.0.0.1:6399/15")
os.environ.setdefault("ADCAM_SECRET_KEY", "test-secret-key-for-signing-only")
os.environ.setdefault("ADCAM_INLINE_WORKER_CONCURRENCY", "2")

from app.config import settings  # noqa: E402
from app.ffmpeg import ffmpeg_available  # noqa: E402

requires_ffmpeg = pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg is not installed")


@pytest.fixture(scope="session", autouse=True)
def _storage_root():
    settings.ensure_dirs()
    yield
    shutil.rmtree(_TMP_ROOT, ignore_errors=True)


@pytest.fixture(scope="session")
def sample_video() -> Path:
    """A 3s 640x360 clip with a moving pattern and a tone, plus fake metadata."""

    path = _TMP_ROOT / "sample.mp4"
    if path.exists():
        return path
    subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest",
            "-metadata", "title=Original Campaign Cut",
            "-metadata", "comment=camera=SonyA7III;editor=Premiere",
            "-metadata", "artist=Acme Studios",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


@pytest.fixture(scope="session")
def silent_video() -> Path:
    path = _TMP_ROOT / "silent.mp4"
    if path.exists():
        return path
    subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


@pytest.fixture(scope="session")
def sample_image() -> Path:
    """A JPEG carrying EXIF that the pipeline is expected to erase."""

    import numpy as np
    import piexif
    from PIL import Image

    path = _TMP_ROOT / "sample.jpg"
    if path.exists():
        return path

    rng = np.random.default_rng(7)
    gradient = np.linspace(0, 255, 480, dtype=np.uint8)
    canvas = np.zeros((360, 480, 3), dtype=np.uint8)
    canvas[..., 0] = np.tile(gradient, (360, 1))
    canvas[..., 1] = np.tile(gradient[::-1], (360, 1))
    canvas[..., 2] = rng.integers(0, 255, size=(360, 480), dtype=np.uint8)
    Image.fromarray(canvas).save(path, quality=95)

    exif = {
        "0th": {
            piexif.ImageIFD.Make: b"Canon",
            piexif.ImageIFD.Model: b"EOS R5",
            piexif.ImageIFD.Software: b"Adobe Photoshop 25.0",
        },
        "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2024:01:01 10:00:00"},
        "GPS": {},
        "1st": {},
        "thumbnail": None,
    }
    piexif.insert(piexif.dump(exif), str(path))
    return path
