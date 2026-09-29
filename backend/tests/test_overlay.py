"""Image-overlay tests.

The timing modes are checked by decoding actual frames and looking for the
overlay's colour, rather than by trusting the filter string.
"""

from __future__ import annotations

import json
import subprocess

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import settings
from app.ffmpeg import probe
from app.main import app
from app.mutator import (
    _still_overlay_origin,
    mutate,
    overlay_enable_expression,
    overlay_position_expressions,
)
from app.schemas import (
    AssetKind,
    FrameRange,
    MutationOptions,
    OverlayMode,
    OverlayPosition,
    OverlaySettings,
    Preset,
)

from .conftest import requires_ffmpeg

# The overlay is painted in a colour nothing in the test pattern uses, so its
# presence in a frame is unambiguous.
BADGE_BGR = (0, 140, 255)  # OpenCV order
BADGE_RGBA = (255, 140, 0, 255)


@pytest.fixture(scope="module")
def badge(tmp_path_factory):
    path = tmp_path_factory.mktemp("overlay") / "badge.png"
    image = Image.new("RGBA", (300, 150), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle([0, 0, 299, 149], radius=20, fill=BADGE_RGBA)
    image.save(path)
    return path


@pytest.fixture(scope="module")
def baseline(sample_video, tmp_path_factory):
    """Badge-colour share in a render with no overlay.

    The synthetic test pattern already contains pixels close to the badge
    colour, so "is the overlay present" has to be judged against this floor
    rather than against zero.
    """

    output = tmp_path_factory.mktemp("baseline") / "control.mp4"
    report = mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        MutationOptions(preset=Preset.BALANCED).resolved(),
        seed=5,
    )
    samples = [_badge_fraction(report.output_path, t) for t in (0.3, 1.2, 2.2)]
    return max(samples)


@pytest.fixture(scope="module")
def stored_badge(badge):
    """The overlay as the engine sees it: a file inside the uploads dir."""

    settings.ensure_dirs()
    target = settings.uploads_dir / "test_badge.png"
    target.write_bytes(badge.read_bytes())
    return target


def _options(**overlay_kwargs) -> MutationOptions:
    return MutationOptions(
        preset=Preset.BALANCED,
        overlay=OverlaySettings(**overlay_kwargs),
    ).resolved()


def _badge_fraction(path, timestamp: float) -> float:
    """Share of pixels close to the badge colour in the frame at `timestamp`."""

    capture = cv2.VideoCapture(str(path))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = capture.read()
        if not ok:
            return 0.0
        target = np.array(BADGE_BGR, dtype=np.int16)
        distance = np.abs(frame.astype(np.int16) - target).sum(axis=2)
        return float((distance < 90).mean())
    finally:
        capture.release()


# --------------------------------------------------------------------------
# expression builders
# --------------------------------------------------------------------------


def test_always_mode_has_no_enable_expression():
    settings_ = OverlaySettings(enabled=True, mode=OverlayMode.ALWAYS)
    assert overlay_enable_expression(settings_, 30.0, 10.0) is None


def test_intro_expression_is_clamped_to_the_clip():
    settings_ = OverlaySettings(enabled=True, mode=OverlayMode.INTRO, intro_seconds=30)
    assert overlay_enable_expression(settings_, 30.0, 4.0) == "between(t,0,4.000)"


def test_frame_ranges_become_timestamps():
    """Frames are converted with the source fps, so a changed output fps cannot
    shift the window the user asked for."""

    settings_ = OverlaySettings(
        enabled=True,
        mode=OverlayMode.RANGES,
        ranges=[FrameRange(start_frame=0, end_frame=29), FrameRange(start_frame=60, end_frame=89)],
    )
    expression = overlay_enable_expression(settings_, 30.0, 10.0)
    assert expression == "between(t,0.000,1.000)+between(t,2.000,3.000)"


def test_ranges_are_shifted_by_the_temporal_trim():
    """The trim seeks into the source, so output t=0 is source t=trim_head.
    Without compensating, picked frames would land a few frames early."""

    settings_ = OverlaySettings(
        enabled=True, mode=OverlayMode.RANGES, ranges=[FrameRange(start_frame=60, end_frame=89)]
    )
    untrimmed = overlay_enable_expression(settings_, 30.0, 10.0, 0.0)
    trimmed = overlay_enable_expression(settings_, 30.0, 10.0, 0.5)
    assert untrimmed == "between(t,2.000,3.000)"
    assert trimmed == "between(t,1.500,2.500)"


