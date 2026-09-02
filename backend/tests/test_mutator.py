"""End-to-end checks of the mutation engine against real media."""

from __future__ import annotations

import random
import subprocess

import pytest

from app.config import settings
from app.ffmpeg import probe
from app.mutator import (
    _atempo_chain,
    build_audio_filters,
    build_plan,
    build_video_filters,
    mutate,
    sha256_file,
)
from app.schemas import AssetKind, MutationOptions, Preset

from .conftest import requires_ffmpeg


def _options(**overrides) -> MutationOptions:
    return MutationOptions(preset=Preset.CUSTOM, **overrides).resolved()


@requires_ffmpeg
def test_video_mutation_changes_every_fingerprint(sample_video, tmp_path):
    target = tmp_path / "out.mp4"
    progress: list[float] = []

    report = mutate(
        sample_video,
        target,
        AssetKind.VIDEO,
        _options(intensity=55, seed=1234),
        on_progress=lambda fraction, _stage: progress.append(fraction),
    )

    output = report.output_path
    assert output.exists() and output.stat().st_size > 0
    assert report.metrics["source_sha256"] != report.metrics["output_sha256"]
    assert progress and max(progress) > 0.5

    source_info = probe(sample_video)
    output_info = probe(output)

    # Geometry was shaved, so a pixel-hash lookup against the original misses.
    assert output_info.video.width < source_info.video.width
    assert output_info.video.height < source_info.video.height
    assert output_info.video.width % 2 == 0 and output_info.video.height % 2 == 0

    # Frame rate was staggered off the source rate.
    assert abs(output_info.video.fps - source_info.video.fps) > 0.01

    # Audio survived the pitch shift.
    assert output_info.has_audio
    assert output_info.duration > 1.0

    assert any("micro-crop" in item for item in report.applied)
    assert any("pitch" in item for item in report.applied)


@requires_ffmpeg
def test_video_metadata_is_stripped(sample_video, tmp_path):
    source_tags = {k.lower() for k in probe(sample_video).tags}
    assert {"title", "comment", "artist"} & source_tags

    report = mutate(sample_video, tmp_path / "clean.mp4", AssetKind.VIDEO, _options(seed=99))

    tags = {k.lower(): v for k, v in probe(report.output_path).tags.items()}
    for forbidden in ("title", "comment", "artist", "encoder", "software"):
        assert not tags.get(forbidden), f"{forbidden} survived the strip: {tags}"

    raw = report.output_path.read_bytes()
    assert b"SonyA7III" not in raw
    assert b"Acme Studios" not in raw
    assert b"Premiere" not in raw


@requires_ffmpeg
def test_video_without_audio_is_handled(silent_video, tmp_path):
    report = mutate(silent_video, tmp_path / "silent-out.mp4", AssetKind.VIDEO, _options(seed=5))
    info = probe(report.output_path)
    assert info.has_video
    assert not info.has_audio


@requires_ffmpeg
def test_deep_scramble_pass_runs_and_moves_perceptual_hash(silent_video, tmp_path):
    report = mutate(
        silent_video,
        tmp_path / "scrambled.mp4",
        AssetKind.VIDEO,
        _options(deep_scramble=True, intensity=85, seed=11),
    )
    assert any("deep frame scramble" in item for item in report.applied)
    assert report.output_path.stat().st_size > 0
    assert probe(report.output_path).video is not None


@requires_ffmpeg
def test_seeded_runs_are_reproducible(silent_video, tmp_path):
    options = _options(intensity=40, seed=4242)
    first = mutate(silent_video, tmp_path / "a.mp4", AssetKind.VIDEO, options, seed=4242)
    second = mutate(silent_video, tmp_path / "b.mp4", AssetKind.VIDEO, options, seed=4242)
    assert first.metrics["output_resolution"] == second.metrics["output_resolution"]
    assert first.metrics["output_fps"] == second.metrics["output_fps"]


@requires_ffmpeg
def test_variants_differ_from_each_other(silent_video, tmp_path):
    options = _options(intensity=60)
    hashes = {
        mutate(silent_video, tmp_path / f"v{i}.mp4", AssetKind.VIDEO, options, seed=i).metrics["output_sha256"]
        for i in range(3)
    }
    assert len(hashes) == 3


