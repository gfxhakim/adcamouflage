"use client";

import {
  AlertTriangle,
  Cpu,
  FileStack,
  Fingerprint,
  Layers3,
  Radar,
  Rocket,
  ScanLine,
  ShieldCheck,
  Sparkles,
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
        <section className="relative mb-8">
          <div
            className="pointer-events-none absolute -inset-x-10 -top-24 h-64 animate-float-slow rounded-full bg-cyan-500/[0.07] blur-3xl"
            aria-hidden
          />
          <div className="relative">
            <span className="chip mb-4">
              <Radar className="h-3.5 w-3.5 animate-pulse-glow text-cyan-300" aria-hidden />
              Mutation engine · FFmpeg + OpenCV
            </span>
            <h1 className="max-w-3xl text-3xl font-bold leading-[1.15] tracking-tight text-slate-50 sm:text-4xl lg:text-5xl">
              Ship the same creative <span className="text-gradient">a hundred different ways</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Every upload is re-cut, re-timed, re-graded and re-encoded from scratch. Geometry,
              grain, frame rate and audio pitch all move; EXIF, camera data, editor tags and encoder
              signatures are erased. What comes out looks the same to a person and reads as a
              completely different file to a matcher.
            </p>
          </div>
        </section>

        {/* Stats --------------------------------------------------------- */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={FileStack}
            label="Queued"
            value={String(files.length)}
            hint={files.length ? formatBytes(queuedBytes) : `up to ${maxFiles} per batch`}
            accent="text-cyan-300"
          />
          <StatTile
            icon={Waves}
            label="Active layers"
            value={`${activeLayers}/9`}
            hint={`intensity ${options.intensity} · ${options.preset}`}
            tone="slow"
            accent="text-fuchsia-300"
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
            accent="text-sky-300"
          />
          <StatTile
            icon={ShieldCheck}
            label="Outputs ready"
            value={String(outputsReady)}
            hint={batch ? `${batch.total} in this batch` : "no batch yet"}
            tone={outputsReady > 0 ? "success" : "muted"}
            accent="text-emerald-300"
          />
        </section>

        {engineBlocked ? (
          <NeonCard tone="danger" padding="md" radius="lg" className="mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden />
              <p className="text-xs leading-relaxed text-rose-200">
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
            <NeonCard padding="lg" radius="xl">
              <div className="mb-5 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-slate-100">
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
                <Layers3 className="h-4 w-4 text-fuchsia-300" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-slate-100">
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
                  <p className="rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                    {healthError}
                  </p>
                ) : null}

                {submitError ? (
                  <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                    {submitError}
                  </p>
                ) : null}

                <p className="text-[11px] leading-relaxed text-slate-600">
                  Renders run on the worker queue, so large batches keep going after you close this
                  tab. Files and download links are purged after{" "}
                  {limits?.retention_hours ?? 24} hours.
                </p>
              </div>
            </NeonCard>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="mb-4 flex items-center gap-2">
              <Radar className="h-4 w-4 text-cyan-300" aria-hidden />
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">
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
        <section className="mt-14">
          <h2 className="mb-5 text-sm font-semibold tracking-tight text-slate-100">
            How a file moves through the engine
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(({ icon: Icon, title, body }, index) => (
              <NeonCard key={title} interactive padding="md" radius="lg" tone={index % 2 ? "slow" : "default"}>
                <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-cyan-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-slate-100">
                  <span className="mr-1.5 font-mono text-[11px] text-slate-600">
                    0{index + 1}
                  </span>
                  {title}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{body}</p>
              </NeonCard>
            ))}
          </div>
        </section>

        <footer className="mt-14 border-t border-white/[0.06] pt-6">
          <div className="flex flex-col items-start justify-between gap-3 text-[11px] text-slate-600 sm:flex-row sm:items-center">
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
