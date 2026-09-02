export type AssetKind = "video" | "image";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type PresetId = "stealth" | "balanced" | "aggressive" | "nuclear" | "custom";

export interface MutationOptions {
  preset: PresetId;
  intensity: number;
  micro_crop: boolean;
  frame_rate_stagger: boolean;
  noise_injection: boolean;
  color_drift: boolean;
  audio_mutation: boolean;
  strip_metadata: boolean;
  deep_scramble: boolean;
  mirror: boolean;
  temporal_trim: boolean;
  target_fps?: number | null;
  audio_pitch_ratio?: number | null;
  output_format?: string | null;
  seed?: number | null;
  variants: number;
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
