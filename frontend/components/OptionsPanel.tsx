"use client";

import clsx from "clsx";
import {
  AudioLines,
  Crop,
  Dices,
  FlipHorizontal2,
  Gauge,
  Layers,
  Palette,
  Scissors,
  Sparkles,
  Tags,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MutationOptions, PresetCatalogue, PresetId } from "@/lib/types";
import NeonCard from "./NeonCard";

interface OptionsPanelProps {
  options: MutationOptions;
  onChange: (options: MutationOptions) => void;
  catalogue: PresetCatalogue | null;
  disabled?: boolean;
}

const PRESET_COPY: Record<Exclude<PresetId, "custom">, { blurb: string; accent: string }> = {
  stealth: {
    blurb: "Minimum visible change. Breaks byte and pixel hashes only.",
    accent: "from-meta-50 to-white text-meta-700 border-meta-500/50",
  },
  balanced: {
    blurb: "The default. Geometry, noise, colour and audio all shift.",
    accent: "from-meta-100 to-meta-50 text-meta-700 border-meta-500/60",
  },
  aggressive: {
    blurb: "Adds the per-frame OpenCV scramble. Slower, far harder to match.",
    accent: "from-meta-200 to-meta-50 text-meta-800 border-meta-600/70",
  },
  nuclear: {
    blurb: "Everything on, mirrored frame. Maximum divergence.",
    accent: "from-meta-300 to-meta-100 text-meta-900 border-meta-700/80",
  },
};

type ToggleKey =
  | "micro_crop"
  | "frame_rate_stagger"
  | "noise_injection"
  | "color_drift"
  | "audio_mutation"
  | "strip_metadata"
  | "deep_scramble"
  | "mirror"
  | "temporal_trim";

const TOGGLES: { key: ToggleKey; label: string; description: string; icon: LucideIcon }[] = [
  {
    key: "micro_crop",
    label: "Micro-crop",
    description: "Shave 2-4px per side, then resample. Kills pixel-hash matches.",
    icon: Crop,
  },
  {
    key: "frame_rate_stagger",
    label: "Frame-rate stagger",
    description: "Re-time to a different broadcast rate, e.g. 29.97fps.",
    icon: Gauge,
  },
  {
    key: "noise_injection",
    label: "Noise layer",
    description: "Low-opacity grain that changes on every single frame.",
    icon: Waves,
  },
  {
    key: "color_drift",
    label: "Colour drift",
    description: "Sub-perceptual brightness, gamma, saturation and hue shift.",
    icon: Palette,
  },
  {
    key: "audio_mutation",
    label: "Audio mutation",
    description: "Pitch and tempo shift that desyncs speech-to-text bots.",
    icon: AudioLines,
  },
  {
    key: "temporal_trim",
    label: "Temporal trim",
    description: "Clip a few frames off each end to shift the timeline.",
    icon: Scissors,
  },
  {
    key: "strip_metadata",
    label: "Strip metadata",
    description: "Erase EXIF, camera data, editor tags and encoder signatures.",
    icon: Tags,
  },
  {
    key: "deep_scramble",
    label: "Deep scramble",
    description: "Per-frame OpenCV noise field and sub-pixel jitter. Slower.",
    icon: Sparkles,
  },
  {
    key: "mirror",
    label: "Mirror",
    description: "Flip horizontally. Very effective, but visibly different.",
    icon: FlipHorizontal2,
  },
];

