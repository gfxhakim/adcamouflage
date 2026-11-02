"""Flashing overlay modes: a fixed on/off rhythm measured in source frames."""

from __future__ import annotations

import math
import re

import pytest

from app.mutator import mutate, overlay_enable_expression
from app.schemas import AssetKind, MutationOptions, OverlayMode, OverlaySettings, Preset

from .conftest import requires_ffmpeg
from .test_overlay import _badge_fraction, baseline, badge, stored_badge  # noqa: F401  (fixtures)


def _evaluate(expression: str, t: float) -> bool:
    """Evaluate the small subset of ffmpeg's expression language we emit."""

    python = re.sub(r"\bt\b", repr(t), expression)
    scope = {
        "floor": math.floor,
        "mod": lambda a, b: a - b * math.floor(a / b),
        "gte": lambda a, b: 1 if a >= b else 0,
        "lt": lambda a, b: 1 if a < b else 0,
    }
    return bool(eval(python, {"__builtins__": {}}, scope))  # noqa: S307 - test-only, our own string


def _visible_frames(settings_: OverlaySettings, fps: float, frames: int, trim_head: float = 0.0) -> list[int]:
    expression = overlay_enable_expression(settings_, fps, frames / fps, trim_head)
    assert expression is not None
    out = []
    for n in range(frames):
        # Sample each output frame at its presentation time.
        if _evaluate(expression, n / fps):
            out.append(n)
    return out


def _pattern(on: int, off: int, frames: int, start: int = 0) -> list[int]:
    return [n for n in range(frames) if n >= start and (n - start) % (on + off) < on]


@pytest.mark.parametrize(("mode", "on", "off"), [(OverlayMode.FLASH_5, 5, 5), (OverlayMode.FLASH_3, 3, 3)])
@pytest.mark.parametrize("fps", [24.0, 25.0, 30.0, 29.97, 60.0])
def test_preset_flash_modes_follow_the_frame_rhythm(mode, on, off, fps):
    settings_ = OverlaySettings(enabled=True, mode=mode)
    assert settings_.flash_pattern() == (on, off, 0)
    assert _visible_frames(settings_, fps, 120) == _pattern(on, off, 120)


def test_preset_modes_ignore_custom_on_off_values():
    settings_ = OverlaySettings(enabled=True, mode=OverlayMode.FLASH_3, flash_on_frames=9, flash_off_frames=1)
    assert settings_.flash_pattern() == (3, 3, 0)


def test_custom_flash_uses_the_users_counts_and_start():
    settings_ = OverlaySettings(
        enabled=True,
        mode=OverlayMode.FLASH_CUSTOM,
        flash_on_frames=2,
        flash_off_frames=7,
        flash_start_frame=10,
    )
    assert _visible_frames(settings_, 30.0, 100) == _pattern(2, 7, 100, start=10)


def test_flash_is_measured_on_the_source_clock_after_the_trim():
    """Output t=0 is source t=trim_head, so the rhythm continues from there."""

    settings_ = OverlaySettings(enabled=True, mode=OverlayMode.FLASH_5)
    # A 0.1s trim at 30fps skips three source frames.
    visible = _visible_frames(settings_, 30.0, 60, trim_head=0.1)
    expected = [n for n in range(60) if ((n + 3) % 10) < 5]
    assert visible == expected


def test_flash_counts_are_validated():
    with pytest.raises(ValueError):
        OverlaySettings(enabled=True, mode=OverlayMode.FLASH_CUSTOM, flash_on_frames=0)
    with pytest.raises(ValueError):
        OverlaySettings(enabled=True, mode=OverlayMode.FLASH_CUSTOM, flash_off_frames=601)


def test_non_flash_modes_have_no_flash_pattern():
    assert OverlaySettings(enabled=True, mode=OverlayMode.ALWAYS).flash_pattern() is None
    assert OverlaySettings(enabled=True, mode=OverlayMode.INTRO).flash_pattern() is None


@requires_ffmpeg
def test_custom_flash_toggles_in_the_render(sample_video, stored_badge, baseline, tmp_path):  # noqa: F811
    """Source is 30fps: 15 on / 15 off shows 0.0-0.5s, 1.0-1.5s, 2.0-2.5s."""

    output = tmp_path / "flash.mp4"
    report = mutate(
        sample_video,
        output,
        AssetKind.VIDEO,
        MutationOptions(
            preset=Preset.BALANCED,
            overlay=OverlaySettings(
                enabled=True,
                mode=OverlayMode.FLASH_CUSTOM,
                flash_on_frames=15,
                flash_off_frames=15,
                scale_percent=30,
                image_filename=stored_badge.name,
            ),
        ).resolved(),
        seed=5,
    )
    assert _badge_fraction(report.output_path, 0.2) > baseline * 5, "missing in the first flash"
    assert _badge_fraction(report.output_path, 0.75) <= baseline * 1.5, "visible during the first gap"
    assert _badge_fraction(report.output_path, 1.2) > baseline * 5, "missing in the second flash"
    assert any("flash 15 frames on / 15 off" in line for line in report.applied)
