"""Forensic comparison of an original asset against its camouflaged derivative.

Answers three separate questions, which are easy to conflate:

1. **Are these the same bytes?**       - hashes, size, container structure
2. **Do they carry the same origin?**  - metadata tags, encoder signatures
3. **Are they the same content?**      - perceptual hashes, SSIM, audio pitch

A successful mutation makes (1) and (2) diverge completely while keeping (3)
close - the asset stays the same ad to a viewer while no longer matching the
original in any automated index. This module measures all three so the claim can
be checked rather than trusted.

Run it directly:

    python -m app.compare original.mp4 camouflaged.mp4
    python -m app.compare original.mp4 camouflaged.mp4 --json
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .config import settings
from .ffmpeg import MediaError, MediaInfo, probe
from .mutator import (
    IMAGE_CONTAINERS,
    STRUCTURAL_CONTAINER_TAGS,
    _average_hash,
    _difference_hash,
    _hamming,
    _to_gray,
    sha256_file,
)

# Strings that identify the encoder, muxer or capture device. Their presence in
# the output means provenance survived the scrub.
SIGNATURE_PATTERNS: tuple[tuple[str, bytes], ...] = (
    ("x264 encoder settings SEI", b"x264 - core"),
    ("x265 encoder settings SEI", b"x265"),
    ("libavcodec compressorname", b"Lavc"),
    ("libavformat muxer tag", b"Lavf"),
    ("Adobe editing suite", b"Adobe"),
    ("Adobe Premiere", b"Premiere"),
    ("Final Cut Pro", b"Final Cut"),
    ("DaVinci Resolve", b"Resolve"),
    ("Apple QuickTime writer", b"QuickTime"),
    ("GoPro", b"GoPro"),
    ("Sony camera", b"SonyA"),
    ("RED camera", b"RED "),
    ("Canon camera", b"Canon"),
)

# How many frames to sample when comparing picture content.
FRAME_SAMPLES = 9

# Width the frames are normalised to before SSIM, so a crop/resample does not
# make the comparison meaningless.
COMPARE_WIDTH = 512


# --------------------------------------------------------------------------
# perceptual hashing
# --------------------------------------------------------------------------


def _perceptual_hash(gray: np.ndarray) -> int:
    """32x32 DCT-based pHash - the standard robust image hash.

    Unlike dHash/aHash this survives mild scaling, noise and gamma changes, so
    it is the fair test of whether a matcher would still link the two assets.
    """

    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(resized)
    # Drop the DC term: it only encodes overall brightness.
    low_frequency = dct[:8, :8].flatten()[1:]
    median = np.median(low_frequency)
    value = 0
    for coefficient in low_frequency:
        value = (value << 1) | int(coefficient > median)
    return value


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Structural similarity, Wang et al. 2004, on single-channel float images.

    1.0 means identical; above ~0.9 reads as visually the same picture.
    """

    a = a.astype(np.float64)
    b = b.astype(np.float64)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    kernel = (11, 11)
    sigma = 1.5
    mu_a = cv2.GaussianBlur(a, kernel, sigma)
    mu_b = cv2.GaussianBlur(b, kernel, sigma)

    mu_a_sq, mu_b_sq, mu_ab = mu_a**2, mu_b**2, mu_a * mu_b
    sigma_a = cv2.GaussianBlur(a * a, kernel, sigma) - mu_a_sq
    sigma_b = cv2.GaussianBlur(b * b, kernel, sigma) - mu_b_sq
    sigma_ab = cv2.GaussianBlur(a * b, kernel, sigma) - mu_ab

    numerator = (2 * mu_ab + c1) * (2 * sigma_ab + c2)
    denominator = (mu_a_sq + mu_b_sq + c1) * (sigma_a + sigma_b + c2)
    return float(np.mean(numerator / denominator))


def _psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    if mse <= 1e-9:
        return float("inf")
    return float(20 * math.log10(255.0) - 10 * math.log10(mse))


