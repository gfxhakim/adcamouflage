"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  Megaphone,
  ImagePlus,
  Layers3,
  Radar,
  Rocket,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import DeckRail from "@/components/DeckRail";
import ThemeDock from "@/components/ThemeDock";
import OverlayPanel, { createOverlayLayer } from "@/components/OverlayPanel";
import PosterPicker from "@/components/PosterPicker";
import JobQueue from "@/components/JobQueue";
import NeonCard from "@/components/NeonCard";
import OptionsPanel from "@/components/OptionsPanel";
import PlanSummary from "@/components/plan/PlanSummary";
import ProgressBar from "@/components/ProgressBar";
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
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";
import type {
  BatchStatus,
  HealthReport,
  MutationOptions,
  OverlayLayer,
  PosterSettings,
  PresetCatalogue,
} from "@/lib/types";
import { useDeckTheme } from "@/lib/deckTheme";

/** A queued file is treated as a video by its extension (matches the API's own classifier). */
function isVideoFile(file: File): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name) || file.type.startsWith("video/");
}

const DEFAULT_OPTIONS: MutationOptions = {
  preset: "balanced",
  intensity: 48,
  micro_crop: true,
  frame_rate_stagger: true,
  noise_injection: true,
  color_drift: true,
  audio_mutation: true,
  strip_metadata: true,
  keyframe_gop_jitter: true,
  container_bitrate_shuffle: true,
  chroma_matrix_shift: true,
  frequency_smoothing: false,
  deep_scramble: false,
  mirror: false,
  temporal_trim: true,
  target_fps: null,
  audio_pitch_ratio: null,
  output_format: null,
  seed: null,
  variants: 1,
  overlay: {
    enabled: false,
    mode: "always",
    position: "bottom_right",
    offset_x: 24,
    offset_y: 24,
    scale_percent: 18,
    opacity: 1,
    intro_seconds: 3,
    ranges: [],
  },
  overlays: [],
  poster: { enabled: false, timestamp: 0 },
  quality: "auto",
  keep_resolution: false,
  upscale_to: null,
};

/** The workspace runs as four steps, one card at a time. */
const STEPS = [
  { label: "Load" },
  { label: "Settings" },
  { label: "Overlay" },
  { label: "Render" },
] as const;

const POLL_INTERVAL_MS = 1200;
const HEALTH_INTERVAL_MS = 15000;

