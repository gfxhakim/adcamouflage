import type { MutationOptions } from "./types";

/**
 * Render-setting groups a plan can include or not (Admin > Token plans).
 * Mirrors backend/app/plan_features.py; the API switches locked ones off too.
 */
export type PlanFeatureId = "full_engine" | "metadata_wipe";

export const PLAN_FEATURES: Record<PlanFeatureId, { label: string; fields: (keyof MutationOptions)[] }> = {
  full_engine: {
    label: "Full Probe, Mutate & Scrub Engine",
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
    label: "Complete Metadata & Hash Wipe",
    fields: ["strip_metadata"],
  },
};

export const PLAN_FEATURE_IDS = Object.keys(PLAN_FEATURES) as PlanFeatureId[];

/** Which feature a pricing line describes, matched loosely so edited wording still maps. */
export function featureForLine(line: string): PlanFeatureId | null {
  if (/probe|mutate|scrub\s*engine/i.test(line)) return "full_engine";
  if (/metadata|hash\s*wipe/i.test(line)) return "metadata_wipe";
  return null;
}

/** The feature (if any) that locks this option for the given locked set. */
export function lockingFeature(field: keyof MutationOptions, locked: readonly PlanFeatureId[]): PlanFeatureId | null {
  return locked.find((id) => PLAN_FEATURES[id].fields.includes(field)) ?? null;
}

/** Turn off every option a locked feature covers. */
export function applyPlanLocks(options: MutationOptions, locked: readonly PlanFeatureId[]): MutationOptions {
  if (!locked.length) return options;
  const next = { ...options } as Record<string, unknown>;
  for (const id of locked) for (const field of PLAN_FEATURES[id].fields) next[field as string] = false;
  return next as unknown as MutationOptions;
}

/**
 * Whether a plan includes a feature. Plans from an older API carry no
 * ``features``; Starter then falls back to the default (not included).
 */
export function planIncludes(plan: { id: string; features?: Partial<Record<PlanFeatureId, boolean>> }, feature: PlanFeatureId): boolean {
  return plan.features?.[feature] ?? plan.id !== "starter";
}
