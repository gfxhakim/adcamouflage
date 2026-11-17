"use client";

import clsx from "clsx";
import { Dices, Layers, Lock, Maximize2, SlidersHorizontal, Sparkles, Zap } from "lucide-react";

import type { MutationOptions, PresetCatalogue, PresetId, QualityTier } from "@/lib/types";
import { UPSCALE_HEIGHTS } from "@/lib/types";
import { applyPlanLocks, type PlanFeatureId } from "@/lib/plan-features";
import Link from "next/link";

interface OptionsPanelProps {
  options: MutationOptions;
  onChange: (options: MutationOptions) => void;
  catalogue: PresetCatalogue | null;
  disabled?: boolean;
  /** Feature groups the user's plan does not include; their controls show locked. */
  lockedFeatures?: PlanFeatureId[];
  /** Where the "Upgrade to Pro" hint links. */
  upgradeHref?: string;
}

/** The small "Upgrade to Pro" hint shown beside a locked control. */
function UpgradeHint({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20"
    >
      <Lock className="h-3 w-3" aria-hidden />
      Upgrade to Pro
    </Link>
  );
}

const PRESET_COPY: Record<Exclude<PresetId, "custom">, { title: string; blurb: string; accent: string }> = {
  stealth: {
    title: "Light",
    blurb: "Subtle studio polish. Clean metadata and light color/framing pass.",
    accent: "from-meta-50 to-white text-meta-700 border-meta-500/50",
  },
  balanced: {
    title: "Balanced",
    blurb: "Recommended default. Full color, framing, audio mastering, and clean export.",
    accent: "from-meta-100 to-meta-50 text-meta-700 border-meta-500/60",
  },
  aggressive: {
    title: "Dynamic",
    blurb: "Adds per-frame film texture and deeper studio variation across copies.",
    accent: "from-meta-200 to-meta-50 text-meta-800 border-meta-600/70",
  },
  nuclear: {
    title: "Max Studio",
    blurb: "All variation layers enabled, including horizontal flip, for maximum contrast.",
    accent: "from-meta-300 to-meta-100 text-meta-900 border-meta-700/80",
  },
};

const QUALITY_TIERS: { id: QualityTier; label: string; blurb: string }[] = [
  { id: "auto", label: "Auto", blurb: "Let the engine pick the rate." },
  { id: "high", label: "High", blurb: "Near-lossless, larger files." },
  { id: "balanced", label: "Balanced", blurb: "Good quality, smaller files." },
  { id: "compact", label: "Compact", blurb: "Smallest files for fast upload." },
];