def _normalise(frame: np.ndarray) -> np.ndarray:
    """Grayscale and resize to a common width so cropped frames stay comparable."""

    gray = _to_gray(frame)
    height, width = gray.shape[:2]
    if width == 0 or height == 0:
        return gray
    target_height = max(1, int(round(height * COMPARE_WIDTH / width)))
    return cv2.resize(gray, (COMPARE_WIDTH, target_height), interpolation=cv2.INTER_AREA)


# --------------------------------------------------------------------------
# report structures
# --------------------------------------------------------------------------


@dataclass
class LayerFinding:
    name: str
    original: Any
    camouflaged: Any
    changed: bool
    note: str = ""


@dataclass
class ComparisonReport:
    original_path: str
    camouflaged_path: str
    identity: list[LayerFinding] = field(default_factory=list)
    provenance: list[LayerFinding] = field(default_factory=list)
    structure: list[LayerFinding] = field(default_factory=list)
    perceptual: dict[str, Any] = field(default_factory=dict)
    audio: dict[str, Any] = field(default_factory=dict)
    verdict: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "original": self.original_path,
            "camouflaged": self.camouflaged_path,
            "identity": [asdict(f) for f in self.identity],
            "provenance": [asdict(f) for f in self.provenance],
            "structure": [asdict(f) for f in self.structure],
            "perceptual": self.perceptual,
            "audio": self.audio,
            "verdict": self.verdict,
        }


# --------------------------------------------------------------------------
# layer 1 + 2: bytes and provenance
# --------------------------------------------------------------------------


def _scan_signatures(path: Path) -> list[str]:
    """Names of encoder/device signatures found in the raw file bytes."""

    try:
        data = path.read_bytes()
    except OSError:
        return []
    return [label for label, needle in SIGNATURE_PATTERNS if needle in data]


def _provenance_tags(info: MediaInfo) -> dict[str, str]:
    return {
        key: value
        for key, value in info.tags.items()
        if key.lower() not in STRUCTURAL_CONTAINER_TAGS and value.strip("\x00 ")
    }


def compare_identity(original: Path, camouflaged: Path) -> list[LayerFinding]:
    original_hash = sha256_file(original)
    camouflaged_hash = sha256_file(camouflaged)
    original_size = original.stat().st_size
    camouflaged_size = camouflaged.stat().st_size

    delta = (camouflaged_size - original_size) / original_size * 100 if original_size else 0.0

    return [
        LayerFinding(
            "SHA-256",
            original_hash[:24] + "…",
            camouflaged_hash[:24] + "…",
            original_hash != camouflaged_hash,
            "any exact-hash blocklist lookup misses" if original_hash != camouflaged_hash else "IDENTICAL FILE",
        ),
        LayerFinding(
            "File size",
            f"{original_size:,} bytes",
            f"{camouflaged_size:,} bytes",
            original_size != camouflaged_size,
            f"{delta:+.1f}%",
        ),
    ]


def compare_provenance(
    original: Path, camouflaged: Path, info_a: MediaInfo, info_b: MediaInfo
) -> list[LayerFinding]:
    tags_a = _provenance_tags(info_a)
    tags_b = _provenance_tags(info_b)
    signatures_a = _scan_signatures(original)
    signatures_b = _scan_signatures(camouflaged)

    findings = [
        LayerFinding(
            "Container metadata tags",
            ", ".join(f"{k}={v}" for k, v in sorted(tags_a.items())) or "none",
            ", ".join(f"{k}={v}" for k, v in sorted(tags_b.items())) or "none",
            tags_a != tags_b,
            f"{len(tags_a)} → {len(tags_b)}",
        ),
        LayerFinding(
            "Encoder / device signatures in bytes",
            ", ".join(signatures_a) or "none",
            ", ".join(signatures_b) or "none",
            signatures_a != signatures_b,
            f"{len(signatures_a)} → {len(signatures_b)}",
        ),
    ]

    leaked = sorted(set(tags_a) & set(tags_b))
    if leaked:
        findings.append(
            LayerFinding(
                "Tags that survived",
                ", ".join(leaked),
                ", ".join(leaked),
                False,
                "these still link the two files",
            )
        )
    return findings


