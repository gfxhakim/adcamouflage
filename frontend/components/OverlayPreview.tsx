"use client";

import clsx from "clsx";
import { AlertTriangle, Eye, Move, Pause, Play, Snail } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { flashesPerSecond, flashPattern, overlayVisibleOnFrame } from "@/lib/overlayTiming";
import type { OverlayLayer, OverlayPosition, OverlaySettings } from "@/lib/types";

interface OverlayPreviewProps {
  layers: OverlayLayer[];
  onChange: (layers: OverlayLayer[]) => void;
  /** Queued videos; the preview shows one at its real shape, or a placeholder frame. */
  videos: File[];
  disabled?: boolean;
}

// Placeholder frames when no video is queued, one per common ad shape.
const PLACEHOLDERS = [
  { id: "16:9", width: 1920, height: 1080 },
  { id: "9:16", width: 1080, height: 1920 },
  { id: "1:1", width: 1080, height: 1080 },
  { id: "4:5", width: 1080, height: 1350 },
] as const;
const PLACEHOLDER = PLACEHOLDERS[0];
// Tallest the preview frame gets; a portrait clip shrinks its width to fit.
const STAGE_MAX_HEIGHT_REM = 26;

function ratioLabel(width: number, height: number): string {
  const known: [number, string][] = [
    [16 / 9, "16:9"], [9 / 16, "9:16"], [1, "1:1"], [4 / 5, "4:5"], [5 / 4, "5:4"],
    [4 / 3, "4:3"], [3 / 4, "3:4"], [21 / 9, "21:9"], [2 / 3, "2:3"], [3 / 2, "3:2"],
  ];
  const ratio = width / height;
  const hit = known.find(([value]) => Math.abs(value - ratio) < 0.02);
  return hit ? hit[1] : `${(ratio).toFixed(2)}:1`;
}
const FPS_CHOICES = [24, 25, 30, 50, 60];
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const STRIP_FRAMES = 40;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlay box in video pixels, using the same anchor maths as the engine. */
function overlayBox(settings: OverlaySettings, aspect: number, W: number, H: number): Box {
  let w = Math.max(2, Math.round((W * settings.scale_percent) / 100));
  if (w % 2) w += 1;
  const h = Math.round(w / (aspect || 1));
  const ox = settings.offset_x;
  const oy = settings.offset_y;
  const pos = settings.position;
  const x = pos.endsWith("_right")
    ? W - w - ox
    : pos === "center" || pos === "top_center" || pos === "bottom_center"
      ? (W - w) / 2
      : ox;
  const y = pos.startsWith("bottom")
    ? H - h - oy
    : pos === "center" || pos === "center_left" || pos === "center_right"
      ? (H - h) / 2
      : oy;
  return { x, y, w, h };
}

/**
 * A dragged box keeps the anchor style the user picked: absolute pixels stay
 * absolute, everything else snaps to the nearest corner with matching margins
 * so the logo keeps its distance from that corner on every video in the batch.
 */
function settingsFromDrag(settings: OverlaySettings, box: Box, W: number, H: number): Partial<OverlaySettings> {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  if (settings.position === "custom") return { offset_x: x, offset_y: y };
  const right = box.x + box.w / 2 > W / 2;
  const bottom = box.y + box.h / 2 > H / 2;
  const position = `${bottom ? "bottom" : "top"}_${right ? "right" : "left"}` as OverlayPosition;
  return {
    position,
    offset_x: right ? Math.round(W - box.w - box.x) : x,
    offset_y: bottom ? Math.round(H - box.h - box.y) : y,
  };
}

function snapFps(raw: number): number {
  const nearest = COMMON_FPS.reduce((best, fps) => (Math.abs(fps - raw) < Math.abs(best - raw) ? fps : best));
  return Math.abs(nearest - raw) < 0.4 ? nearest : Math.round(raw * 100) / 100;
}

