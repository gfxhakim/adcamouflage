import type { MutationOptions, PlanFeatureId } from "./types";

export type { PlanFeatureId };

/**
 * Render-setting and platform groups a plan can include or not (Admin > Token plans).
 * Mirrors backend/app/plan_features.py; the API enforces locked ones too.
 */
export const PLAN_FEATURES: Record<PlanFeatureId, { label: string; fields: (keyof MutationOptions)[] }> = {
  full_engine: {
    label: "Full AI Engine for Rejected & Aggressive Video Ads",
    fields: [
      "elastic_mesh_warp",
      "dct_jnd_perturbation",
      "lut_clahe_color",
      "optical_flow_timewarp",
      "adversarial_cnn_layer",
      "audio_allpass_phase",
      "formant_pitch_lfo",
      "psychoacoustic_rir",
      "authentic_atom_spoof",
      "macroblock_aq_variance",
    ],
  },
  metadata_wipe: {
    label: "Clean Container, Fresh Encoding & Policy-Safe Re-Export",
    fields: ["strip_metadata"],
  },
  multi_platform: {
    label: "Meta Ads, TikTok Ads & YouTube Ads Recovery",
    fields: [],
  },
};

export const PLAN_FEATURE_IDS = Object.keys(PLAN_FEATURES) as PlanFeatureId[];

export interface PlanConfirmedFeature {
  id: string;
  label: string;
}

const STARTER_CONFIRMED: readonly PlanConfirmedFeature[] = [
  { id: "batch_zip", label: "5-Output Cloud Batch Rendering & 1-Click ZIP Download" },
  { id: "bg_history", label: "Background Cloud Queue & 48h Auto-Delete History" },
];

const PRO_CONFIRMED: readonly PlanConfirmedFeature[] = [
  ...STARTER_CONFIRMED,
  { id: "upscale_quality", label: "4K Upscaling (Up to 2160p), Quality Tiers & Format Converter" },
  { id: "seeds_reports", label: "Reproducible Render Seeds & Per-Export Verification Reports" },
  { id: "ai_live_support", label: "AI Studio Assistant & Live Agent Support (<30 Min)" },
];

const MAX_CONFIRMED: readonly PlanConfirmedFeature[] = [
  ...PRO_CONFIRMED,
  { id: "best_economics", label: "Lowest Cost Per Export & Highest Top-Up Bonus Rate" },
];

/**
 * Confirmed, non-layer app capabilities shown per plan on the landing page
 * and `/app/plan` cards (2 on Starter, 5 on Pro, 6 on Max).
 */
export const PLAN_CONFIRMED_FEATURES: Record<string, readonly PlanConfirmedFeature[]> = {
  starter: STARTER_CONFIRMED,
  pro: PRO_CONFIRMED,
  max: MAX_CONFIRMED,
};

/** Confirmed extra capabilities surfaced for a given plan id. */
export function confirmedFeaturesForPlan(planId: string): readonly PlanConfirmedFeature[] {
  return PLAN_CONFIRMED_FEATURES[planId] ?? [];
}

/** Which feature a pricing line describes, matched loosely so edited wording still maps. */
export function featureForLine(line: string): PlanFeatureId | null {
  if (/probe|mutate|scrub\s*engine|23[- ]*layer|studio\s*variation|gen[- ]*4|pro\s*color\s*grading|full\s*ai|rejected\s*&\s*aggressive/i.test(line)) return "full_engine";
  if (/metadata|hash\s*wipe|clean\s*container|policy[- ]*safe/i.test(line)) return "metadata_wipe";
  if (/tiktok|youtube|multi[- ]*platform/i.test(line)) return "multi_platform";
  return null;
}

/** Platform availability headline shown on Starter vs Pro/Max plan cards. */
export function platformLineForPlan(plan: { id: string; features?: Partial<Record<PlanFeatureId, boolean>> }): string {
  return planIncludes(plan, "multi_platform") ? "Meta Ads, TikTok Ads & YouTube Ads" : "Meta Ads";
}

/** The feature (if any) that locks this option for the given locked set. */
export function lockingFeature(field: keyof MutationOptions, locked: readonly PlanFeatureId[]): PlanFeatureId | null {
  return locked.find((id) => PLAN_FEATURES[id].fields.includes(field)) ?? null;
}

/** Turn off every option a locked feature covers (and clamp Starter to Meta). */
export function applyPlanLocks(options: MutationOptions, locked: readonly PlanFeatureId[]): MutationOptions {
  if (!locked.length) return options;
  const next = { ...options } as Record<string, unknown>;
  for (const id of locked) for (const field of PLAN_FEATURES[id].fields) next[field as string] = false;
  if (locked.includes("multi_platform")) next.platform = "meta";
  return next as unknown as MutationOptions;
}

/**
 * Whether a plan includes a feature. Plans from an older API carry no
 * ``features``; Starter falls back to Meta + Clean Container only.
 */
export function planIncludes(plan: { id: string; features?: Partial<Record<PlanFeatureId, boolean>> }, feature: PlanFeatureId): boolean {
  if (plan.features?.[feature] !== undefined) return Boolean(plan.features[feature]);
  return plan.id === "starter" ? feature === "metadata_wipe" : true;
}
