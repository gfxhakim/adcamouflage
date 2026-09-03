"""Tests for the forensic comparison report.

These run the real mutation engine and then measure its output, so they assert
the behaviour the product actually claims rather than restating the code.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from app.compare import (
    _perceptual_hash,
    _psnr,
    _ssim,
    compare,
    main,
    render,
)
from app.mutator import mutate
from app.schemas import AssetKind, MutationOptions, Preset

from .conftest import requires_ffmpeg


# --------------------------------------------------------------------------
# metric primitives
# --------------------------------------------------------------------------


def test_ssim_of_identical_images_is_one():
    rng = np.random.default_rng(3)
    image = rng.integers(0, 255, size=(120, 160), dtype=np.uint8)
    assert _ssim(image, image) == pytest.approx(1.0, abs=1e-6)


def test_ssim_falls_with_distortion():
    """Use a structured image: SSIM stays high on pure noise, because its local
    statistics are dominated by the noise variance rather than by structure."""

    import cv2

    canvas = np.zeros((120, 160), dtype=np.uint8)
    canvas[:] = np.linspace(20, 200, 160, dtype=np.uint8)[None, :]
    cv2.rectangle(canvas, (30, 30), (90, 90), 240, -1)
    cv2.circle(canvas, (120, 60), 25, 10, -1)

    rng = np.random.default_rng(5)
    noisy = np.clip(canvas.astype(np.int16) + rng.integers(-60, 60, canvas.shape), 0, 255).astype(np.uint8)

    assert _ssim(canvas, canvas) == pytest.approx(1.0, abs=1e-6)
    assert _ssim(canvas, noisy) < 0.6


def test_psnr_of_identical_images_is_infinite():
    image = np.full((32, 32), 128, dtype=np.uint8)
    assert _psnr(image, image) == float("inf")


def test_perceptual_hash_is_stable_under_mild_noise():
    rng = np.random.default_rng(11)
    base = rng.integers(0, 255, size=(256, 256), dtype=np.uint8)
    nudged = np.clip(base.astype(np.int16) + rng.integers(-4, 4, base.shape), 0, 255).astype(np.uint8)
    distance = bin(_perceptual_hash(base) ^ _perceptual_hash(nudged)).count("1")
    # A robust hash must survive small perturbations; that is the whole point
    # of measuring against it.
    assert distance <= 12


def test_perceptual_hash_separates_different_pictures():
    rng = np.random.default_rng(13)
    a = rng.integers(0, 255, size=(256, 256), dtype=np.uint8)
    b = rng.integers(0, 255, size=(256, 256), dtype=np.uint8)
    distance = bin(_perceptual_hash(a) ^ _perceptual_hash(b)).count("1")
    assert distance > 15


# --------------------------------------------------------------------------
# end-to-end report
# --------------------------------------------------------------------------


@requires_ffmpeg
def test_report_shows_identity_and_provenance_broken(sample_video, tmp_path):
    output = tmp_path / "camouflaged.mp4"
    mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        MutationOptions(preset=Preset.BALANCED).resolved(),
        seed=2024,
    )

    report = compare(sample_video, output)

    sha = next(f for f in report.identity if f.name == "SHA-256")
    assert sha.changed, "the mutated file must not share the original's hash"

    tags = next(f for f in report.provenance if f.name.startswith("Container metadata"))
    assert tags.camouflaged == "none", f"metadata survived: {tags.camouflaged}"

    signatures = next(f for f in report.provenance if f.name.startswith("Encoder"))
    assert signatures.original != "none", "the fixture should carry encoder signatures"
    assert signatures.camouflaged == "none", f"signatures survived: {signatures.camouflaged}"

    assert report.verdict["exact_hash_match"]["would_match"] is False
    assert report.verdict["provenance_linkage"]["would_match"] is False


@requires_ffmpeg
def test_report_measures_geometry_and_timing_changes(sample_video, tmp_path):
    output = tmp_path / "camouflaged.mp4"
    mutate(sample_video, output, AssetKind.VIDEO, MutationOptions(preset=Preset.BALANCED).resolved(), seed=7)

    report = compare(sample_video, output)
    names = {f.name: f for f in report.structure}

    assert names["Resolution"].changed
    assert names["Frame rate"].changed
    assert names["Duration"].changed


@requires_ffmpeg
def test_audio_pitch_shift_is_detected_and_alignment_destroyed(sample_video, tmp_path):
    output = tmp_path / "camouflaged.mp4"
    mutate(sample_video, output, AssetKind.VIDEO, MutationOptions(preset=Preset.BALANCED).resolved(), seed=99)

    report = compare(sample_video, output)
    audio = report.audio

    assert audio["present"] is True
    assert audio["pitch_shift_ratio"] != pytest.approx(1.0, abs=1e-3)
    # Sample-level alignment is what audio fingerprinting and ASR rely on.
    assert abs(audio["waveform_correlation"]) < 0.5
    assert report.verdict["audio_fingerprint_match"]["would_match"] is False


@requires_ffmpeg
def test_mirror_is_what_moves_the_perceptual_hash(sample_video, tmp_path):
    """The honest trade-off: only the mirrored profile defeats a robust pHash."""

    balanced = tmp_path / "balanced.mp4"
    nuclear = tmp_path / "nuclear.mp4"
    mutate(sample_video, balanced, AssetKind.VIDEO, MutationOptions(preset=Preset.BALANCED).resolved(), seed=1)
    mutate(sample_video, nuclear, AssetKind.VIDEO, MutationOptions(preset=Preset.NUCLEAR).resolved(), seed=1)

    balanced_report = compare(sample_video, balanced)
    nuclear_report = compare(sample_video, nuclear)

    balanced_distance = balanced_report.perceptual["phash_distance_mean"]
    nuclear_distance = nuclear_report.perceptual["phash_distance_mean"]

    assert nuclear_distance > balanced_distance, (
        f"nuclear ({nuclear_distance}) should diverge further than balanced ({balanced_distance})"
    )
    # Balanced deliberately stays close enough that a viewer sees the same ad.
    assert balanced_report.perceptual["ssim_mean"] > nuclear_report.perceptual["ssim_mean"]


def test_image_comparison_reports_all_layers(sample_image, tmp_path):
    output = tmp_path / "camouflaged.jpg"
    mutate(sample_image, output, AssetKind.IMAGE, MutationOptions(preset=Preset.BALANCED).resolved(), seed=4)

    report = compare(sample_image, output)
    assert report.perceptual["frames_compared"] == 1
    assert "ssim_mean" in report.perceptual
    assert report.audio == {"present": False}
    assert report.verdict["exact_hash_match"]["would_match"] is False


def test_identical_files_are_reported_as_identical(sample_image, tmp_path):
    """The report must not claim success when nothing actually changed."""

    twin = tmp_path / "twin.jpg"
    twin.write_bytes(sample_image.read_bytes())

    report = compare(sample_image, twin)
    assert report.verdict["exact_hash_match"]["would_match"] is True
    assert report.verdict["perceptual_hash_match"]["would_match"] is True
    assert report.perceptual["phash_distance_mean"] == 0


def test_render_produces_every_section(sample_image, tmp_path):
    output = tmp_path / "out.jpg"
    mutate(sample_image, output, AssetKind.IMAGE, MutationOptions(preset=Preset.BALANCED).resolved(), seed=8)
    text = render(compare(sample_image, output), colour=False)

    for heading in ("FILE IDENTITY", "PROVENANCE", "CONTAINER STRUCTURE", "VERDICT"):
        assert heading in text


def test_cli_json_output(sample_image, tmp_path, capsys):
    output = tmp_path / "cli.jpg"
    mutate(sample_image, output, AssetKind.IMAGE, MutationOptions(preset=Preset.BALANCED).resolved(), seed=6)

    assert main([str(sample_image), str(output), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["verdict"]["exact_hash_match"]["would_match"] is False
    assert payload["identity"][0]["name"] == "SHA-256"


def test_cli_reports_a_missing_file(tmp_path, capsys):
    assert main([str(tmp_path / "nope.mp4"), str(tmp_path / "also-nope.mp4")]) == 1
    assert "does not exist" in capsys.readouterr().err
