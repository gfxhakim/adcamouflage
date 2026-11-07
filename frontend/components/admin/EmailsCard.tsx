"use client";

import { ImageUp, Loader2, Mail, Palette, RotateCcw, Save, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  getEmailSettings,
  previewEmail,
  saveEmailSettings,
  sendTestEmail,
  type EmailKind,
  type EmailSettings,
  type EmailStyle,
  type EmailTemplate,
  type EmailTemplateInput,
} from "@/lib/admin";
import { contentAdmin } from "@/lib/siteContent";

const ORDER: EmailKind[] = ["welcome", "activated", "ending", "ended"];
const DESIGN_TAB = "design" as const;
type Tab = EmailKind | typeof DESIGN_TAB;

const COLOURS: { key: keyof EmailStyle; label: string }[] = [
  { key: "header_color", label: "Header" },
  { key: "header_text_color", label: "Header text" },
  { key: "page_color", label: "Background" },
  { key: "card_color", label: "Card" },
  { key: "text_color", label: "Message text" },
  { key: "button_color", label: "Button" },
  { key: "button_text_color", label: "Button text" },
];

type Note = { ok: boolean; text: string } | null;

const input = (t: EmailTemplate): EmailTemplateInput => ({
  enabled: t.enabled,
  subject: t.subject,
  body: t.body,
  days_before: t.days_before,
  kicker: t.kicker,
  stat: t.stat,
  stat_sub: t.stat_sub,
  headline: t.headline,
  button: t.button,
});