def test_a_range_starting_before_the_trim_is_clamped_to_zero():
    settings_ = OverlaySettings(
        enabled=True, mode=OverlayMode.RANGES, ranges=[FrameRange(start_frame=0, end_frame=29)]
    )
    assert overlay_enable_expression(settings_, 30.0, 10.0, 0.5) == "between(t,0.000,0.500)"


def test_ranges_beyond_the_clip_are_dropped():
    settings_ = OverlaySettings(
        enabled=True, mode=OverlayMode.RANGES, ranges=[FrameRange(start_frame=9000, end_frame=9100)]
    )
    # Nothing visible beats silently showing it for the whole clip.
    assert overlay_enable_expression(settings_, 30.0, 4.0) == "0"


@pytest.mark.parametrize(
    ("position", "expected_x", "expected_y"),
    [
        (OverlayPosition.TOP_LEFT, "10", "20"),
        (OverlayPosition.TOP_RIGHT, "W-w-(10)", "20"),
        (OverlayPosition.BOTTOM_LEFT, "10", "H-h-(20)"),
        (OverlayPosition.BOTTOM_RIGHT, "W-w-(10)", "H-h-(20)"),
        (OverlayPosition.CENTER, "(W-w)/2", "(H-h)/2"),
        (OverlayPosition.CUSTOM, "10", "20"),
    ],
)
def test_position_expressions(position, expected_x, expected_y):
    settings_ = OverlaySettings(enabled=True, position=position, offset_x=10, offset_y=20)
    assert overlay_position_expressions(settings_) == (expected_x, expected_y)


@pytest.mark.parametrize(
    ("position", "expected"),
    [
        (OverlayPosition.TOP_LEFT, (10, 20)),
        (OverlayPosition.BOTTOM_RIGHT, (1000 - 100 - 10, 500 - 50 - 20)),
        (OverlayPosition.CENTER, ((1000 - 100) // 2, (500 - 50) // 2)),
        (OverlayPosition.CUSTOM, (10, 20)),
    ],
)
def test_still_overlay_origin_matches_video_anchors(position, expected):
    settings_ = OverlaySettings(enabled=True, position=position, offset_x=10, offset_y=20)
    assert _still_overlay_origin(settings_, 1000, 500, 100, 50) == expected


def test_ranges_mode_requires_at_least_one_range():
    with pytest.raises(ValueError):
        OverlaySettings(enabled=True, mode=OverlayMode.RANGES, ranges=[])


def test_a_backwards_range_is_rejected():
    with pytest.raises(ValueError):
        FrameRange(start_frame=90, end_frame=10)


# --------------------------------------------------------------------------
# rendered output
# --------------------------------------------------------------------------


@requires_ffmpeg
def test_overlay_is_present_on_every_frame_in_always_mode(sample_video, stored_badge, baseline, tmp_path):
    output = tmp_path / "always.mp4"
    report = mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        _options(enabled=True, mode=OverlayMode.ALWAYS, scale_percent=30, image_filename=stored_badge.name),
        seed=5,
    )
    for timestamp in (0.3, 1.2, 2.2):
        share = _badge_fraction(report.output_path, timestamp)
        assert share > baseline * 5, f"missing at {timestamp}s ({share:.4f} vs floor {baseline:.4f})"
    assert any("image overlay" in line for line in report.applied)


@requires_ffmpeg
def test_intro_mode_shows_then_hides(sample_video, stored_badge, baseline, tmp_path):
    output = tmp_path / "intro.mp4"
    report = mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        _options(
            enabled=True,
            mode=OverlayMode.INTRO,
            intro_seconds=1.0,
            scale_percent=30,
            image_filename=stored_badge.name,
        ),
        seed=5,
    )
    assert _badge_fraction(report.output_path, 0.3) > baseline * 5, "overlay missing during the intro"
    assert _badge_fraction(report.output_path, 2.2) <= baseline * 1.5, "overlay still visible after the intro"


@requires_ffmpeg
def test_custom_ranges_toggle_the_overlay(sample_video, stored_badge, baseline, tmp_path):
    """Source is 30fps: frames 0-14 is 0.0-0.5s, frames 60-74 is 2.0-2.5s."""

    output = tmp_path / "ranges.mp4"
    report = mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        _options(
            enabled=True,
            mode=OverlayMode.RANGES,
            ranges=[FrameRange(start_frame=0, end_frame=14), FrameRange(start_frame=60, end_frame=74)],
            scale_percent=30,
            image_filename=stored_badge.name,
        ),
        seed=5,
    )
    assert _badge_fraction(report.output_path, 0.2) > baseline * 5, "missing in the first range"
    assert _badge_fraction(report.output_path, 1.2) <= baseline * 1.5, "visible in the gap between ranges"
    assert _badge_fraction(report.output_path, 2.2) > baseline * 5, "missing in the second range"


