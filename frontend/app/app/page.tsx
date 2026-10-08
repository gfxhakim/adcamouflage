"use client";

import {
  AlertTriangle,
  Cpu,
  FileStack,
  ImagePlus,
  Layers3,
  Radar,
  Rocket,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import OverlayPanel from "@/components/OverlayPanel";
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
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";
import type {
  BatchStatus,
  HealthReport,
  MutationOptions,
  OverlaySettings,
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
};

const POLL_INTERVAL_MS = 1200;
const HEALTH_INTERVAL_MS = 15000;

export default function WorkspacePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [overlayImage, setOverlayImage] = useState<File | null>(null);
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
        // it first: otherwise /login would see the cookie and bounce back here.
        if (!profile) {
          void signOut()
            .catch(() => undefined)
            .finally(() => window.location.assign("/login?next=%2Fapp"));
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
      const created = await createBatch(
        files,
        options,
        setUploadProgress,
        undefined,
        overlayImage,
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
  }, [files, options, overlayImage, refresh, uploading]);

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

  // Mirrors the API's own validation, so an avoidable 422 never leaves the page.
  const overlayProblem = useMemo(() => {
    const overlay = options.overlay;
    if (!overlayImage) return null;
    if (overlay.mode === "ranges") {
      if (overlay.ranges.length === 0) return "Add at least one frame range for the overlay.";
      const bad = overlay.ranges.findIndex((r) => r.end_frame < r.start_frame);
      if (bad >= 0) return `Overlay range ${bad + 1} ends before it starts.`;
    }
    return null;
  }, [options.overlay, overlayImage]);

  const outputsReady = batch?.completed ?? 0;
  const engineBlocked = Boolean(health) && !health?.ffmpeg;

  return (
    <>
      <Header health={health} healthError={healthError} user={user} />

      <main className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        {/* Intro ------------------------------------------------------- */}
        <section className="mb-6 flex flex-col gap-1 sm:mb-8">
          <p className="label">Workspace</p>
          <h1 className="text-2xl font-bold tracking-tight text-black sm:text-3xl">
            {user ? `Welcome back${user.display_name ? `, ${user.display_name}` : ""}` : "Your workspace"}
          </h1>
          <p className="max-w-2xl text-sm text-ink-muted">
            Load assets, choose how hard to camouflage them, optionally add an overlay, then run.
            Batch up to {maxFiles} files; outputs are deleted after{" "}
            {limits?.retention_hours ?? 24} hours.
          </p>
        </section>

        {/* Stats --------------------------------------------------------- */}
        <section className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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

            <NeonCard padding="lg" radius="xl" id="overlay">
              <div className="mb-5 flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">
                  3 · Brand overlay
                </h2>
                <span className="chip !text-[10px]">optional</span>
              </div>
              <OverlayPanel
                overlay={options.overlay}
                onChange={(overlay: OverlaySettings) => setOptions({ ...options, overlay })}
                image={overlayImage}
                onImageChange={setOverlayImage}
                disabled={uploading}
              />
            </NeonCard>

            <NeonCard padding="lg" radius="xl">
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    files.length === 0 || uploading || Boolean(healthError) || Boolean(overlayProblem)
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
                  <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    {overlayProblem}
                  </p>
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
                4 · Mutation queue
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

        <footer className="mt-12 border-t border-black/[0.07] pt-6">
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
