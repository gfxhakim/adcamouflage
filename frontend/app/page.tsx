"use client";

import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Check,
  Cpu,
  FileStack,
  Fingerprint,
  Layers3,
  Radar,
  Rocket,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Tags,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import JobQueue from "@/components/JobQueue";
import NeonCard from "@/components/NeonCard";
import OptionsPanel from "@/components/OptionsPanel";
import ProgressBar from "@/components/ProgressBar";
import StatTile from "@/components/StatTile";
import UploadZone from "@/components/UploadZone";
import {
  ApiError,
  cancelAsset,
  createBatch,
  deleteBatch,
  getBatch,
  getHealth,
  getPresets,
} from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type {
  BatchStatus,
  HealthReport,
  MutationOptions,
  PresetCatalogue,
} from "@/lib/types";

const DEFAULT_OPTIONS: MutationOptions = {
  preset: "balanced",
  intensity: 48,
  micro_crop: true,
  frame_rate_stagger: true,
  noise_injection: true,
  color_drift: true,
  audio_mutation: true,
  strip_metadata: true,
  deep_scramble: false,
  mirror: false,
  temporal_trim: true,
  target_fps: null,
  audio_pitch_ratio: null,
  output_format: null,
  seed: null,
  variants: 1,
};

const POLL_INTERVAL_MS = 1200;
const HEALTH_INTERVAL_MS = 15000;

const HERO_BENEFITS = [
  { icon: Fingerprint, text: "Different file hash on every copy — duplicate detection misses" },
  { icon: Tags, text: "EXIF, camera, editor and encoder signatures fully erased" },
  { icon: AudioLines, text: "Audio pitch-shifted to desync speech-to-text bots" },
  { icon: Layers3, text: "Up to 5 distinct variants per upload, in one batch" },
];

const HERO_PROOF = [
  { label: "File hash", before: "6fa82c49ec91…", after: "358da85223…" },
  { label: "Resolution", before: "1280 × 720", after: "1274 × 708" },
  { label: "Frame rate", before: "30 fps", after: "23.976 fps" },
  { label: "Metadata tags", before: "camera, editor, title", after: "none" },
  { label: "Audio pitch", before: "0 cents", after: "+39.8 cents" },
];

const PIPELINE = [
  {
    icon: ScanLine,
    title: "Probe",
    body: "ffprobe reads the container, streams, frame rate and every tag the source carries.",
  },
  {
    icon: Layers3,
    title: "Mutate",
    body: "Micro-crop and resample, temporal noise, colour drift, staggered frame rate, pitch-shifted audio.",
  },
  {
    icon: Fingerprint,
    title: "Scrub",
    body: "EXIF, camera data, editor tags, the x264 SEI option dump and the MP4 compressorname all go.",
  },
  {
    icon: Rocket,
    title: "Ship",
    body: "Download each variant individually, or pull the whole batch as a zip with a mutation manifest.",
  },
];