def compare_structure(info_a: MediaInfo, info_b: MediaInfo, still: bool = False) -> list[LayerFinding]:
    findings: list[LayerFinding] = [
        LayerFinding("Container", info_a.format_name, info_b.format_name, info_a.format_name != info_b.format_name),
    ]
    if not still:
        findings.append(
            LayerFinding(
                "Duration",
                f"{info_a.duration:.3f}s",
                f"{info_b.duration:.3f}s",
                abs(info_a.duration - info_b.duration) > 0.01,
                f"{info_b.duration - info_a.duration:+.3f}s",
            )
        )

    if info_a.video and info_b.video:
        resolution_a = f"{info_a.video.width}x{info_a.video.height}"
        resolution_b = f"{info_b.video.width}x{info_b.video.height}"
        pixels_a = info_a.video.width * info_a.video.height
        pixels_b = info_b.video.width * info_b.video.height
        findings += [
            LayerFinding(
                "Resolution",
                resolution_a,
                resolution_b,
                resolution_a != resolution_b,
                f"{(pixels_b - pixels_a) / pixels_a * 100:+.2f}% of pixels" if pixels_a else "",
            ),
            LayerFinding(
                "Encoding" if still else "Video codec",
                info_a.video.codec,
                info_b.video.codec,
                info_a.video.codec != info_b.video.codec,
            ),
        ]
        if not still:
            findings.insert(
                -1,
                LayerFinding(
                    "Frame rate",
                    f"{info_a.video.fps:g} fps",
                    f"{info_b.video.fps:g} fps",
                    abs(info_a.video.fps - info_b.video.fps) > 0.01,
                    "frame timestamps no longer align"
                    if abs(info_a.video.fps - info_b.video.fps) > 0.01
                    else "",
                ),
            )

    if info_a.audio and info_b.audio:
        findings.append(
            LayerFinding(
                "Audio",
                f"{info_a.audio.codec} {info_a.audio.sample_rate}Hz {info_a.audio.channels}ch",
                f"{info_b.audio.codec} {info_b.audio.sample_rate}Hz {info_b.audio.channels}ch",
                (info_a.audio.codec, info_a.audio.sample_rate) != (info_b.audio.codec, info_b.audio.sample_rate),
            )
        )
    elif info_a.has_audio != info_b.has_audio:
        findings.append(
            LayerFinding("Audio stream", info_a.has_audio, info_b.has_audio, True, "audio was added or dropped")
        )
    return findings


# --------------------------------------------------------------------------
# layer 3: picture content
# --------------------------------------------------------------------------


def is_still_image(path: Path, info: MediaInfo) -> bool:
    """Distinguish a still from a clip.

    ffprobe describes a JPEG or PNG as a one-frame mjpeg/png *video* stream, so
    `has_video` alone would send images down the frame-sampling path.
    """

    if path.suffix.lower().lstrip(".") in IMAGE_CONTAINERS | {"bmp", "tif", "tiff", "gif", "heic", "heif"}:
        return True
    if info.video is None:
        return False
    if info.video.codec in {"mjpeg", "png", "bmp", "webp", "gif", "tiff"}:
        return True
    return info.duration <= 0.05 and (info.video.nb_frames or 0) <= 1


def _read_frame_at(capture: cv2.VideoCapture, index: int) -> np.ndarray | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, index))
    ok, frame = capture.read()
    return frame if ok else None


