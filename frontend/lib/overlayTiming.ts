import type { OverlaySettings } from "@/lib/types";

/** Fixed on/off frame counts for the preset flash modes (mirrors the API). */
export const FLASH_PRESETS: Partial<Record<OverlaySettings["mode"], [number, number]>> = {
  flash_5: [5, 5],
  flash_3: [3, 3],
};

export const FLASH_LIMIT = 600;

/** [onFrames, offFrames, startFrame] for a flash mode, otherwise null. */
export function flashPattern(settings: OverlaySettings): [number, number, number] | null {
  const start = Math.max(0, settings.flash_start_frame || 0);
  if (settings.mode === "flash_custom") {
    return [settings.flash_on_frames, settings.flash_off_frames, start];
  }
  const preset = FLASH_PRESETS[settings.mode];
  return preset ? [preset[0], preset[1], start] : null;
}

export function isFlashMode(mode: OverlaySettings["mode"]): boolean {
  return mode === "flash_5" || mode === "flash_3" || mode === "flash_custom";
}

/**
 * Whether the overlay is visible on a given source frame. Same rules the
 * render engine uses, so the in-browser preview matches the output.
 */
export function overlayVisibleOnFrame(settings: OverlaySettings, frame: number, fps: number): boolean {
  const flash = flashPattern(settings);
  if (flash) {
    const [on, off, start] = flash;
    if (frame < start || on < 1) return false;
    if (off < 1) return true;
    return (frame - start) % (on + off) < on;
  }
  if (settings.mode === "intro") return frame / fps <= settings.intro_seconds;
  if (settings.mode === "ranges") {
    return settings.ranges.some((range) => frame >= range.start_frame && frame <= range.end_frame);
  }
  return true;
}

/** Flashes per second for a flash mode at the given frame rate. */
export function flashesPerSecond(settings: OverlaySettings, fps: number): number | null {
  const flash = flashPattern(settings);
  if (!flash) return null;
  const [on, off] = flash;
  return fps / (on + off);
}