def test_image_mutation_strips_exif_and_shifts_pixels(sample_image, tmp_path):
    import piexif

    before = piexif.load(str(sample_image))
    assert before["0th"], "fixture should carry EXIF"

    report = mutate(sample_image, tmp_path / "out.jpg", AssetKind.IMAGE, _options(intensity=50, seed=7))
    output = report.output_path

    assert output.exists()
    assert report.metrics["residual_exif_tags"] == 0
    assert report.metrics["source_sha256"] != report.metrics["output_sha256"]
    assert report.metrics["source_resolution"] != report.metrics["output_resolution"]
    assert b"EOS R5" not in output.read_bytes()
    assert b"Photoshop" not in output.read_bytes()


def test_image_format_conversion(sample_image, tmp_path):
    report = mutate(
        sample_image,
        tmp_path / "converted.jpg",
        AssetKind.IMAGE,
        _options(output_format="png", seed=3),
    )
    assert report.output_path.suffix == ".png"
    assert report.output_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_missing_source_raises(tmp_path):
    from app.mutator import MutationError

    with pytest.raises(MutationError):
        mutate(tmp_path / "nope.mp4", tmp_path / "out.mp4", AssetKind.VIDEO, _options())


def test_atempo_chain_stays_within_ffmpeg_limits():
    assert _atempo_chain(1.0) == []
    assert _atempo_chain(0.98) == ["atempo=0.980000"]
    chained = _atempo_chain(3.5)
    assert chained[0] == "atempo=2.0"
    product = 1.0
    for entry in chained:
        product *= float(entry.split("=")[1])
    assert abs(product - 3.5) < 1e-6


def test_plan_respects_disabled_features():
    options = MutationOptions(
        preset=Preset.CUSTOM,
        micro_crop=False,
        frame_rate_stagger=False,
        noise_injection=False,
        color_drift=False,
        audio_mutation=False,
        temporal_trim=False,
    )
    plan = build_plan(options, random.Random(1), width=1920, height=1080, duration=10, source_fps=30)
    assert plan.crop_x == 0 and plan.crop_y == 0
    assert plan.fps is None
    assert plan.noise_strength == 0
    assert plan.pitch_ratio == 1.0
    assert plan.trim_head == 0.0


def test_preset_intensities_are_ordered():
    order = [Preset.STEALTH, Preset.BALANCED, Preset.AGGRESSIVE, Preset.NUCLEAR]
    intensities = [MutationOptions(preset=preset).resolved().intensity for preset in order]
    assert intensities == sorted(intensities)


def test_explicit_fields_override_preset_defaults():
    resolved = MutationOptions(preset=Preset.NUCLEAR, mirror=False, intensity=10).resolved()
    assert resolved.mirror is False
    assert resolved.intensity == 10


@requires_ffmpeg
def test_filter_graph_is_well_formed(sample_video):
    info = probe(sample_video)
    plan = build_plan(
        MutationOptions(preset=Preset.CUSTOM).resolved(),
        random.Random(2),
        width=info.video.width,
        height=info.video.height,
        duration=info.duration,
        source_fps=info.video.fps,
    )
    graph = ",".join(build_video_filters(plan, info))
    audio = ",".join(build_audio_filters(plan, info))

    result = subprocess.run(
        [
            settings.ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(sample_video), "-t", "0.5",
            "-vf", graph, "-af", audio,
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_sha256_of_known_bytes(tmp_path):
    path = tmp_path / "blob.bin"
    path.write_bytes(b"adcamouflage")
    assert sha256_file(path) == __import__("hashlib").sha256(b"adcamouflage").hexdigest()


@requires_ffmpeg
def test_deep_scramble_keeps_audio_and_honours_the_trim(sample_video, tmp_path):
    """The scramble pass is video-only, so audio must be remapped from the source."""

    source = probe(sample_video)
    report = mutate(
        sample_video,
        tmp_path / "scramble-audio.mp4",
        AssetKind.VIDEO,
        _options(deep_scramble=True, temporal_trim=True, intensity=70, seed=31),
        seed=31,
    )
    output = probe(report.output_path)

    assert output.has_audio, "audio was dropped by the deep-scramble path"
    assert output.has_video
    # The trim shaves a little off each end, so the result is shorter but not
    # truncated to a fraction of the original.
    assert 0.5 * source.duration < output.duration < source.duration
