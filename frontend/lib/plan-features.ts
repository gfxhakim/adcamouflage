import type { MutationOptions, PlanFeatureId } from "./types";

export type { PlanFeatureId };

/**
 * Render-setting and platform groups a plan can include or not (Admin > Token plans).
 * Mirrors backend/app/plan_features.py; the API enforces locked ones too.
 */
export const PLAN_FEATURES: Record<PlanFeatureId, { label: string; fields: (keyof MutationOptions)[] }> = {
  full_engine: {
    label: "Pro Color Grading & Broadcast Audio Mastering",
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
    label: "Clean Container & Project Tag Export",
    fields: ["strip_metadata"],
  },
  multi_platform: {
    label: "TikTok & YouTube",
    fields: [],
  },
};

export const PLAN_FEATURE_IDS = Object.keys(PLAN_FEATURES) as PlanFeatureId[];

/** Which feature a pricing line describes, matched loosely so edited wording still maps. */
export function featureForLine(line: string): PlanFeatureId | null {
  if (/probe|mutate|scrub\s*engine|23[- ]*layer|studio\s*variation|gen[- ]*4|pro\s*color\s*grading/i.test(line)) return "full_engine";
  if (/metadata|hash\s*wipe|clean\s*container/i.test(line)) return "metadata_wipe";
  if (/tiktok|youtube|multi[- ]*platform/i.test(line)) return "multi_platform";
  return null;
}

/** Platform availability headline shown on Starter vs Pro/Max plan cards. */
export function platformLineForPlan(plan: { id: string; features?: Partial<Record<PlanFeatureId, boolean>> }): string {
  return planIncludes(plan, "multi_platform") ? "Meta, TikTok & YouTube" : "Meta";
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
 * ``features``; Starter then falls back to the default (not included).
 */
export function planIncludes(plan: { id: string; features?: Partial<Record<PlanFeatureId, boolean>> }, feature: PlanFeatureId): boolean {
  return plan.features?.[feature] ?? plan.id !== "starter";
}
