"""The mutation engine.

Given an uploaded asset the engine produces a visually equivalent derivative
whose byte-level, pixel-level and audio-level fingerprints no longer match the
original. Three independent layers are applied:

1. **Geometry** - micro-crop plus a resample so every pixel is recomputed and
   block-level / pixel-hash matching fails.
2. **Signal**   - temporal noise, colour drift and (optionally) a per-frame
   OpenCV scramble that destroys perceptual-hash stability.
3. **Container** - re-encode with jittered rate-control, a staggered frame
   rate, a shifted audio pitch and a completely stripped metadata block.

Everything is driven by a seeded RNG so a batch can be reproduced exactly when
a customer asks for "the same variant again".
"""

from __future__ import annotations

import hashlib
import logging
import math
import random
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from PIL import Image

from .config import settings
from .ffmpeg import MediaError, MediaInfo, describe_ffmpeg_exit, open_ffmpeg_writer, probe, run_ffmpeg
from .schemas import (
    QUALITY_TIER_CRF,
    AssetKind,
    MutationOptions,
    OverlayMode,
    OverlaySettings,
    QualityTier,
)
from .scrub import bitstream_filter_args, scrub_container

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]

VIDEO_CONTAINERS = {"mp4", "mov", "mkv", "webm"}
IMAGE_CONTAINERS = {"jpg", "jpeg", "png", "webp"}

# Broadcast-adjacent frame rates that are plausible for real footage but differ
# from the common 30/60 defaults, which is enough to desynchronise frame-level
# matching without looking odd to a human reviewer.
FPS_LADDER = (23.976, 24.0, 25.0, 29.97, 30.0, 47.952, 50.0, 59.94)

# Tags that describe the container format itself rather than the asset's
# provenance. They cannot be removed without producing an invalid file, and
# they carry no information about the source, so they are excluded from the
# "residual provenance tags" metric.
STRUCTURAL_CONTAINER_TAGS = frozenset({"major_brand", "minor_version", "compatible_brands"})


class MutationError(RuntimeError):
    """Raised when an asset cannot be mutated."""


@dataclass(slots=True)
class MutationReport:
    output_path: Path
    applied: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    poster_filename: str | None = None


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _even(value: int) -> int:
    """H.264 requires even dimensions; round down to the nearest even int."""

    value = int(value)
    return value if value % 2 == 0 else value - 1


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _scale(intensity: int, low: float, high: float) -> float:
    """Map a 0..100 intensity dial onto an inclusive numeric range."""

    return low + (high - low) * (_clamp(intensity, 0, 100) / 100.0)


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _difference_hash(gray: np.ndarray) -> int:
    """64-bit dHash - the standard row-gradient perceptual hash."""

    resized = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = resized[:, 1:] > resized[:, :-1]
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bit)
    return value