export function OptionsPanel({
  options,
  onChange,
  catalogue,
  disabled = false,
  lockedFeatures = [],
  upgradeHref = "/app/plan",
}: OptionsPanelProps) {
  // Every change goes through the plan locks, so a preset can never switch a locked option on.
  const emit = (next: MutationOptions) => onChange(applyPlanLocks(next, lockedFeatures));
  const engineLocked = lockedFeatures.includes("full_engine");

  const applyPreset = (preset: PresetId) => {
    const defaults = catalogue?.presets.find((entry) => entry.id === preset)?.defaults ?? {};
    emit({ ...options, ...defaults, preset });
  };

  const applySmartGen4 = () => {
    if (engineLocked) return;
    emit({
      ...options,
      preset: "custom",
      intensity: 58,
      // Keep non-destructive classic layers, disable destructive ones (mirror, trim, blur)
      micro_crop: false,
      frame_rate_stagger: false,
      noise_injection: false,
      color_drift: false,
      audio_mutation: false,
      temporal_trim: false,
      frequency_smoothing: false,
      deep_scramble: false,
      mirror: false,
      strip_metadata: true,
      keyframe_gop_jitter: true,
      container_bitrate_shuffle: true,
      chroma_matrix_shift: true,
      // Enable all 10 Gen-4 signal, psychoacoustic & forensic layers
      elastic_mesh_warp: true,
      dct_jnd_perturbation: true,
      lut_clahe_color: true,
      optical_flow_timewarp: true,
      adversarial_cnn_layer: true,
      audio_allpass_phase: true,
      formant_pitch_lfo: true,
      psychoacoustic_rir: true,
      authentic_atom_spoof: true,
      macroblock_aq_variance: true,
    });
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="label">Variation profile</p>
          <div className="flex flex-wrap items-center gap-2">
            {options.preset === "custom" ? <span className="chip !text-[10px]">custom</span> : null}
            {engineLocked ? <UpgradeHint href={upgradeHref} /> : null}
            <button
              type="button"
              disabled={disabled || engineLocked}
              onClick={applySmartGen4}
              title={engineLocked ? "Not included in your plan. Upgrade to Pro to use it." : undefined}
              className="inline-flex items-center gap-1.5 rounded-full border border-meta-500/60 bg-meta-50 px-3 py-1 text-[11px] font-semibold text-meta-700 transition hover:bg-meta-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-meta-500/15 dark:text-meta-200 dark:hover:bg-meta-500/25"
            >
              {engineLocked ? <Lock className="h-3 w-3" aria-hidden /> : <Sparkles className="h-3 w-3" aria-hidden />}
              Studio Pro (Gen-4 Precision)
            </button>
          </div>
        </div>
        <div data-tour="settings.profile" className="grid gap-2.5 sm:grid-cols-2">
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
                    ? clsx(
                        "bg-gradient-to-br shadow-meta-sm dark:border-meta-500/50 dark:from-meta-500/20 dark:to-meta-500/10 dark:text-meta-100",
                        copy.accent,
                      )
                    : "border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] text-ink-muted dark:text-slate-300 hover:border-black/20 dark:hover:border-white/15 hover:bg-white/[0.05]",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Zap className={clsx("h-3.5 w-3.5", active ? "" : "text-ink-subtle dark:text-slate-400")} aria-hidden />
                  {copy.title}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed opacity-80">{copy.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
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

      <p className="text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
        A seed makes a render reproducible — the same seed and settings always produce the same
        variant. Leave it empty for fresh entropy on every asset.
      </p>

      <section>
        <p className="label mb-3 flex items-center gap-1.5">
          <SlidersHorizontal className="h-3 w-3" aria-hidden />
          Output quality
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUALITY_TIERS.map(({ id, label, blurb }) => {
            const active = (options.quality ?? "auto") === id;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onChange({ ...options, quality: id })}
                className={clsx(
                  "rounded-lg border p-2.5 text-left transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-meta-500/50 bg-meta-50 dark:bg-meta-500/10 text-black dark:text-slate-100"
                    : "border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] text-ink-subtle dark:text-slate-400 hover:border-black/20 dark:hover:border-white/15",
                )}
              >
                <span className="text-xs font-semibold">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint dark:text-slate-500">{blurb}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="upscale" className="label mb-1.5 flex h-4 items-center gap-1.5">
              <Maximize2 className="h-3 w-3" aria-hidden />
              Upscale low-res
            </label>
            <select
              id="upscale"
              className="field"
              value={options.upscale_to ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...options,
                  upscale_to: event.target.value ? Number(event.target.value) : null,
                  // Upscaling sets the delivered size, so "keep resolution" no longer applies.
                  keep_resolution: event.target.value ? false : options.keep_resolution,
                })
              }
            >
              <option value="">Off</option>
              {UPSCALE_HEIGHTS.map((height) => (
                <option key={height} value={height}>
                  up to {height}p
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 self-end pb-2.5 text-[11px] text-ink-subtle dark:text-slate-400">
            <input
              type="checkbox"
              className="accent-meta-500"
              checked={options.keep_resolution ?? false}
              disabled={disabled || Boolean(options.upscale_to)}
              onChange={(event) => onChange({ ...options, keep_resolution: event.target.checked })}
            />
            Keep the source&apos;s original resolution
          </label>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
          Quality and resolution control how the finished file looks — the variation profile above is
          unchanged. Upscaling and higher quality still count against your plan the same way.
        </p>
      </section>
    </div>
  );
}

export default OptionsPanel;
