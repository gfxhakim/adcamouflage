"use client";

import clsx from "clsx";
import { Clapperboard, Image as ImageIcon, Plus, Repeat, Timer, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import type { FrameRange, OverlayMode, OverlayPosition, OverlaySettings } from "@/lib/types";

const MODES: { id: OverlayMode; label: string; blurb: string; icon: typeof Repeat }[] = [
  { id: "always", label: "Every frame", blurb: "A persistent watermark for the whole clip.", icon: Repeat },
  { id: "intro", label: "Intro only", blurb: "Show it at the start, then let the creative breathe.", icon: Timer },
  { id: "ranges", label: "Custom frames", blurb: "Pick exact frame ranges to show it on.", icon: Clapperboard },
];

const POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: "top_left", label: "Top left" },
  { id: "top_center", label: "Top" },
  { id: "top_right", label: "Top right" },
  { id: "center_left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "center_right", label: "Right" },
  { id: "bottom_left", label: "Bottom left" },
  { id: "bottom_center", label: "Bottom" },
  { id: "bottom_right", label: "Bottom right" },
];

interface OverlayPanelProps {
  overlay: OverlaySettings;
  onChange: (overlay: OverlaySettings) => void;
  image: File | null;
  onImageChange: (image: File | null) => void;
  disabled?: boolean;
}

