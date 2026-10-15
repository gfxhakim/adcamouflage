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
from .schemas import AssetKind, MutationOptions, OverlayMode, OverlaySettings
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

    if plan.sharpen:
        pre.append(f"unsharp=3:3:{plan.sharpen}:3:3:0.0")

    if plan.noise_strength:
        # allf=t+u => temporally varying, uniformly distributed noise, so the
        # grain pattern differs on every single frame.
        post.append(f"noise=alls={plan.noise_strength}:allf=t+u")

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


def build_overlay_filtergraph(
    overlay: OverlaySettings,
    plan: MutationPlan,
    info: MediaInfo,
    *,
    pre: list[str],
    post: list[str],
    duration: float,
    overlay_input: int,
    trim_head: float = 0.0,
) -> str:
    """The complete -filter_complex graph for a render that has an overlay."""

    source_fps = info.video.fps if info.video else 30.0
    width = plan.out_width or (info.video.width if info.video else 0)

    pre_chain = ",".join(pre) if pre else "null"
    post_chain = ",".join(post) if post else "null"

    # Width as a share of the output frame; -1 keeps the aspect ratio, and
    # rounding to an even width avoids chroma subsampling artefacts.
    overlay_width = max(2, int(round(width * overlay.scale_percent / 100.0))) if width else 120
    if overlay_width % 2:
        overlay_width += 1

    overlay_chain = [
        f"scale={overlay_width}:-1:flags=lanczos",
        # rgba first, so an opacity below 1 has an alpha channel to act on and
        # a logo with its own transparency is preserved.
        "format=rgba",
    ]
    if overlay.opacity < 1.0:
        overlay_chain.append(f"colorchannelmixer=aa={overlay.opacity:.3f}")

    x_expression, y_expression = overlay_position_expressions(overlay)
    overlay_args = [f"x={x_expression}", f"y={y_expression}"]

    enable = overlay_enable_expression(overlay, source_fps, duration, trim_head)
    if enable is not None:
        overlay_args.append(f"enable='{enable}'")
    # Hold the last overlay frame rather than ending the output early; the
    # overlay is a still, so it has exactly one frame.
    overlay_args.append("eof_action=repeat")

    return (
        f"[0:v]{pre_chain}[base];"
        f"[{overlay_input}:v]{','.join(overlay_chain)}[ovl];"
        f"[base][ovl]overlay={':'.join(overlay_args)}[composited];"
        f"[composited]{post_chain}[vout]"
    )


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


def overlay_is_active(options: MutationOptions) -> bool:
    return bool(options.overlay and options.overlay.enabled and options.overlay.image_filename)


def resolve_overlay_image(options: MutationOptions) -> Path | None:
    """Locate the stored overlay image, or None when there is not one."""

    if not overlay_is_active(options):
        return None
    name = Path(options.overlay.image_filename or "").name
    if not name:
        return None
    candidate = settings.uploads_dir / name
    return candidate if candidate.exists() else None


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
    if info.has_audio:
        args += ["-c:a", "aac", "-b:a", "160k", "-ar", str(info.audio.sample_rate or 44100)]
    if container in {"mp4", "mov"}:
        args += ["-movflags", "+faststart"]
    return args


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

        index = 0
        assert writer.stdin is not None
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break

                phase = math.sin(index * 0.11) * 0.5 + 0.5
                field = base_field * phase + drift_field * (1.0 - phase)
                noise = cv2.resize(field, (width, height), interpolation=cv2.INTER_CUBIC) * amplitude

                mutated = frame.astype(np.float32) + noise

                # Sub-pixel translation: invisible to a viewer, fatal to any
                # matcher that assumes a stable pixel grid.
                dx = math.sin(index * 0.037 + plan.seed % 7) * 0.7
                dy = math.cos(index * 0.029 + plan.seed % 5) * 0.7
                matrix = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]], dtype=np.float32)
                mutated = cv2.warpAffine(
                    mutated,
                    matrix,
                    (width, height),
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REFLECT_101,
                )

                gamma = 1.0 + math.sin(index * 0.013) * 0.012
                mutated = np.clip(mutated, 0, 255)
                mutated = np.power(mutated / 255.0, gamma) * 255.0

                writer.stdin.write(np.clip(mutated, 0, 255).astype(np.uint8).tobytes())

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
        overlay_path = resolve_overlay_image(options)

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

        if overlay_path is not None:
            # The overlay is a still image looped for the length of the clip.
            overlay_input = 2 if take_audio_from_source else 1
            args += ["-loop", "1", "-framerate", "25", "-i", str(overlay_path)]
            graph = build_overlay_filtergraph(
                options.overlay,
                plan,
                info,
                pre=pre_filters,
                post=post_filters,
                duration=effective_duration,
                overlay_input=overlay_input,
                trim_head=plan.trim_head,
            )
            args += ["-filter_complex", graph, "-map", "[vout]"]
            # -loop makes the overlay input infinite, so the output length has
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

    if plan.crop_x or plan.crop_y:
        applied.append(f"micro-crop {plan.crop_x}px x {plan.crop_y}px -> {plan.out_width}x{plan.out_height}")
    if plan.fps:
        applied.append(f"frame rate staggered to {plan.fps:g}fps")
    if plan.noise_strength:
        applied.append(f"temporal noise layer (strength {plan.noise_strength})")
    if plan.brightness or plan.contrast != 1.0 or plan.saturation != 1.0 or plan.gamma != 1.0:
        applied.append("sub-perceptual colour and gamma drift")
    if plan.hue_degrees:
        applied.append(f"hue rotated {plan.hue_degrees:+.2f}deg")
    if plan.mirror:
        applied.append("horizontal mirror")
    if plan.trim_head or plan.trim_tail:
        applied.append(f"temporal trim -{plan.trim_head:.2f}s / -{plan.trim_tail:.2f}s")
    if info.has_audio and not math.isclose(plan.pitch_ratio, 1.0, abs_tol=1e-4):
        applied.append(f"audio pitch shifted x{plan.pitch_ratio:.4f} (ASR desync)")
    if info.has_audio and not math.isclose(plan.tempo_ratio, 1.0, abs_tol=1e-4):
        applied.append(f"audio tempo x{plan.tempo_ratio:.4f}")
    if overlay_path is not None:
        overlay = options.overlay
        if overlay.mode is OverlayMode.ALWAYS:
            when = "every frame"
        elif overlay.mode is OverlayMode.INTRO:
            when = f"first {overlay.intro_seconds:g}s"
        else:
            when = f"{len(overlay.ranges)} frame range(s)"
        applied.append(
            f"image overlay at {overlay.position.value.replace('_', ' ')} "
            f"({overlay.scale_percent:g}% width, {overlay.opacity:.0%} opacity) on {when}"
        )
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
    return MutationReport(output_path=target, applied=applied, metrics=metrics)


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

    if plan.mirror:
        array = np.ascontiguousarray(array[:, ::-1])
        applied.append("horizontal mirror")

    if on_progress:
        on_progress(0.45, "signal")

    working = array.astype(np.float32)

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

    overlay_path = resolve_overlay_image(options)
    if overlay_path is not None:
        working = composite_overlay_on_image(working, overlay_path, options.overlay)
        applied.append(
            f"image overlay at {options.overlay.position.value.replace('_', ' ')} "
            f"({options.overlay.scale_percent:g}% width, {options.overlay.opacity:.0%} opacity)"
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