export default function WorkspacePage() {
  const onDark = useDeckTheme() === "dark";
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState(0);
  const [overlayLayers, setOverlayLayers] = useState<OverlayLayer[]>([createOverlayLayer()]);
  const [user, setUser] = useState<UserProfile | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((profile) => {
        if (cancelled || !mountedRef.current) return;
        // The middleware already gated this route on the cookie being present.
        // If the API rejects it (expired, or signed with an old secret), clear
        // it first, then go back to the landing page to sign in again.
        if (!profile) {
          void signOut()
            .catch(() => undefined)
            .finally(() => window.location.assign("/"));
          return;
        }
        setUser(profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
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
      // Only layers with an image are sent; each image rides alongside its
      // layer settings, in order.
      const activeLayers = overlayLayers.filter((layer) => layer.image);
      const payload: MutationOptions = {
        ...options,
        overlays: activeLayers.map((layer) => ({ ...layer.settings, enabled: true })),
      };
      const overlayImages = activeLayers.map((layer) => layer.image as File);

      const created = await createBatch(
        files,
        payload,
        setUploadProgress,
        undefined,
        null,
        overlayImages,
      );
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
      // Keeps the plan usage readout in the header current.
      void fetchMe()
        .then((profile) => {
          if (profile && mountedRef.current) setUser(profile);
        })
        .catch(() => undefined);
    }
  }, [files, options, overlayLayers, refresh, uploading]);

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

  const queuedBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

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

  // First queued video, used by the poster picker as a scrub preview.
  const firstVideo = useMemo(() => files.find(isVideoFile) ?? null, [files]);

  // Mirrors the API's own validation, so an avoidable 422 never leaves the page.
  const overlayProblem = useMemo(() => {
    const active = overlayLayers.filter((layer) => layer.image);
    for (let i = 0; i < active.length; i += 1) {
      const { settings } = active[i];
      const prefix = active.length > 1 ? `Logo ${i + 1}: ` : "";
      if (settings.mode === "ranges") {
        if (settings.ranges.length === 0) return `${prefix}add at least one frame range.`;
        const bad = settings.ranges.findIndex((r) => r.end_frame < r.start_frame);
        if (bad >= 0) return `${prefix}range ${bad + 1} ends before it starts.`;
      }
    }
    return null;
  }, [overlayLayers]);

  const outputsReady = batch?.completed ?? 0;
  const engineBlocked = Boolean(health) && !health?.ffmpeg;

  return (
    <div className="deck min-h-screen">
      <Header health={health} healthError={healthError} user={user} onDark={onDark} />

      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-40 pt-6 md:pb-24 sm:px-6 sm:pt-8 lg:px-8">
        {/* Left rail — signed-in navigation -------------------------- */}
        <DeckRail onDark={onDark} />

        {/* Main console --------------------------------------------- */}
        <main className="relative min-w-0 flex-1">
          {/* Intro ------------------------------------------------- */}
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label">Workspace</p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black dark:text-slate-50 sm:text-5xl">
              {user
                ? `Welcome back${user.display_name ? `, ${user.display_name}` : ""}`
                : "Your workspace"}
            </h1>
            <p className="max-w-2xl text-sm text-ink-muted dark:text-slate-400">
              Load assets, choose how hard to camouflage them, optionally add an overlay, then run.
              Batch up to {maxFiles} files; outputs are deleted after{" "}
              {limits?.retention_hours ?? 24} hours.
            </p>
          </section>

          {user?.announcement ? (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-meta-500/30 bg-meta-50 px-4 py-3 dark:bg-meta-500/10">
              <Megaphone
                className="mt-0.5 h-4 w-4 shrink-0 text-meta-600 dark:text-meta-300"
                aria-hidden
              />
              <p className="whitespace-pre-line text-sm leading-relaxed text-meta-900 dark:text-meta-100">
                {user.announcement}
              </p>
            </div>
          ) : null}

          {user ? <PlanSummary user={user} /> : null}

          {/* Readout strip ----------------------------------------- */}
          <section className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <div className="readout">
              <p className="readout-k">Queued</p>
              <p className="readout-v tabular-nums">{files.length}</p>
              <p className="readout-h">
                {files.length ? formatBytes(queuedBytes) : `up to ${maxFiles} per batch`}
              </p>
            </div>
            <div className="readout">
              <p className="readout-k">Active layers</p>
              <p className="readout-v tabular-nums">{activeLayers}/9</p>
              <p className="readout-h">
                intensity {options.intensity} · {options.preset}
              </p>
            </div>
            <div className="readout" data-tone={healthError ? "danger" : undefined}>
              <p className="readout-k">Engine</p>
              <p className="readout-v">{health ? health.worker_mode : "—"}</p>
              <p className="readout-h">
                {health
                  ? `${health.active_jobs} active · ${health.queue_depth} queued`
                  : healthError
                    ? "unreachable"
                    : "connecting"}
              </p>
            </div>
            <div className="readout" data-tone={outputsReady > 0 ? "success" : "muted"}>
              <p className="readout-k">Outputs ready</p>
              <p className="readout-v tabular-nums">{outputsReady}</p>
              <p className="readout-h">{batch ? `${batch.total} in this batch` : "no batch yet"}</p>
            </div>
          </section>

          {engineBlocked ? (
            <NeonCard tone="danger" padding="md" radius="lg" className="mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                  aria-hidden
                />
                <p className="text-xs leading-relaxed text-red-700 dark:text-red-300">
                  The API is up but <span className="font-mono">ffmpeg</span> is missing on the
                  worker host. Renders will fail until it is installed — see the README for the
                  one-line install per platform.
                </p>
              </div>
            </NeonCard>
          ) : null}

          {/* Step flow: one step at a time ------------------------- */}
          <nav aria-label="Workspace steps" className="mb-5">
            <ol className="flex items-center gap-2 sm:gap-3">
              {STEPS.map(({ label }, index) => {
                const done = index < step;
                const current = index === step;
                const locked = index > 0 && files.length === 0 && !batch;
                return (
                  <li
                    key={label}
                    className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 last:flex-none"
                  >
                    <button
                      type="button"
                      onClick={() => setStep(index)}
                      disabled={locked}
                      aria-current={current ? "step" : undefined}
                      className="group flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        className={clsx(
                          "grid h-7 w-7 place-items-center rounded-full border font-mono text-xs tabular-nums transition",
                          current || done
                            ? "border-meta-500 bg-meta-500 text-white shadow-[0_0_14px_-3px_rgb(8_102_255/0.8)]"
                            : "border-black/15 text-ink-muted group-hover:border-meta-500 dark:border-white/15 dark:text-slate-400",
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                      </span>
                      <span
                        className={clsx(
                          "hidden text-sm sm:inline",
                          current
                            ? "font-medium text-black dark:text-slate-50"
                            : "text-ink-muted dark:text-slate-400",
                        )}
                      >
                        {label}
                      </span>
                    </button>
                    {index < STEPS.length - 1 ? (
                      <span
                        className={clsx(
                          "h-px min-w-[1rem] flex-1 rounded-full",
                          done ? "bg-meta-500" : "bg-black/10 dark:bg-white/10",
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-xs text-ink-muted dark:text-slate-400 sm:hidden">
              Step {step + 1} of {STEPS.length} · {STEPS[step].label}
            </p>
          </nav>

          {/* Console: current step on the left, queue docked right -- */}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="min-w-0 space-y-6">
              {step === 0 ? (
                <NeonCard glow padding="lg" radius="xl" id="upload">
                  <div className="mb-5 flex items-center gap-2">
                    <span className="panel-step hidden dark:inline">01</span>
                    <Sparkles className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
                      <span className="dark:hidden">1 · </span>Load assets
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
              ) : null}

              {step === 1 ? (
                <NeonCard glow tone="slow" padding="lg" radius="xl" id="configure">
                  <div className="mb-5 flex items-center gap-2">
                    <span className="panel-step hidden dark:inline">02</span>
                    <Layers3 className="h-4 w-4 text-meta-600 dark:text-meta-300" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
                      <span className="dark:hidden">2 · </span>Configure camouflage
                    </h2>
                  </div>
                  <OptionsPanel
                    options={options}
                    onChange={setOptions}
                    catalogue={catalogue}
                    disabled={uploading}
                  />
                </NeonCard>
              ) : null}

              {step === 2 ? (
                <div className="space-y-6">
                  <NeonCard glow padding="lg" radius="xl" id="overlay">
                    <div className="mb-5 flex items-center gap-2">
                      <span className="panel-step hidden dark:inline">03</span>
                      <ImagePlus className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
                        <span className="dark:hidden">3 · </span>Brand overlay
                      </h2>
                      <span className="chip !text-[10px]">optional</span>
                    </div>
                    <OverlayPanel
                      layers={overlayLayers}
                      onChange={setOverlayLayers}
                      disabled={uploading}
                    />
                  </NeonCard>
                  <NeonCard padding="lg" radius="xl" id="poster">
                    <div className="mb-5 flex items-center gap-2">
                      <Film className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
                        Poster frame
                      </h2>
                      <span className="chip !text-[10px]">optional</span>
                    </div>
                    <PosterPicker
                      poster={options.poster}
                      onChange={(poster: PosterSettings) => setOptions({ ...options, poster })}
                      video={firstVideo}
                      disabled={uploading}
                    />
                  </NeonCard>
                </div>
              ) : null}

              {step === 3 ? (
                <NeonCard glow padding="lg" radius="xl" id="run">
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={
                        files.length === 0 ||
                        uploading ||
                        Boolean(healthError) ||
                        Boolean(overlayProblem)
                      }
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

                    {overlayProblem ? (
                      <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        {overlayProblem}
                      </p>
                    ) : null}

                    {healthError ? (
                      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                        {healthError}
                      </p>
                    ) : null}

                    {submitError ? (
                      <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        {submitError}
                      </p>
                    ) : null}

                    <p className="text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
                      Renders run on the worker queue, so large batches keep going after you close
                      this tab. Files and download links are purged after{" "}
                      {limits?.retention_hours ?? 24} hours.
                    </p>
                  </div>
                </NeonCard>
              ) : null}

              {/* Back / Next ------------------------------------------- */}
              <div className="flex items-center justify-between gap-3">
                {step > 0 ? (
                  <button type="button" onClick={() => setStep(step - 1)} className="btn-ghost">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Back
                  </button>
                ) : (
                  <span />
                )}
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    disabled={files.length === 0 && !batch}
                    className="btn-primary"
                  >
                    Next · {STEPS[step + 1].label}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            <div id="queue" className="lg:sticky lg:top-24 lg:self-start">
              <div className="mb-4 flex items-center gap-2">
                <span className="panel-step hidden dark:inline">04</span>
                <Radar className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
                  <span className="dark:hidden">4 · </span>Mutation queue
                </h2>
              </div>
              <div className="max-h-[calc(100vh-11rem)] overflow-y-auto rounded-2xl border border-transparent pr-1 dark:border-white/5 dark:bg-white/[0.015] dark:p-2">
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

          <footer className="mt-12 border-t border-black/[0.07] pt-6 dark:border-white/10">
            <div className="flex flex-col items-start justify-between gap-3 text-[11px] text-ink-faint dark:text-slate-500 sm:flex-row sm:items-center">
              <p>
                AdCamouflage {health?.version ? `v${health.version}` : ""} · FastAPI · Celery ·
                FFmpeg · OpenCV
              </p>
              <p>
                Use only on creatives you own or are licensed to distribute, and within the terms of
                the platforms you publish to.
              </p>
            </div>
          </footer>
        </main>
      </div>
      <ThemeDock />
    </div>
  );
}
