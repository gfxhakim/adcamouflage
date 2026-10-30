"use client";

/* eslint-disable @next/next/no-img-element -- previews of admin-supplied media. */
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Laptop,
  Loader2,
  MousePointerClick,
  Monitor,
  Palette,
  RefreshCw,
  RotateCcw,
  Rocket,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  Type,
  Upload,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ICONS, ICON_NAMES } from "@/components/cms/icons";
import {
  FONT_CHOICES,
  PREVIEW_PARAM,
  contentAdmin,
  isVideoUrl,
  type ContentRecord,
  type FieldInfo,
  type LinkValue,
  type ListEntry,
  type MediaValue,
  type Namespace,
  type PreviewMessage,
  type SectionStyle,
  type SiteContent,
  type TextStyle,
  type ThemeValue,
} from "@/lib/siteContent";

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

const DEVICES = [
  { id: "desktop", label: "Desktop", width: 1440, icon: Monitor },
  { id: "laptop", label: "Laptop", width: 1180, icon: Laptop },
  { id: "tablet", label: "Tablet", width: 820, icon: Tablet },
  { id: "phone", label: "Phone", width: 390, icon: Smartphone },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

const WORDS: Record<string, string> = {
  cta: "Call to action",
  lede: "Intro paragraph",
  q: "Question",
  a: "Answer",
  kicker: "Small label",
  faq: "FAQ",
  why: "How it works",
  nav: "Menu",
  ui: "Labels",
};

function humanize(part: string): string {
  if (WORDS[part]) return WORDS[part];
  if (/^\d+$/.test(part)) return `#${Number(part) + 1}`;
  const spaced = part.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fieldLabel(field: FieldInfo): string {
  if (field.key.startsWith("ui.") && !field.label) {
    const text = String(field.fallback ?? "");
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
  const parts = field.key.split(".");
  const own = field.label || humanize(parts[parts.length - 1]);
  // Items inside a list get their position so "Title" reads "#2 · Title".
  const position = parts.slice(1, -1).filter((p) => /^\d+$|^n\d+$/.test(p));
  return position.length ? `${position.map((p) => humanize(p.replace(/^n/, ""))).join(" ")} · ${own}` : own;
}

function sectionOf(key: string): string {
  return key.split(".")[0];
}

function groupOf(field: FieldInfo | undefined, key: string): string {
  return field?.group ?? sectionOf(key);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

/** Drop empty maps and blank values so the stored document stays small and "reset" is clean. */
function prune(content: SiteContent): SiteContent {
  const out: Record<string, unknown> = {};
  for (const [bucket, value] of Object.entries(content)) {
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) continue;
    const entries = Object.entries(value).filter(([, v]) => {
      if (v === undefined || v === null || v === "") return false;
      if (typeof v === "object" && !Array.isArray(v)) return Object.values(v).some((x) => x !== undefined && x !== null && x !== "");
      return true;
    });
    if (entries.length) out[bucket] = Object.fromEntries(entries);
  }
  return out as SiteContent;
}

function cleanObject<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

// --------------------------------------------------------------------------
// small inputs
// --------------------------------------------------------------------------

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
        value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : /^#[0-9a-f]{6}$/i.test(placeholder ?? "") ? placeholder : "#0866ff"}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="field min-w-0 flex-1 font-mono text-xs"
        value={value ?? ""}
        placeholder={placeholder ?? "Built-in"}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {value ? (
        <button type="button" className="btn-ghost !px-2 !py-1.5" onClick={() => onChange(undefined)} title="Use the built-in colour">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  value?: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className="field"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder ?? "Built-in"}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value?: T;
  onChange: (v: T | undefined) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select className="field" value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
      <option value="">Built-in</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
      <input type="checkbox" className="h-4 w-4 accent-meta-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function UploadButton({ onUploaded, accept }: { onUploaded: (url: string, type: string) => void; accept: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
        Upload
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const result = await contentAdmin.upload(file);
            onUploaded(result.url, result.type);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <span className="mt-1 text-[11px] text-red-300">{error}</span> : null}
    </span>
  );
}

function MediaThumb({ src, kind }: { src?: string; kind?: string }) {
  if (!src) return <div className="grid h-20 w-full place-items-center rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500">Built-in visual</div>;
  const video = kind ? kind === "video" : isVideoUrl(src);
  return video ? (
    <video src={src} className="h-28 w-full rounded-lg bg-black object-contain" muted loop autoPlay playsInline />
  ) : (
    <img src={src} alt="" className="h-28 w-full rounded-lg bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:16px_16px] object-contain" />
  );
}

// --------------------------------------------------------------------------
// value editors
// --------------------------------------------------------------------------

function StyleEditor({ value, onChange }: { value?: TextStyle; onChange: (v: TextStyle | undefined) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<TextStyle>) => onChange(cleanObject({ ...v, ...patch }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Row label="Colour">
        <ColorInput value={v.color} onChange={(color) => set({ color })} />
      </Row>
      <Row label="Size (px)">
        <NumberInput value={v.size} min={6} max={240} onChange={(size) => set({ size })} />
      </Row>
      <Row label="Weight">
        <Select
          value={v.weight ? String(v.weight) : undefined}
          onChange={(w) => set({ weight: w ? Number(w) : undefined })}
          options={["300", "400", "500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))}
        />
      </Row>
      <Row label="Font">
        <Select value={v.font} onChange={(font) => set({ font })} options={[{ value: "sans", label: "Body font" }, { value: "display", label: "Display font" }, { value: "mono", label: "Mono font" }]} />
      </Row>
      <Row label="Align">
        <Select value={v.align} onChange={(align) => set({ align })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} />
      </Row>
      <Row label="Letter spacing (em)">
        <NumberInput value={v.tracking} step={0.01} min={-0.2} max={1} onChange={(tracking) => set({ tracking })} />
      </Row>
      <Row label="Line height">
        <NumberInput value={v.lineHeight} step={0.05} min={0.6} max={3} onChange={(lineHeight) => set({ lineHeight })} />
      </Row>
      <div className="flex flex-col justify-end gap-2 pb-1">
        <Toggle checked={!!v.italic} onChange={(italic) => set({ italic: italic || undefined })} label="Italic" />
        <Toggle checked={!!v.uppercase} onChange={(uppercase) => set({ uppercase: uppercase || undefined })} label="Uppercase" />
      </div>
    </div>
  );
}

function MediaEditor({ value, fallback, onChange }: { value?: MediaValue; fallback?: MediaValue; onChange: (v: MediaValue | undefined) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<MediaValue>) => onChange(cleanObject({ ...v, ...patch }));
  const src = v.src ?? fallback?.src;
  const kind = v.kind ?? fallback?.kind ?? (isVideoUrl(src) ? "video" : "image");
  return (
    <div className="space-y-3">
      <MediaThumb src={src} kind={kind} />
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Row label="File or URL">
            <input className="field font-mono text-xs" value={v.src ?? ""} placeholder={fallback?.src || "https://…"} onChange={(e) => set({ src: e.target.value || undefined })} />
          </Row>
        </div>
        <UploadButton
          accept="image/*,video/mp4,video/webm,video/quicktime"
          onUploaded={(url, type) => set({ src: url, kind: type.startsWith("video") ? "video" : "image" })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Type">
          <Select value={v.kind} onChange={(k) => set({ kind: k })} options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} />
        </Row>
        <Row label="Alt text">
          <input className="field" value={v.alt ?? ""} placeholder={fallback?.alt || "Describe the picture"} onChange={(e) => set({ alt: e.target.value || undefined })} />
        </Row>
        <Row label="Fit">
          <Select value={v.fit} onChange={(fit) => set({ fit })} options={[{ value: "cover", label: "Fill & crop" }, { value: "contain", label: "Fit inside" }, { value: "fill", label: "Stretch" }]} />
        </Row>
        <Row label="Align">
          <Select value={v.align} onChange={(align) => set({ align })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} />
        </Row>
        <Row label="Max width (px)">
          <NumberInput value={v.width} min={0} max={4000} onChange={(width) => set({ width })} />
        </Row>
        <Row label="Height (px)">
          <NumberInput value={v.height} min={0} max={4000} onChange={(height) => set({ height })} />
        </Row>
        <Row label="Corner radius (px)">
          <NumberInput value={v.radius} min={0} max={400} onChange={(radius) => set({ radius })} />
        </Row>
        <Row label="Opacity (0–1)">
          <NumberInput value={v.opacity} min={0} max={1} step={0.05} onChange={(opacity) => set({ opacity })} />
        </Row>
        <Row label="Click opens link">
          <input className="field font-mono text-xs" value={v.link ?? ""} placeholder="None" onChange={(e) => set({ link: e.target.value || undefined })} />
        </Row>
      </div>
      {kind === "video" ? (
        <div className="space-y-3 rounded-lg border border-white/10 p-3">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Row label="Poster image">
                <input className="field font-mono text-xs" value={v.poster ?? ""} placeholder="None" onChange={(e) => set({ poster: e.target.value || undefined })} />
              </Row>
            </div>
            <UploadButton accept="image/*" onUploaded={(url) => set({ poster: url })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <Toggle checked={v.autoplay ?? true} onChange={(autoplay) => set({ autoplay })} label="Autoplay" />
            <Toggle checked={v.loop ?? true} onChange={(loop) => set({ loop })} label="Loop" />
            <Toggle checked={v.muted ?? true} onChange={(muted) => set({ muted })} label="Muted" />
            <Toggle checked={v.controls ?? false} onChange={(controls) => set({ controls })} label="Show controls" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LinkEditor({ value, fallback, onChange }: { value?: LinkValue; fallback?: LinkValue; onChange: (v: LinkValue | undefined) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<LinkValue>) => onChange(cleanObject({ ...v, ...patch }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Row label="Button text">
        <input className="field" value={v.label ?? fallback?.label ?? ""} onChange={(e) => set({ label: e.target.value === fallback?.label ? undefined : e.target.value })} />
      </Row>
      <Row label="Goes to" hint="A page (/login), a section (#pricing) or a full web address.">
        <input className="field font-mono text-xs" value={v.href ?? ""} placeholder={fallback?.href} onChange={(e) => set({ href: e.target.value || undefined })} />
      </Row>
      <Row label="Style">
        <Select
          value={v.variant}
          onChange={(variant) => set({ variant })}
          options={[{ value: "solid", label: "Solid" }, { value: "outline", label: "Outline" }, { value: "ghost", label: "Text only" }]}
        />
      </Row>
      <div className="flex items-end pb-2">
        <Toggle checked={!!v.newTab} onChange={(newTab) => set({ newTab: newTab || undefined })} label="Open in a new tab" />
      </div>
      <Row label="Button colour">
        <ColorInput value={v.color} onChange={(color) => set({ color })} />
      </Row>
      <Row label="Text colour">
        <ColorInput value={v.textColor} onChange={(textColor) => set({ textColor })} />
      </Row>
    </div>
  );
}

function IconEditor({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [filter, setFilter] = useState("");
  const custom = value && /^(\/|https?:)/.test(value);
  const names = ICON_NAMES.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-3">
      <input className="field" placeholder="Search icons" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="grid max-h-48 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-white/10 p-1.5">
        {names.map((name) => {
          const Icon = ICONS[name];
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onChange(name)}
              className={clsx(
                "grid aspect-square place-items-center rounded-md transition-colors",
                value === name ? "bg-meta-500 text-white" : "text-slate-300 hover:bg-white/10",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Row label="Or your own icon image">
            <input className="field font-mono text-xs" value={custom ? value : ""} placeholder="https://… or upload" onChange={(e) => onChange(e.target.value || undefined)} />
          </Row>
        </div>
        <UploadButton accept="image/*" onUploaded={(url) => onChange(url)} />
      </div>
    </div>
  );
}

function SectionEditor({ value, onChange }: { value?: SectionStyle; onChange: (v: SectionStyle | undefined) => void }) {
  const v = value ?? {};
  const set = (patch: Partial<SectionStyle>) => onChange(cleanObject({ ...v, ...patch }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Row label="Background colour">
        <ColorInput value={v.background} onChange={(background) => set({ background })} />
      </Row>
      <Row label="Text colour">
        <ColorInput value={v.textColor} onChange={(textColor) => set({ textColor })} />
      </Row>
      <div className="sm:col-span-2">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Row label="Background image">
              <input className="field font-mono text-xs" value={v.backgroundImage ?? ""} placeholder="None" onChange={(e) => set({ backgroundImage: e.target.value || undefined })} />
            </Row>
          </div>
          <UploadButton accept="image/*" onUploaded={(url) => set({ backgroundImage: url })} />
        </div>
      </div>
      <Row label="Image size">
        <Select value={v.backgroundSize} onChange={(backgroundSize) => set({ backgroundSize })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Fit" }, { value: "auto", label: "Original" }]} />
      </Row>
      <Row label="Darken image (0–1)">
        <NumberInput value={v.backgroundOverlay} min={0} max={1} step={0.05} onChange={(backgroundOverlay) => set({ backgroundOverlay })} />
      </Row>
      <Row label="Top & bottom spacing (px)">
        <NumberInput value={v.paddingY} min={0} max={400} onChange={(paddingY) => set({ paddingY })} />
      </Row>
      <Row label="Corner radius (px)">
        <NumberInput value={v.radius} min={0} max={200} onChange={(radius) => set({ radius })} />
      </Row>
    </div>
  );
}

function ListEditor({
  field,
  entries,
  hide,
  onChange,
  onToggle,
}: {
  field: FieldInfo;
  entries?: ListEntry[];
  hide: Record<string, boolean>;
  onChange: (v: ListEntry[] | undefined) => void;
  onToggle: (id: string) => void;
}) {
  const count = field.count ?? 0;
  const list = entries ?? Array.from({ length: count }, (_, i) => ({ id: String(i), from: i }));
  const name = (entry: ListEntry) => {
    const base = field.items?.[entry.from] ?? `Item ${entry.from + 1}`;
    return /^\d+$/.test(entry.id) ? base : `${base} (copy)`;
  };
  const move = (i: number, by: number) => {
    const next = [...list];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    onChange(next);
  };
  const duplicate = (i: number) => {
    const next = [...list];
    next.splice(i + 1, 0, { id: `n${Date.now().toString(36)}`, from: list[i].from });
    onChange(next);
  };
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i));
  return (
    <ul className="space-y-1.5">
      {list.map((entry, i) => {
        const off = !!hide[`${field.key}.${entry.id}`];
        return (
          <li key={entry.id} className={clsx("flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5", off && "opacity-50")}>
            <span className="w-5 text-center font-mono text-[11px] text-slate-500">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{name(entry)}</span>
            <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Move down">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10" onClick={() => onToggle(entry.id)} title={off ? "Show" : "Hide"}>
              {off ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            </button>
            {field.fixed ? null : (
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10" onClick={() => duplicate(i)} title="Add a copy below">
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {field.fixed || /^\d+$/.test(entry.id) ? null : (
              <button type="button" className="rounded p-1 text-red-300 hover:bg-red-500/10" onClick={() => remove(i)} title="Remove this copy">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
      {field.fixed ? null : (
        <li className="pt-1 text-[11px] text-slate-500">Copies start with the text of the item they copy; edit them in the fields below once the preview shows them.</li>
      )}
    </ul>
  );
}

// --------------------------------------------------------------------------
// one field
// --------------------------------------------------------------------------

function FieldCard({
  field,
  draft,
  update,
  selected,
  onSelect,
}: {
  field: FieldInfo;
  draft: SiteContent;
  update: (fn: (d: SiteContent) => void) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const key = field.key;

  useEffect(() => {
    if (!selected) return;
    setOpen(true);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected]);

  const hidden = !!draft.hide?.[key];
  const isText = field.type === "text" || field.type === "longtext" || field.type === "headline";
  const changed =
    (isText && draft.text?.[key] !== undefined) ||
    !!draft.style?.[key] ||
    !!draft.media?.[key] ||
    !!draft.link?.[key] ||
    !!draft.icon?.[key] ||
    !!draft.list?.[key] ||
    !!draft.section?.[key] ||
    hidden;

  const reset = () =>
    update((d) => {
      for (const bucket of ["text", "style", "media", "link", "icon", "list", "section", "hide"] as const) {
        const map = d[bucket] as Record<string, unknown> | undefined;
        if (map) delete map[key];
      }
    });

  const setIn = <B extends "text" | "style" | "media" | "link" | "icon" | "list" | "section">(bucket: B, value: unknown) =>
    update((d) => {
      const map = ((d[bucket] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
      if (value === undefined) delete map[key];
      else map[key] = value;
      (d as Record<string, unknown>)[bucket] = map;
    });

  const toggleHide = (target = key) =>
    update((d) => {
      d.hide = d.hide ?? {};
      if (d.hide[target]) delete d.hide[target];
      else d.hide[target] = true;
    });

  const preview = isText
    ? draft.text?.[key] ?? String(field.fallback ?? "")
    : field.type === "link"
      ? (draft.link?.[key]?.label ?? (field.fallback as LinkValue | undefined)?.label ?? "")
      : field.type === "icon"
        ? draft.icon?.[key] ?? String(field.fallback || "Built-in icon")
        : field.type === "list"
          ? `${draft.list?.[key]?.length ?? field.count ?? 0} items`
          : field.type === "media" || field.type === "slot"
            ? draft.media?.[key]?.src ? "Custom media" : field.type === "slot" ? "Built-in visual" : "Built-in media"
            : field.type === "toggle"
              ? hidden ? "Off" : "On"
              : "";

  return (
    <div
      ref={ref}
      className={clsx(
        "rounded-xl border transition-colors",
        selected ? "border-meta-500 bg-meta-500/[0.06]" : "border-white/10 bg-white/[0.02]",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { setOpen(!open); onSelect(); }}>
          <ChevronDown className={clsx("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", open ? "" : "-rotate-90")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
              {fieldLabel(field)}
              {changed ? <span className="h-1.5 w-1.5 rounded-full bg-meta-400" title="Changed" /> : null}
            </span>
            <span className={clsx("block truncate text-[11px]", hidden ? "text-slate-600 line-through" : "text-slate-500")}>{preview}</span>
          </span>
        </button>
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10" onClick={() => toggleHide()} title={hidden ? "Show" : "Hide"}>
          {hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
        </button>
        {changed ? (
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-white/10" onClick={reset} title="Reset to built-in">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          {isText ? (
            <>
              <textarea
                className={clsx("field resize-y text-sm", field.type === "text" ? "min-h-[42px]" : "min-h-[110px]")}
                rows={field.type === "text" ? 1 : 4}
                value={draft.text?.[key] ?? String(field.fallback ?? "")}
                onChange={(e) => setIn("text", e.target.value === field.fallback ? undefined : e.target.value)}
              />
              {field.type === "headline" ? (
                <p className="text-[11px] text-slate-500">Use | to start a new line and [square brackets] to put words on the blue marker.</p>
              ) : null}
              <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-meta-300" onClick={() => setStyleOpen(!styleOpen)}>
                <Type className="h-3.5 w-3.5" aria-hidden />
                {styleOpen ? "Hide text style" : "Text style (colour, size, font…)"}
              </button>
              {styleOpen ? <StyleEditor value={draft.style?.[key]} onChange={(v) => setIn("style", v)} /> : null}
            </>
          ) : field.type === "media" || field.type === "slot" ? (
            <>
              {field.type === "slot" ? (
                <p className="text-[11px] text-slate-500">This is a drawn card. Add an image or video to show yours instead, or hide it.</p>
              ) : null}
              <MediaEditor value={draft.media?.[key]} fallback={field.fallback as MediaValue} onChange={(v) => setIn("media", v)} />
            </>
          ) : field.type === "link" ? (
            <LinkEditor value={draft.link?.[key]} fallback={field.fallback as LinkValue} onChange={(v) => setIn("link", v)} />
          ) : field.type === "icon" ? (
            <IconEditor value={draft.icon?.[key]} onChange={(v) => setIn("icon", v)} />
          ) : field.type === "list" ? (
            <ListEditor
              field={field}
              entries={draft.list?.[key]}
              hide={draft.hide ?? {}}
              onChange={(v) => setIn("list", v)}
              onToggle={(id) => toggleHide(`${key}.${id}`)}
            />
          ) : field.type === "section" ? (
            <SectionEditor value={draft.section?.[key]} onChange={(v) => setIn("section", v)} />
          ) : (
            <p className="text-[11px] text-slate-500">Use the eye button to switch this on or off.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// theme & page info
// --------------------------------------------------------------------------

function ThemePanel({ namespace, theme, onChange }: { namespace: Namespace; theme: ThemeValue; onChange: (t: ThemeValue) => void }) {
  const set = (patch: Partial<ThemeValue>) => onChange(cleanObject({ ...theme, ...patch }) ?? {});
  const fontOptions = FONT_CHOICES.map((f) => ({ value: f, label: f }));
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Colours</h3>
        <Row label="Accent (buttons, highlights)" hint="Every shade of the blue is worked out from this one colour.">
          <ColorInput value={theme.accent} onChange={(accent) => set({ accent })} placeholder="#0866ff" />
        </Row>
        <Row label="Dark surfaces (black sections and cards)">
          <ColorInput value={theme.dark} onChange={(dark) => set({ dark })} placeholder="#000000" />
        </Row>
        <Row label="Light surfaces (white cards)">
          <ColorInput value={theme.light} onChange={(light) => set({ light })} placeholder="#ffffff" />
        </Row>
        <Row label="Soft grey sections">
          <ColorInput value={theme.soft} onChange={(soft) => set({ soft })} placeholder="#f4f5f7" />
        </Row>
        <Row label="Page background">
          <ColorInput value={theme.page} onChange={(page) => set({ page })} placeholder="#ffffff" />
        </Row>
        <Row label="Main text">
          <ColorInput value={theme.ink} onChange={(ink) => set({ ink })} placeholder="#000000" />
        </Row>
        <Row label="Secondary text">
          <ColorInput value={theme.muted} onChange={(muted) => set({ muted })} placeholder="#4b4f56" />
        </Row>
      </div>
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Fonts</h3>
        <Row label="Body & headings">
          <Select value={theme.fontSans} onChange={(fontSans) => set({ fontSans })} options={fontOptions} />
        </Row>
        <Row label="Display (serif titles)">
          <Select value={theme.fontDisplay} onChange={(fontDisplay) => set({ fontDisplay })} options={fontOptions} />
        </Row>
        <Row label="Mono (small labels)">
          <Select value={theme.fontMono} onChange={(fontMono) => set({ fontMono })} options={fontOptions} />
        </Row>
        <Row label="Base text size (px)" hint="16 is the built-in size; everything scales with it.">
          <NumberInput value={theme.baseSize} min={12} max={22} onChange={(baseSize) => set({ baseSize })} />
        </Row>
      </div>
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Shape & behaviour</h3>
        <Row label="Card roundness" hint="1 = as built, 0 = square corners, 2 = twice as round.">
          <NumberInput value={theme.radius} min={0} max={3} step={0.1} onChange={(radius) => set({ radius })} />
        </Row>
        <Row label="Page scrollbar">
          <Select
            value={theme.scrollbar}
            onChange={(scrollbar) => set({ scrollbar })}
            options={[
              { value: "hidden", label: namespace === "landing" ? "Hidden (built-in)" : "Hidden" },
              { value: "thin", label: "Thin blue" },
              { value: "default", label: "Browser default" },
            ]}
          />
        </Row>
        <Row label="Animations">
          <Select value={theme.motion} onChange={(motion) => set({ motion })} options={[{ value: "full", label: "On" }, { value: "reduced", label: "Off" }]} />
        </Row>
        {namespace === "workspace" ? (
          <Row label="Starting theme for new visitors" hint="People can still switch with the moon/sun button; their choice is remembered.">
            <Select value={theme.deckDefault} onChange={(deckDefault) => set({ deckDefault })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          </Row>
        ) : null}
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Custom CSS</h3>
        <textarea
          className="field min-h-[160px] resize-y font-mono text-xs"
          placeholder={`.cms-${namespace} h2 { letter-spacing: -0.02em; }`}
          value={theme.css ?? ""}
          onChange={(e) => set({ css: e.target.value || undefined })}
        />
        <p className="text-[11px] text-slate-500">For anything the fields above don&apos;t cover. Scope rules with .cms-{namespace}.</p>
      </div>
    </div>
  );
}

function PagePanel({ meta, onChange }: { meta: NonNullable<SiteContent["meta"]>; onChange: (m: SiteContent["meta"]) => void }) {
  const set = (patch: Partial<NonNullable<SiteContent["meta"]>>) => onChange(cleanObject({ ...meta, ...patch }));
  return (
    <div className="space-y-3">
      <Row label="Browser tab title">
        <input className="field" value={meta.title ?? ""} placeholder="Built-in title" onChange={(e) => set({ title: e.target.value || undefined })} />
      </Row>
      <Row label="Search / share description">
        <textarea className="field min-h-[90px] resize-y" value={meta.description ?? ""} placeholder="Built-in description" onChange={(e) => set({ description: e.target.value || undefined })} />
      </Row>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Row label="Tab icon (favicon)">
            <input className="field font-mono text-xs" value={meta.favicon ?? ""} placeholder="Built-in icon" onChange={(e) => set({ favicon: e.target.value || undefined })} />
          </Row>
        </div>
        <UploadButton accept="image/png,image/x-icon,image/svg+xml,image/webp" onUploaded={(favicon) => set({ favicon })} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// the editor
// --------------------------------------------------------------------------

type Panel = "content" | "theme" | "page";

export function ContentEditor({ namespace, pages }: { namespace: Namespace; pages: { path: string; label: string }[] }) {
  const [record, setRecord] = useState<ContentRecord | null>(null);
  const [draft, setDraft] = useState<SiteContent>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);

  const [fields, setFields] = useState<Map<string, FieldInfo>>(new Map());
  const [panel, setPanel] = useState<Panel>("content");
  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const [page, setPage] = useState(pages[0]?.path ?? "/");
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [pick, setPick] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const frameBox = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(900);

  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const dirty = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // --- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    contentAdmin
      .read(namespace)
      .then((r) => {
        if (cancelled) return;
        setRecord(r);
        setDraft(r.draft ?? {});
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load the content."));
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  // --- preview frame ---------------------------------------------------------
  const send = useCallback((message: PreviewMessage) => {
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "cms:ready") {
        send({ type: "cms:content", content: draftRef.current });
        send({ type: "cms:pick", on: pick });
      } else if (data.type === "cms:fields") {
        setFields((prev) => {
          const next = new Map(prev);
          for (const f of data.fields) next.set(f.key, f);
          return next;
        });
      } else if (data.type === "cms:picked") {
        setPanel("content");
        setSearch("");
        setSelected(data.key);
        setOpenSections((prev) => new Set(prev).add(groupOf(fieldsRef.current.get(data.key), data.key)));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, pick]);

  useEffect(() => {
    const id = setTimeout(() => send({ type: "cms:content", content: draft }), 60);
    return () => clearTimeout(id);
  }, [draft, send]);

  useEffect(() => send({ type: "cms:pick", on: pick }), [pick, send]);

  useEffect(() => {
    const box = frameBox.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setBoxWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // --- autosave ---------------------------------------------------------------
  useEffect(() => {
    if (!dirty.current) return;
    setStatus("saving");
    const id = setTimeout(async () => {
      try {
        const saved = await contentAdmin.saveDraft(namespace, prune(draftRef.current));
        setRecord(saved);
        dirty.current = false;
        setStatus("saved");
      } catch (err) {
        setStatus("error");
        setStatusText(err instanceof Error ? err.message : "Could not save the draft.");
      }
    }, 900);
    return () => clearTimeout(id);
  }, [draft, namespace]);

  const update = useCallback((fn: (d: SiteContent) => void) => {
    setDraft((prev) => {
      const next = clone(prev);
      fn(next);
      dirty.current = true;
      return next;
    });
  }, []);

  const publish = async () => {
    setBusy("publish");
    try {
      await contentAdmin.saveDraft(namespace, prune(draftRef.current));
      dirty.current = false;
      const r = await contentAdmin.publish(namespace);
      setRecord(r);
      setStatus("saved");
      setStatusText("");
    } catch (err) {
      setStatus("error");
      setStatusText(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!window.confirm("Throw away every change since the last publish?")) return;
    setBusy("discard");
    try {
      const r = await contentAdmin.discard(namespace);
      setRecord(r);
      dirty.current = false;
      setDraft(r.draft ?? {});
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setStatusText(err instanceof Error ? err.message : "Could not discard the draft.");
    } finally {
      setBusy(null);
    }
  };

  const resetAll = () => {
    if (!window.confirm("Reset every text, picture, colour and setting on this page to the built-in version? You can still discard this before publishing.")) return;
    update((d) => {
      for (const k of Object.keys(d)) delete (d as Record<string, unknown>)[k];
    });
  };

  // --- field list -------------------------------------------------------------
  const unpublished = useMemo(
    () => JSON.stringify(prune(draft)) !== JSON.stringify(prune(record?.published ?? {})),
    [draft, record],
  );

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = new Map<string, { label: string; fields: FieldInfo[] }>();
    for (const field of fields.values()) {
      if (field.type === "section" && field.key === sectionOf(field.key)) {
        const g = out.get(field.key) ?? { label: field.label || humanize(field.key), fields: [] };
        g.label = field.label || g.label;
        out.set(field.key, g);
      }
    }
    for (const field of fields.values()) {
      const section = groupOf(field, field.key);
      const value = draft.text?.[field.key] ?? (typeof field.fallback === "string" ? field.fallback : "");
      if (term && !`${field.key} ${fieldLabel(field)} ${value}`.toLowerCase().includes(term)) continue;
      if (onlyChanged) {
        const k = field.key;
        const changed = [draft.text, draft.style, draft.media, draft.link, draft.icon, draft.list, draft.section, draft.hide].some((m) => m && k in m);
        if (!changed) continue;
      }
      const g = out.get(section) ?? { label: field.group ?? humanize(section), fields: [] };
      g.fields.push(field);
      out.set(section, g);
    }
    return Array.from(out.entries()).filter(([, g]) => g.fields.length);
  }, [fields, search, onlyChanged, draft]);

  const deviceWidth = DEVICES.find((d) => d.id === device)?.width ?? 1440;
  const scale = Math.min(1, boxWidth / deviceWidth);
  const src = `${page}${page.includes("?") ? "&" : "?"}${PREVIEW_PARAM}=1`;

  if (loadError) {
    return <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{loadError}</p>;
  }
  if (!record) {
    return (
      <div className="grid place-items-center py-24 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        <span className="flex items-center gap-1.5 px-2 text-xs text-slate-400">
          {status === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving draft…
            </>
          ) : status === "error" ? (
            <span className="text-red-300">{statusText}</span>
          ) : unpublished ? (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Draft saved · not live yet
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Live version is up to date
            </>
          )}
        </span>
        <span className="hidden text-[11px] text-slate-600 sm:inline">
          {record.published_at ? `Last published ${new Date(record.published_at).toLocaleString()}` : "Never published: visitors see the built-in page"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost !px-3 !py-2 text-xs" onClick={resetAll} title="Reset everything to the built-in page">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset all
          </button>
          <button type="button" className="btn-ghost !px-3 !py-2 text-xs" onClick={discard} disabled={!unpublished || busy !== null}>
            {busy === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
            Discard draft
          </button>
          <button type="button" className="btn-primary !px-4 !py-2 text-xs" onClick={publish} disabled={busy !== null || (!unpublished && status !== "saving")}>
            {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Rocket className="h-3.5 w-3.5" aria-hidden />}
            Publish
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* left: controls */}
        <aside className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] xl:sticky xl:top-20 xl:h-[calc(100vh-7rem)]">
          <div className="flex gap-1 border-b border-white/10 p-1.5">
            {(
              [
                { id: "content", label: "Content", icon: Type },
                { id: "theme", label: "Colours & fonts", icon: Palette },
                { id: "page", label: "Tab & SEO", icon: Monitor },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPanel(t.id)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                  panel === t.id ? "bg-meta-500 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                )}
              >
                <t.icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {panel === "content" ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
                  <input className="field !pl-8" placeholder="Search text, pictures, buttons…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Toggle checked={onlyChanged} onChange={setOnlyChanged} label="Only show what I changed" />
                  <span className="text-[11px] text-slate-500">{fields.size} items</span>
                </div>
                {fields.size === 0 ? (
                  <p className="flex items-center gap-2 py-8 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the page…
                  </p>
                ) : null}
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Tip: turn on <b className="text-slate-300">Click to edit</b> above the preview and click anything on the page to jump to it.
                  {namespace === "workspace" ? " Open other pages and steps in the preview to list their texts too." : ""}
                </p>
                {groups.map(([section, group]) => {
                  const open = openSections.has(section) || !!search || onlyChanged;
                  return (
                    <div key={section} className="rounded-xl border border-white/10">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                        onClick={() =>
                          setOpenSections((prev) => {
                            const next = new Set(prev);
                            if (next.has(section)) next.delete(section);
                            else next.add(section);
                            return next;
                          })
                        }
                      >
                        <span className="text-sm font-semibold text-slate-100">{group.label}</span>
                        <span className="flex items-center gap-2 text-[11px] text-slate-500">
                          {group.fields.length}
                          <ChevronDown className={clsx("h-4 w-4 transition-transform", open ? "" : "-rotate-90")} aria-hidden />
                        </span>
                      </button>
                      {open ? (
                        <div className="space-y-1.5 border-t border-white/10 p-2">
                          {group.fields.map((field) => (
                            <FieldCard
                              key={field.key}
                              field={field}
                              draft={draft}
                              update={update}
                              selected={selected === field.key}
                              onSelect={() => setSelected(field.key)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : panel === "theme" ? (
              <ThemePanel namespace={namespace} theme={draft.theme ?? {}} onChange={(theme) => update((d) => { d.theme = theme; })} />
            ) : (
              <PagePanel meta={draft.meta ?? {}} onChange={(meta) => update((d) => { d.meta = meta; })} />
            )}
          </div>
        </aside>

        {/* right: live preview */}
        <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.02] p-2">
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
            {pages.length > 1 ? (
              <select className="field !w-auto !py-1.5 text-xs" value={page} onChange={(e) => setPage(e.target.value)}>
                {pages.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="px-2 text-xs font-semibold text-slate-300">Live preview · draft</span>
            )}
            <div className="flex rounded-lg border border-white/10 p-0.5">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={`${d.label} (${d.width}px)`}
                  onClick={() => setDevice(d.id)}
                  className={clsx("rounded-md p-1.5 transition-colors", device === d.id ? "bg-meta-500 text-white" : "text-slate-400 hover:text-slate-100")}
                >
                  <d.icon className="h-3.5 w-3.5" aria-hidden />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPick(!pick)}
              className={clsx("btn-ghost !px-3 !py-1.5 text-xs", pick && "!border-meta-500 !bg-meta-500/20 !text-meta-200")}
            >
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              Click to edit {pick ? "on" : "off"}
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => setFrameKey((k) => k + 1)} title="Reload the preview">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="ml-auto text-[11px] text-slate-500">
              {deviceWidth}px{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
            </span>
          </div>
          <div ref={frameBox} className="overflow-hidden rounded-xl bg-black/40">
            <div style={{ height: `calc((100vh - 13rem))`, minHeight: 520 }} className="relative">
              <iframe
                key={`${page}-${frameKey}`}
                ref={frame}
                src={src}
                title="Page preview"
                className="absolute left-1/2 top-0 origin-top border-0 bg-white"
                style={{
                  width: deviceWidth,
                  height: `calc((100vh - 13rem) / ${scale})`,
                  minHeight: 520 / scale,
                  transform: `translateX(-50%) scale(${scale})`,
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default ContentEditor;
