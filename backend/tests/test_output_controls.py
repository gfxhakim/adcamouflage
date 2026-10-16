"""Tests for the creative / output-fidelity controls.

Covers the three workspace additions that are output-quality only and do not
touch the camouflage layers:

* multiple brand overlays composited in one pass,
* a user-chosen poster/thumbnail frame,
* quality tier, keep-resolution and low-res upscaling.
"""

from __future__ import annotations

import json
import random
import subprocess

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import settings
from app.ffmpeg import MediaInfo, VideoStream, probe, settings as _ffsettings  # noqa: F401
from app.main import app
from app.mutator import _even, build_multi_overlay_filtergraph, build_plan, mutate
from app.schemas import (
    UPSCALE_HEIGHTS,
    AssetKind,
    MutationOptions,
    OverlayPosition,
    OverlaySettings,
    Preset,
    QualityTier,
)

from .conftest import requires_ffmpeg


# --------------------------------------------------------------------------
# quality + resolution (unit, no ffmpeg)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tier", "crf"),
    [(QualityTier.HIGH, 18), (QualityTier.BALANCED, 21), (QualityTier.COMPACT, 26)],
)
def test_quality_tier_pins_crf(tier, crf):
    plan = build_plan(
        MutationOptions(quality=tier).resolved(), random.Random(1), width=640, height=360
    )
    assert plan.crf == crf


def test_auto_quality_leaves_crf_randomised():
    """AUTO must preserve the engine's own rate-control (crf stays in 19..24)."""

    plan = build_plan(MutationOptions().resolved(), random.Random(1), width=640, height=360)
    assert 19 <= plan.crf <= 24


def test_keep_resolution_delivers_source_dimensions():
    plan = build_plan(
        MutationOptions(keep_resolution=True, micro_crop=True).resolved(),
        random.Random(3),
        width=640,
        height=360,
    )
    # Micro-crop still shaves pixels (so the resample runs) but the delivered
    # frame is scaled back to the source size.
    assert plan.crop_x and plan.crop_y
    assert (plan.out_width, plan.out_height) == (640, 360)


def test_upscale_lifts_a_low_res_source():
    plan = build_plan(
        MutationOptions(upscale_to=720).resolved(), random.Random(1), width=320, height=240
    )
    assert plan.out_height == 720
    assert plan.out_width == _even(round(320 * 720 / 240))


def test_upscale_never_downscales_a_taller_source():
    plan = build_plan(
        MutationOptions(upscale_to=720).resolved(), random.Random(1), width=1920, height=1080
    )
    # 1080 >= 720, so the output keeps its own (crop-derived) dimensions.
    assert plan.out_height != 720


def test_upscale_to_rejects_unknown_heights():
    with pytest.raises(ValueError):
        MutationOptions(upscale_to=999)
    for height in UPSCALE_HEIGHTS:
        assert MutationOptions(upscale_to=height).upscale_to == height


# --------------------------------------------------------------------------
# multiple overlays
# --------------------------------------------------------------------------


def test_multi_overlay_graph_chains_each_layer():
    from pathlib import Path

    plan = build_plan(MutationOptions().resolved(), random.Random(1), width=640, height=360)
    plan.out_width, plan.out_height = 640, 360
    info = MediaInfo(
        path=Path("x"),
        duration=3.0,
        size_bytes=0,
        format_name="mp4",
        video=VideoStream(index=0, codec="h264", width=640, height=360, fps=30.0),
    )
    layers = [
        OverlaySettings(enabled=True, position=OverlayPosition.TOP_LEFT, image_filename="a.png"),
        OverlaySettings(enabled=True, position=OverlayPosition.BOTTOM_RIGHT, image_filename="b.png"),
    ]
    graph = build_multi_overlay_filtergraph(
        layers, plan, info, pre=[], post=[], duration=3.0, first_input=1
    )
    assert graph.count("overlay=") == 2
    assert "[1:v]" in graph and "[2:v]" in graph
    assert "[base]" in graph and "[step0]" in graph and "[composited]" in graph and "[vout]" in graph


