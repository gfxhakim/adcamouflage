"""Container/bitstream scrubbing tests against real encoded files."""

from __future__ import annotations

import subprocess

import pytest

from app.config import settings
from app.ffmpeg import probe
from app.mutator import mutate
from app.schemas import AssetKind, MutationOptions, Preset
from app.scrub import (
    _read_vint_size,
    bitstream_filter_args,
    strip_matroska_app_tags,
    strip_mp4_compressor_names,
)

from .conftest import requires_ffmpeg


@requires_ffmpeg
def test_mp4_compressor_name_is_removed(sample_video, tmp_path):
    raw = tmp_path / "raw.mp4"
    subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(sample_video), "-t", "1", "-c:v", "libx264",
            "-preset", "ultrafast", "-an", str(raw),
        ],
        check=True,
        capture_output=True,
    )
    assert b"Lavc" in raw.read_bytes()
    size_before = raw.stat().st_size

    assert strip_mp4_compressor_names(raw) >= 1
    data = raw.read_bytes()
    assert b"Lavc" not in data
    # The field is fixed width, so nothing may shift.
    assert len(data) == size_before
    # The file must still decode.
    assert probe(raw).video is not None


@requires_ffmpeg
def test_scrub_is_idempotent(sample_video, tmp_path):
    raw = tmp_path / "idem.mp4"
    subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(sample_video), "-t", "1", "-c:v", "libx264",
            "-preset", "ultrafast", "-an", str(raw),
        ],
        check=True,
        capture_output=True,
    )
    strip_mp4_compressor_names(raw)
    digest = raw.read_bytes()
    assert strip_mp4_compressor_names(raw) == 0
    assert raw.read_bytes() == digest


@requires_ffmpeg
def test_full_video_mutation_leaves_no_encoder_fingerprint(sample_video, tmp_path):
    report = mutate(
        sample_video,
        tmp_path / "clean.mp4",
        AssetKind.VIDEO,
        MutationOptions(preset=Preset.BALANCED).resolved(),
        seed=17,
    )
    data = report.output_path.read_bytes()
    for signature in (b"x264", b"x265", b"Lavc", b"Lavf", b"libav", b"SonyA7III", b"Premiere"):
        assert signature not in data, f"{signature!r} survived the scrub"
    assert report.metrics["residual_tags"] == []
    assert probe(report.output_path).video is not None


@requires_ffmpeg
def test_webm_writing_app_is_removed(silent_video, tmp_path):
    raw = tmp_path / "raw.webm"
    subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(silent_video), "-t", "1", "-c:v", "libvpx-vp9",
            "-b:v", "200k", "-an", str(raw),
        ],
        check=True,
        capture_output=True,
    )
    if b"Lavf" not in raw.read_bytes():
        pytest.skip("this ffmpeg build does not tag the WebM writing app")

    size_before = raw.stat().st_size
    assert strip_matroska_app_tags(raw) >= 2
    data = raw.read_bytes()
    assert b"Lavf" not in data
    assert b"Lavc" not in data
    assert len(data) == size_before
    assert probe(raw).video is not None


def test_bitstream_filter_selection():
    args = bitstream_filter_args("libx264")
    if args:
        assert args == ["-bsf:v", "filter_units=remove_types=6"]
        assert bitstream_filter_args("libx265") == ["-bsf:v", "filter_units=remove_types=39|40"]
    assert bitstream_filter_args("libvpx-vp9") == []


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (b"\x84", (4, 1)),
        (b"\x40\x0a", (10, 2)),
        (b"\x20\x00\x05", (5, 3)),
        (b"\x00", (-1, 0)),
    ],
)
def test_vint_decoding(payload, expected):
    assert _read_vint_size(payload, 0) == expected


def test_scrub_ignores_non_media_files(tmp_path):
    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"avc1" * 40)
    assert strip_mp4_compressor_names(junk) == 0
    assert junk.read_bytes() == b"avc1" * 40


@requires_ffmpeg
def test_webm_output_is_signature_free(silent_video, tmp_path):
    report = mutate(
        silent_video,
        tmp_path / "clean.webm",
        AssetKind.VIDEO,
        MutationOptions(preset=Preset.STEALTH, output_format="webm").resolved(),
        seed=21,
    )
    data = report.output_path.read_bytes()
    for signature in (b"Lavf", b"Lavc", b"x264", b"libvpx"):
        assert signature not in data, f"{signature!r} survived the scrub"
    assert report.metrics["residual_tags"] == []
    assert probe(report.output_path).video is not None
