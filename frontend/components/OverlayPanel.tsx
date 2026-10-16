"use client";

import clsx from "clsx";
import { Clapperboard, Layers3, Plus, Repeat, Timer, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { formatBytes } from "@/lib/format";
import type {
  FrameRange,
  OverlayLayer,
  OverlayMode,
  OverlayPosition,
  OverlaySettings,
} from "@/lib/types";

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

const MAX_LAYERS = 6;

export function defaultOverlaySettings(): OverlaySettings {
  return {
    enabled: true,
    mode: "always",
    position: "bottom_right",
    offset_x: 24,
    offset_y: 24,
    scale_percent: 18,
    opacity: 1,
    intro_seconds: 3,
    ranges: [],
  };
}

export function createOverlayLayer(): OverlayLayer {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `ovl-${Math.random().toString(36).slice(2)}`;
  return { id, settings: defaultOverlaySettings(), image: null };
}

interface OverlayPanelProps {
  layers: OverlayLayer[];
  onChange: (layers: OverlayLayer[]) => void;
  disabled?: boolean;
}

export function OverlayPanel({ layers, onChange, disabled = false }: OverlayPanelProps) {
  const updateLayer = useCallback(
    (id: string, patch: Partial<OverlayLayer>) =>
      onChange(layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))),
    [layers, onChange],
  );

  const removeLayer = useCallback(
    (id: string) => onChange(layers.filter((layer) => layer.id !== id)),
    [layers, onChange],
  );

  const addLayer = useCallback(
    () => onChange([...layers, createOverlayLayer()]),
    [layers, onChange],
  );

  // Always keep one editable layer on screen so the first upload has a home.
  const visible = layers.length > 0 ? layers : [createOverlayLayer()];

  return (
    <div className="space-y-4">
      {visible.map((layer, index) => (
        <LayerEditor
          key={layer.id}
          layer={layer}
          index={index}
          total={visible.length}
          disabled={disabled}
          onChange={(patch) => {
            // The placeholder layer only becomes real once it is touched.
            if (!layers.some((entry) => entry.id === layer.id)) {
              onChange([...layers, { ...layer, ...patch }]);
            } else {
              updateLayer(layer.id, patch);
            }
          }}
          onRemove={layers.length > 1 ? () => removeLayer(layer.id) : undefined}
        />
      ))}

      {layers.length >= 1 && layers.length < MAX_LAYERS ? (
        <button
          type="button"
          onClick={addLayer}
          disabled={disabled}
          className="btn-ghost w-full justify-center !py-2 !text-xs"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add another logo or badge
        </button>
      ) : null}

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
        <Layers3 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Each overlay is composited before the grain pass, so logos pick up the same per-frame
        noise as the rest of the picture. Add up to {MAX_LAYERS}.
      </p>
    </div>
  );
}

interface LayerEditorProps {
  layer: OverlayLayer;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (patch: Partial<OverlayLayer>) => void;
  onRemove?: () => void;
}

