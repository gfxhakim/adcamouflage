"use client";

import clsx from "clsx";
import {
  AudioLines,
  Crop,
  Dices,
  FlipHorizontal2,
  Gauge,
  Layers,
  Maximize2,
  Palette,
  RefreshCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { MutationOptions, PresetCatalogue, PresetId, QualityTier } from "@/lib/types";
import { UPSCALE_HEIGHTS } from "@/lib/types";
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
    label: "Sub-pixel perspective & mesh warp",
    badge: "Spatial",
    description:
      "Shifts 8×8 and 16×16 DCT block grid alignment via sub-pixel perspective & smooth displacement without clipping subtitles or faces.",
    icon: Maximize2,
  },
  {
    key: "dct_jnd_perturbation",
    label: "DCT mid-band & JND masking",
    badge: "Frequency",
    description:
      "Perturbs mid-frequency DCT bands strictly inside high-texture regions so changes survive platform H.264/H.265/AV1 re-encoding.",
    icon: Waves,
  },
  {
    key: "lut_clahe_color",
    label: "Skin-protected 3D LUT & CLAHE",
    badge: "Photometric",
    description:
      "Modulates local contrast (LAB CLAHE) and rotates shadow/highlight vectors while locking the human skin-tone corridor.",
    icon: Palette,
  },
  {
    key: "optical_flow_timewarp",
    label: "Temporal motion micro-interpolation",
    badge: "Temporal",
    description:
      "Blends sub-frame temporal motion gradients across adjacent frames at a rock-solid constant FPS without dropping hooks or CTAs.",
    icon: Gauge,
  },
  {
    key: "adversarial_cnn_layer",
    label: "Adversarial CNN edge perturbation",
    badge: "Neural",
    description:
      "Injects an imperceptible, edge-masked directional grating (±1–2 RGB levels) that shifts ResNet/CLIP/ViT neural embeddings.",
    icon: Sparkles,
  },
  {
    key: "audio_allpass_phase",
    label: "All-pass phase dispersion",
    badge: "Psychoacoustic",
    description:
      "Cascades 4-stage biquad all-pass filters to rotate STFT phase and waveform structure while keeping EQ and voice tone 100% identical.",
    icon: AudioLines,
  },
  {
    key: "formant_pitch_lfo",
    label: "Formant-locked micro-pitch LFO",
    badge: "Psychoacoustic",
    description:
      "Sub-audible LFO pitch drift (0.35–0.65 Hz) with formant EQ compensation—zero chipmunk effect and zero lip-sync drift.",
    icon: AudioLines,
  },
  {
    key: "psychoacoustic_rir",
    label: "Psychoacoustic micro-RIR reflections",
    badge: "Psychoacoustic",
    description:
      "Convolves ultra-short studio early reflections (5–15ms) below the human echo threshold to disrupt spectrogram peak constellations.",
    icon: Waves,
  },
  {
    key: "authentic_atom_spoof",
    label: "Authentic NLE / device atom structure",
    badge: "Forensic",
    description:
      "Emulates genuine Rec.709 colr atoms and camera/NLE track timescales so containers pass platform authenticity classifiers.",
    icon: Tags,
  },
  {
    key: "macroblock_aq_variance",
    label: "Macroblock AQ & psy-RD variance",
    badge: "Bitstream",
    description:
      "Randomizes internal x264/VP9 adaptive quantization and psychovisual rate-distortion trees for unique macroblock bit allocation.",
    icon: Layers,
  },
];

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
    key: "keyframe_gop_jitter",
    label: "Keyframe & GOP jitter",
    description: "Randomize I-frame intervals and scene-cut thresholds across variants.",
    icon: RefreshCcw,
  },
  {
    key: "container_bitrate_shuffle",
    label: "Container & bitrate shuffle",
    description: "Vary MP4 atom structure, chunk interleaving and micro-CRF curves.",
    icon: Layers,
  },
  {
    key: "chroma_matrix_shift",
    label: "Chroma matrix shift",
    description: "Sub-perceptual YUV color-space and chroma calibration tweaks.",
    icon: Palette,
  },
  {
    key: "frequency_smoothing",
    label: "Frequency smoothing",
    description: "Apply micro-bilateral chroma filtering to normalize high-frequency noise.",
    icon: Waves,
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

  const applySmartGen4 = () => {
    onChange({
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
          <p className="label">Camouflage profile</p>
          <div className="flex items-center gap-2">
            {options.preset === "custom" ? <span className="chip !text-[10px]">custom</span> : null}
            <button
              type="button"
              disabled={disabled}
              onClick={applySmartGen4}
              className="inline-flex items-center gap-1.5 rounded-full border border-meta-500/60 bg-meta-50 px-3 py-1 text-[11px] font-semibold text-meta-700 transition hover:bg-meta-100 dark:bg-meta-500/15 dark:text-meta-200 dark:hover:bg-meta-500/25"
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              Smart Anti-Detection (Gen-4 Only)
            </button>
          </div>
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
                    ? clsx(
                        "bg-gradient-to-br shadow-meta-sm dark:border-meta-500/50 dark:from-meta-500/20 dark:to-meta-500/10 dark:text-meta-100",
                        copy.accent,
                      )
                    : "border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] text-ink-muted dark:text-slate-300 hover:border-black/20 dark:hover:border-white/15 hover:bg-white/[0.05]",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold capitalize">
                  <Zap className={clsx("h-3.5 w-3.5", active ? "" : "text-ink-subtle dark:text-slate-400")} aria-hidden />
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
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundImage: `linear-gradient(90deg, #22d3ee 0%, #a855f7 ${options.intensity}%, var(--track-empty, rgb(30 41 59)) ${options.intensity}%)`,
          }}
        />
        <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-ink-faint dark:text-slate-500">
          <span>Subtle</span>
          <span>Balanced</span>
          <span>Extreme</span>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="label flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-meta-500" aria-hidden />
            Gen-4 signal, psychoacoustic &amp; forensic layers
          </p>
          <span className="font-mono text-[10px] text-meta-600 dark:text-meta-300">
            Zero quality loss · Re-encode resilient
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {ADVANCED_TOGGLES.map(({ key, label, badge, description, icon: Icon }) => {
            const active = Boolean(options[key]);
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
                    ? "border-meta-500/60 bg-meta-50/90 dark:bg-meta-500/15 text-black dark:text-slate-100"
                    : "border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] text-ink-subtle dark:text-slate-400 hover:border-black/15 dark:hover:border-white/15",
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors",
                    active
                      ? "border-meta-500/50 bg-meta-100 dark:bg-meta-500/25 text-meta-600 dark:text-meta-300"
                      : "border-black/10 dark:border-white/10 bg-meta-50 dark:bg-meta-500/10 text-ink-subtle dark:text-slate-400",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                    {label}
                    <span className="rounded bg-meta-500/15 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-meta-700 dark:text-meta-300">
                      {badge}
                    </span>
                    <span
                      className={clsx(
                        "ml-auto h-1.5 w-1.5 rounded-full transition-colors",
                        active ? "bg-meta-500 shadow-meta-sm" : "bg-black/20 dark:bg-white/20",
                      )}
                      aria-hidden
                    />
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle dark:text-slate-400">
                    {description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="label mb-3">Classic evasion layers</p>
        <div className="grid gap-2 md:grid-cols-2">
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
                    ? "border-meta-500/50 bg-meta-50 dark:bg-meta-500/10 text-black dark:text-slate-100"
                    : "border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] text-ink-subtle dark:text-slate-400 hover:border-black/15 dark:hover:border-white/15",
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors",
                    active
                      ? "border-meta-500/50 bg-meta-100 dark:bg-meta-500/20 text-meta-600 dark:text-meta-300"
                      : "border-black/10 dark:border-white/10 bg-meta-50 dark:bg-meta-500/10 text-ink-subtle dark:text-slate-400",
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
                        active ? "bg-meta-500 shadow-meta-sm" : "bg-black/20 dark:bg-white/20",
                      )}
                      aria-hidden
                    />
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle dark:text-slate-400">
                    {description}
                  </span>
                </span>
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
          Quality and resolution control how the finished file looks — the camouflage layers above
          are unchanged. Upscaling and higher quality still count against your plan the same way.
        </p>
      </section>
    </div>
  );
}

export default OptionsPanel;