/** Admin > Settings: switch each customer email on or off and edit its text and look. */
export default function EmailsCard() {
  const [data, setData] = useState<EmailSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<EmailKind, EmailTemplate> | null>(null);
  const [style, setStyle] = useState<EmailStyle | null>(null);
  const [tab, setTab] = useState<Tab>("welcome");
  const [shown, setShown] = useState<EmailKind>("welcome");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (next: EmailSettings) => {
    setData(next);
    setDrafts(structuredClone(next.templates));
    setStyle(structuredClone(next.style));
  };

  useEffect(() => {
    getEmailSettings()
      .then(load)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load the email settings."));
  }, []);

  useEffect(() => {
    if (tab !== DESIGN_TAB) setShown(tab);
  }, [tab]);

  // Live preview of the unsaved edits.
  const previewKey = drafts && style ? JSON.stringify([shown, drafts[shown], style]) : "";
  useEffect(() => {
    if (!drafts || !style) return;
    const timer = window.setTimeout(() => {
      previewEmail(shown, input(drafts[shown]), style)
        .then((p) => {
          setPreview(p);
          setPreviewError(null);
        })
        .catch((err) => setPreviewError(err instanceof Error ? err.message : "Preview failed."));
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  if (!data || !drafts || !style) {
    return (
      <NeonCard padding="lg" radius="xl">
        <div className="flex items-center gap-2 text-xs text-ink-faint dark:text-slate-500">
          {loadError ? <span className="text-red-600 dark:text-red-400">{loadError}</span> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        </div>
      </NeonCard>
    );
  }

  const ready = data.transport !== "";
  const dirty =
    JSON.stringify(drafts) !== JSON.stringify(data.templates) || JSON.stringify(style) !== JSON.stringify(data.style);

  const patch = (kind: EmailKind, change: Partial<EmailTemplate>) =>
    setDrafts((d) => (d ? { ...d, [kind]: { ...d[kind], ...change } } : d));
  const patchStyle = (change: Partial<EmailStyle>) => setStyle((s) => (s ? { ...s, ...change } : s));

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const payload = Object.fromEntries(ORDER.map((k) => [k, input(drafts[k])]));
      load(await saveEmailSettings(payload, style));
      setNote({ ok: true, text: "Saved." });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setNote(null);
    try {
      const { sent_to } = await sendTestEmail(shown);
      setNote({ ok: true, text: `Test of "${drafts[shown].label}" sent to ${sent_to}${dirty ? " (saved version, not your unsaved edits)" : ""}.` });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not send the test email." });
    } finally {
      setTesting(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setNote(null);
    try {
      const { url } = await contentAdmin.upload(file);
      patchStyle({ logo_url: url });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not upload the logo." });
    } finally {
      setUploading(false);
    }
  };

  const label = "block text-xs font-medium text-black/70 dark:text-slate-300";
  const hint = "mt-0.5 block text-[11px] font-normal text-ink-faint dark:text-slate-500";
  const draft = tab === DESIGN_TAB ? null : drafts[tab];

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <Mail className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Customer emails</h2>
        <span
          className={
            ready
              ? "ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "ml-auto rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-ink-faint dark:bg-white/10 dark:text-slate-400"
          }
        >
          {ready ? `On: ${data.transport === "smtp" ? "SMTP" : data.transport === "brevo" ? "Brevo" : "Resend"}` : "Off"}
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-500">
        {ready
          ? `Sent from ${data.from}.${data.public_url_set ? "" : " Set ADCAM_PUBLIC_URL on the api service so the links and logo in emails point at your site."}`
          : "Not set up yet. Add the SMTP variables on the api service (see docs/EMAIL.md). You can edit the emails now; they start going out once the server can send."}
      </p>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {[...ORDER, DESIGN_TAB].map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "inline-flex items-center gap-1 rounded-full bg-meta-500 px-3 py-1 text-xs font-semibold text-white"
                : "inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/70 hover:border-black/25 dark:border-white/15 dark:text-slate-300"
            }
          >
            {t === DESIGN_TAB ? (
              <>
                <Palette className="h-3.5 w-3.5" aria-hidden /> Logo &amp; colours
              </>
            ) : (
              <>
                {drafts[t].label}
                {!drafts[t].enabled ? <span className="opacity-70">(off)</span> : null}
              </>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {draft && tab !== DESIGN_TAB ? (
            <>
              <p className="text-xs text-ink-faint dark:text-slate-500">{draft.when}</p>
              <label className="flex items-center gap-2 text-sm text-black dark:text-slate-100">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-meta-500"
                  checked={draft.enabled}
                  onChange={(e) => patch(tab, { enabled: e.target.checked })}
                />
                Send this email
              </label>
              {draft.days_before !== undefined ? (
                <label className={label}>
                  Days before the plan ends
                  <input
                    type="number"
                    min={1}
                    max={14}
                    className="field mt-1 !w-24"
                    value={draft.days_before}
                    onChange={(e) => patch(tab, { days_before: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })}
                  />
                </label>
              ) : null}
              <label className={label}>
                Subject
                <input className="field mt-1" maxLength={200} value={draft.subject} onChange={(e) => patch(tab, { subject: e.target.value })} />
              </label>

              <fieldset className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-slate-500">Blue header</legend>
                <label className={label}>
                  Small top line
                  <input className="field mt-1" maxLength={200} value={draft.kicker} onChange={(e) => patch(tab, { kicker: e.target.value })} />
                </label>
                <label className={label}>
                  Big text
                  <input className="field mt-1" maxLength={200} value={draft.stat} onChange={(e) => patch(tab, { stat: e.target.value })} />
                </label>
                <label className={label}>
                  Line under the big text
                  <input className="field mt-1" maxLength={200} value={draft.stat_sub} onChange={(e) => patch(tab, { stat_sub: e.target.value })} />
                </label>
                <span className={hint}>Leave any of these empty to hide it.</span>
              </fieldset>

              <label className={label}>
                Headline
                <input
                  className="field mt-1"
                  maxLength={200}
                  placeholder="Empty = same as the subject"
                  value={draft.headline}
                  onChange={(e) => patch(tab, { headline: e.target.value })}
                />
              </label>
              <label className={label}>
                Message
                <textarea
                  className="field mt-1 min-h-[180px] font-mono !text-xs leading-relaxed"
                  maxLength={5000}
                  value={draft.body}
                  onChange={(e) => patch(tab, { body: e.target.value })}
                />
              </label>
              <label className={label}>
                Button text
                <input className="field mt-1" maxLength={200} value={draft.button} onChange={(e) => patch(tab, { button: e.target.value })} />
                <span className={hint}>
                  The first line in the message that is only a link becomes this button. Empty = no button, the link stays as text.
                </span>
              </label>
              <p className="text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
                You can use these anywhere above:{" "}
                {Object.entries(data.placeholders).map(([key, help], i) => (
                  <span key={key} title={help}>
                    {i ? ", " : ""}
                    <code className="rounded bg-black/5 px-1 dark:bg-white/10">{`{${key}}`}</code>
                  </span>
                ))}
                . A blank line in the message starts a new paragraph.
              </p>
              <button
                type="button"
                className="btn-ghost !text-xs"
                onClick={() => {
                  const d = data.defaults[tab];
                  patch(tab, {
                    subject: d.subject,
                    body: d.body,
                    kicker: d.kicker,
                    stat: d.stat,
                    stat_sub: d.stat_sub,
                    headline: d.headline,
                    button: d.button,
                  });
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Default text for this email
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-faint dark:text-slate-500">The logo, colours and footer used by every customer email.</p>
              <div className="flex items-center gap-3">
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl" style={{ background: style.header_color }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={style.logo_url || "/brand/blucloacking-mark-email.png"} alt="" className="max-h-16 max-w-16" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="btn-ghost !text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImageUp className="h-3.5 w-3.5" aria-hidden />}
                    Upload logo
                  </button>
                  <button type="button" className="btn-ghost !text-xs" onClick={() => patchStyle({ logo_url: "" })}>
                    Use the BluCloacking shield
                  </button>
                </div>
              </div>
              <label className={label}>
                Or logo link (https://…)
                <input
                  className="field mt-1"
                  maxLength={1000}
                  placeholder="Empty = the BluCloacking shield with white glow"
                  value={style.logo_url}
                  onChange={(e) => patchStyle({ logo_url: e.target.value })}
                />
                <span className={hint}>PNG or JPG works best. Many email apps do not show SVG or WebP.</span>
              </label>
              <label className={label}>
                Logo size: {style.logo_size}px
                <input
                  type="range"
                  min={24}
                  max={160}
                  className="mt-1 w-full accent-meta-500"
                  value={style.logo_size}
                  onChange={(e) => patchStyle({ logo_size: Number(e.target.value) })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {COLOURS.map(({ key, label: name }) => (
                  <label key={key} className={label}>
                    {name}
                    <span className="mt-1 flex items-center gap-1.5">
                      <input
                        type="color"
                        className="h-8 w-9 shrink-0 cursor-pointer rounded border border-black/10 bg-transparent dark:border-white/15"
                        value={String(style[key]).length === 7 ? String(style[key]) : "#000000"}
                        onChange={(e) => patchStyle({ [key]: e.target.value } as Partial<EmailStyle>)}
                      />
                      <input
                        className="field !px-2 font-mono !text-xs"
                        maxLength={7}
                        value={String(style[key])}
                        onChange={(e) => patchStyle({ [key]: e.target.value } as Partial<EmailStyle>)}
                      />
                    </span>
                  </label>
                ))}
              </div>
              <label className={label}>
                Footer text
                <textarea
                  className="field mt-1 min-h-[60px] !text-xs"
                  maxLength={500}
                  value={style.footer_text}
                  onChange={(e) => patchStyle({ footer_text: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-black dark:text-slate-100">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-meta-500"
                  checked={style.show_footer_logo}
                  onChange={(e) => patchStyle({ show_footer_logo: e.target.checked })}
                />
                Show the BluCloacking name under the email
              </label>
              <button type="button" className="btn-ghost !text-xs" onClick={() => setStyle(structuredClone(data.style_defaults))}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Default look
              </button>
            </>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint dark:text-slate-500">
            <span>Preview:</span>
            {ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setShown(k)}
                className={shown === k ? "font-semibold text-meta-500" : "hover:text-black dark:hover:text-slate-200"}
              >
                {drafts[k].label}
              </button>
            ))}
          </div>
          {preview ? (
            <p className="mb-2 truncate text-xs text-black/70 dark:text-slate-300">
              <span className="text-ink-faint dark:text-slate-500">Subject:</span> {preview.subject}
            </p>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10">
            {preview ? (
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[640px] w-full" />
            ) : (
              <div className="grid h-[640px] place-items-center">
                <Loader2 className="h-4 w-4 animate-spin text-ink-faint" aria-hidden />
              </div>
            )}
          </div>
          {previewError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{previewError}</p> : null}
          <p className="mt-2 text-[11px] text-ink-faint dark:text-slate-500">Sample values (Pro plan, 4,500 tokens). Shows your unsaved edits.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !text-xs" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
          Save emails
        </button>
        <button type="button" className="btn-ghost !text-xs" disabled={!ready || testing} onClick={() => void test()}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Send test to me
        </button>
        {note ? (
          <p className={note.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-red-600 dark:text-red-400"}>{note.text}</p>
        ) : null}
      </div>
    </NeonCard>
  );
}
