"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Film,
  Megaphone,
  ImagePlus,
  Radar,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import DeckRail from "@/components/DeckRail";
import ThemeDock from "@/components/ThemeDock";
import OverlayPanel, { createOverlayLayer } from "@/components/OverlayPanel";
import PosterPicker from "@/components/PosterPicker";
import JobQueue from "@/components/JobQueue";
import NeonCard from "@/components/NeonCard";
import OptionsPanel from "@/components/OptionsPanel";
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
  { id: "upload", label: "Load", title: "Load assets", hint: "" },
  {
    id: "configure",
    label: "Settings",
    title: "Settings",
    hint: "Pick a profile and intensity, then fine-tune each layer and the output quality.",
  },
  {
    id: "overlay",
    label: "Overlay",
    title: "Overlay & poster",
    hint: "Add up to 6 logos or badges and choose the cover frame. Both are optional.",
  },
  {
    id: "run",
    label: "Render",
    title: "Render",
    hint: "Start the run and follow every file in the queue. Downloads appear here.",
  },
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

  const plan = user
    ? {
        label: user.plan_label,
        used: user.used_this_month,
        quota: user.monthly_quota,
        low:
          user.plan_expired ||
          (user.monthly_quota !== null &&
            user.monthly_quota - user.used_this_month <= Math.max(1, user.monthly_quota * 0.2)),
      }
    : null;

  return (
    <div className="deck min-h-screen">
      <Header health={health} healthError={healthError} user={user} onDark={onDark} />

      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-40 pt-6 sm:px-6 sm:pt-8 md:pb-28 lg:px-8">
        {/* Left rail — signed-in navigation -------------------------- */}
        <DeckRail onDark={onDark} />

        {/* Step Flow: one step at a time in a single framed console ---- */}
        <main className="relative flex min-w-0 flex-1 flex-col gap-4">
          {user?.announcement ? (
            <div className="flex items-start gap-3 rounded-xl border border-meta-500/30 bg-meta-50 px-4 py-3 dark:bg-meta-500/10">
              <Megaphone
                className="mt-0.5 h-4 w-4 shrink-0 text-meta-600 dark:text-meta-300"
                aria-hidden
              />
              <p className="whitespace-pre-line text-sm leading-relaxed text-meta-900 dark:text-meta-100">
                {user.announcement}
              </p>
            </div>
          ) : null}

          {engineBlocked ? (
            <NeonCard tone="danger" padding="md" radius="lg">
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

          {/* Stepper ------------------------------------------------- */}
          <nav
            aria-label="Workspace steps"
            className="rounded-2xl border border-black/[0.08] bg-white/80 px-3 py-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 sm:px-4"
          >
            <ol className="flex items-center gap-2 sm:gap-3">
              {STEPS.map(({ label }, index) => {
                const done = index < step;
                const current = index === step;
                const locked = index > 0 && files.length === 0 && !batch;
                return (
                  <li
                    key={label}
                    className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3"
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
                          "h-[3px] min-w-[1rem] flex-1 rounded-full transition-colors",
                          done ? "bg-meta-500" : "bg-black/10 dark:bg-white/10",
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* Status strip: plan, files, layers, engine, outputs --------- */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            {plan ? (
              <Link
                href="/app/plan"
                className={clsx(
                  "chip !font-mono hover:!border-meta-500/60",
                  plan.low && "!border-red-400/50 !text-red-700 dark:!text-red-300",
                )}
                title="Plan & usage"
              >
                <Crown className="h-3.5 w-3.5" aria-hidden />
                {plan.label} · {plan.used}
                {plan.quota === null ? "" : `/${plan.quota}`} files
                {user?.plan_expired ? " · expired" : ""}
              </Link>
            ) : null}
            <span className="chip !font-mono">
              Queued {files.length}
              {files.length ? ` · ${formatBytes(queuedBytes)}` : ` · max ${maxFiles}`}
            </span>
            <span className="chip !font-mono">
              Layers {activeLayers}/9 · {options.preset} {options.intensity}
            </span>
            <span
              className={clsx(
                "chip !font-mono",
                healthError && "!border-red-400/50 !text-red-700 dark:!text-red-300",
              )}
            >
              Engine{" "}
              {health
                ? `${health.worker_mode} · ${health.active_jobs} active`
                : healthError
                  ? "unreachable"
                  : "connecting"}
            </span>
            <button
              type="button"
              onClick={() => setStep(STEPS.length - 1)}
              disabled={!batch}
              className={clsx(
                "chip !font-mono disabled:cursor-default",
                outputsReady > 0 && "!border-meta-500/60 !text-meta-700 dark:!text-meta-200",
              )}
            >
              {polling ? <Radar className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Ready {outputsReady}
              {batch ? `/${batch.total}` : ""}
            </button>
          </div>

          {/* The one step card ------------------------------------------ */}
          <NeonCard glow padding="lg" radius="xl" id={STEPS[step].id}>
            <div className="flex min-h-[52vh] flex-col">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-display text-3xl font-normal leading-none text-black dark:text-slate-50 sm:text-4xl">
                    {STEPS[step].title}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm text-ink-muted dark:text-slate-400">
                    {step === 0
                      ? `Drop up to ${maxFiles} videos or images. Outputs are deleted after ${limits?.retention_hours ?? 24} hours.`
                      : STEPS[step].hint}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint dark:text-slate-500">
                  {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                {step === 0 ? (
                  <UploadZone
                    files={files}
                    onFilesChange={setFiles}
                    maxFiles={maxFiles}
                    maxSizeMb={maxSizeMb}
                    disabled={uploading}
                  />
                ) : null}

                {step === 1 ? (
                  <OptionsPanel
                    options={options}
                    onChange={setOptions}
                    catalogue={catalogue}
                    disabled={uploading}
                  />
                ) : null}

                {step === 2 ? (
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <p className="label mb-3 flex items-center gap-1.5">
                        <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                        Brand overlay · optional
                      </p>
                      <OverlayPanel
                        layers={overlayLayers}
                        onChange={setOverlayLayers}
                        disabled={uploading}
                      />
                    </div>
                    <div className="min-w-0 border-t border-black/[0.07] pt-6 dark:border-white/10 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                      <p className="label mb-3 flex items-center gap-1.5">
                        <Film className="h-3.5 w-3.5" aria-hidden />
                        Poster frame · optional
                      </p>
                      <PosterPicker
                        poster={options.poster}
                        onChange={(poster: PosterSettings) => setOptions({ ...options, poster })}
                        video={firstVideo}
                        disabled={uploading}
                      />
                    </div>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                    <div className="min-w-0 space-y-4">
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
                    <div id="queue" className="min-w-0">
                      <p className="label mb-3 flex items-center gap-1.5">
                        <Radar className="h-3.5 w-3.5" aria-hidden />
                        Mutation queue
                      </p>
                      <div className="max-h-[60vh] overflow-y-auto rounded-2xl pr-1">
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
                  </div>
                ) : null}
              </div>

              {/* Back / Next, inside the frame like the mock ------------ */}
              <div className="mt-8 flex items-center justify-between gap-3 border-t border-black/[0.07] pt-5 dark:border-white/10">
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
          </NeonCard>

          <footer className="mt-6 flex flex-col items-start justify-between gap-3 text-[11px] text-ink-faint dark:text-slate-500 sm:flex-row sm:items-center">
            <p>
              AdCamouflage {health?.version ? `v${health.version}` : ""} · FastAPI · Celery · FFmpeg
              · OpenCV
            </p>
            <p>
              Use only on creatives you own or are licensed to distribute, and within the terms of
              the platforms you publish to.
            </p>
          </footer>
        </main>
      </div>
      <ThemeDock />
    </div>
  );
}
