export type AssetKind = "video" | "image";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type PresetId = "stealth" | "balanced" | "aggressive" | "nuclear" | "custom";

export type OverlayMode = "always" | "intro" | "ranges";

export type OverlayPosition =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center_left"
  | "center"
  | "center_right"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right"
  | "custom";

export interface FrameRange {
  start_frame: number;
  end_frame: number;
}

export interface OverlaySettings {
  enabled: boolean;
  mode: OverlayMode;
  position: OverlayPosition;
  offset_x: number;
  offset_y: number;
  scale_percent: number;
  opacity: number;
  intro_seconds: number;
  ranges: FrameRange[];
  image_filename?: string | null;
}

export type QualityTier = "auto" | "high" | "balanced" | "compact";

export const UPSCALE_HEIGHTS = [720, 1080, 1440, 2160] as const;
export type UpscaleHeight = (typeof UPSCALE_HEIGHTS)[number];

export interface PosterSettings {
  enabled: boolean;
  timestamp: number;
}

/** One brand overlay in the workspace: its placement plus the image file. */
export interface OverlayLayer {
  id: string;
  settings: OverlaySettings;
  image: File | null;
}

export interface MutationOptions {
  preset: PresetId;
  intensity: number;
  micro_crop: boolean;
  frame_rate_stagger: boolean;
  noise_injection: boolean;
  color_drift: boolean;
  audio_mutation: boolean;
  strip_metadata: boolean;
  keyframe_gop_jitter: boolean;
  container_bitrate_shuffle: boolean;
  chroma_matrix_shift: boolean;
  frequency_smoothing: boolean;
  deep_scramble: boolean;
  mirror: boolean;
  temporal_trim: boolean;
  elastic_mesh_warp: boolean;
  dct_jnd_perturbation: boolean;
  lut_clahe_color: boolean;
  optical_flow_timewarp: boolean;
  adversarial_cnn_layer: boolean;
  audio_allpass_phase: boolean;
  formant_pitch_lfo: boolean;
  psychoacoustic_rir: boolean;
  authentic_atom_spoof: boolean;
  macroblock_aq_variance: boolean;
  target_fps?: number | null;
  audio_pitch_ratio?: number | null;
  output_format?: string | null;
  seed?: number | null;
  variants: number;
  overlay: OverlaySettings;
  overlays: OverlaySettings[];
  poster: PosterSettings;
  quality: QualityTier;
  keep_resolution: boolean;
  upscale_to?: number | null;
}

export interface AssetMetrics {
  source_sha256?: string;
  output_sha256?: string;
  source_bytes?: number;
  output_bytes?: number;
  source_resolution?: string;
  output_resolution?: string;
  source_fps?: number;
  output_fps?: number;
  duration?: number;
  seed?: number;
  dhash_distance?: number;
  ahash_distance?: number;
  residual_tags?: string[];
  residual_exif_tags?: number;
  scrubbed_signatures?: number;
}

export interface AssetJob {
  id: string;
  batch_id: string;
  original_filename: string;
  stored_filename: string;
  kind: AssetKind;
  size_bytes: number;
  status: JobStatus;
  progress: number;
  stage: string;
  variant_index: number;
  variants_total: number;
  task_id: string | null;
  output_filename: string | null;
  output_size_bytes: number | null;
  download_url: string | null;
  poster_filename?: string | null;
  poster_url?: string | null;
  error: string | null;
  applied: string[];
  metrics: AssetMetrics;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Batch {
  id: string;
  options: MutationOptions;
  asset_ids: string[];
  created_at: string;
}

export interface BatchStatus {
  batch: Batch;
  assets: AssetJob[];
  status: JobStatus;
  progress: number;
  completed: number;
  failed: number;
  total: number;
  archive_url: string | null;
}

export interface UploadRejection {
  filename: string;
  reason: string;
}

export interface BatchCreated {
  batch_id: string;
  accepted: AssetJob[];
  rejected: UploadRejection[];
  options: MutationOptions;
}

export interface HealthReport {
  status: string;
  version: string;
  environment: string;
  ffmpeg: boolean;
  ffmpeg_version: string | null;
  redis: boolean;
  worker_mode: string;
  active_jobs: number;
  queue_depth: number;
}

export interface PresetInfo {
  id: PresetId;
  label: string;
  defaults: Partial<MutationOptions>;
}

export interface PresetCatalogue {
  presets: PresetInfo[];
  limits: {
    max_upload_mb: number;
    max_batch_files: number;
    max_video_seconds: number;
    retention_hours: number;
  };
  formats: { video: string[]; image: string[] };
}

// --- token billing ---------------------------------------------------------

export type BillingMode = "legacy" | "tokens";

/** One of the three token plans, as /api/v1/plans and the subscription payload send it. */
export interface TokenPlanCard {
  id: string;
  label: string;
  /** Per 30-day period, in the site currency. */
  price: number;
  tokens: number;
  tokens_per_generation: number;
  generations: number;
  price_per_generation: number;
  /** Unused subscription tokens carry over up to rollover_months × tokens; 0 means none. */
  rollover_months: number;
  /** Sent by the API as a convenience; derive it as rollover_months × tokens when absent. */
  rollover_cap?: number;
  /** Tokens per 1 unit of currency on a top-up. */
  topup_rate: number;
}

/** One row of the top-up picker, priced for a plan. */
export interface TopupOption {
  amount: number;
  tokens: number;
  bonus: number;
  total: number;
  generations: number;
}

/** Allowed top-up amounts and the bonus each earns per plan (plan id → amount → tokens). */
export interface TopupTable {
  amounts: number[];
  bonus: Record<string, Record<string, number>>;
}

export interface BillingRules {
  grace_days: number;
  period_days: number;
}

/** The public price list behind the landing page's pricing section. */
/** The rollover cap, whether or not the API sent it. */
export function rolloverCap(plan: Pick<TokenPlanCard, "rollover_months" | "tokens" | "rollover_cap">): number {
  return plan.rollover_cap ?? plan.rollover_months * plan.tokens;
}

export interface PublicPricing {
  currency: string;
  plans: TokenPlanCard[];
  topups: TopupTable;
  rules?: BillingRules;
}

/** Where a checkout is paid: BTCPay's invoice page or Volet's hosted checkout. */
export type PaymentProviderId = "btcpay" | "volet";

const PAYMENT_PROVIDER_NAMES: Record<PaymentProviderId, string> = { btcpay: "BTCPay", volet: "Volet" };

/** The short name on an order row's provider tag; empty when the API sent none. */
export function paymentProviderName(id: PaymentProviderId | null | undefined): string {
  if (!id) return "";
  return PAYMENT_PROVIDER_NAMES[id] ?? id;
}
