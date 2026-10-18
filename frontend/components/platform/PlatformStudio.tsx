"use client";

import clsx from "clsx";
import {
  ArrowRight,
  Crop,
  Download,
  Film,
  Frame,
  Maximize2,
  Ruler,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { formatBytes } from "@/lib/format";
import { formatDuration, type FormatPreset, type PlatformConfig } from "@/lib/platforms";

type FitMode = "cover" | "contain";

/** Longest side of the exported thumbnail, so a 4K target stays a light PNG. */
const THUMB_MAX_SIDE = 1920;

function isVideo(file: File): boolean {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name) || file.type.startsWith("video/");
}

export default function PlatformStudio({ platform }: { platform: PlatformConfig }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [preset, setPreset] = useState<FormatPreset>(platform.presets[0]);
  const [fit, setFit] = useState<FitMode>("cover");
  const [showSafe, setShowSafe] = useState(true);
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  const [duration, setDuration] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  // A preset can change when the user switches platform pages.
  useEffect(() => {
    setPreset(platform.presets[0]);
  }, [platform]);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const onPick = useCallback((picked: File | null) => {
    if (!picked) return;
    if (!isVideo(picked)) return;
    setFile(picked);
    setDuration(0);
    setDims(null);
  }, []);

  const vertical = preset.height > preset.width;
  const tooLong = duration > 0 && duration > preset.maxDurationSec;

  const specRows = useMemo(
    () => [
      { k: "Aspect ratio", v: preset.aspect },
      { k: "Output size", v: `${preset.width} × ${preset.height}` },
      { k: "Max length", v: formatDuration(preset.maxDurationSec) },
      { k: "Placement", v: preset.note },
    ],
    [preset],
  );

  const saveThumbnail = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Scale the target frame down so a 4K preset still exports a light PNG.
    const scaleDown = Math.min(1, THUMB_MAX_SIDE / Math.max(preset.width, preset.height));
    const tw = Math.round(preset.width * scaleDown);
    const th = Math.round(preset.height * scaleDown);

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = fit === "cover" ? Math.max(tw / vw, th / vh) : Math.min(tw / vw, th / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;

    if (fit === "contain") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, tw, th);
    }
    const dx = fit === "cover" ? (tw - drawW) * (posX / 100) : (tw - drawW) / 2;
    const dy = fit === "cover" ? (th - drawH) * (posY / 100) : (th - drawH) / 2;
    ctx.drawImage(video, dx, dy, drawW, drawH);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${platform.key}-${preset.id}-${preset.width}x${preset.height}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }, [fit, posX, posY, preset, platform.key]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Controls ----------------------------------------------------------- */}
      <div className="space-y-6">
        <NeonCard glow padding="lg" radius="xl">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
            <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
              1 · Load a clip
            </h2>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onPick(e.dataTransfer.files?.[0] ?? null);
            }}
            className={clsx(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition",
              dragging
                ? "border-meta-500/60 bg-meta-500/10"
                : "border-black/15 hover:border-meta-500/40 dark:border-white/15",
            )}
          >
            <Film className="h-6 w-6 text-meta-500 dark:text-meta-300" aria-hidden />
            <span className="text-sm font-medium text-black dark:text-slate-100">
              {file ? file.name : "Drop a video or browse"}
            </span>
            <span className="text-[11px] text-ink-faint dark:text-slate-500">
              {file ? formatBytes(file.size) : "Stays in your browser — nothing is uploaded here"}
            </span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </label>
        </NeonCard>

        <NeonCard tone="slow" padding="lg" radius="xl">
          <div className="mb-4 flex items-center gap-2">
            <Frame className="h-4 w-4 text-meta-600 dark:text-meta-300" aria-hidden />
            <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
              2 · Pick a {platform.name} format
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {platform.presets.map((p) => {
              const on = p.id === preset.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={clsx(
                    "rounded-xl border px-3 py-2 text-left text-xs transition",
                    on
                      ? "border-meta-500/60 bg-meta-50 text-meta-700 dark:bg-meta-500/15 dark:text-meta-200"
                      : "border-black/10 text-ink-muted hover:border-meta-500/30 dark:border-white/10 dark:text-slate-300",
                  )}
                >
                  <span className="block font-semibold">{p.label}</span>
                  <span className="block text-[10px] opacity-70">
                    {p.aspect} · {p.width}×{p.height}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-black/10 p-0.5 dark:border-white/10">
              {(["cover", "contain"] as FitMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFit(m)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                    fit === m
                      ? "bg-meta-500 text-white"
                      : "text-ink-muted hover:text-black dark:text-slate-400 dark:hover:text-slate-100",
                  )}
                >
                  {m === "cover" ? <Crop className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {m === "cover" ? "Crop to fill" : "Fit (pad)"}
                </button>
              ))}
            </div>

            {vertical ? (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={showSafe}
                  onChange={(e) => setShowSafe(e.target.checked)}
                  className="h-3.5 w-3.5 accent-meta-500"
                />
                Safe-zone guides
              </label>
            ) : null}
          </div>

          {fit === "cover" ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-ink-muted dark:text-slate-400">
                <span className="mb-1 block">Horizontal {posX}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={posX}
                  onChange={(e) => setPosX(Number(e.target.value))}
                  className="w-full accent-meta-500"
                />
              </label>
              <label className="block text-xs text-ink-muted dark:text-slate-400">
                <span className="mb-1 block">Vertical {posY}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={posY}
                  onChange={(e) => setPosY(Number(e.target.value))}
                  className="w-full accent-meta-500"
                />
              </label>
            </div>
          ) : null}
        </NeonCard>

        <NeonCard padding="lg" radius="xl">
          <div className="mb-3 flex items-center gap-2">
            <Ruler className="h-4 w-4 text-meta-500 dark:text-meta-300" aria-hidden />
            <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Specs</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            {specRows.map((row) => (
              <div key={row.k} className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wide text-ink-faint dark:text-slate-500">{row.k}</dt>
                <dd className="font-medium text-black dark:text-slate-100">{row.v}</dd>
              </div>
            ))}
            {duration > 0 ? (
              <div className="flex flex-col">
                <dt className="text-[10px] uppercase tracking-wide text-ink-faint dark:text-slate-500">Your clip</dt>
                <dd className={clsx("font-medium", tooLong ? "text-amber-600 dark:text-amber-400" : "text-black dark:text-slate-100")}>
                  {formatDuration(duration)}
                  {dims ? ` · ${dims.w}×${dims.h}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
          {tooLong ? (
            <p className="mt-3 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              This clip is longer than {platform.name}&apos;s {formatDuration(preset.maxDurationSec)} limit for this
              placement — trim it before publishing.
            </p>
          ) : null}
        </NeonCard>
      </div>

      {/* Preview ------------------------------------------------------------ */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <NeonCard padding="lg" radius="xl">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">
              {preset.aspect} preview
            </h2>
            <span className="chip !text-[10px]">{preset.label}</span>
          </div>

          <div className="flex justify-center">
            <div
              className="relative max-h-[60vh] w-full overflow-hidden rounded-xl bg-black"
              style={{
                aspectRatio: `${preset.width} / ${preset.height}`,
                maxWidth: vertical ? "min(100%, 22rem)" : "100%",
              }}
            >
              {url ? (
                <video
                  ref={videoRef}
                  src={url}
                  controls
                  playsInline
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setDuration(v.duration);
                    setDims({ w: v.videoWidth, h: v.videoHeight });
                  }}
                  className="h-full w-full"
                  style={{ objectFit: fit, objectPosition: `${posX}% ${posY}%` }}
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs text-slate-500">
                  Load a clip to preview this frame
                </div>
              )}

              {/* Vertical UI safe-zone guides (approximate). */}
              {url && vertical && showSafe ? (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  <div className="absolute inset-x-0 top-0 h-[14%] bg-gradient-to-b from-black/35 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 h-[20%] bg-gradient-to-t from-black/45 to-transparent" />
                  <div className="absolute inset-0 m-[6%] rounded-md border border-dashed border-white/40" />
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={saveThumbnail}
              disabled={!url}
              className="btn-ghost flex-1 justify-center !py-2.5 disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              Save framed thumbnail
            </button>
            <Link href="/app" className="btn-primary flex-1 justify-center !py-2.5">
              Open in Workspace
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
            This studio frames and previews your clip for {platform.name} and exports a cover thumbnail
            right here in the browser. Camouflage mutation and the video render still run in the
            Workspace. One-click reframe-and-export of the video to this exact size is a planned next
            step — tell us if you want it wired up.
          </p>
        </NeonCard>
      </div>
    </div>
  );
}
