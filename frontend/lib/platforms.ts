import { Facebook, Music2, Youtube, type LucideIcon } from "lucide-react";

/** One target frame a creative can be formatted to. */
export interface FormatPreset {
  id: string;
  label: string;
  /** Human aspect, e.g. "9:16". */
  aspect: string;
  width: number;
  height: number;
  /** Suggested maximum clip length, in seconds, for this placement. */
  maxDurationSec: number;
  /** One short line on where this placement is used. */
  note: string;
}

export interface PlatformConfig {
  key: "meta" | "tiktok" | "youtube";
  /** Display name. */
  name: string;
  /** One line under the title. */
  tagline: string;
  icon: LucideIcon;
  presets: FormatPreset[];
  /** Whether vertical safe-zone guides (UI chrome overlap) are worth showing. */
  safeZonesNote: string;
}

/**
 * Per-platform placement specs. These are formatting targets — aspect ratio,
 * resolution and a sensible length — for preparing a creative for each surface.
 * Figures follow each platform's published creative guidance and are a starting
 * point, not a guarantee; check the platform's current spec sheet before a paid
 * campaign.
 */
export const PLATFORMS: Record<PlatformConfig["key"], PlatformConfig> = {
  meta: {
    key: "meta",
    name: "Meta",
    tagline: "Format for Facebook & Instagram — Feed, Reels and Stories.",
    icon: Facebook,
    safeZonesNote:
      "Reels & Stories cover the top ~14% and bottom ~20% with UI; keep text and logos inside the guides.",
    presets: [
      { id: "feed-square", label: "Feed · Square", aspect: "1:1", width: 1080, height: 1080, maxDurationSec: 120, note: "Facebook & Instagram feed" },
      { id: "feed-portrait", label: "Feed · Portrait", aspect: "4:5", width: 1080, height: 1350, maxDurationSec: 120, note: "Tallest feed placement" },
      { id: "reels-stories", label: "Reels / Stories", aspect: "9:16", width: 1080, height: 1920, maxDurationSec: 90, note: "Full-screen vertical" },
      { id: "landscape", label: "Landscape", aspect: "16:9", width: 1920, height: 1080, maxDurationSec: 241, note: "In-stream & wide feed" },
    ],
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    tagline: "Format for TikTok — full-screen vertical first.",
    icon: Music2,
    safeZonesNote:
      "The right rail (actions) and bottom (caption + handle) sit over your video; keep key content centred.",
    presets: [
      { id: "vertical", label: "Vertical", aspect: "9:16", width: 1080, height: 1920, maxDurationSec: 600, note: "Standard TikTok video" },
      { id: "square", label: "Square", aspect: "1:1", width: 1080, height: 1080, maxDurationSec: 600, note: "Supported, less immersive" },
      { id: "landscape", label: "Landscape", aspect: "16:9", width: 1920, height: 1080, maxDurationSec: 600, note: "Repurposed wide video" },
    ],
  },
  youtube: {
    key: "youtube",
    name: "YouTube",
    tagline: "Format for YouTube — standard 16:9 and vertical Shorts.",
    icon: Youtube,
    safeZonesNote:
      "Shorts overlay the bottom with title and actions; the standard player can letterbox off-ratio video.",
    presets: [
      { id: "standard", label: "Standard", aspect: "16:9", width: 1920, height: 1080, maxDurationSec: 43200, note: "Main YouTube player" },
      { id: "standard-4k", label: "Standard · 4K", aspect: "16:9", width: 3840, height: 2160, maxDurationSec: 43200, note: "2160p upload" },
      { id: "shorts", label: "Shorts", aspect: "9:16", width: 1080, height: 1920, maxDurationSec: 180, note: "Vertical, up to 3 min" },
    ],
  },
};

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