export function OptionsPanel({ options, onChange, catalogue, disabled = false }: OptionsPanelProps) {
  const set = <K extends keyof MutationOptions>(key: K, value: MutationOptions[K]) => {
    // Changing any individual switch means the profile is no longer a preset.
    const preset: PresetId = key === "preset" ? (value as PresetId) : "custom";
    onChange({ ...options, [key]: value, preset });
  };

  const applyPreset = (preset: PresetId) => {
    const defaults = catalogue?.presets.find((entry) => entry.id === preset)?.defaults ?? {};
    onChange({ ...options, ...defaults, preset });
  };

  const presetIds = (catalogue?.presets ?? [])
    .map((entry) => entry.id)
    .filter((id): id is Exclude<PresetId, "custom"> => id !== "custom");
  const availablePresets = presetIds.length
    ? presetIds
    : (["stealth", "balanced", "aggressive", "nuclear"] as const);

  const formats = catalogue?.formats ?? { video: ["mp4", "mov", "webm"], image: ["jpg", "png", "webp"] };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="label">Camouflage profile</p>
          {options.preset === "custom" ? <span className="chip !text-[10px]">custom</span> : null}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {availablePresets.map((preset) => {
            const active = options.preset === preset;
            const copy = PRESET_COPY[preset];
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => applyPreset(preset)}
                aria-pressed={active}
                className={clsx(
                  "group relative overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? clsx("bg-gradient-to-br shadow-meta-sm", copy.accent)
                    : "border-white/[0.08] bg-black/[0.02] text-ink-muted hover:border-black/20 hover:bg-white/[0.05]",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold capitalize">
                  <Zap className={clsx("h-3.5 w-3.5", active ? "" : "text-black0")} aria-hidden />
                  {preset}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed opacity-80">{copy.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="intensity" className="label">
            Mutation intensity
          </label>
          <span className="font-mono text-sm text-meta-500">{options.intensity}</span>
        </div>
        <input
          id="intensity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={options.intensity}
          disabled={disabled}
          onChange={(event) => set("intensity", Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] accent-meta-500 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundImage: `linear-gradient(90deg, #22d3ee 0%, #a855f7 ${options.intensity}%, rgb(30 41 59) ${options.intensity}%)`,
          }}
        />
        <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-ink-faint">
          <span>Subtle</span>
          <span>Balanced</span>
          <span>Extreme</span>
        </div>
      </section>

      <section>
        <p className="label mb-3">Evasion layers</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOGGLES.map(({ key, label, description, icon: Icon }) => {
            const active = options[key];
            return (
              <button
                key={key}
                type="button"
                role="switch"
                aria-checked={active}
                disabled={disabled}
                onClick={() => set(key, !active)}
                className={clsx(
                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-meta-500/50 bg-meta-50 text-black"
                    : "border-black/[0.08] bg-black/[0.02] text-ink-subtle hover:border-black/15",
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors",
                    active
                      ? "border-meta-500/50 bg-meta-100 text-meta-600"
                      : "border-black/10 bg-meta-50 text-black0",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {label}
                    <span
                      className={clsx(
                        "h-1.5 w-1.5 rounded-full transition-colors",
                        active ? "bg-meta-500 shadow-meta-sm" : "bg-black/20",
                      )}
                      aria-hidden
                    />
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-black0">
                    {description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="variants" className="label mb-1.5 flex h-4 items-center gap-1.5">
            <Layers className="h-3 w-3" aria-hidden />
            Variants
          </label>
          <select
            id="variants"
            className="field"
            value={options.variants}
            disabled={disabled}
            onChange={(event) => onChange({ ...options, variants: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "copy" : "copies"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="format" className="label mb-1.5 flex h-4 items-center gap-1.5">
            Output format
          </label>
          <select
            id="format"
            className="field"
            value={options.output_format ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...options, output_format: event.target.value || null })
            }
          >
            <option value="">Same as source</option>
            <optgroup label="Video">
              {formats.video.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </optgroup>
            <optgroup label="Image">
              {formats.image.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div>
          <label htmlFor="seed" className="label mb-1.5 flex h-4 items-center gap-1.5">
            <Dices className="h-3 w-3" aria-hidden />
            Seed
          </label>
          <input
            id="seed"
            type="number"
            min={0}
            max={2147483647}
            className="field"
            placeholder="random"
            value={options.seed ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...options,
                seed: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        A seed makes a render reproducible — the same seed and settings always produce the same
        variant. Leave it empty for fresh entropy on every asset.
      </p>
    </div>
  );
}

export default OptionsPanel;