export function OverlayPreview({ layers, onChange, videos, disabled = false }: OverlayPreviewProps) {
  const [videoIndex, setVideoIndex] = useState(0);
  const [placeholder, setPlaceholder] = useState<(typeof PLACEHOLDERS)[number]>(PLACEHOLDER);
  const video = videos[Math.min(videoIndex, videos.length - 1)] ?? null;
  useEffect(() => {
    if (videoIndex >= videos.length) setVideoIndex(0);
  }, [videoIndex, videos.length]);
  const active = useMemo(() => layers.filter((layer) => layer.image), [layers]);

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>(PLACEHOLDER);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const [fps, setFps] = useState(30);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const fpsTouched = useRef(false);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [frame, setFrame] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  // --- sources -------------------------------------------------------------
  useEffect(() => {
    stop();
    setFrame(0);
    setDetectedFps(null);
    if (!video) {
      setVideoSrc(null);
      setDims({ width: placeholder.width, height: placeholder.height });
      return;
    }
    const url = URL.createObjectURL(video);
    setVideoSrc(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, placeholder]);

  const imageKey = active.map((layer) => `${layer.id}:${layer.image?.name}:${layer.image?.size}`).join("|");
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const layer of active) {
      if (layer.image) next[layer.id] = URL.createObjectURL(layer.image);
    }
    setImageUrls(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  useEffect(() => {
    if (selected && active.some((layer) => layer.id === selected)) return;
    setSelected(active[0]?.id ?? null);
  }, [active, selected]);

  // --- playback ------------------------------------------------------------
  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    const rate = slow ? 0.25 : 1;
    const element = videoRef.current;
    setPlaying(true);

    if (element && videoSrc) {
      element.playbackRate = rate;
      element.currentTime = 0;
      void element.play().catch(() => setPlaying(false));

      // Measure the clip's real frame rate from presented frames when the
      // browser exposes it, unless the user picked one by hand.
      const withCallback = element as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
      };
      if (withCallback.requestVideoFrameCallback && !fpsTouched.current) {
        // A busy tab can skip painting frames, so count on the smallest gap
        // between consecutive media timestamps (one true frame) rather than
        // on how many frames happened to be shown.
        let last: number | null = null;
        let smallest = Infinity;
        let samples = 0;
        const sample = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
          if (last !== null && meta.mediaTime > last) {
            smallest = Math.min(smallest, meta.mediaTime - last);
            samples += 1;
          }
          last = meta.mediaTime;
          if (samples >= 15) {
            const measured = snapFps(1 / smallest);
            if (measured >= 10 && measured <= 120) {
              setDetectedFps(measured);
              if (!fpsTouched.current) setFps(measured);
            }
            return;
          }
          withCallback.requestVideoFrameCallback?.(sample);
        };
        withCallback.requestVideoFrameCallback(sample);
      }

      const tick = () => {
        setFrame(Math.floor(element.currentTime * fpsRef.current + 0.001));
        if (element.ended) {
          stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    // No clip queued: run a 6 second simulated timeline on the placeholder.
    const started = performance.now();
    const tick = (now: number) => {
      const seconds = ((now - started) / 1000) * rate;
      if (seconds > 6) {
        stop();
        return;
      }
      setFrame(Math.floor(seconds * fpsRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [slow, stop, videoSrc]);

  // --- dragging ------------------------------------------------------------
  const W = dims.width;
  const H = dims.height;

  const toVideoPx = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  };

  const updateSettings = (id: string, patch: Partial<OverlaySettings>) =>
    onChange(layers.map((layer) => (layer.id === id ? { ...layer, settings: { ...layer.settings, ...patch } } : layer)));

  const onPointerDown = (event: React.PointerEvent, layer: OverlayLayer) => {
    if (disabled) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setSelected(layer.id);
    const box = overlayBox(layer.settings, aspects[layer.id] ?? 2, W, H);
    const point = toVideoPx(event.clientX, event.clientY);
    dragRef.current = { id: layer.id, dx: point.x - box.x, dy: point.y - box.y };
  };

  const onPointerMove = (event: React.PointerEvent, layer: OverlayLayer) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== layer.id) return;
    const box = overlayBox(layer.settings, aspects[layer.id] ?? 2, W, H);
    const point = toVideoPx(event.clientX, event.clientY);
    // Keep at least a sliver of the logo inside the frame.
    const x = Math.min(W - 8, Math.max(8 - box.w, point.x - drag.dx));
    const y = Math.min(H - 8, Math.max(8 - box.h, point.y - drag.dy));
    updateSettings(layer.id, settingsFromDrag(layer.settings, { ...box, x, y }, W, H));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Arrow keys nudge the selected logo by 1px (10px with Shift).
  const onKeyDown = (event: React.KeyboardEvent, layer: OverlayLayer) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move || disabled) return;
    event.preventDefault();
    const box = overlayBox(layer.settings, aspects[layer.id] ?? 2, W, H);
    updateSettings(layer.id, settingsFromDrag(layer.settings, { ...box, x: box.x + move[0], y: box.y + move[1] }, W, H));
  };

  // --- derived -------------------------------------------------------------
  const selectedLayer = active.find((layer) => layer.id === selected) ?? active[0] ?? null;
  const anyFlash = active.some((layer) => flashPattern(layer.settings));
  const fastestFlash = active.reduce((max, layer) => Math.max(max, flashesPerSecond(layer.settings, fps) ?? 0), 0);
  const stripStart = Math.floor(frame / STRIP_FRAMES) * STRIP_FRAMES;

  if (active.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed text-ink-subtle dark:text-slate-400">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-slate-500" aria-hidden />
        Add a logo or badge on the left to place it on the frame and preview its timing here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Which clip / shape to preview -------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {videos.length > 1 ? (
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-ink-subtle dark:text-slate-400">
            Video
            <select
              className="field min-w-0 flex-1 !py-1 !text-xs"
              value={Math.min(videoIndex, videos.length - 1)}
              onChange={(event) => setVideoIndex(Number(event.target.value))}
            >
              {videos.map((file, i) => (
                <option key={`${file.name}-${i}`} value={i}>
                  {i + 1}. {file.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!video ? (
          <div className="flex items-center gap-1" role="group" aria-label="Placeholder shape">
            {PLACEHOLDERS.map((shape) => (
              <button
                key={shape.id}
                type="button"
                aria-pressed={placeholder.id === shape.id}
                onClick={() => setPlaceholder(shape)}
                className={clsx(
                  "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                  placeholder.id === shape.id
                    ? "border-meta-500 bg-meta-500 text-white"
                    : "border-black/10 dark:border-white/10 text-ink-subtle dark:text-slate-400 hover:border-meta-500/50",
                )}
              >
                {shape.id}
              </button>
            ))}
          </div>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-ink-faint dark:text-slate-500">
          {ratioLabel(W, H)} · {W}×{H}
        </span>
      </div>

      <div className="flex justify-center">
      <div
        ref={stageRef}
        className="relative select-none overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-black touch-none"
        style={{
          aspectRatio: `${W} / ${H}`,
          // Width follows the clip's own shape: full column for landscape,
          // narrower for portrait so the whole frame fits without cropping.
          width: `min(100%, ${((STAGE_MAX_HEIGHT_REM * W) / H).toFixed(3)}rem, ${((70 * W) / H).toFixed(3)}vh)`,
        }}
      >
        {videoSrc ? (
          // The user's own clip, used only as a backdrop for placement.
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-fill"
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              if (el.videoWidth && el.videoHeight) setDims({ width: el.videoWidth, height: el.videoHeight });
              try {
                el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
              } catch {
                /* first frame is fine */
              }
            }}
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(24,119,242,0.45),transparent_60%),linear-gradient(135deg,#0b1220,#111827_55%,#0b1a33)]"
          >
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:10%_10%]" />
            <span className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-widest text-white/40">
              Placeholder · {placeholder.id}
            </span>
          </div>
        )}

        {active.map((layer) => {
          const box = overlayBox(layer.settings, aspects[layer.id] ?? 2, W, H);
          const visible = !playing || overlayVisibleOnFrame(layer.settings, frame, fps);
          const isSelected = layer.id === selectedLayer?.id;
          return (
            <div
              key={layer.id}
              role="button"
              tabIndex={0}
              aria-label={`Logo ${active.indexOf(layer) + 1}: drag to position, arrow keys to nudge`}
              onPointerDown={(event) => onPointerDown(event, layer)}
              onPointerMove={(event) => onPointerMove(event, layer)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(event) => onKeyDown(event, layer)}
              onFocus={() => setSelected(layer.id)}
              className={clsx(
                "absolute cursor-grab active:cursor-grabbing focus-visible:outline-none",
                !playing && (isSelected ? "ring-2 ring-meta-500" : "ring-1 ring-white/50"),
              )}
              style={{
                left: `${(box.x / W) * 100}%`,
                top: `${(box.y / H) * 100}%`,
                width: `${(box.w / W) * 100}%`,
                height: `${(box.h / H) * 100}%`,
              }}
            >
              {imageUrls[layer.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrls[layer.id]}
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full object-fill"
                  style={{ opacity: visible ? layer.settings.opacity : 0 }}
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      const ratio = img.naturalWidth / img.naturalHeight;
                      setAspects((prev) => (prev[layer.id] === ratio ? prev : { ...prev, [layer.id]: ratio }));
                    }
                  }}
                />
              ) : null}
            </div>
          );
        })}

        <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
          {playing ? `frame ${frame}` : "drag to place"}
        </span>
      </div>
      </div>

      {/* Controls ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={playing ? stop : play}
          className="btn-primary !px-3 !py-1.5 !text-xs"
        >
          {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          {playing ? "Stop" : "Play preview"}
        </button>
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow((value) => !value)}
          disabled={playing}
          className={clsx("btn-ghost !px-2.5 !py-1.5 !text-xs", slow && "!border-meta-500/60 !text-meta-600 dark:!text-meta-300")}
          title="Play at quarter speed"
        >
          <Snail className="h-3.5 w-3.5" aria-hidden />
          Slow-mo
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-subtle dark:text-slate-400">
          Preview fps
          <select
            className="field !w-auto !py-1 !text-xs"
            value={fps}
            disabled={playing}
            onChange={(event) => {
              fpsTouched.current = true;
              setFps(Number(event.target.value));
            }}
          >
            {Array.from(new Set([...(detectedFps ? [detectedFps] : []), ...FPS_CHOICES]))
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                  {value === detectedFps ? " (clip)" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>

      {/* Timing strip for the selected logo ---------------------------------- */}
      {selectedLayer ? (
        <div>
          <p className="label mb-1.5 flex items-center justify-between">
            <span>
              {active.length > 1 ? `Logo ${active.indexOf(selectedLayer) + 1} · ` : ""}frames {stripStart}–
              {stripStart + STRIP_FRAMES - 1}
            </span>
            {anyFlash && fastestFlash > 0 ? (
              <span className="font-mono normal-case tracking-normal text-meta-600 dark:text-meta-300">
                {fastestFlash.toFixed(1)} flashes/s
              </span>
            ) : null}
          </p>
          <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${STRIP_FRAMES}, minmax(0, 1fr))` }} aria-hidden>
            {Array.from({ length: STRIP_FRAMES }, (_, i) => {
              const n = stripStart + i;
              const on = overlayVisibleOnFrame(selectedLayer.settings, n, fps);
              return (
                <span
                  key={n}
                  className={clsx(
                    "h-3 rounded-[2px]",
                    on ? "bg-meta-500" : "bg-black/[0.08] dark:bg-white/10",
                    playing && n === frame && "ring-2 ring-black dark:ring-white",
                  )}
                />
              );
            })}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-faint dark:text-slate-500">
            <Move className="h-3 w-3" aria-hidden />
            Drag a logo to move it, arrow keys nudge (Shift for 10px). Size, margins and opacity sync
            with the controls on the left.
          </p>
        </div>
      ) : null}

      {anyFlash ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Photosensitivity: flashing more than 3 times a second can affect people with
          photosensitive epilepsy. Use Slow-mo to check the rhythm comfortably.
        </p>
      ) : null}
    </div>
  );
}

export default OverlayPreview;