@requires_ffmpeg
def test_overlay_does_not_break_audio_or_duration(sample_video, stored_badge, tmp_path):
    source = probe(sample_video)
    report = mutate(
        sample_video,
        tmp_path / "audio.mp4",
        AssetKind.VIDEO,
        _options(enabled=True, scale_percent=25, image_filename=stored_badge.name),
        seed=5,
    )
    result = probe(report.output_path)
    assert result.has_audio, "the overlay path dropped the audio stream"
    # -loop makes the overlay input infinite; -shortest must stop the output
    # at the end of the video rather than running forever.
    assert 0.5 * source.duration < result.duration <= source.duration + 0.2


@requires_ffmpeg
def test_overlay_still_strips_metadata(sample_video, stored_badge, tmp_path):
    report = mutate(
        sample_video,
        tmp_path / "clean.mp4",
        AssetKind.VIDEO,
        _options(enabled=True, scale_percent=25, image_filename=stored_badge.name),
        seed=5,
    )
    data = report.output_path.read_bytes()
    for signature in (b"x264", b"Lavc", b"Lavf", b"SonyA7III"):
        assert signature not in data, f"{signature!r} survived on the overlay path"
    assert report.metrics["residual_tags"] == []


def test_overlay_on_a_still_image(sample_image, stored_badge, tmp_path):
    report = mutate(
        sample_image,
        tmp_path / "still.jpg",
        AssetKind.IMAGE,
        _options(
            enabled=True,
            position=OverlayPosition.TOP_LEFT,
            offset_x=5,
            offset_y=5,
            scale_percent=40,
            image_filename=stored_badge.name,
        ),
        seed=5,
    )
    image = cv2.imread(str(report.output_path), cv2.IMREAD_COLOR)
    target = np.array(BADGE_BGR, dtype=np.int16)
    corner = image[: image.shape[0] // 2, : image.shape[1] // 2]
    assert (np.abs(corner.astype(np.int16) - target).sum(axis=2) < 90).mean() > 0.02
    assert any("image overlay" in line for line in report.applied)


def test_opacity_reduces_overlay_coverage(sample_image, stored_badge, tmp_path):
    """A translucent badge blends toward the background, so fewer pixels match
    the badge colour exactly."""

    def coverage(opacity: float) -> float:
        report = mutate(
            sample_image,
            tmp_path / f"op{int(opacity * 100)}.jpg",
            AssetKind.IMAGE,
            _options(enabled=True, opacity=opacity, scale_percent=50, image_filename=stored_badge.name),
            seed=5,
        )
        image = cv2.imread(str(report.output_path), cv2.IMREAD_COLOR)
        target = np.array(BADGE_BGR, dtype=np.int16)
        return float((np.abs(image.astype(np.int16) - target).sum(axis=2) < 90).mean())

    assert coverage(1.0) > coverage(0.3)


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


@pytest.fixture
def signed_in_client():
    from app.db import init_db

    init_db()
    client = TestClient(app)
    credentials = {"email": "overlay@example.com", "password": "correct-horse-battery"}
    response = client.post("/api/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = client.post("/api/v1/auth/login", json=credentials)
    assert response.status_code in (200, 201), response.text
    return client


def test_api_accepts_an_overlay_image(signed_in_client, sample_image, badge):
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[
            ("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg")),
            ("overlay_image", ("badge.png", badge.read_bytes(), "image/png")),
        ],
        data={"options": json.dumps({"preset": "balanced", "overlay": {"enabled": True, "scale_percent": 25}})},
    )
    assert response.status_code == 202, response.text
    overlay = response.json()["options"]["overlay"]
    assert overlay["enabled"] is True
    assert overlay["image_filename"], "the stored overlay filename was not recorded"


def test_api_rejects_a_non_image_overlay(signed_in_client, sample_image):
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[
            ("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg")),
            ("overlay_image", ("notes.txt", b"not an image", "text/plain")),
        ],
    )
    assert response.status_code == 422
    assert "overlay" in response.json()["detail"].lower()


def test_api_rejects_overlay_enabled_with_no_image(signed_in_client, sample_image):
    response = signed_in_client.post(
        "/api/v1/batches",
        files=[("files", ("shot.jpg", sample_image.read_bytes(), "image/jpeg"))],
        data={"options": json.dumps({"overlay": {"enabled": True}})},
    )
    assert response.status_code == 422
    assert "no overlay image" in response.json()["detail"].lower()