export function OverlayPanel({
  overlay,
  onChange,
  image,
  onImageChange,
  disabled = false,
}: OverlayPanelProps) {
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Object URLs have to be revoked or the blob leaks for the page's lifetime.
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const set = <K extends keyof OverlaySettings>(key: K, value: OverlaySettings[K]) =>
    onChange({ ...overlay, [key]: value });

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
        setProblem("Use a PNG, JPG or WEBP. PNG keeps transparency.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setProblem("Keep the overlay under 20MB.");
        return;
      }
      setProblem(null);
      onImageChange(file);
      onChange({ ...overlay, enabled: true });
    },
    [onChange, onImageChange, overlay],
  );

  const addRange = () => {
    const last = overlay.ranges[overlay.ranges.length - 1];
    const start = last ? last.end_frame + 30 : 0;
    set("ranges", [...overlay.ranges, { start_frame: start, end_frame: start + 29 }]);
  };

  const updateRange = (index: number, patch: Partial<FrameRange>) => {
    set(
      "ranges",
      overlay.ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)),
    );
  };

  const removeRange = (index: number) =>
    set("ranges", overlay.ranges.filter((_, i) => i !== index));

  const invalidRange = overlay.ranges.findIndex((r) => r.end_frame < r.start_frame);

  return (
    <div className="space-y-5">
      {/* Image ---------------------------------------------------------- */}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!disabled) accept(event.dataTransfer.files?.[0]);
        }}
      >
        {image && preview ? (
          <div className="flex items-center gap-3 rounded-xl border border-meta-500/40 bg-meta-50 p-3">
            {/* A blob preview of the user's own file; next/image adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Overlay preview"
              className="h-14 w-14 shrink-0 rounded-lg border border-black/10 bg-white object-contain p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-black">{image.name}</p>
              <p className="text-[11px] text-ink-subtle">{formatBytes(image.size)}</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onImageChange(null);
                onChange({ ...overlay, enabled: false });
              }}
              className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
              aria-label="Remove the overlay image"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className={clsx(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/20 px-4 py-6 text-center transition-colors",
              dragging && "border-meta-500 bg-meta-50",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-black/10 bg-meta-50 text-meta-500">
              <Upload className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-xs font-semibold text-black">Add a logo or badge</span>
            <span className="text-[11px] text-ink-faint">
              PNG with transparency works best · drop it here or click
            </span>
            <input
              id={inputId}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="sr-only"
              disabled={disabled}
              onChange={(event) => {
                accept(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {problem ? (
        <p className="flex items-start justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {problem}
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </p>
      ) : null}

      {image ? (
        <>
          {/* When ------------------------------------------------------- */}
          <section>
            <p className="label mb-2">When it shows</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map(({ id, label, blurb, icon: Icon }) => {
                const active = overlay.mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => set("mode", id)}
                    className={clsx(
                      "rounded-lg border p-2.5 text-left transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                      active
                        ? "border-meta-500/50 bg-meta-50 text-black"
                        : "border-black/[0.08] bg-black/[0.02] text-ink-subtle hover:border-black/20",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Icon className={clsx("h-3.5 w-3.5", active ? "text-meta-500" : "")} aria-hidden />
                      {label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-ink-faint">{blurb}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {overlay.mode === "intro" ? (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="intro-seconds" className="label">
                  Intro length
                </label>
                <span className="font-mono text-xs text-meta-600">{overlay.intro_seconds}s</span>
              </div>
              <input
                id="intro-seconds"
                type="range"
                min={0.5}
                max={15}
                step={0.5}
                value={overlay.intro_seconds}
                disabled={disabled}
                onChange={(event) => set("intro_seconds", Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] accent-meta-500"
              />
            </div>
          ) : null}

          {overlay.mode === "ranges" ? (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="label">Frame ranges</p>
                <button
                  type="button"
                  onClick={addRange}
                  disabled={disabled || overlay.ranges.length >= 50}
                  className="btn-ghost !px-2 !py-1 !text-[11px]"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Add range
                </button>
              </div>

              {overlay.ranges.length === 0 ? (
                <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  Add at least one range, or the batch will be rejected.
                </p>
              ) : (
                <ul className="space-y-2">
                  {overlay.ranges.map((range, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-[11px] text-ink-faint">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <input
                        type="number"
                        min={0}
                        className="field !py-1.5 !text-xs"
                        value={range.start_frame}
                        disabled={disabled}
                        aria-label={`Range ${index + 1} start frame`}
                        onChange={(event) =>
                          updateRange(index, { start_frame: Math.max(0, Number(event.target.value)) })
                        }
                      />
                      <span className="shrink-0 text-[11px] text-ink-faint">to</span>
                      <input
                        type="number"
                        min={0}
                        className="field !py-1.5 !text-xs"
                        value={range.end_frame}
                        disabled={disabled}
                        aria-label={`Range ${index + 1} end frame`}
                        onChange={(event) =>
                          updateRange(index, { end_frame: Math.max(0, Number(event.target.value)) })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeRange(index)}
                        disabled={disabled}
                        className="shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove range ${index + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {invalidRange >= 0 ? (
                <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  Range {invalidRange + 1} ends before it starts.
                </p>
              ) : null}

              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Frame numbers refer to your source file. They are converted to timestamps, so they
                stay accurate even though the output frame rate is deliberately changed.
              </p>
            </section>
          ) : null}

          {/* Where ------------------------------------------------------ */}
          <section>
            <p className="label mb-2">Where it sits</p>
            <div className="flex gap-4">
              <div className="grid shrink-0 grid-cols-3 gap-1" role="group" aria-label="Overlay position">
                {POSITIONS.map(({ id, label }) => {
                  const active = overlay.position === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      title={label}
                      aria-label={label}
                      onClick={() => set("position", id)}
                      className={clsx(
                        "h-9 w-9 rounded-md border transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                        active
                          ? "border-meta-500 bg-meta-500 shadow-meta-sm"
                          : "border-black/10 bg-black/[0.02] hover:border-meta-500/50",
                      )}
                    >
                      <span
                        className={clsx(
                          "mx-auto block h-1.5 w-1.5 rounded-full",
                          active ? "bg-white" : "bg-black/20",
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <label htmlFor="ov-scale" className="label">
                      Size
                    </label>
                    <span className="font-mono text-xs text-meta-600">
                      {overlay.scale_percent}% of width
                    </span>
                  </div>
                  <input
                    id="ov-scale"
                    type="range"
                    min={2}
                    max={100}
                    step={1}
                    value={overlay.scale_percent}
                    disabled={disabled}
                    onChange={(event) => set("scale_percent", Number(event.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] accent-meta-500"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <label htmlFor="ov-opacity" className="label">
                      Opacity
                    </label>
                    <span className="font-mono text-xs text-meta-600">
                      {Math.round(overlay.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    id="ov-opacity"
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(overlay.opacity * 100)}
                    disabled={disabled}
                    onChange={(event) => set("opacity", Number(event.target.value) / 100)}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] accent-meta-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="ov-x" className="label mb-1 block">
                      {overlay.position === "custom" ? "X" : "Margin X"}
                    </label>
                    <input
                      id="ov-x"
                      type="number"
                      className="field !py-1.5 !text-xs"
                      value={overlay.offset_x}
                      disabled={disabled}
                      onChange={(event) => set("offset_x", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <label htmlFor="ov-y" className="label mb-1 block">
                      {overlay.position === "custom" ? "Y" : "Margin Y"}
                    </label>
                    <input
                      id="ov-y"
                      type="number"
                      className="field !py-1.5 !text-xs"
                      value={overlay.offset_y}
                      disabled={disabled}
                      onChange={(event) => set("offset_y", Number(event.target.value))}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-ink-subtle">
                  <input
                    type="checkbox"
                    className="accent-meta-500"
                    checked={overlay.position === "custom"}
                    disabled={disabled}
                    onChange={(event) =>
                      set("position", event.target.checked ? "custom" : "bottom_right")
                    }
                  />
                  Use absolute pixel coordinates
                </label>
              </div>
            </div>
          </section>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
            <ImageIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            The overlay is composited before the grain pass, so it picks up the same per-frame noise
            as the rest of the picture instead of staying a pristine, unchanging region.
          </p>
        </>
      ) : null}
    </div>
  );
}

export default OverlayPanel;
