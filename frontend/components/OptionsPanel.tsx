"use client";

import clsx from "clsx";
import {
  Activity,
  AudioLines,
  Cpu,
  Crop,
  Dices,
  Eye,
  Film,
  Fingerprint,
  FlipHorizontal2,
  Gauge,
  Layers,
  Lock,
  Maximize2,
  Move,
  Music,
  Music2,
  Package,
  Palette,
  Radar,
  RefreshCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tags,
  Wand2,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MutationOptions, PresetCatalogue, PresetId, QualityTier } from "@/lib/types";
import { UPSCALE_HEIGHTS } from "@/lib/types";
import { applyPlanLocks, lockingFeature, type PlanFeatureId } from "@/lib/plan-features";
import Link from "next/link";
import NeonCard from "./NeonCard";

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

type ToggleKey =
  | "micro_crop"
  | "frame_rate_stagger"
  | "noise_injection"
  | "color_drift"
  | "audio_mutation"
  | "strip_metadata"
  | "keyframe_gop_jitter"
  | "container_bitrate_shuffle"
  | "chroma_matrix_shift"
  | "frequency_smoothing"
  | "deep_scramble"
  | "mirror"
  | "temporal_trim"
  | "elastic_mesh_warp"
  | "dct_jnd_perturbation"
  | "lut_clahe_color"
  | "optical_flow_timewarp"
  | "adversarial_cnn_layer"
  | "audio_allpass_phase"
  | "formant_pitch_lfo"
  | "psychoacoustic_rir"
  | "authentic_atom_spoof"
  | "macroblock_aq_variance";

const ADVANCED_TOGGLES: {
  key: ToggleKey;
  label: string;
  badge: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    key: "elastic_mesh_warp",
    label: "Sub-pixel perspective & lens polish",
    badge: "Spatial",
    description:
      "Applies gentle sub-pixel perspective and lens alignment refinement without clipping subtitles or faces.",
    icon: Move,
  },
  {
    key: "dct_jnd_perturbation",
    label: "Fine texture detail enhancement",
    badge: "Frequency",
    description:
      "Refines mid-band texture detail inside high-detail regions so exports stay crisp after social platform compression.",
    icon: Radar,
  },
  {
    key: "lut_clahe_color",
    label: "Skin-protected 3D LUT & CLAHE",
    badge: "Photometric",
    description:
      "Balances local contrast (LAB CLAHE) and refines shadow/highlight tones while protecting natural skin tones.",
    icon: Sun,
  },
  {
    key: "optical_flow_timewarp",
    label: "Temporal motion smoothing",
    badge: "Temporal",
    description:
      "Blends sub-frame temporal motion gradients across adjacent frames at a constant FPS without dropping hooks or CTAs.",
    icon: Activity,
  },
  {
    key: "adversarial_cnn_layer",
    label: "Micro-contrast edge refinement",
    badge: "Detail",
    description:
      "Applies a subtle, edge-aware micro-contrast pass (±1–2 RGB levels) for clean visual separation on mobile screens.",
    icon: Eye,
  },
  {
    key: "audio_allpass_phase",
    label: "All-pass phase alignment",
    badge: "Acoustic",
    description:
      "Uses 4-stage biquad all-pass filters to align phase and waveform dynamics while keeping EQ and voice tone 100% natural.",
    icon: AudioLines,
  },
  {
    key: "formant_pitch_lfo",
    label: "Formant-locked vocal modulation",
    badge: "Acoustic",
    description:
      "Gentle LFO vocal warmth (0.35–0.65 Hz) with formant EQ compensation—natural voice tone and zero lip-sync drift.",
    icon: Music2,
  },
  {
    key: "psychoacoustic_rir",
    label: "Studio room ambiance (micro-RIR)",
    badge: "Acoustic",
    description:
      "Adds ultra-short studio early reflections (5–15ms) below the echo threshold for broadcast audio depth.",
    icon: Waves,
  },
  {
    key: "authentic_atom_spoof",
    label: "Standard NLE / Rec.709 atom packaging",
    badge: "Container",
    description:
      "Writes standard Rec.709 color atoms and clean track timescales for seamless compatibility across ad platforms.",
    icon: Fingerprint,
  },
  {
    key: "macroblock_aq_variance",
    label: "Adaptive quantization (AQ) tuning",
    badge: "Encoding",
    description:
      "Optimizes x264/VP9 adaptive quantization and rate-distortion curves for clean macroblock bit allocation.",
    icon: Cpu,
  },
];