function LayerEditor({ layer, index, total, disabled, onChange, onRemove }: LayerEditorProps) {
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const { settings, image } = layer;

  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const setSetting = <K extends keyof OverlaySettings>(key: K, value: OverlaySettings[K]) =>
    onChange({ settings: { ...settings, [key]: value } });

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
      onChange({ image: file, settings: { ...settings, enabled: true } });
    },
    [onChange, settings],
  );

  const addRange = () => {
    const last = settings.ranges[settings.ranges.length - 1];
    const start = last ? last.end_frame + 30 : 0;
    setSetting("ranges", [...settings.ranges, { start_frame: start, end_frame: start + 29 }]);
  };

  const updateRange = (i: number, patch: Partial<FrameRange>) =>
    setSetting(
      "ranges",
      settings.ranges.map((range, r) => (r === i ? { ...range, ...patch } : range)),
    );

  const removeRange = (i: number) =>
    setSetting("ranges", settings.ranges.filter((_, r) => r !== i));

  const invalidRange = settings.ranges.findIndex((r) => r.end_frame < r.start_frame);

  return (
    <div className="rounded-xl border border-black/[0.08] dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.04] p-3 sm:p-4">
      {total > 1 ? (
        <div className="mb-3 flex items-center justify-between">
          <span className="label">Logo {index + 1}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="rounded-md p-1.5 text-ink-faint dark:text-slate-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              aria-label={`Remove logo ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

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
          <div className="flex items-center gap-3 rounded-xl border border-meta-500/40 bg-meta-50 dark:bg-meta-500/10 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Overlay preview"
              className="h-14 w-14 shrink-0 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 object-contain p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-black dark:text-slate-100">{image.name}</p>
              <p className="text-[11px] text-ink-subtle dark:text-slate-400">{formatBytes(image.size)}</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ image: null, settings: { ...settings, enabled: false } })}
              className="rounded-md p-1.5 text-ink-faint dark:text-slate-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              aria-label="Remove the overlay image"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className={clsx(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/20 dark:border-white/15 px-4 py-6 text-center transition-colors",
              dragging && "border-meta-500 bg-meta-50 dark:bg-meta-500/10",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-black/10 dark:border-white/10 bg-meta-50 dark:bg-meta-500/10 text-meta-500">
              <Upload className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-xs font-semibold text-black dark:text-slate-100">Add a logo or badge</span>
            <span className="text-[11px] text-ink-faint dark:text-slate-500">
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
        <p className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          {problem}
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </p>
      ) : null}

      {image ? (
        <div className="mt-4 space-y-5">
          {/* When ------------------------------------------------------- */}
          <section>
            <p className="label mb-2">When it shows</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map(({ id, label, blurb, icon: Icon }) => {
                const active = settings.mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => setSetting("mode", id)}
                    className={clsx(
                      "rounded-lg border p-2.5 text-left transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                      active
                        ? "border-meta-500/50 bg-meta-50 dark:bg-meta-500/10 text-black dark:text-slate-100"
                        : "border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] text-ink-subtle dark:text-slate-400 hover:border-black/20 dark:hover:border-white/15",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Icon className={clsx("h-3.5 w-3.5", active ? "text-meta-500" : "")} aria-hidden />
                      {label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-ink-faint dark:text-slate-500">{blurb}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {settings.mode === "intro" ? (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor={`${inputId}-intro`} className="label">
                  Intro length
                </label>
                <span className="font-mono text-xs text-meta-600 dark:text-meta-300">{settings.intro_seconds}s</span>
              </div>
              <input
                id={`${inputId}-intro`}
                type="range"
                min={0.5}
                max={15}
                step={0.5}
                value={settings.intro_seconds}
                disabled={disabled}
                onChange={(event) => setSetting("intro_seconds", Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500"
              />
            </div>
          ) : null}

          {settings.mode === "ranges" ? (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="label">Frame ranges</p>
                <button
                  type="button"
                  onClick={addRange}
                  disabled={disabled || settings.ranges.length >= 50}
                  className="btn-ghost !px-2 !py-1 !text-[11px]"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  Add range
                </button>
              </div>

              {settings.ranges.length === 0 ? (
                <p className="rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  Add at least one range, or the batch will be rejected.
                </p>
              ) : (
                <ul className="space-y-2">
                  {settings.ranges.map((range, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 font-mono text-[11px] text-ink-faint dark:text-slate-500">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <input
                        type="number"
                        min={0}
                        className="field !py-1.5 !text-xs"
                        value={range.start_frame}
                        disabled={disabled}
                        aria-label={`Range ${i + 1} start frame`}
                        onChange={(event) =>
                          updateRange(i, { start_frame: Math.max(0, Number(event.target.value)) })
                        }
                      />
                      <span className="shrink-0 text-[11px] text-ink-faint dark:text-slate-500">to</span>
                      <input
                        type="number"
                        min={0}
                        className="field !py-1.5 !text-xs"
                        value={range.end_frame}
                        disabled={disabled}
                        aria-label={`Range ${i + 1} end frame`}
                        onChange={(event) =>
                          updateRange(i, { end_frame: Math.max(0, Number(event.target.value)) })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeRange(i)}
                        disabled={disabled}
                        className="shrink-0 rounded-md p-1.5 text-ink-faint dark:text-slate-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                        aria-label={`Remove range ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {invalidRange >= 0 ? (
                <p className="mt-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
                  Range {invalidRange + 1} ends before it starts.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Where ------------------------------------------------------ */}
          <section>
            <p className="label mb-2">Where it sits</p>
            <div className="flex gap-4">
              <div className="grid shrink-0 grid-cols-3 gap-1" role="group" aria-label="Overlay position">
                {POSITIONS.map(({ id, label }) => {
                  const active = settings.position === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      title={label}
                      aria-label={label}
                      onClick={() => setSetting("position", id)}
                      className={clsx(
                        "h-9 w-9 rounded-md border transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                        active
                          ? "border-meta-500 bg-meta-500 shadow-meta-sm"
                          : "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] hover:border-meta-500/50",
                      )}
                    >
                      <span
                        className={clsx(
                          "mx-auto block h-1.5 w-1.5 rounded-full",
                          active ? "bg-white" : "bg-black/20 dark:bg-white/20",
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
                    <label htmlFor={`${inputId}-scale`} className="label">
                      Size
                    </label>
                    <span className="font-mono text-xs text-meta-600 dark:text-meta-300">
                      {settings.scale_percent}% of width
                    </span>
                  </div>
                  <input
                    id={`${inputId}-scale`}
                    type="range"
                    min={2}
                    max={100}
                    step={1}
                    value={settings.scale_percent}
                    disabled={disabled}
                    onChange={(event) => setSetting("scale_percent", Number(event.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <label htmlFor={`${inputId}-opacity`} className="label">
                      Opacity
                    </label>
                    <span className="font-mono text-xs text-meta-600 dark:text-meta-300">
                      {Math.round(settings.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    id={`${inputId}-opacity`}
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(settings.opacity * 100)}
                    disabled={disabled}
                    onChange={(event) => setSetting("opacity", Number(event.target.value) / 100)}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.08] dark:bg-white/10 accent-meta-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`${inputId}-x`} className="label mb-1 block">
                      {settings.position === "custom" ? "X" : "Margin X"}
                    </label>
                    <input
                      id={`${inputId}-x`}
                      type="number"
                      className="field !py-1.5 !text-xs"
                      value={settings.offset_x}
                      disabled={disabled}
                      onChange={(event) => setSetting("offset_x", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${inputId}-y`} className="label mb-1 block">
                      {settings.position === "custom" ? "Y" : "Margin Y"}
                    </label>
                    <input
                      id={`${inputId}-y`}
                      type="number"
                      className="field !py-1.5 !text-xs"
                      value={settings.offset_y}
                      disabled={disabled}
                      onChange={(event) => setSetting("offset_y", Number(event.target.value))}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-ink-subtle dark:text-slate-400">
                  <input
                    type="checkbox"
                    className="accent-meta-500"
                    checked={settings.position === "custom"}
                    disabled={disabled}
                    onChange={(event) =>
                      setSetting("position", event.target.checked ? "custom" : "bottom_right")
                    }
                  />
                  Use absolute pixel coordinates
                </label>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default OverlayPanel;