export default function DashboardPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<MutationOptions>(DEFAULT_OPTIONS);
  const [catalogue, setCatalogue] = useState<PresetCatalogue | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const batchIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- health + presets ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const report = await getHealth();
        if (cancelled || !mountedRef.current) return;
        setHealth(report);
        setHealthError(null);
      } catch (error) {
        if (cancelled || !mountedRef.current) return;
        setHealth(null);
        setHealthError(error instanceof Error ? error.message : "Engine unreachable");
      }
    };

    check();
    const timer = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPresets()
      .then((data) => {
        if (!cancelled && mountedRef.current) setCatalogue(data);
      })
      .catch(() => {
        /* The UI ships with sensible fallbacks, so a missing catalogue is not fatal. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- batch polling ------------------------------------------------------
  const refresh = useCallback(async (batchId: string) => {
    try {
      const status = await getBatch(batchId);
      if (!mountedRef.current || batchIdRef.current !== batchId) return status;
      setBatch(status);
      setPollError(null);
      return status;
    } catch (error) {
      if (!mountedRef.current) return null;
      if (error instanceof ApiError && error.status === 404) {
        setPollError("This batch expired and its files were purged.");
        batchIdRef.current = null;
        return null;
      }
      setPollError(error instanceof Error ? error.message : "Could not refresh the batch.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!batch) return;
    const settled = batch.completed + batch.failed >= batch.total;
    if (settled) {
      setPolling(false);
      return;
    }

    const batchId = batch.batch.id;
    setPolling(true);
    const timer = setTimeout(() => {
      void refresh(batchId);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [batch, refresh]);

  // --- actions ------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    setSubmitError(null);
    setPollError(null);

    try {
      const created = await createBatch(files, options, setUploadProgress);
      batchIdRef.current = created.batch_id;
      setFiles([]);

      if (created.rejected.length > 0) {
        setSubmitError(
          `Skipped ${created.rejected.length} file(s): ${created.rejected
            .map((entry) => `${entry.filename} — ${entry.reason}`)
            .join("; ")}`,
        );
      }

      await refresh(created.batch_id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  }, [files, options, refresh, uploading]);

  const handleCancel = useCallback(
    async (assetId: string) => {
      try {
        await cancelAsset(assetId);
      } catch (error) {
        setPollError(error instanceof Error ? error.message : "Could not cancel that asset.");
      }
      if (batchIdRef.current) await refresh(batchIdRef.current);
    },
    [refresh],
  );

  const handleDiscard = useCallback(async () => {
    const batchId = batchIdRef.current;
    if (!batchId) return;
    batchIdRef.current = null;
    setBatch(null);
    setPolling(false);
    try {
      await deleteBatch(batchId);
    } catch {
      /* The retention sweep removes it regardless; nothing useful to surface here. */
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (batchIdRef.current) void refresh(batchIdRef.current);
  }, [refresh]);

  // --- derived ------------------------------------------------------------
  const limits = catalogue?.limits;
  const maxFiles = limits?.max_batch_files ?? 25;
  const maxSizeMb = limits?.max_upload_mb ?? 2048;

  const queuedBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  const activeLayers = useMemo(
    () =>
      [
        options.micro_crop,
        options.frame_rate_stagger,
        options.noise_injection,
        options.color_drift,
        options.audio_mutation,
        options.strip_metadata,
        options.deep_scramble,
        options.mirror,
        options.temporal_trim,
      ].filter(Boolean).length,
    [options],
  );

  const outputsReady = batch?.completed ?? 0;
  const engineBlocked = Boolean(health) && !health?.ffmpeg;

  return (
    <>
      <Header health={health} healthError={healthError} />

      <main className="relative mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        {/* Hero ---------------------------------------------------------- */}
        <section className="relative mb-10">
          <div
            className="pointer-events-none absolute -inset-x-10 -top-28 h-72 animate-float-slow rounded-full bg-meta-500/[0.07] blur-3xl"
            aria-hidden
          />

          <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div>
              <span className="chip mb-5 !border-meta-500/30 !bg-meta-50 !text-meta-700">
                <ShieldCheck className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                Runs on your own machine · nothing is uploaded to us
              </span>

              <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-black sm:text-5xl lg:text-[3.4rem]">
                One master.
                <br />
                <span className="text-gradient">Unlimited unique creatives.</span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
                Drop in a video or image and get back copies that are{" "}
                <strong className="font-semibold text-black">byte-for-byte different files</strong> —
                re-cut, re-timed, re-graded, re-encoded, and stripped of every trace of your camera,
                editor and encoder. Identical to a viewer. Unrecognisable to a duplicate-detection
                system.
              </p>

              <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {HERO_BENEFITS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                      <Icon className="h-3 w-3" aria-hidden />
                    </span>
                    <span className="text-sm leading-snug text-ink-muted">{text}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#upload" className="btn-primary !px-6 !py-3 !text-base">
                  <Rocket className="h-4 w-4" aria-hidden />
                  Camouflage your first asset
                </a>
                <a href="#pipeline" className="btn-ghost !px-5 !py-3">
                  See how it works
                </a>
              </div>

              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  No account required
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Batch up to {maxFiles} files
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Files auto-deleted after {limits?.retention_hours ?? 24}h
                </span>
              </p>
            </div>

            {/* Proof panel: what measurably changes on every render. */}
            <NeonCard padding="lg" radius="xl" className="lg:justify-self-end lg:max-w-md">
              <p className="label">What changes on every render</p>
              <dl className="mt-4 space-y-3.5">
                {HERO_PROOF.map(({ label, before, after }) => (
                  <div key={label}>
                    <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono text-[13px]">
                      <span className="truncate text-ink-faint line-through decoration-red-400/70">
                        {before}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                      <span className="truncate font-semibold text-meta-700">{after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t border-black/10 pt-4 text-[11px] leading-relaxed text-ink-faint">
                Every job ships with a verifiable report — hashes before and after, which mutations
                were applied, and how many provenance tags remain.
              </p>
            </NeonCard>
          </div>
        </section>

        {/* Stats --------------------------------------------------------- */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={FileStack}
            label="Queued"
            value={String(files.length)}
            hint={files.length ? formatBytes(queuedBytes) : `up to ${maxFiles} per batch`}
            accent="text-meta-500"
          />
          <StatTile
            icon={Waves}
            label="Active layers"
            value={`${activeLayers}/9`}
            hint={`intensity ${options.intensity} · ${options.preset}`}
            tone="slow"
            accent="text-meta-600"
          />
          <StatTile
            icon={Cpu}
            label="Engine"
            value={health ? health.worker_mode : "—"}
            hint={
              health
                ? `${health.active_jobs} active · ${health.queue_depth} queued`
                : healthError
                  ? "unreachable"
                  : "connecting"
            }
            tone={healthError ? "danger" : "default"}
            accent="text-meta-600"
          />
          <StatTile
            icon={ShieldCheck}
            label="Outputs ready"
            value={String(outputsReady)}
            hint={batch ? `${batch.total} in this batch` : "no batch yet"}
            tone={outputsReady > 0 ? "success" : "muted"}
            accent="text-meta-600"
          />
        </section>

        {engineBlocked ? (
          <NeonCard tone="danger" padding="md" radius="lg" className="mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <p className="text-xs leading-relaxed text-red-700">
                The API is up but <span className="font-mono">ffmpeg</span> is missing on the worker
                host. Renders will fail until it is installed — see the README for the one-line
                install per platform.
              </p>
            </div>
          </NeonCard>
        ) : null}

        {/* Console ------------------------------------------------------- */}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-6">
            <NeonCard padding="lg" radius="xl" id="upload">
              <div className="mb-5 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">
                  1 · Load assets
                </h2>
              </div>
              <UploadZone
                files={files}
                onFilesChange={setFiles}
                maxFiles={maxFiles}
                maxSizeMb={maxSizeMb}
                disabled={uploading}
              />
            </NeonCard>

            <NeonCard tone="slow" padding="lg" radius="xl">
              <div className="mb-5 flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-meta-600" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">
                  2 · Configure camouflage
                </h2>
              </div>
              <OptionsPanel
                options={options}
                onChange={setOptions}
                catalogue={catalogue}
                disabled={uploading}
              />
            </NeonCard>

            <NeonCard padding="lg" radius="xl">
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={files.length === 0 || uploading || Boolean(healthError)}
                  className="btn-primary w-full !py-3 !text-sm"
                >
                  {uploading ? (
                    <>
                      <Radar className="h-4 w-4 animate-spin" aria-hidden />
                      Uploading… {Math.round(uploadProgress * 100)}%
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4" aria-hidden />
                      Run mutation on {files.length || "0"} asset
                      {files.length === 1 ? "" : "s"}
                      {options.variants > 1 ? ` × ${options.variants} variants` : ""}
                    </>
                  )}
                </button>

                {uploading ? (
                  <ProgressBar value={uploadProgress * 100} active label="Upload progress" />
                ) : null}

                {healthError ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700">
                    {healthError}
                  </p>
                ) : null}

                {submitError ? (
                  <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    {submitError}
                  </p>
                ) : null}

                <p className="text-[11px] leading-relaxed text-ink-faint">
                  Renders run on the worker queue, so large batches keep going after you close this
                  tab. Files and download links are purged after{" "}
                  {limits?.retention_hours ?? 24} hours.
                </p>
              </div>
            </NeonCard>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="mb-4 flex items-center gap-2">
              <Radar className="h-4 w-4 text-meta-500" aria-hidden />
              <h2 className="text-sm font-semibold tracking-tight text-black">
                3 · Mutation queue
              </h2>
            </div>
            <div className="max-h-[calc(100vh-11rem)] overflow-y-auto pr-1">
              <JobQueue
                batch={batch}
                polling={polling}
                error={pollError}
                onCancel={handleCancel}
                onRefresh={handleRefresh}
                onDiscard={handleDiscard}
              />
            </div>
          </div>
        </section>

        {/* Pipeline ------------------------------------------------------ */}
        <section className="mt-14 scroll-mt-24" id="pipeline">
          <h2 className="mb-5 text-sm font-semibold tracking-tight text-black">
            How a file moves through the engine
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(({ icon: Icon, title, body }, index) => (
              <NeonCard key={title} interactive padding="md" radius="lg" tone={index % 2 ? "slow" : "default"}>
                <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-lg border border-black/10 bg-meta-50 text-meta-500">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-black">
                  <span className="mr-1.5 font-mono text-[11px] text-ink-faint">
                    0{index + 1}
                  </span>
                  {title}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-black0">{body}</p>
              </NeonCard>
            ))}
          </div>
        </section>

        <footer className="mt-14 border-t border-black/[0.07] pt-6">
          <div className="flex flex-col items-start justify-between gap-3 text-[11px] text-ink-faint sm:flex-row sm:items-center">
            <p>
              AdCamouflage {health?.version ? `v${health.version}` : ""} · FastAPI · Celery · FFmpeg
              · OpenCV
            </p>
            <p>
              Use only on creatives you own or are licensed to distribute, and within the terms of
              the platforms you publish to.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