const TOGGLES: { key: ToggleKey; label: string; description: string; icon: LucideIcon }[] = [
  {
    key: "micro_crop",
    label: "Smart edge framing",
    description: "Trims 2-4px per side and resamples cleanly to source resolution.",
    icon: Crop,
  },
  {
    key: "frame_rate_stagger",
    label: "Broadcast frame-rate cadence",
    description: "Re-times delivery to a standard broadcast cadence, e.g. 29.97fps.",
    icon: Gauge,
  },
  {
    key: "noise_injection",
    label: "Subtle film grain",
    description: "Low-opacity organic film texture that varies across frames.",
    icon: Sparkles,
  },
  {
    key: "color_drift",
    label: "Color & tone balance",
    description: "Subtle brightness, gamma, saturation and hue calibration.",
    icon: Palette,
  },
  {
    key: "audio_mutation",
    label: "Audio pitch & tempo polish",
    description: "Subtle pitch and tempo tuning across exported variations.",
    icon: Music,
  },
  {
    key: "temporal_trim",
    label: "Endpoint frame trim",
    description: "Trims a few milliseconds off the tail to give each variation a clean duration.",
    icon: Scissors,
  },
  {
    key: "strip_metadata",
    label: "Clean project metadata",
    description: "Removes legacy EXIF, camera serials, and timeline editor history.",
    icon: Tags,
  },
  {
    key: "keyframe_gop_jitter",
    label: "Keyframe & GOP optimization",
    description: "Varies I-frame intervals and scene-cut thresholds across exported copies.",
    icon: RefreshCcw,
  },
  {
    key: "container_bitrate_shuffle",
    label: "Container & bitrate tuning",
    description: "Optimizes MP4 atom ordering, chunk interleaving and CRF encoding curves.",
    icon: Package,
  },
  {
    key: "chroma_matrix_shift",
    label: "Chroma matrix calibration",
    description: "Fine YUV color-space and chroma subsampling calibration.",
    icon: SlidersHorizontal,
  },
  {
    key: "frequency_smoothing",
    label: "Chroma smoothing",
    description: "Applies bilateral chroma filtering to smooth high-frequency compression artifacts.",
    icon: Wand2,
  },
  {
    key: "deep_scramble",
    label: "Dynamic film texture",
    description: "Per-frame OpenCV organic film grain and sub-pixel polish.",
    icon: Film,
  },
  {
    key: "mirror",
    label: "Horizontal flip",
    description: "Flips the visual composition horizontally for A/B layout testing.",
    icon: FlipHorizontal2,
  },
];

const ALL_LAYERS: { key: ToggleKey; label: string; icon: LucideIcon }[] = [...ADVANCED_TOGGLES, ...TOGGLES];