def _average_hash(gray: np.ndarray) -> int:
    resized = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)
    bits = resized > resized.mean()
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bit)
    return value


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _to_gray(frame: np.ndarray) -> np.ndarray:
    if frame.ndim == 2:
        return frame
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def _first_frame(path: Path) -> np.ndarray | None:
    capture = cv2.VideoCapture(str(path))
    try:
        # Sample a frame a little way in: frame zero is often a black slate.
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total > 12:
            capture.set(cv2.CAP_PROP_POS_FRAMES, min(total // 4, total - 1))
        ok, frame = capture.read()
        if not ok:
            capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = capture.read()
        return frame if ok else None
    finally:
        capture.release()


def perceptual_delta(source: Path, target: Path, kind: AssetKind) -> dict[str, Any]:
    """Quantify how far the mutated asset moved from the original.

    Returned distances are Hamming distances over 64-bit hashes, so 0 means an
    exact perceptual match and anything above ~10 is considered a different
    asset by most matching systems.
    """

    try:
        if kind is AssetKind.IMAGE:
            src = cv2.imread(str(source), cv2.IMREAD_COLOR)
            dst = cv2.imread(str(target), cv2.IMREAD_COLOR)
        else:
            src = _first_frame(source)
            dst = _first_frame(target)
        if src is None or dst is None:
            return {}
        src_gray = _to_gray(src)
        dst_gray = _to_gray(dst)
        return {
            "dhash_distance": _hamming(_difference_hash(src_gray), _difference_hash(dst_gray)),
            "ahash_distance": _hamming(_average_hash(src_gray), _average_hash(dst_gray)),
        }
    except Exception:  # pragma: no cover - metrics must never fail a job
        logger.debug("perceptual delta failed", exc_info=True)
        return {}


# --------------------------------------------------------------------------
# plan
# --------------------------------------------------------------------------


@dataclass(slots=True)
class MutationPlan:
    """Concrete, randomised parameters for one asset."""

    crop_x: int = 0
    crop_y: int = 0
    out_width: int = 0
    out_height: int = 0
    fps: float | None = None
    noise_strength: int = 0
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    gamma: float = 1.0
    hue_degrees: float = 0.0
    sharpen: float = 0.0
    keyframe_gop_jitter: bool = False
    container_bitrate_shuffle: bool = False
    chroma_matrix_shift: bool = False
    frequency_smoothing: bool = False
    mirror: bool = False
    trim_head: float = 0.0
    trim_tail: float = 0.0
    pitch_ratio: float = 1.0
    tempo_ratio: float = 1.0
    audio_gain_db: float = 0.0
    highpass_hz: int = 0
    crf: int = 21
    gop: int = 60
    deep_scramble: bool = False
    jpeg_quality: int = 92
    seed: int = 0

    # --- Gen-4 Advanced Signal, Psychoacoustic & Forensic Parameters -------
    elastic_mesh_warp: bool = False
    perspective_offsets: tuple[float, float, float, float, float, float, float, float] = (
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    )
    mesh_amplitude: float = 0.0

    dct_jnd_perturbation: bool = False
    dct_mid_gain: float = 0.0
    jnd_strength: float = 0.0

    lut_clahe_color: bool = False
    clahe_clip: float = 0.0
    cb_shadows: tuple[float, float, float] = (0.0, 0.0, 0.0)
    cb_highlights: tuple[float, float, float] = (0.0, 0.0, 0.0)

    optical_flow_timewarp: bool = False
    tmix_weights: tuple[int, int, int] = (0, 100, 0)

    adversarial_cnn_layer: bool = False
    cnn_epsilon: float = 0.0
    cnn_kernel: tuple[int, int, int, int, int] = (0, 0, 100, 0, 0)

    audio_allpass_phase: bool = False
    allpass_bands: tuple[tuple[int, float], ...] = ()

    formant_pitch_lfo: bool = False
    vibrato_hz: float = 0.0
    vibrato_depth: float = 0.0
    formant_eq_hz: int = 0
    formant_eq_gain: float = 0.0

    psychoacoustic_rir: bool = False
    rir_delays_ms: tuple[int, int] = (0, 0)
    rir_decays: tuple[float, float] = (0.0, 0.0)
    stereo_widen: float = 1.0

    authentic_atom_spoof: bool = False
    track_timescale: int = 0

    macroblock_aq_variance: bool = False
    aq_mode: int = 1
    aq_strength: float = 1.0
    psy_rd: float = 1.0
    psy_trellis: float = 0.0
    qcomp: float = 0.60


def build_plan(
    options: MutationOptions,
    rng: random.Random,
    *,
    width: int = 0,
    height: int = 0,
    duration: float = 0.0,
    source_fps: float = 30.0,
) -> MutationPlan:
    intensity = options.intensity
    plan = MutationPlan(seed=rng.randrange(2**31))

    if options.micro_crop and width and height:
        # 2..4px per side at low intensity, up to ~1.2% of the frame at high.
        max_shave = max(2, int(min(width, height) * _scale(intensity, 0.004, 0.014)))
        plan.crop_x = rng.randint(2, max(2, min(max_shave, 24)))
        plan.crop_y = rng.randint(2, max(2, min(max_shave, 24)))
        plan.out_width = _even(width - 2 * plan.crop_x)
        plan.out_height = _even(height - 2 * plan.crop_y)
    elif width and height:
        plan.out_width = _even(width)
        plan.out_height = _even(height)

    # Output-fidelity dimensions. These only change the *delivered* size; the
    # micro-crop resample above still recomputes every pixel. "Keep resolution"
    # scales back to the source size, and "upscale" lifts a low-res source up to
    # a chosen height (never down). Neither is an evasion control.
    if width and height:
        if options.upscale_to and height < options.upscale_to:
            factor = options.upscale_to / float(height)
            plan.out_width = _even(int(round(width * factor)))
            plan.out_height = _even(options.upscale_to)
        elif options.keep_resolution:
            plan.out_width = _even(width)
            plan.out_height = _even(height)

    if options.frame_rate_stagger:
        if options.target_fps:
            plan.fps = float(options.target_fps)
        else:
            candidates = [f for f in FPS_LADDER if abs(f - source_fps) > 0.05 and f <= max(source_fps, 30.0) + 0.1]
            plan.fps = rng.choice(candidates) if candidates else 29.97

    if options.noise_injection:
        plan.noise_strength = max(1, int(round(_scale(intensity, 1.5, 16))))

    if options.color_drift:
        plan.brightness = round(rng.uniform(-1, 1) * _scale(intensity, 0.004, 0.035), 5)
        plan.contrast = round(1.0 + rng.uniform(-1, 1) * _scale(intensity, 0.006, 0.05), 5)
        plan.saturation = round(1.0 + rng.uniform(-1, 1) * _scale(intensity, 0.008, 0.06), 5)
        plan.gamma = round(1.0 + rng.uniform(-1, 1) * _scale(intensity, 0.005, 0.04), 5)
        plan.hue_degrees = round(rng.uniform(-1, 1) * _scale(intensity, 0.4, 3.5), 4)
        plan.sharpen = round(_scale(intensity, 0.05, 0.45), 4)

    plan.mirror = bool(options.mirror)
    plan.deep_scramble = bool(options.deep_scramble)
    plan.keyframe_gop_jitter = bool(options.keyframe_gop_jitter)
    plan.container_bitrate_shuffle = bool(options.container_bitrate_shuffle)
    plan.chroma_matrix_shift = bool(options.chroma_matrix_shift)
    plan.frequency_smoothing = bool(options.frequency_smoothing)

    if plan.keyframe_gop_jitter:
        plan.gop = rng.choice((44, 52, 60, 68, 76))
        plan.crf = max(18, min(24, plan.crf + rng.randint(-2, 2)))

    if plan.container_bitrate_shuffle:
        plan.crf = max(18, min(24, plan.crf + rng.randint(-1, 1)))

    if plan.chroma_matrix_shift:
        plan.saturation = round(_clamp(plan.saturation + rng.uniform(-0.015, 0.015), 0.96, 1.04), 5)
        plan.hue_degrees = round(_clamp(plan.hue_degrees + rng.uniform(-0.7, 0.7), -2.0, 2.0), 4)

    if plan.frequency_smoothing:
        plan.sharpen = round(max(0.0, plan.sharpen * 0.75), 4)

    if options.temporal_trim and duration > 1.5:
        budget = min(duration * 0.02, 0.5)
        plan.trim_head = round(rng.uniform(0.02, max(0.03, budget)), 3)
        plan.trim_tail = round(rng.uniform(0.02, max(0.03, budget)), 3)

    if options.audio_mutation:
        spread = _scale(intensity, 0.012, 0.06)
        plan.pitch_ratio = float(options.audio_pitch_ratio or round(1.0 + rng.choice((-1, 1)) * rng.uniform(spread * 0.4, spread), 5))
        plan.pitch_ratio = _clamp(plan.pitch_ratio, 0.85, 1.18)
        plan.tempo_ratio = round(_clamp(1.0 + rng.uniform(-1, 1) * _scale(intensity, 0.004, 0.025), 0.9, 1.1), 5)
        plan.audio_gain_db = round(rng.uniform(-1, 1) * _scale(intensity, 0.2, 1.4), 3)
        plan.highpass_hz = rng.choice((0, 30, 40, 55))

    plan.crf = rng.randint(19, 24)
    plan.gop = rng.choice((48, 50, 60, 72, 90, 120))
    plan.jpeg_quality = rng.randint(88, 96) if intensity < 70 else rng.randint(80, 92)

    # --- Gen-4 Advanced Layer Plan Generation ------------------------------
    if options.elastic_mesh_warp:
        plan.elastic_mesh_warp = True
        max_shift = _scale(intensity, 0.65, 2.75)
        plan.perspective_offsets = tuple(
            round(rng.uniform(0.35, max_shift), 3) for _ in range(8)
        )  # type: ignore[assignment]
        plan.mesh_amplitude = round(_scale(intensity, 0.9, 3.1), 3)

    if options.dct_jnd_perturbation:
        plan.dct_jnd_perturbation = True
        direction = rng.choice((-1.0, 1.0))
        plan.dct_mid_gain = round(direction * _scale(intensity, 0.08, 0.28), 4)
        plan.jnd_strength = round(_scale(intensity, 1.2, 4.5), 3)

    if options.lut_clahe_color:
        plan.lut_clahe_color = True
        plan.clahe_clip = round(_scale(intensity, 1.08, 1.42), 3)
        shift_mag = _scale(intensity, 0.012, 0.042)
        rs = round(rng.uniform(-shift_mag, shift_mag), 4)
        gs = round(rng.uniform(-shift_mag * 0.7, shift_mag * 0.7), 4)
        bs = round(-rs * 0.8 + rng.uniform(-0.008, 0.008), 4)
        rh = round(-rs * 0.6 + rng.uniform(-shift_mag * 0.8, shift_mag * 0.8), 4)
        gh = round(rng.uniform(-shift_mag * 0.6, shift_mag * 0.6), 4)
        bh = round(-rh * 0.75 + rng.uniform(-0.008, 0.008), 4)
        plan.cb_shadows = (rs, gs, bs)
        plan.cb_highlights = (rh, gh, bh)

    if options.optical_flow_timewarp:
        plan.optical_flow_timewarp = True
        w_side = rng.randint(3, max(4, int(round(_scale(intensity, 3, 9)))))
        w_lead = w_side + rng.randint(-1, 2)
        w_center = max(75, 100 - w_side - w_lead)
        plan.tmix_weights = (max(1, w_lead), w_center, max(1, w_side))

    if options.adversarial_cnn_layer:
        plan.adversarial_cnn_layer = True
        plan.cnn_epsilon = round(_scale(intensity, 1.0, 2.4), 3)
        # Zero-DC-drift asymmetric 3x3 cross kernel (sum == 100) to perturb
        # directional CNN edge filters without changing luminance.
        delta_h = rng.choice((-2, -1, 1, 2))
        delta_v = rng.choice((-2, -1, 1, 2))
        plan.cnn_kernel = (delta_v, delta_h, 100, -delta_h, -delta_v)

    if options.audio_allpass_phase:
        plan.audio_allpass_phase = True
        plan.allpass_bands = (
            (rng.randint(210, 340), round(rng.uniform(0.65, 1.15), 3)),
            (rng.randint(720, 1020), round(rng.uniform(0.70, 1.25), 3)),
            (rng.randint(2050, 2750), round(rng.uniform(0.75, 1.30), 3)),
            (rng.randint(5100, 6500), round(rng.uniform(0.70, 1.20), 3)),
        )

    if options.formant_pitch_lfo:
        plan.formant_pitch_lfo = True
        plan.vibrato_hz = round(rng.uniform(0.35, 0.68), 3)
        plan.vibrato_depth = round(_scale(intensity, 0.025, 0.085), 4)
        plan.formant_eq_hz = rng.randint(1750, 2550)
        plan.formant_eq_gain = round(rng.choice((-1, 1)) * _scale(intensity, 0.35, 0.95), 3)

    if options.psychoacoustic_rir:
        plan.psychoacoustic_rir = True
        d1 = rng.randint(5, 9)
        d2 = rng.randint(10, 15)
        w1 = round(_scale(intensity, 0.014, 0.028), 4)
        w2 = round(w1 * rng.uniform(0.60, 0.82), 4)
        plan.rir_delays_ms = (d1, d2)
        plan.rir_decays = (w1, w2)
        plan.stereo_widen = round(1.0 + rng.choice((-1, 1)) * _scale(intensity, 0.015, 0.042), 4)

    if options.authentic_atom_spoof:
        plan.authentic_atom_spoof = True
        plan.track_timescale = rng.choice((24000, 30000, 60000, 90000))

    if options.macroblock_aq_variance:
        plan.macroblock_aq_variance = True
        plan.aq_mode = rng.choice((2, 3))
        plan.aq_strength = round(rng.uniform(0.84, 1.18), 2)
        plan.psy_rd = round(rng.uniform(0.90, 1.12), 2)
        plan.psy_trellis = round(rng.uniform(0.04, 0.14), 2)
        plan.qcomp = round(rng.uniform(0.58, 0.66), 2)

    # A chosen quality tier pins the rate-control to a fixed value. This only
    # narrows the engine's own randomised CRF to a user preference; it adds no
    # hash-varying behaviour.
    if options.quality is not QualityTier.AUTO:
        plan.crf = QUALITY_TIER_CRF[options.quality]
        plan.jpeg_quality = {
            QualityTier.HIGH: 95,
            QualityTier.BALANCED: 90,
            QualityTier.COMPACT: 82,
        }[options.quality]
    return plan


# --------------------------------------------------------------------------
# filter graph construction
# --------------------------------------------------------------------------


def build_video_filters(plan: MutationPlan, info: MediaInfo) -> list[str]:
    """The whole picture chain, for the common case with no overlay."""

    pre, post = build_video_filter_stages(plan, info)
    return pre + post


def build_video_filter_stages(
    plan: MutationPlan, info: MediaInfo
) -> tuple[list[str], list[str]]:
    """Split the picture chain either side of the overlay.

    Geometry and grading run first, so an overlay is positioned against the
    final, already-cropped frame. Grain and the frame-rate change run after, so
    the overlay picks up the same per-frame noise as the rest of the picture -
    otherwise it would sit there as a pristine, unchanging region and become a
    fingerprint of its own across every variant.
    """

    pre: list[str] = []
    post: list[str] = []
    video = info.video

    if video and plan.crop_x and plan.crop_y and plan.out_width > 0 and plan.out_height > 0:
        crop_w = _even(video.width - 2 * plan.crop_x)
        crop_h = _even(video.height - 2 * plan.crop_y)
        pre.append(f"crop={crop_w}:{crop_h}:{plan.crop_x}:{plan.crop_y}")
        if (crop_w, crop_h) != (plan.out_width, plan.out_height):
            pre.append(f"scale={plan.out_width}:{plan.out_height}:flags=lanczos")
    elif plan.out_width and plan.out_height and video and (plan.out_width, plan.out_height) != (video.width, video.height):
        pre.append(f"scale={plan.out_width}:{plan.out_height}:flags=lanczos")

    # Stage 1 (Gen-4 Spatial): Sub-pixel perspective keystone warp shifts all
    # 8x8 and 16x16 DCT macroblock boundaries without clipping edge text/faces.
    if plan.elastic_mesh_warp and any(plan.perspective_offsets):
        x0, y0, x1, y1, x2, y2, x3, y3 = plan.perspective_offsets
        pre.append(
            f"perspective=x0={x0}:y0={y0}:x1=W-{x1}:y1={y1}:"
            f"x2={x2}:y2=H-{y2}:x3=W-{x3}:y3=H-{y3}:interpolation=cubic:sense=source"
        )

    if plan.mirror:
        pre.append("hflip")

    if plan.brightness or plan.contrast != 1.0 or plan.saturation != 1.0 or plan.gamma != 1.0:
        pre.append(
            "eq="
            f"brightness={plan.brightness}:"
            f"contrast={plan.contrast}:"
            f"saturation={plan.saturation}:"
            f"gamma={plan.gamma}"
        )

    if plan.hue_degrees:
        pre.append(f"hue=h={plan.hue_degrees}")

    # Stage 2 (Gen-4 Photometric): Skin-protected shadow/highlight split-toning
    # rotates shadow and highlight color vectors while locking midtones (skin).
    if plan.lut_clahe_color and (any(plan.cb_shadows) or any(plan.cb_highlights)):
        rs, gs, bs = plan.cb_shadows
        rh, gh, bh = plan.cb_highlights
        pre.append(
            f"colorbalance=rs={rs}:gs={gs}:bs={bs}:rh={rh}:gh={gh}:bh={bh}"
        )

    if plan.sharpen:
        pre.append(f"unsharp=3:3:{plan.sharpen}:3:3:0.0")

    # Stage 3 (Gen-4 Frequency): DCT Mid-Band spatial perturbation targeting
    # 5x5 mid-band frequencies that survive platform H.264/H.265 re-encoding.
    if plan.dct_jnd_perturbation and plan.dct_mid_gain:
        pre.append(f"unsharp=5:5:{plan.dct_mid_gain}:5:5:0.0")

    # Stage 4 (Gen-4 Adversarial): Directional zero-DC-drift convolution kernel
    # shifting CNN edge-filter activations without altering global luminance.
    if plan.adversarial_cnn_layer and any(plan.cnn_kernel):
        ct, cl, cc, cr, cb = plan.cnn_kernel
        rdiv = ct + cl + cc + cr + cb
        if rdiv > 0:
            matrix = f"0 {ct} 0 {cl} {cc} {cr} 0 {cb} 0"
            post.append(
                f"convolution=0m='{matrix}':1m='0 0 0 0 1 0 0 0 0':2m='0 0 0 0 1 0 0 0 0':0rdiv={rdiv}:1rdiv=1:2rdiv=1"
            )

    if plan.noise_strength:
        # allf=t+u => temporally varying, uniformly distributed noise, so the
        # grain pattern differs on every single frame.
        post.append(f"noise=alls={plan.noise_strength}:allf=t+u")

    # Stage 5 (Gen-4 Temporal): Sub-frame optical-flow-like motion blending
    # across adjacent frames while keeping a constant output frame rate.
    if plan.optical_flow_timewarp and plan.tmix_weights != (0, 100, 0):
        w0, w1, w2 = plan.tmix_weights
        post.append(f"tmix=frames=3:weights='{w0} {w1} {w2}'")

    if plan.fps:
        post.append(f"fps=fps={_fps_expression(plan.fps)}")

    post.append("setsar=1")
    post.append("format=yuv420p")
    return pre, post


# --------------------------------------------------------------------------
# image overlay
# --------------------------------------------------------------------------

# x/y expressions for each anchor. W,H are the main frame; w,h the overlay;
# OX,OY the user's margins, substituted in below.
_POSITION_EXPRESSIONS: dict[str, tuple[str, str]] = {
    "top_left": ("{ox}", "{oy}"),
    "top_center": ("(W-w)/2", "{oy}"),
    "top_right": ("W-w-({ox})", "{oy}"),
    "center_left": ("{ox}", "(H-h)/2"),
    "center": ("(W-w)/2", "(H-h)/2"),
    "center_right": ("W-w-({ox})", "(H-h)/2"),
    "bottom_left": ("{ox}", "H-h-({oy})"),
    "bottom_center": ("(W-w)/2", "H-h-({oy})"),
    "bottom_right": ("W-w-({ox})", "H-h-({oy})"),
    "custom": ("{ox}", "{oy}"),
}


def overlay_position_expressions(overlay: OverlaySettings) -> tuple[str, str]:
    x_template, y_template = _POSITION_EXPRESSIONS.get(
        overlay.position.value, _POSITION_EXPRESSIONS["bottom_right"]
    )
    return (
        x_template.format(ox=overlay.offset_x, oy=overlay.offset_y),
        y_template.format(ox=overlay.offset_x, oy=overlay.offset_y),
    )


def overlay_enable_expression(
    overlay: OverlaySettings, source_fps: float, duration: float, trim_head: float = 0.0
) -> str | None:
    """When the overlay is visible, as an ffmpeg timeline expression.

    Frame ranges are converted to timestamps using the *source* frame rate.
    Using `t` rather than `n` keeps the user's frame numbers meaningful even
    though the mutation deliberately changes the output frame rate, which would
    otherwise renumber every frame.

    ``trim_head`` is subtracted because the temporal trim seeks into the source,
    so output time zero is source time ``trim_head``. Without this the overlay
    lands a few frames early - invisible for a whole-clip watermark, but wrong
    when someone has picked exact frames.
    """

    if overlay.mode is OverlayMode.ALWAYS:
        return None

    if overlay.mode is OverlayMode.INTRO:
        # An intro is defined from the start of the delivered clip, so it is
        # not shifted by the trim.
        end = overlay.intro_seconds
        if duration > 0:
            end = min(end, duration)
        return f"between(t,0,{end:.3f})"

    fps = source_fps if source_fps and source_fps > 0 else 30.0
    windows: list[str] = []
    for frame_range in overlay.ranges:
        start = frame_range.start_frame / fps - trim_head
        # end_frame is inclusive, so the window runs to the end of that frame.
        end = (frame_range.end_frame + 1) / fps - trim_head
        start = max(start, 0.0)
        if duration > 0:
            if start >= duration:
                continue
            end = min(end, duration)
        if end <= start:
            continue
        windows.append(f"between(t,{start:.3f},{end:.3f})")

    if not windows:
        # Every requested range fell outside the clip; show nothing rather than
        # silently falling back to "always".
        return "0"
    # In ffmpeg's expression language non-zero is true, so summing the windows
    # is a logical OR across them.
    return "+".join(windows)


def build_multi_overlay_filtergraph(
    layers: list[OverlaySettings],
    plan: MutationPlan,
    info: MediaInfo,
    *,
    pre: list[str],
    post: list[str],
    duration: float,
    first_input: int,
    trim_head: float = 0.0,
) -> str:
    """-filter_complex graph compositing one or more overlays in order.

    For a single layer this is the same graph the engine has always produced
    (labels ``base``/``ovl0``/``composited``/``vout``); each extra layer adds
    another ``scale``+``overlay`` stage chained onto the last.
    """

    source_fps = info.video.fps if info.video else 30.0
    width = plan.out_width or (info.video.width if info.video else 0)

    pre_chain = ",".join(pre) if pre else "null"
    post_chain = ",".join(post) if post else "null"

    parts = [f"[0:v]{pre_chain}[base]"]
    current = "base"
    for i, layer in enumerate(layers):
        # Width as a share of the output frame; -1 keeps aspect, and an even
        # width avoids chroma-subsampling artefacts.
        overlay_width = max(2, int(round(width * layer.scale_percent / 100.0))) if width else 120
        if overlay_width % 2:
            overlay_width += 1

        chain = [
            f"scale={overlay_width}:-1:flags=lanczos",
            # rgba first, so an opacity below 1 has an alpha channel to act on
            # and a logo with its own transparency is preserved.
            "format=rgba",
        ]
        if layer.opacity < 1.0:
            chain.append(f"colorchannelmixer=aa={layer.opacity:.3f}")

        x_expression, y_expression = overlay_position_expressions(layer)
        overlay_args = [f"x={x_expression}", f"y={y_expression}"]
        enable = overlay_enable_expression(layer, source_fps, duration, trim_head)
        if enable is not None:
            overlay_args.append(f"enable='{enable}'")
        # The overlay is a still (one frame); hold it rather than ending early.
        overlay_args.append("eof_action=repeat")

        output_label = "composited" if i == len(layers) - 1 else f"step{i}"
        parts.append(f"[{first_input + i}:v]{','.join(chain)}[ovl{i}]")
        parts.append(f"[{current}][ovl{i}]overlay={':'.join(overlay_args)}[{output_label}]")
        current = output_label

    parts.append(f"[composited]{post_chain}[vout]")
    return ";".join(parts)


def composite_overlay_on_image(
    base_rgb: np.ndarray, overlay_path: Path, overlay: OverlaySettings
) -> np.ndarray:
    """Alpha-composite the overlay onto a still, honouring position and opacity.

    Frame-range and intro modes have no meaning for a still, so the overlay is
    simply drawn; position, scale and opacity all behave as they do for video.
    """

    with Image.open(overlay_path) as handle:
        badge = handle.convert("RGBA")

    height, width = base_rgb.shape[:2]
    target_width = max(1, int(round(width * overlay.scale_percent / 100.0)))
    target_height = max(1, int(round(badge.height * target_width / badge.width)))
    badge = badge.resize((target_width, target_height), Image.LANCZOS)

    if overlay.opacity < 1.0:
        alpha = badge.getchannel("A").point(lambda value: int(value * overlay.opacity))
        badge.putalpha(alpha)

    x, y = _still_overlay_origin(
        overlay, width, height, target_width, target_height
    )

    canvas = Image.fromarray(base_rgb).convert("RGBA")
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(badge, (x, y), badge)
    return np.array(Image.alpha_composite(canvas, layer).convert("RGB"))


def _still_overlay_origin(
    overlay: OverlaySettings, width: int, height: int, badge_w: int, badge_h: int
) -> tuple[int, int]:
    """Top-left pixel for the overlay, matching the video anchor semantics."""

    ox, oy = overlay.offset_x, overlay.offset_y
    position = overlay.position.value

    if position == "custom":
        return ox, oy

    if position.endswith("_left"):
        x = ox
    elif position.endswith("_right"):
        x = width - badge_w - ox
    else:
        x = (width - badge_w) // 2

    if position.startswith("top"):
        y = oy
    elif position.startswith("bottom"):
        y = height - badge_h - oy
    else:
        y = (height - badge_h) // 2

    return x, y


def resolve_overlay_images(options: MutationOptions) -> list[tuple[OverlaySettings, Path]]:
    """Every overlay layer with a stored image, in composite order."""

    resolved: list[tuple[OverlaySettings, Path]] = []
    for layer in options.effective_overlays():
        name = Path(layer.image_filename or "").name
        if not name:
            continue
        candidate = settings.uploads_dir / name
        if candidate.exists():
            resolved.append((layer, candidate))
    return resolved


# Containers whose cover art a remux can embed as an mp4/mov-style poster.
_POSTER_EMBED_CONTAINERS = {"mp4", "mov", "m4v"}


def generate_poster(
    source: Path,
    target: Path,
    options: MutationOptions,
    info: MediaInfo,
    container: str,
) -> str | None:
    """Pick the thumbnail/poster frame for ``target``.

    Extracts the user's chosen frame from the *source* (clamped to its
    duration) into a sidecar JPG next to the output and, for containers that
    support cover art, embeds it so players show that frame. Best-effort: a
    failed embed keeps the sidecar and never fails the render.

    Returns the sidecar filename, or None when no poster was requested.
    """

    if not options.poster.enabled:
        return None

    duration = info.duration or 0.0
    timestamp = max(0.0, float(options.poster.timestamp))
    if duration > 0.1:
        timestamp = min(timestamp, max(duration - 0.05, 0.0))

    poster_path = target.with_name(f"{target.stem}.poster.jpg")
    try:
        run_ffmpeg(
            ["-ss", f"{timestamp:.3f}", "-i", str(source), "-frames:v", "1", "-q:v", "3", str(poster_path)],
            stage="poster",
        )
    except MediaError:
        logger.warning("poster extraction failed for %s", source.name, exc_info=True)
        return None
    if not poster_path.exists() or poster_path.stat().st_size == 0:
        return None

    if container in _POSTER_EMBED_CONTAINERS:
        embedded = target.with_name(f"{target.stem}.poster{target.suffix}")
        try:
            run_ffmpeg(
                [
                    "-i",
                    str(target),
                    "-i",
                    str(poster_path),
                    "-map",
                    "0",
                    "-map",
                    "1",
                    "-c",
                    "copy",
                    "-disposition:v:1",
                    "attached_pic",
                    str(embedded),
                ],
                stage="poster",
            )
            if embedded.exists() and embedded.stat().st_size > 0:
                embedded.replace(target)
            else:
                embedded.unlink(missing_ok=True)
        except MediaError:
            # A container that rejects cover art still gets the sidecar.
            logger.info("poster embed skipped for %s", target.name, exc_info=True)
            embedded.unlink(missing_ok=True)

    return poster_path.name


def _fps_expression(fps: float) -> str:
    """Render NTSC-style rates as exact fractions so ffmpeg does not round."""

    ntsc = {23.976: "24000/1001", 29.97: "30000/1001", 47.952: "48000/1001", 59.94: "60000/1001"}
    for value, expression in ntsc.items():
        if math.isclose(fps, value, abs_tol=0.01):
            return expression
    return f"{fps:g}"


def build_audio_filters(plan: MutationPlan, info: MediaInfo) -> list[str]:
    if not info.audio:
        return []
    filters: list[str] = []
    sample_rate = info.audio.sample_rate or 44100

    if not math.isclose(plan.pitch_ratio, 1.0, abs_tol=1e-4):
        # asetrate shifts pitch *and* duration; atempo puts the duration back,
        # leaving a pitch-shifted track that defeats ASR/audio-fingerprinting
        # while staying in sync with the picture.
        filters.append(f"asetrate={int(sample_rate * plan.pitch_ratio)}")
        filters.append(f"aresample={sample_rate}")
        filters.extend(_atempo_chain(1.0 / plan.pitch_ratio))

    if not math.isclose(plan.tempo_ratio, 1.0, abs_tol=1e-4):
        filters.extend(_atempo_chain(plan.tempo_ratio))

    # Stage 5a (Gen-4 Psychoacoustic): All-pass phase dispersion cascades 4
    # biquad all-pass stages to rotate STFT phase without altering EQ/tone.
    if plan.audio_allpass_phase and plan.allpass_bands:
        for freq, q_val in plan.allpass_bands:
            filters.append(f"allpass=f={freq}:t=q:w={q_val}")

    # Stage 5b (Gen-4 Psychoacoustic): Formant-preserving sub-audible LFO pitch
    # modulation with formant-band EQ compensation.
    if plan.formant_pitch_lfo and plan.vibrato_hz > 0 and plan.vibrato_depth > 0:
        filters.append(f"vibrato=f={plan.vibrato_hz}:d={plan.vibrato_depth}")
        if plan.formant_eq_hz and plan.formant_eq_gain:
            filters.append(
                f"equalizer=f={plan.formant_eq_hz}:t=q:w=1.2:g={plan.formant_eq_gain}"
            )

    # Stage 5c (Gen-4 Psychoacoustic): Ultra-short studio early reflections
    # (micro-RIR) below the human echo threshold to shift constellation peaks.
    if plan.psychoacoustic_rir and any(plan.rir_delays_ms):
        d1, d2 = plan.rir_delays_ms
        w1, w2 = plan.rir_decays
        if d1 > 0 and w1 > 0:
            filters.append(f"aecho=0.92:0.90:{d1}:{w1}")
        if d2 > 0 and w2 > 0:
            filters.append(f"aecho=0.95:0.93:{d2}:{w2}")
        if info.audio.channels >= 2 and not math.isclose(plan.stereo_widen, 1.0, abs_tol=1e-4):
            filters.append(f"extrastereo=m={plan.stereo_widen}")

    if plan.highpass_hz:
        filters.append(f"highpass=f={plan.highpass_hz}")

    if plan.audio_gain_db:
        filters.append(f"volume={plan.audio_gain_db}dB")

    filters.append(f"aresample={sample_rate}:first_pts=0")
    return filters


def _atempo_chain(ratio: float) -> list[str]:
    """atempo only accepts 0.5..2.0 per instance; chain for extreme ratios."""

    ratio = _clamp(ratio, 0.25, 4.0)
    chain: list[str] = []
    while ratio < 0.5:
        chain.append("atempo=0.5")
        ratio /= 0.5
    while ratio > 2.0:
        chain.append("atempo=2.0")
        ratio /= 2.0
    if not math.isclose(ratio, 1.0, abs_tol=1e-6):
        chain.append(f"atempo={ratio:.6f}")
    return chain


def metadata_strip_args() -> list[str]:
    """Arguments that leave the output container free of provenance data."""

    return [
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-fflags",
        "+bitexact",
        "-flags:v",
        "+bitexact",
        "-flags:a",
        "+bitexact",
        "-metadata",
        "encoder=",
        "-metadata",
        "comment=",
        "-metadata",
        "title=",
        "-metadata",
        "artist=",
        "-metadata",
        "handler_name=",
        "-write_tmcd",
        "0",
    ]


def _codec_args(container: str, plan: MutationPlan, info: MediaInfo) -> list[str]:
    if container == "webm":
        args = [
            "-c:v",
            "libvpx-vp9",
            "-crf",
            str(plan.crf + 8),
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-g",
            str(plan.gop),
        ]
        if plan.macroblock_aq_variance:
            args += ["-aq-mode", str(plan.aq_mode)]
        if info.has_audio:
            args += ["-c:a", "libopus", "-b:a", "128k"]
        return args

    args = [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(plan.crf),
        "-g",
        str(plan.gop),
        "-keyint_min",
        str(max(2, plan.gop // 2)),
        "-sc_threshold",
        "0",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
    ]
    if plan.macroblock_aq_variance:
        args += [
            "-aq-mode",
            str(plan.aq_mode),
            "-aq-strength",
            f"{plan.aq_strength:.2f}",
            "-psy-rd",
            f"{plan.psy_rd:.2f}:{plan.psy_trellis:.2f}",
            "-qcomp",
            f"{plan.qcomp:.2f}",
        ]
    if plan.authentic_atom_spoof:
        args += [
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
        ]
    if info.has_audio:
        args += ["-c:a", "aac", "-b:a", "160k", "-ar", str(info.audio.sample_rate or 44100)]
    if container in {"mp4", "mov"}:
        movflags = "+faststart+write_colr" if plan.authentic_atom_spoof else "+faststart"
        args += ["-movflags", movflags]
        if plan.authentic_atom_spoof and plan.track_timescale:
            args += ["-video_track_timescale", str(plan.track_timescale)]
    return args


# --------------------------------------------------------------------------
# Gen-4 OpenCV Signal & Spatial Processors (Image & Frame Level)
# --------------------------------------------------------------------------


def _apply_elastic_mesh_image(image: np.ndarray, plan: MutationPlan) -> np.ndarray:
    """Apply a smooth, continuous 2D low-frequency elastic displacement grid
    plus micro-perspective warp so every 8x8/16x16 block boundary shifts
    without clipping edges or distorting text.
    """

    height, width = image.shape[:2]
    if height < 16 or width < 16:
        return image

    rng = np.random.default_rng(plan.seed ^ 0x5A17)
    grid_h, grid_w = max(6, height // 48), max(6, width // 48)
    amp = float(plan.mesh_amplitude or 1.5)

    dx_coarse = rng.uniform(-amp, amp, size=(grid_h, grid_w)).astype(np.float32)
    dy_coarse = rng.uniform(-amp, amp, size=(grid_h, grid_w)).astype(np.float32)
    # Taper displacement to zero at the outer borders so edges are never clipped.
    dx_coarse[0, :] = dx_coarse[-1, :] = dx_coarse[:, 0] = dx_coarse[:, -1] = 0.0
    dy_coarse[0, :] = dy_coarse[-1, :] = dy_coarse[:, 0] = dy_coarse[:, -1] = 0.0

    dx = cv2.resize(dx_coarse, (width, height), interpolation=cv2.INTER_CUBIC)
    dy = cv2.resize(dy_coarse, (width, height), interpolation=cv2.INTER_CUBIC)

    xs, ys = np.meshgrid(
        np.arange(width, dtype=np.float32),
        np.arange(height, dtype=np.float32),
    )
    map_x = xs + dx
    map_y = ys + dy
    return cv2.remap(
        image,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def _apply_lut_clahe_color_image(image: np.ndarray, plan: MutationPlan) -> np.ndarray:
    """Apply local Contrast Limited Adaptive Histogram Equalization (CLAHE) on
    the LAB luminance channel (defeating global histogram normalization) and
    rotate shadow/highlight chrominance vectors while protecting skin tones.
    """

    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)

    clip_limit = float(plan.clahe_clip or 1.2)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l_chan)
    # Blend at 24% opacity so local contrast relationships shift without harshness.
    l_out = cv2.addWeighted(l_chan, 0.76, l_clahe, 0.24, 0)

    # Protect skin-tone corridor while subtly rotating shadow/highlight A/B vectors.
    l_norm = l_out.astype(np.float32) / 255.0
    shadow_mask = np.clip(1.0 - l_norm * 2.0, 0.0, 1.0)
    highlight_mask = np.clip((l_norm - 0.5) * 2.0, 0.0, 1.0)

    rs, gs, bs = plan.cb_shadows
    rh, gh, bh = plan.cb_highlights
    a_shift = (rs - gs) * 14.0 * shadow_mask + (rh - gh) * 14.0 * highlight_mask
    b_shift = (gs - bs) * 14.0 * shadow_mask + (gh - bh) * 14.0 * highlight_mask

    a_out = np.clip(a_chan.astype(np.float32) + a_shift, 0, 255).astype(np.uint8)
    b_out = np.clip(b_chan.astype(np.float32) + b_shift, 0, 255).astype(np.uint8)

    merged = cv2.merge((l_out, a_out, b_out))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)


def _apply_dct_jnd_image(working: np.ndarray, plan: MutationPlan) -> np.ndarray:
    """Inject mid-band frequency perturbation strictly masked by a Just
    Noticeable Difference (JND) spatial-variance map so flat areas stay clean
    and perturbations survive platform re-encoding.
    """

    height, width = working.shape[:2]
    gray = cv2.cvtColor(np.clip(working, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    local_mean = cv2.blur(gray, (7, 7))
    local_sq_mean = cv2.blur(gray * gray, (7, 7))
    local_std = np.sqrt(np.maximum(local_sq_mean - local_mean * local_mean, 0.0))
    # JND mask: near 0 in flat areas (skies, smooth skin), up to 1.0 on edges/textures.
    jnd_mask = np.clip(local_std / 28.0, 0.08, 1.0)[..., None]

    # Mid-frequency band-pass carrier (wavelength ~6-10px, inside 8x8 DCT mid-band).
    rng = np.random.default_rng(plan.seed ^ 0x9E37)
    mid_h, mid_w = max(8, height // 4), max(8, width // 4)
    carrier_raw = rng.normal(0.0, 1.0, size=(mid_h, mid_w, 3)).astype(np.float32)
    carrier_up = cv2.resize(carrier_raw, (width, height), interpolation=cv2.INTER_CUBIC)
    carrier_low = cv2.GaussianBlur(carrier_up, (9, 9), 2.2)
    mid_band = carrier_up - carrier_low

    strength = float(plan.jnd_strength or 2.2)
    return working + mid_band * jnd_mask * strength


def _apply_adversarial_cnn_image(working: np.ndarray, plan: MutationPlan) -> np.ndarray:
    """Inject an epsilon-bounded multi-orientation Gabor frequency grating
    masked by Sobel edge energy to shift CNN/ViT feature embeddings.
    """

    height, width = working.shape[:2]
    gray = cv2.cvtColor(np.clip(working, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    edge_mag = np.clip(np.hypot(gx, gy) / 120.0, 0.15, 1.0)[..., None]

    rng = np.random.default_rng(plan.seed ^ 0xC3A5)
    theta1 = float(rng.uniform(0.2, math.pi - 0.2))
    theta2 = theta1 + math.pi / 3.0
    freq = float(rng.uniform(0.35, 0.65))

    xs, ys = np.meshgrid(
        np.arange(width, dtype=np.float32),
        np.arange(height, dtype=np.float32),
    )
    grating1 = np.sin((xs * math.cos(theta1) + ys * math.sin(theta1)) * freq)
    grating2 = np.cos((xs * math.cos(theta2) + ys * math.sin(theta2)) * freq * 1.3)
    pattern = ((grating1 + grating2) * 0.5)[..., None]

    channel_signs = np.array([1.0, -0.85, 0.9], dtype=np.float32).reshape((1, 1, 3))
    eps = float(plan.cnn_epsilon or 1.5)
    return working + pattern * edge_mag * channel_signs * eps


# --------------------------------------------------------------------------
# video pipeline
# --------------------------------------------------------------------------


def _deep_scramble_video(
    source: Path,
    target: Path,
    plan: MutationPlan,
    info: MediaInfo,
    on_progress: ProgressCallback | None,
) -> None:
    """Rewrite every frame through OpenCV before handing it back to ffmpeg.

    ffmpeg's own filters are deterministic per-frame transforms; this pass adds
    a slowly drifting, spatially smooth noise field plus sub-pixel geometric
    jitter, which is what actually breaks perceptual-hash *sequences* rather
    than single frames.
    """

    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise MutationError(f"OpenCV could not open {source.name}")

    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = capture.get(cv2.CAP_PROP_FPS) or info.video.fps if info.video else 30.0
        if not fps or fps <= 0:
            fps = 30.0
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if width <= 0 or height <= 0:
            raise MutationError(f"{source.name} reports an empty video stream")

        writer = open_ffmpeg_writer(
            [
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{width}x{height}",
                "-r",
                f"{fps:.6f}",
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                str(max(16, plan.crf - 2)),
                "-pix_fmt",
                "yuv420p",
                *metadata_strip_args(),
                str(target),
            ]
        )

        rng = np.random.default_rng(plan.seed)
        # A low-resolution field, upscaled per frame, gives smooth "film grain"
        # style perturbation instead of per-pixel salt and pepper.
        field_h, field_w = max(8, height // 40), max(8, width // 40)
        base_field = rng.normal(0.0, 1.0, size=(field_h, field_w, 3)).astype(np.float32)
        drift_field = rng.normal(0.0, 1.0, size=(field_h, field_w, 3)).astype(np.float32)
        amplitude = float(np.clip(plan.noise_strength * 0.55 + 1.2, 1.0, 12.0))

        # Full-resolution scratch buffers, allocated once and reused for every
        # frame. The per-frame maths below writes into these in place rather
        # than allocating a fresh array at each step; on an HD/4K clip that is
        # the difference between a steady footprint and a spike of ~8 full-frame
        # float arrays per frame, which is what was OOM-killing the worker on
        # larger uploads. Two float32 buffers are the minimum: warpAffine cannot
        # read and write the same array, so it needs a distinct destination.
        # ``scratch`` first holds the noise field (consumed into ``work``) and
        # is then reused as the warp destination. The arithmetic and its order
        # are unchanged, so the encoded output is byte-for-byte identical.
        scratch = np.empty((height, width, 3), dtype=np.float32)
        work = np.empty((height, width, 3), dtype=np.float32)
        out_u8 = np.empty((height, width, 3), dtype=np.uint8)

        index = 0
        assert writer.stdin is not None
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break

                phase = math.sin(index * 0.11) * 0.5 + 0.5
                field = base_field * phase + drift_field * (1.0 - phase)
                # noise = resize(field) * amplitude
                cv2.resize(field, (width, height), dst=scratch, interpolation=cv2.INTER_CUBIC)
                scratch *= amplitude

                # mutated = frame.astype(float32) + noise  (uint8 -> float32 is exact)
                work[:] = frame
                work += scratch

                # Sub-pixel translation: invisible to a viewer, fatal to any
                # matcher that assumes a stable pixel grid. warpAffine reads from
                # ``work`` and writes into ``scratch`` (the noise is spent by now).
                dx = math.sin(index * 0.037 + plan.seed % 7) * 0.7
                dy = math.cos(index * 0.029 + plan.seed % 5) * 0.7
                matrix = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]], dtype=np.float32)
                cv2.warpAffine(
                    work,
                    matrix,
                    (width, height),
                    dst=scratch,
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REFLECT_101,
                )

                gamma = 1.0 + math.sin(index * 0.013) * 0.012
                # mutated = power(clip(mutated)/255, gamma) * 255, then clip again
                np.clip(scratch, 0, 255, out=scratch)
                scratch /= 255.0
                np.power(scratch, gamma, out=scratch)
                scratch *= 255.0
                np.clip(scratch, 0, 255, out=scratch)

                # float32 -> uint8 assignment truncates exactly like astype(uint8)
                out_u8[:] = scratch
                writer.stdin.write(out_u8.tobytes())

                index += 1
                if on_progress and total_frames > 0 and index % 15 == 0:
                    on_progress(min(index / total_frames, 1.0), "deep-scramble")
        finally:
            try:
                writer.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            stderr = writer.stderr.read() if writer.stderr else b""
            code = writer.wait()
            if code != 0:
                raise MutationError(
                    "deep scramble encoder failed: "
                    + describe_ffmpeg_exit(code, stderr.decode("utf-8", "replace"))
                )
        if index == 0:
            raise MutationError(f"no decodable frames in {source.name}")
    finally:
        capture.release()


def mutate_video(
    source: Path,
    target: Path,
    options: MutationOptions,
    *,
    rng: random.Random,
    on_progress: ProgressCallback | None = None,
    work_dir: Path | None = None,
) -> MutationReport:
    info = probe(source)
    if not info.has_video:
        raise MutationError(f"{source.name} does not contain a video stream")
    if settings.video_max_duration and info.duration > settings.video_max_duration:
        raise MutationError(
            f"{source.name} is {info.duration:.0f}s long; the limit is {settings.video_max_duration}s"
        )

    video = info.video
    plan = build_plan(
        options,
        rng,
        width=video.width,
        height=video.height,
        duration=info.duration,
        source_fps=video.fps or 30.0,
    )

    container = (options.output_format or target.suffix.lstrip(".") or "mp4").lower()
    if container not in VIDEO_CONTAINERS:
        container = "mp4"
    target = target.with_suffix(f".{container}")

    work_dir = work_dir or settings.work_dir
    work_dir.mkdir(parents=True, exist_ok=True)

    applied: list[str] = []
    scratch: Path | None = None
    render_source = source

    try:
        if plan.deep_scramble:
            scratch = work_dir / f"{target.stem}.scramble.mp4"
            _deep_scramble_video(
                source,
                scratch,
                plan,
                info,
                (lambda fraction, _stage: on_progress(fraction * 0.55, "deep-scramble")) if on_progress else None,
            )
            render_source = scratch
            applied.append("opencv deep frame scramble")

        pre_filters, post_filters = build_video_filter_stages(plan, info)
        audio_filters = build_audio_filters(plan, info)
        overlays = resolve_overlay_images(options)

        effective_duration = max(info.duration - plan.trim_head - plan.trim_tail, 0.1)
        seek: list[str] = ["-ss", f"{plan.trim_head:.3f}"] if plan.trim_head else []
        take_audio_from_source = plan.deep_scramble and info.has_audio

        # Input options must precede the -i they apply to; -t is added once
        # afterwards as an output option so it bounds the muxed result.
        args: list[str] = [*seek, "-i", str(render_source)]
        if take_audio_from_source:
            # The scramble pass is video-only; pull audio from the original.
            args += [*seek, "-i", str(source)]
        if plan.trim_head or plan.trim_tail:
            args += ["-t", f"{effective_duration:.3f}"]

        if overlays:
            # Each overlay is a still image looped for the length of the clip.
            first_overlay_input = 2 if take_audio_from_source else 1
            for _layer, overlay_path in overlays:
                args += ["-loop", "1", "-framerate", "25", "-i", str(overlay_path)]
            graph = build_multi_overlay_filtergraph(
                [layer for layer, _ in overlays],
                plan,
                info,
                pre=pre_filters,
                post=post_filters,
                duration=effective_duration,
                first_input=first_overlay_input,
                trim_head=plan.trim_head,
            )
            args += ["-filter_complex", graph, "-map", "[vout]"]
            # -loop makes the overlay inputs infinite, so the output length has
            # to come from the video rather than the longest input.
            args += ["-shortest"]
        else:
            args += ["-map", "0:v:0"]
            video_filters = pre_filters + post_filters
            if video_filters:
                args += ["-vf", ",".join(video_filters)]

        if take_audio_from_source:
            args += ["-map", "1:a:0?"]
        elif info.has_audio:
            args += ["-map", "0:a:0?"]

        if audio_filters and info.has_audio:
            args += ["-af", ",".join(audio_filters)]
        elif not info.has_audio:
            args += ["-an"]

        codec_args = _codec_args(container, plan, info)
        args += codec_args
        video_codec = codec_args[codec_args.index("-c:v") + 1] if "-c:v" in codec_args else ""
        if options.strip_metadata:
            # Drops the x264/x265 SEI that otherwise carries the encoder
            # version and its full option string inside the bitstream.
            args += bitstream_filter_args(video_codec)
        if settings.ffmpeg_threads:
            args += ["-threads", str(settings.ffmpeg_threads)]
        if options.strip_metadata:
            args += metadata_strip_args()
        args += ["-map_metadata:s:v", "-1"]
        if info.has_audio:
            args += ["-map_metadata:s:a", "-1"]
        args.append(str(target))

        base = 0.55 if plan.deep_scramble else 0.0
        span = 1.0 - base

        def report(fraction: float, stage: str) -> None:
            if on_progress:
                on_progress(base + fraction * span, stage)

        run_ffmpeg(
            args,
            total_duration=effective_duration,
            on_progress=report if on_progress else None,
            stage="encoding",
        )
    finally:
        if scratch and scratch.exists():
            scratch.unlink(missing_ok=True)

    if not target.exists() or target.stat().st_size == 0:
        raise MutationError("the encoder produced an empty file")

    scrub_report = scrub_container(target) if options.strip_metadata else {}

    poster_name = generate_poster(source, target, options, info, container)

    if plan.crop_x or plan.crop_y:
        applied.append(f"micro-crop {plan.crop_x}px x {plan.crop_y}px -> {plan.out_width}x{plan.out_height}")
    if plan.elastic_mesh_warp:
        applied.append("sub-pixel perspective & macroblock grid warp")
    if plan.fps:
        applied.append(f"frame rate staggered to {plan.fps:g}fps")
    if plan.optical_flow_timewarp:
        w0, w1, w2 = plan.tmix_weights
        applied.append(f"temporal motion micro-interpolation ({w0}:{w1}:{w2})")
    if plan.noise_strength:
        applied.append(f"temporal noise layer (strength {plan.noise_strength})")
    if plan.dct_jnd_perturbation:
        applied.append(f"DCT mid-band & JND psychovisual perturbation ({plan.dct_mid_gain:+.3f})")
    if plan.brightness or plan.contrast != 1.0 or plan.saturation != 1.0 or plan.gamma != 1.0:
        applied.append("sub-perceptual colour and gamma drift")
    if plan.lut_clahe_color:
        applied.append("skin-protected 3D LUT shadow/highlight vector modulation")
    if plan.hue_degrees:
        applied.append(f"hue rotated {plan.hue_degrees:+.2f}deg")
    if plan.adversarial_cnn_layer:
        applied.append("adversarial CNN directional edge-phase perturbation")
    if plan.keyframe_gop_jitter:
        applied.append(f"gop jittered (keyint {plan.gop})")
    if plan.container_bitrate_shuffle:
        applied.append("bitrate and container shuffle enabled")
    if plan.macroblock_aq_variance:
        applied.append(f"macroblock AQ variance (mode {plan.aq_mode}, strength {plan.aq_strength:.2f})")
    if plan.chroma_matrix_shift:
        applied.append("chroma matrix shift applied")
    if plan.frequency_smoothing:
        applied.append("frequency smoothing enabled")
    if plan.mirror:
        applied.append("horizontal mirror")
    if plan.trim_head or plan.trim_tail:
        applied.append(f"temporal trim -{plan.trim_head:.2f}s / -{plan.trim_tail:.2f}s")
    if info.has_audio and not math.isclose(plan.pitch_ratio, 1.0, abs_tol=1e-4):
        applied.append(f"audio pitch shifted x{plan.pitch_ratio:.4f} (ASR desync)")
    if info.has_audio and not math.isclose(plan.tempo_ratio, 1.0, abs_tol=1e-4):
        applied.append(f"audio tempo x{plan.tempo_ratio:.4f}")
    if info.has_audio and plan.audio_allpass_phase:
        applied.append("4-stage biquad all-pass audio phase dispersion")
    if info.has_audio and plan.formant_pitch_lfo:
        applied.append(f"formant-locked micro-pitch LFO ({plan.vibrato_hz:.2f}Hz)")
    if info.has_audio and plan.psychoacoustic_rir:
        d1, d2 = plan.rir_delays_ms
        applied.append(f"psychoacoustic micro-RIR early reflections ({d1}ms/{d2}ms)")
    for layer, _ in overlays:
        applied.append(_overlay_applied_line(layer))
    if options.upscale_to and video.height < options.upscale_to:
        applied.append(f"upscaled to {plan.out_width}x{plan.out_height}")
    elif options.keep_resolution:
        applied.append(f"resolution preserved at {plan.out_width}x{plan.out_height}")
    if options.quality is not QualityTier.AUTO:
        applied.append(f"{options.quality.value} quality (crf {plan.crf})")
    if poster_name:
        applied.append(f"poster frame set at {options.poster.timestamp:g}s")
    if plan.authentic_atom_spoof:
        applied.append(f"authentic Rec.709 colr & track timescale ({plan.track_timescale}Hz) atom structure")
    if options.strip_metadata:
        applied.append("container metadata, chapters and encoder tags stripped")
        applied.append("encoder SEI and compressor signatures scrubbed")
    applied.append(f"re-encoded (crf {plan.crf}, gop {plan.gop})")

    metrics: dict[str, Any] = {
        "source_sha256": sha256_file(source),
        "output_sha256": sha256_file(target),
        "source_bytes": source.stat().st_size,
        "output_bytes": target.stat().st_size,
        "source_resolution": f"{video.width}x{video.height}",
        "output_resolution": f"{plan.out_width}x{plan.out_height}",
        "source_fps": video.fps,
        "output_fps": plan.fps or video.fps,
        "duration": round(effective_duration, 3),
        "seed": plan.seed,
    }
    metrics.update(perceptual_delta(source, target, AssetKind.VIDEO))
    metrics["residual_tags"] = sorted(
        tag
        for tag, value in probe(target).tags.items()
        if tag.lower() not in STRUCTURAL_CONTAINER_TAGS and value.strip("\x00 ")
    )
    metrics["scrubbed_signatures"] = sum(scrub_report.values())
    return MutationReport(
        output_path=target, applied=applied, metrics=metrics, poster_filename=poster_name
    )


def _overlay_applied_line(overlay: OverlaySettings) -> str:
    if overlay.mode is OverlayMode.ALWAYS:
        when = "every frame"
    elif overlay.mode is OverlayMode.INTRO:
        when = f"first {overlay.intro_seconds:g}s"
    else:
        when = f"{len(overlay.ranges)} frame range(s)"
    return (
        f"image overlay at {overlay.position.value.replace('_', ' ')} "
        f"({overlay.scale_percent:g}% width, {overlay.opacity:.0%} opacity) on {when}"
    )


# --------------------------------------------------------------------------
# image pipeline
# --------------------------------------------------------------------------


def mutate_image(
    source: Path,
    target: Path,
    options: MutationOptions,
    *,
    rng: random.Random,
    on_progress: ProgressCallback | None = None,
) -> MutationReport:
    with Image.open(source) as handle:
        handle = handle.convert("RGB") if handle.mode not in {"RGB", "L"} else handle.convert("RGB")
        array = np.array(handle)

    if array.size == 0:
        raise MutationError(f"{source.name} decoded to an empty image")

    height, width = array.shape[:2]
    plan = build_plan(options, rng, width=width, height=height)
    if on_progress:
        on_progress(0.15, "planning")

    applied: list[str] = []

    if plan.crop_x or plan.crop_y:
        x0 = min(plan.crop_x, max(0, width // 4))
        y0 = min(plan.crop_y, max(0, height // 4))
        array = array[y0 : height - y0, x0 : width - x0]
        applied.append(f"micro-crop {x0}px x {y0}px")

    out_w = plan.out_width or array.shape[1]
    out_h = plan.out_height or array.shape[0]
    if (array.shape[1], array.shape[0]) != (out_w, out_h) and out_w > 0 and out_h > 0:
        array = cv2.resize(array, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
        applied.append(f"lanczos resample -> {out_w}x{out_h}")

    if plan.elastic_mesh_warp:
        array = _apply_elastic_mesh_image(array, plan)
        applied.append(f"sub-pixel elastic mesh warp ({plan.mesh_amplitude:.2f}px)")

    if plan.mirror:
        array = np.ascontiguousarray(array[:, ::-1])
        applied.append("horizontal mirror")

    if plan.lut_clahe_color:
        array = _apply_lut_clahe_color_image(array, plan)
        applied.append(f"skin-protected LAB CLAHE & 3D LUT modulation (clip {plan.clahe_clip:.2f})")

    if on_progress:
        on_progress(0.45, "signal")

    working = array.astype(np.float32)

    if plan.dct_jnd_perturbation:
        working = _apply_dct_jnd_image(working, plan)
        applied.append(f"DCT mid-band & JND psychovisual perturbation (strength {plan.jnd_strength:.2f})")

    if plan.adversarial_cnn_layer:
        working = _apply_adversarial_cnn_image(working, plan)
        applied.append(f"adversarial CNN Gabor edge perturbation (eps {plan.cnn_epsilon:.2f})")

    if plan.noise_strength:
        generator = np.random.default_rng(plan.seed)
        field_h = max(4, working.shape[0] // 32)
        field_w = max(4, working.shape[1] // 32)
        coarse = generator.normal(0.0, 1.0, size=(field_h, field_w, 3)).astype(np.float32)
        smooth = cv2.resize(coarse, (working.shape[1], working.shape[0]), interpolation=cv2.INTER_CUBIC)
        fine = generator.normal(0.0, 1.0, size=working.shape).astype(np.float32)
        working += smooth * plan.noise_strength * 0.6 + fine * plan.noise_strength * 0.35
        applied.append(f"dual-band noise layer (strength {plan.noise_strength})")

    if plan.contrast != 1.0 or plan.brightness:
        working = (working - 127.5) * plan.contrast + 127.5 + plan.brightness * 255.0
        applied.append("contrast and brightness drift")

    if plan.gamma != 1.0:
        working = np.power(np.clip(working, 0, 255) / 255.0, plan.gamma) * 255.0
        applied.append(f"gamma {plan.gamma:.4f}")

    working = np.clip(working, 0, 255).astype(np.uint8)

    if plan.saturation != 1.0 or plan.hue_degrees:
        hsv = cv2.cvtColor(working, cv2.COLOR_RGB2HSV).astype(np.float32)
        hsv[..., 0] = (hsv[..., 0] + plan.hue_degrees / 2.0) % 180.0
        hsv[..., 1] = np.clip(hsv[..., 1] * plan.saturation, 0, 255)
        working = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)
        applied.append("hue and saturation drift")

    for layer, overlay_path in resolve_overlay_images(options):
        working = composite_overlay_on_image(working, overlay_path, layer)
        applied.append(
            f"image overlay at {layer.position.value.replace('_', ' ')} "
            f"({layer.scale_percent:g}% width, {layer.opacity:.0%} opacity)"
        )

    if plan.sharpen:
        blurred = cv2.GaussianBlur(working, (0, 0), 1.1)
        working = cv2.addWeighted(working, 1.0 + plan.sharpen, blurred, -plan.sharpen, 0)
        applied.append("unsharp micro-pass")

    if on_progress:
        on_progress(0.75, "encoding")

    container = (options.output_format or target.suffix.lstrip(".") or "jpg").lower()
    if container not in IMAGE_CONTAINERS:
        container = "jpg"
    if container == "jpeg":
        container = "jpg"
    target = target.with_suffix(f".{container}")

    image = Image.fromarray(working)
    save_kwargs: dict[str, Any] = {}
    if container in {"jpg", "jpeg"}:
        save_kwargs = {
            "format": "JPEG",
            "quality": plan.jpeg_quality,
            "optimize": True,
            "progressive": bool(rng.getrandbits(1)),
            "subsampling": rng.choice([0, 1, 2]),
        }
    elif container == "png":
        save_kwargs = {"format": "PNG", "optimize": True, "compress_level": rng.randint(6, 9)}
    else:
        save_kwargs = {"format": "WEBP", "quality": plan.jpeg_quality, "method": 5}

    # Writing from a bare ndarray-backed Image never carries EXIF, ICC, XMP or
    # PNG text chunks across, so the output is provenance-free by construction.
    image.save(target, **save_kwargs)

    if options.strip_metadata:
        applied.append("EXIF, XMP, ICC and vendor chunks removed")

    if not target.exists() or target.stat().st_size == 0:
        raise MutationError("image encoding produced an empty file")

    metrics: dict[str, Any] = {
        "source_sha256": sha256_file(source),
        "output_sha256": sha256_file(target),
        "source_bytes": source.stat().st_size,
        "output_bytes": target.stat().st_size,
        "source_resolution": f"{width}x{height}",
        "output_resolution": f"{working.shape[1]}x{working.shape[0]}",
        "seed": plan.seed,
        "residual_exif_tags": _residual_exif(target),
    }
    metrics.update(perceptual_delta(source, target, AssetKind.IMAGE))
    if on_progress:
        on_progress(1.0, "done")
    return MutationReport(output_path=target, applied=applied, metrics=metrics)


def _residual_exif(path: Path) -> int:
    """Count any EXIF tags that survived; a clean strip returns 0."""

    try:
        import piexif

        data = piexif.load(str(path))
        return sum(len(section) for section in data.values() if isinstance(section, dict))
    except Exception:
        return 0


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------


def mutate(
    source: Path,
    target: Path,
    kind: AssetKind,
    options: MutationOptions,
    *,
    seed: int | None = None,
    on_progress: ProgressCallback | None = None,
) -> MutationReport:
    """Mutate ``source`` into ``target``; raises :class:`MutationError` on failure."""

    if not source.exists():
        raise MutationError(f"source asset {source.name} is missing")

    rng = random.Random(seed if seed is not None else options.seed)
    if seed is None and options.seed is None:
        rng = random.Random()

    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        if kind is AssetKind.VIDEO:
            return mutate_video(source, target, options, rng=rng, on_progress=on_progress)
        return mutate_image(source, target, options, rng=rng, on_progress=on_progress)
    except MediaError as exc:
        raise MutationError(str(exc)) from exc
    except MutationError:
        raise
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the API
        logger.exception("mutation failed for %s", source)
        raise MutationError(f"unexpected failure while mutating {source.name}: {exc}") from exc


def copy_fallback(source: Path, target: Path) -> None:
    """Last-resort passthrough used only when a caller explicitly allows it."""

    shutil.copy2(source, target)