def _store_badge(name: str, rgba) -> str:
    settings.ensure_dirs()
    image = Image.new("RGBA", (200, 100), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle([0, 0, 199, 99], radius=10, fill=rgba)
    image.save(settings.uploads_dir / name)
    return name


def _corner_fraction(path, bgr, corner: str) -> float:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    h, w = image.shape[:2]
    if corner == "top_left":
        region = image[: h // 2, : w // 2]
    else:
        region = image[h // 2 :, w // 2 :]
    target = np.array(bgr, dtype=np.int16)
    return float((np.abs(region.astype(np.int16) - target).sum(axis=2) < 90).mean())


def test_two_overlays_land_in_their_own_corners(sample_image, tmp_path):
    red = _store_badge("multi_red.png", (255, 0, 0, 255))  # RGBA
    green = _store_badge("multi_green.png", (0, 255, 0, 255))
    options = MutationOptions(
        preset=Preset.BALANCED,
        overlays=[
            OverlaySettings(
                enabled=True, position=OverlayPosition.TOP_LEFT, scale_percent=40,
                offset_x=5, offset_y=5, image_filename=red,
            ),
            OverlaySettings(
                enabled=True, position=OverlayPosition.BOTTOM_RIGHT, scale_percent=40,
                offset_x=5, offset_y=5, image_filename=green,
            ),
        ],
    ).resolved()
    report = mutate(sample_image, tmp_path / "multi.jpg", AssetKind.IMAGE, options, seed=5)
    # Red badge (BGR 0,0,255) top-left; green badge (BGR 0,255,0) bottom-right.
    assert _corner_fraction(report.output_path, (0, 0, 255), "top_left") > 0.02
    assert _corner_fraction(report.output_path, (0, 255, 0), "bottom_right") > 0.02
    assert sum("image overlay" in line for line in report.applied) == 2


# --------------------------------------------------------------------------
# poster frame
# --------------------------------------------------------------------------


@requires_ffmpeg
def test_poster_frame_is_extracted_and_embedded(sample_video, tmp_path):
    options = MutationOptions(preset=Preset.STEALTH).resolved()
    options.poster.enabled = True
    options.poster.timestamp = 1.0
    report = mutate(sample_video, tmp_path / "poster.mp4", AssetKind.VIDEO, options, seed=5)

    assert report.poster_filename == "poster.poster.jpg"
    sidecar = report.output_path.with_name(report.poster_filename)
    assert sidecar.exists() and sidecar.stat().st_size > 0
    assert Image.open(sidecar).size[0] > 0  # a decodable JPEG

    # mp4 cover art is embedded as an attached_pic stream.
    probe_json = subprocess.run(
        [settings.ffprobe_binary, "-v", "error", "-print_format", "json",
         "-show_streams", str(report.output_path)],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(probe_json.stdout)["streams"]
    assert any(s.get("disposition", {}).get("attached_pic") for s in streams), "cover art not embedded"
    # The real video stream still decodes.
    assert probe(report.output_path).video is not None


@requires_ffmpeg
def test_no_poster_when_disabled(sample_video, tmp_path):
    report = mutate(
        sample_video, tmp_path / "nop.mp4", AssetKind.VIDEO,
        MutationOptions(preset=Preset.STEALTH).resolved(), seed=5,
    )
    assert report.poster_filename is None


@requires_ffmpeg
def test_keep_resolution_end_to_end(silent_video, tmp_path):
    options = MutationOptions(preset=Preset.BALANCED, keep_resolution=True).resolved()
    report = mutate(silent_video, tmp_path / "keep.mp4", AssetKind.VIDEO, options, seed=5)
    assert report.metrics["source_resolution"] == report.metrics["output_resolution"]


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


@pytest.fixture
def signed_in_client():
    from app.db import init_db

    init_db()
    client = TestClient(app)
    credentials = {"email": "controls@example.com", "password": "correct-horse-battery"}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def _badge_bytes() -> bytes:
    from io import BytesIO

    image = Image.new("RGBA", (120, 60), (0, 140, 255, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_api_accepts_multiple_overlays(signed_in_client, sample_image):
    options = {
        "preset": "balanced",
        "overlays": [
            {"enabled": True, "position": "top_left", "scale_percent": 25},
            {"enabled": True, "position": "bottom_right", "scale_percent": 25},
        ],
    }
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[
            ("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg")),
            ("overlay_images", ("a.png", _badge_bytes(), "image/png")),
            ("overlay_images", ("b.png", _badge_bytes(), "image/png")),
        ],
        data={"options": json.dumps(options)},
    )
    assert response.status_code == 202, response.text
    overlays = response.json()["options"]["overlays"]
    assert len(overlays) == 2
    assert all(layer["image_filename"] for layer in overlays)


def test_api_rejects_overlay_count_mismatch(signed_in_client, sample_image):
    options = {"overlays": [{"enabled": True}, {"enabled": True}]}
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[
            ("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg")),
            ("overlay_images", ("a.png", _badge_bytes(), "image/png")),
        ],
        data={"options": json.dumps(options)},
    )
    assert response.status_code == 422
    assert "one per layer" in response.json()["detail"].lower()


def test_api_echoes_output_controls(signed_in_client, sample_image):
    options = {
        "preset": "balanced",
        "quality": "high",
        "keep_resolution": True,
        "poster": {"enabled": True, "timestamp": 2.5},
    }
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg"))],
        data={"options": json.dumps(options)},
    )
    assert response.status_code == 202, response.text
    echoed = response.json()["options"]
    assert echoed["quality"] == "high"
    assert echoed["keep_resolution"] is True
    assert echoed["poster"]["enabled"] is True and echoed["poster"]["timestamp"] == 2.5


def test_api_rejects_invalid_upscale(signed_in_client, sample_image):
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg"))],
        data={"options": json.dumps({"upscale_to": 999})},
    )
    assert response.status_code == 422