const PRESET_DEFAULT_LAYERS: Record<Exclude<PresetId, "custom">, ToggleKey[]> = {
  stealth: [
    "elastic_mesh_warp",
    "audio_allpass_phase",
    "authentic_atom_spoof",
    "macroblock_aq_variance",
    "micro_crop",
    "frame_rate_stagger",
    "temporal_trim",
    "strip_metadata",
    "keyframe_gop_jitter",
    "container_bitrate_shuffle",
    "chroma_matrix_shift",
  ],
  balanced: [
    "elastic_mesh_warp",
    "dct_jnd_perturbation",
    "lut_clahe_color",
    "audio_allpass_phase",
    "formant_pitch_lfo",
    "authentic_atom_spoof",
    "macroblock_aq_variance",
    "micro_crop",
    "frame_rate_stagger",
    "noise_injection",
    "color_drift",
    "audio_mutation",
    "temporal_trim",
    "strip_metadata",
    "keyframe_gop_jitter",
    "container_bitrate_shuffle",
    "chroma_matrix_shift",
  ],
  aggressive: ALL_LAYERS.map((l) => l.key).filter((key) => key !== "mirror"),
  nuclear: ALL_LAYERS.map((l) => l.key),
};

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
  const isLocked = (key: keyof MutationOptions) => lockingFeature(key, lockedFeatures) !== null;

  const set = <K extends keyof MutationOptions>(key: K, value: MutationOptions[K]) => {
    if (isLocked(key)) return;
    // Changing any individual switch means the profile is no longer a preset.
    const preset: PresetId = key === "preset" ? (value as PresetId) : "custom";
    emit({ ...options, [key]: value, preset });
  };

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
          <div className="flex items-center gap-2">
            {options.preset === "custom" ? <span className="chip !text-[10px]">custom</span> : null}
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

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="intensity" className="label">
            Variation intensity
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
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundImage: `linear-gradient(90deg, #22d3ee 0%, #a855f7 ${options.intensity}%, var(--track-empty, rgb(30 41 59)) ${options.intensity}%)`,
          }}
        />
        <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-ink-faint dark:text-slate-500">
          <span>Subtle</span>
          <span>Balanced</span>
          <span>Maximum</span>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="label flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-meta-500" aria-hidden />
            Profile layers
          </p>
          {engineLocked || lockedFeatures.includes("metadata_wipe") ? (
            <UpgradeHint href={upgradeHref} />
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {availablePresets.map((preset) => {
            const presetSelected = options.preset === preset;
            const copy = PRESET_COPY[preset];
            const catalogueDefaults = catalogue?.presets.find((entry) => entry.id === preset)?.defaults;
            const layersForPreset = ALL_LAYERS.filter(({ key }) =>
              catalogueDefaults ? Boolean(catalogueDefaults[key]) : PRESET_DEFAULT_LAYERS[preset].includes(key),
            );
            return (
              <div
                key={preset}
                className={clsx(
                  "flex flex-col rounded-xl border p-3 transition-all duration-200",
                  presetSelected
                    ? "border-meta-500/60 bg-meta-50/70 shadow-meta-sm dark:border-meta-500/50 dark:bg-meta-500/10"
                    : "border-black/[0.08] bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.04]",
                )}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => applyPreset(preset)}
                  aria-pressed={presetSelected}
                  className="mb-2.5 flex w-full items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-black dark:text-slate-100">
                    <Zap
                      className={clsx(
                        "h-3.5 w-3.5 shrink-0",
                        presetSelected ? "text-meta-500" : "text-ink-subtle dark:text-slate-400",
                      )}
                      aria-hidden
                    />
                    {copy.title}
                  </span>
                  <span
                    className={clsx(
                      "h-2 w-2 shrink-0 rounded-full transition-colors",
                      presetSelected ? "bg-meta-500 shadow-meta-sm" : "bg-black/15 dark:bg-white/20",
                    )}
                    aria-hidden
                  />
                </button>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-4 xl:grid-cols-5">
                  {layersForPreset.map(({ key, label, icon: Icon }) => {
                    const locked = isLocked(key);
                    const active = !locked && Boolean(options[key]);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-disabled={locked || undefined}
                        aria-label={label}
                        title={locked ? `${label} (Upgrade to Pro)` : label}
                        disabled={disabled || locked}
                        onClick={() => set(key, !active)}
                        className={clsx(
                          "relative grid aspect-square w-full place-items-center rounded-lg border transition-all duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                          "disabled:cursor-not-allowed disabled:opacity-40",
                          active
                            ? "border-meta-500/60 bg-meta-100/90 text-meta-700 dark:bg-meta-500/25 dark:text-meta-200"
                            : "border-black/[0.08] bg-white/60 text-ink-subtle hover:border-black/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/20",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {locked ? (
                          <Lock
                            className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-600 dark:text-amber-300"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
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
          Quality and resolution control how the finished file looks — the variation layers above
          are unchanged. Upscaling and higher quality still count against your plan the same way.
        </p>
      </section>
    </div>
  );
}

export default OptionsPanel;