def compare_frames(original: Path, camouflaged: Path, info_a: MediaInfo, info_b: MediaInfo) -> dict[str, Any]:
    """Sample matched frames and measure how far the picture actually moved."""

    capture_a = cv2.VideoCapture(str(original))
    capture_b = cv2.VideoCapture(str(camouflaged))
    try:
        if not capture_a.isOpened() or not capture_b.isOpened():
            return {"error": "one of the files could not be decoded by OpenCV"}

        total_a = int(capture_a.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        total_b = int(capture_b.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total_a < 2 or total_b < 2:
            return {"error": "not enough frames to compare"}

        fps_b = capture_b.get(cv2.CAP_PROP_FPS) or (info_b.video.fps if info_b.video else 30.0)
        # The mutation trims a fraction of a second off the head, so search a
        # small window around the proportional position for the true match.
        search_radius = max(2, int(round(fps_b * 0.6)))

        phash_distances: list[int] = []
        dhash_distances: list[int] = []
        ahash_distances: list[int] = []
        ssim_scores: list[float] = []
        psnr_scores: list[float] = []
        offsets: list[int] = []

        for step in range(FRAME_SAMPLES):
            fraction = (step + 1) / (FRAME_SAMPLES + 1)
            index_b = int(fraction * (total_b - 1))
            frame_b = _read_frame_at(capture_b, index_b)
            if frame_b is None:
                continue
            normal_b = _normalise(frame_b)
            hash_b = _perceptual_hash(normal_b)

            # Find the original frame that best matches this mutated frame.
            centre_a = int(fraction * (total_a - 1))
            best: tuple[int, int, np.ndarray] | None = None
            for delta in range(-search_radius, search_radius + 1, max(1, search_radius // 4)):
                candidate = centre_a + delta
                if candidate < 0 or candidate >= total_a:
                    continue
                frame_a = _read_frame_at(capture_a, candidate)
                if frame_a is None:
                    continue
                normal_a = _normalise(frame_a)
                distance = _hamming(_perceptual_hash(normal_a), hash_b)
                if best is None or distance < best[0]:
                    best = (distance, candidate, normal_a)

            if best is None:
                continue
            distance, matched_index, normal_a = best
            offsets.append(matched_index - centre_a)

            phash_distances.append(distance)
            dhash_distances.append(_hamming(_difference_hash(normal_a), _difference_hash(normal_b)))
            ahash_distances.append(_hamming(_average_hash(normal_a), _average_hash(normal_b)))

            height = min(normal_a.shape[0], normal_b.shape[0])
            crop_a = normal_a[:height]
            crop_b = normal_b[:height]
            ssim_scores.append(_ssim(crop_a, crop_b))
            psnr_scores.append(_psnr(crop_a, crop_b))

        if not phash_distances:
            return {"error": "no frames could be aligned"}

        return {
            "frames_compared": len(phash_distances),
            "phash_distance_mean": round(float(np.mean(phash_distances)), 2),
            "phash_distance_max": int(np.max(phash_distances)),
            "dhash_distance_mean": round(float(np.mean(dhash_distances)), 2),
            "ahash_distance_mean": round(float(np.mean(ahash_distances)), 2),
            "ssim_mean": round(float(np.mean(ssim_scores)), 4),
            "ssim_min": round(float(np.min(ssim_scores)), 4),
            "psnr_mean_db": round(float(np.mean([p for p in psnr_scores if math.isfinite(p)] or [0])), 2),
            "frame_offset_median": int(np.median(offsets)) if offsets else 0,
        }
    finally:
        capture_a.release()
        capture_b.release()


# --------------------------------------------------------------------------
# layer 3b: audio
# --------------------------------------------------------------------------


def _decode_audio(path: Path, seconds: float = 12.0, rate: int = 16000) -> np.ndarray | None:
    """Decode the head of the audio track to mono float32 samples."""

    command = [
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        str(path),
        "-t",
        str(seconds),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(rate),
        "-f",
        "f32le",
        "pipe:1",
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=120, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    return np.frombuffer(result.stdout, dtype=np.float32)


def _spectral_centroid(samples: np.ndarray, rate: int = 16000) -> float:
    """Brightness of the signal in Hz - shifts proportionally with pitch."""

    window = 2048
    hop = 1024
    centroids: list[float] = []
    frequencies = np.fft.rfftfreq(window, d=1.0 / rate)
    for start in range(0, max(0, len(samples) - window), hop):
        chunk = samples[start : start + window] * np.hanning(window)
        spectrum = np.abs(np.fft.rfft(chunk))
        total = spectrum.sum()
        if total > 1e-6:
            centroids.append(float((frequencies * spectrum).sum() / total))
    return float(np.median(centroids)) if centroids else 0.0


def compare_audio(original: Path, camouflaged: Path, info_a: MediaInfo, info_b: MediaInfo) -> dict[str, Any]:
    if not info_a.has_audio or not info_b.has_audio:
        return {"present": False}

    samples_a = _decode_audio(original)
    samples_b = _decode_audio(camouflaged)
    if samples_a is None or samples_b is None or len(samples_a) < 4096 or len(samples_b) < 4096:
        return {"present": True, "error": "audio could not be decoded for analysis"}

    centroid_a = _spectral_centroid(samples_a)
    centroid_b = _spectral_centroid(samples_b)
    ratio = centroid_b / centroid_a if centroid_a > 0 else 0.0

    # Waveform correlation over the overlapping region: a pitch/tempo shift
    # destroys sample-level alignment even though it sounds the same.
    length = min(len(samples_a), len(samples_b))
    a = samples_a[:length]
    b = samples_b[:length]
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    correlation = float(np.dot(a, b) / denominator) if denominator > 1e-9 else 0.0

    return {
        "present": True,
        "spectral_centroid_original_hz": round(centroid_a, 1),
        "spectral_centroid_camouflaged_hz": round(centroid_b, 1),
        "pitch_shift_ratio": round(ratio, 4),
        "pitch_shift_cents": round(1200 * math.log2(ratio), 1) if ratio > 0 else None,
        "waveform_correlation": round(correlation, 4),
    }


# --------------------------------------------------------------------------
# verdict
# --------------------------------------------------------------------------


def build_verdict(report: ComparisonReport) -> dict[str, Any]:
    """Translate the measurements into what each class of matcher would do."""

    identity_changed = any(f.name == "SHA-256" and f.changed for f in report.identity)
    provenance = next((f for f in report.provenance if f.name.startswith("Container metadata")), None)
    signatures = next((f for f in report.provenance if f.name.startswith("Encoder")), None)

    perceptual = report.perceptual
    phash = perceptual.get("phash_distance_mean")
    ssim = perceptual.get("ssim_mean")

    lines: dict[str, Any] = {}

    lines["exact_hash_match"] = {
        "would_match": not identity_changed,
        "detail": "Byte hashes differ, so exact-match blocklists and dedupe indexes miss."
        if identity_changed
        else "The files are byte-identical - nothing was changed.",
    }

    if phash is not None:
        # Common industry thresholds treat <=10 bits of a 63-bit pHash as a match.
        would_match = phash <= 10
        lines["perceptual_hash_match"] = {
            "would_match": would_match,
            "distance": phash,
            "detail": (
                f"Mean pHash distance {phash} of 63 bits. A robust perceptual matcher "
                + ("would still link these." if would_match else "is unlikely to link these.")
            ),
        }

    if ssim is not None:
        lines["human_perception"] = {
            "looks_the_same": ssim >= 0.85,
            "ssim": ssim,
            "detail": (
                f"SSIM {ssim} - "
                + (
                    "visually the same asset to a viewer."
                    if ssim >= 0.85
                    else "visibly different; the mutation is strong enough to notice."
                )
            ),
        }

    residual = []
    if provenance and provenance.camouflaged != "none":
        residual.append("container metadata")
    if signatures and signatures.camouflaged != "none":
        residual.append("encoder/device signatures")

    lines["provenance_linkage"] = {
        "would_match": bool(residual),
        "detail": (
            "Residual " + " and ".join(residual) + " still tie the file to its origin."
            if residual
            else "No metadata tags or encoder signatures remain to link the file to its origin."
        ),
    }

    audio = report.audio
    if audio.get("present") and "waveform_correlation" in audio:
        correlation = audio["waveform_correlation"]
        lines["audio_fingerprint_match"] = {
            "would_match": abs(correlation) > 0.9,
            "correlation": correlation,
            "detail": (
                f"Waveform correlation {correlation}; pitch shifted "
                f"{audio.get('pitch_shift_cents')} cents. "
                + (
                    "Sample-level alignment survives."
                    if abs(correlation) > 0.9
                    else "Sample-level alignment is destroyed, so ASR and audio fingerprints desync."
                )
            ),
        }

    return lines


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------


def compare(original: Path, camouflaged: Path) -> ComparisonReport:
    for path in (original, camouflaged):
        if not path.exists():
            raise MediaError(f"{path} does not exist")

    info_a = probe(original)
    info_b = probe(camouflaged)

    report = ComparisonReport(str(original), str(camouflaged))
    report.identity = compare_identity(original, camouflaged)
    report.provenance = compare_provenance(original, camouflaged, info_a, info_b)
    still_pair = is_still_image(original, info_a) and is_still_image(camouflaged, info_b)
    report.structure = compare_structure(info_a, info_b, still=still_pair)

    still = is_still_image(original, info_a) or is_still_image(camouflaged, info_b)
    if info_a.has_video and info_b.has_video and not still:
        report.perceptual = compare_frames(original, camouflaged, info_a, info_b)
    else:
        image_a = cv2.imread(str(original), cv2.IMREAD_COLOR)
        image_b = cv2.imread(str(camouflaged), cv2.IMREAD_COLOR)
        if image_a is not None and image_b is not None:
            normal_a = _normalise(image_a)
            normal_b = _normalise(image_b)
            height = min(normal_a.shape[0], normal_b.shape[0])
            report.perceptual = {
                "frames_compared": 1,
                "phash_distance_mean": _hamming(_perceptual_hash(normal_a), _perceptual_hash(normal_b)),
                "dhash_distance_mean": _hamming(_difference_hash(normal_a), _difference_hash(normal_b)),
                "ahash_distance_mean": _hamming(_average_hash(normal_a), _average_hash(normal_b)),
                "ssim_mean": round(_ssim(normal_a[:height], normal_b[:height]), 4),
                "psnr_mean_db": round(_psnr(normal_a[:height], normal_b[:height]), 2),
            }
            # A still has a single sample, so min and mean are the same value.
            report.perceptual["ssim_min"] = report.perceptual["ssim_mean"]
            report.perceptual["phash_distance_max"] = report.perceptual["phash_distance_mean"]

    report.audio = compare_audio(original, camouflaged, info_a, info_b)
    report.verdict = build_verdict(report)
    return report


# --------------------------------------------------------------------------
# CLI rendering
# --------------------------------------------------------------------------

_BOLD = "\033[1m"
_DIM = "\033[2m"
_GREEN = "\033[32m"
_RED = "\033[31m"
_YELLOW = "\033[33m"
_CYAN = "\033[36m"
_OFF = "\033[0m"


def _colour(enabled: bool, code: str, text: str) -> str:
    return f"{code}{text}{_OFF}" if enabled else text


def render(report: ComparisonReport, colour: bool = True) -> str:
    out: list[str] = []
    c = lambda code, text: _colour(colour, code, text)  # noqa: E731

    def section(title: str) -> None:
        out.append("")
        out.append(c(_BOLD, title))
        out.append(c(_DIM, "─" * 74))

    def row(finding: LayerFinding) -> None:
        mark = c(_GREEN, "changed") if finding.changed else c(_YELLOW, "same   ")
        out.append(f"  {mark}  {finding.name}")
        out.append(f"           original     {finding.original}")
        out.append(f"           camouflaged  {finding.camouflaged}")
        if finding.note:
            out.append(f"           {c(_DIM, finding.note)}")

    out.append("")
    out.append(c(_BOLD + _CYAN, "  CAMOUFLAGE COMPARISON REPORT"))
    out.append(f"  {c(_DIM, 'original')}     {report.original_path}")
    out.append(f"  {c(_DIM, 'camouflaged')}  {report.camouflaged_path}")

    section("1 · FILE IDENTITY  (what an exact-match index sees)")
    for finding in report.identity:
        row(finding)

    section("2 · PROVENANCE  (what links the file to its origin)")
    for finding in report.provenance:
        row(finding)

    section("3 · CONTAINER STRUCTURE")
    for finding in report.structure:
        row(finding)

    if report.perceptual and "error" not in report.perceptual:
        section("4 · PICTURE CONTENT  (what a perceptual matcher and a viewer see)")
        p = report.perceptual
        out.append(f"  frames compared        {p.get('frames_compared')}")
        out.append(
            f"  pHash distance         {p.get('phash_distance_mean')} mean / "
            f"{p.get('phash_distance_max')} max   {c(_DIM, 'of 63 bits')}"
        )
        out.append(f"  dHash distance         {p.get('dhash_distance_mean')} mean   {c(_DIM, 'of 64 bits')}")
        out.append(f"  aHash distance         {p.get('ahash_distance_mean')} mean   {c(_DIM, 'of 64 bits')}")
        out.append(f"  SSIM                   {p.get('ssim_mean')} mean / {p.get('ssim_min')} min   {c(_DIM, '1.0 = identical')}")
        out.append(f"  PSNR                   {p.get('psnr_mean_db')} dB")
        if p.get("frame_offset_median"):
            out.append(f"  frame offset           {p.get('frame_offset_median')} frames {c(_DIM, '(temporal trim)')}")
    elif report.perceptual.get("error"):
        section("4 · PICTURE CONTENT")
        out.append(f"  {c(_YELLOW, report.perceptual['error'])}")

    if report.audio.get("present"):
        section("5 · AUDIO")
        a = report.audio
        if "error" in a:
            out.append(f"  {c(_YELLOW, a['error'])}")
        else:
            out.append(
                f"  spectral centroid      {a['spectral_centroid_original_hz']} Hz → "
                f"{a['spectral_centroid_camouflaged_hz']} Hz"
            )
            out.append(
                f"  pitch shift            ×{a['pitch_shift_ratio']}  ({a['pitch_shift_cents']} cents)"
            )
            out.append(
                f"  waveform correlation   {a['waveform_correlation']}   {c(_DIM, '1.0 = sample-aligned')}"
            )

    section("VERDICT  (what each class of matcher would conclude)")
    for key, value in report.verdict.items():
        label = key.replace("_", " ")
        if "would_match" in value:
            state = (
                c(_RED, "WOULD MATCH  ") if value["would_match"] else c(_GREEN, "WOULD NOT MATCH")
            )
        else:
            state = c(_GREEN, "SAME TO VIEWER ") if value.get("looks_the_same") else c(_YELLOW, "VISIBLY CHANGED")
        out.append(f"  {state}  {label}")
        out.append(f"                    {c(_DIM, value['detail'])}")

    out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.compare",
        description="Compare an original asset with its camouflaged derivative.",
    )
    parser.add_argument("original", type=Path)
    parser.add_argument("camouflaged", type=Path)
    parser.add_argument("--json", action="store_true", help="Emit the raw report as JSON.")
    parser.add_argument("--no-colour", action="store_true")
    args = parser.parse_args(argv)

    try:
        report = compare(args.original, args.camouflaged)
    except MediaError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(render(report, colour=not args.no_colour and sys.stdout.isatty()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
