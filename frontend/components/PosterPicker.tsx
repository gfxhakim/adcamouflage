"use client";

import { Clapperboard, ImageDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PosterSettings } from "@/lib/types";

interface PosterPickerProps {
  poster: PosterSettings;
  onChange: (poster: PosterSettings) => void;
  /** First queued video, used purely as a scrub preview. */
  video: File | null;
  disabled?: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  const mm = Math.floor(whole / 60);
  const ss = String(whole % 60).padStart(2, "0");
  const dec = Math.round((seconds - whole) * 10);
  return `${mm}:${ss}.${dec}`;
}

export function PosterPicker({ poster, onChange, video, disabled = false }: PosterPickerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!video) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(video);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  // Keep the preview frame in step with the chosen timestamp.
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !poster.enabled) return;
    if (Number.isFinite(poster.timestamp)) {
      try {
        element.currentTime = Math.min(poster.timestamp, duration || poster.timestamp);
      } catch {
        /* seeking before metadata is ready throws; the slider retries on input */
      }
    }
  }, [poster.timestamp, poster.enabled, duration]);

  const setEnabled = (enabled: boolean) => onChange({ ...poster, enabled });
  const setTimestamp = (timestamp: number) => onChange({ ...poster, timestamp });

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 accent-meta-500"
          checked={poster.enabled}
          disabled={disabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-black dark:text-slate-100">
            <ImageDown className="h-3.5 w-3.5 text-meta-500" aria-hidden />
            Pick the thumbnail frame
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle dark:text-slate-400">
            Choose which frame players show as the poster. Applied to every video in the batch,
            clamped to each clip&apos;s length.
          </span>
        </span>
      </label>

      {poster.enabled ? (
        video && src ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-black">
              {/* The user's own clip, used only to preview the chosen frame. */}
              <video
                ref={videoRef}
                src={src}
                muted
                playsInline
                preload="metadata"
                className="mx-auto max-h-56 w-full object-contain"
                onLoadedMetadata={(event) => {
                  const d = event.currentTarget.duration;
                  setDuration(Number.isFinite(d) ? d : 0);
                  event.currentTarget.currentTime = Math.min(poster.timestamp, d || 0);
                }}
              />
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label htmlFor="poster-scrub" className="label">
                  Thumbnail time
                </label>
                <span className="font-mono text-xs text-meta-600 dark:text-meta-300">
                  {formatTime(poster.timestamp)}
                  {duration ? ` / ${formatTime(duration)}` : ""}
                </span>
              </div>
              <input
                id="poster-scrub"
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={Math.min(poster.timestamp, duration || poster.timestamp)}
                disabled={disabled || !duration}
                onChange={(event) => setTimestamp(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed text-ink-subtle dark:text-slate-400">
            <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-slate-500" aria-hidden />
            Queue a video above to scrub and pick its thumbnail frame. The time you choose is
            applied to every video in the batch.
          </p>
        )
      ) : null}
    </div>
  );
}

export default PosterPicker;
