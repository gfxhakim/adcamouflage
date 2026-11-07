"use client";

import { Loader2, Mail, RotateCcw, Save, Send } from "lucide-react";
import { useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  getEmailSettings,
  saveEmailSettings,
  sendTestEmail,
  type EmailKind,
  type EmailSettings,
  type EmailTemplate,
} from "@/lib/admin";

const ORDER: EmailKind[] = ["welcome", "activated", "ending", "ended"];

type Note = { ok: boolean; text: string } | null;

/** Admin > Settings: switch each customer email on or off and edit its text. */
export default function EmailsCard() {
  const [data, setData] = useState<EmailSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<EmailKind, EmailTemplate> | null>(null);
  const [open, setOpen] = useState<EmailKind>("welcome");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = (next: EmailSettings) => {
    setData(next);
    setDrafts(structuredClone(next.templates));
  };

  useEffect(() => {
    getEmailSettings()
      .then(load)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load the email settings."));
  }, []);

  if (!data || !drafts) {
    return (
      <NeonCard padding="lg" radius="xl">
        <div className="flex items-center gap-2 text-xs text-ink-faint dark:text-slate-500">
          {loadError ? <span className="text-red-600 dark:text-red-400">{loadError}</span> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        </div>
      </NeonCard>
    );
  }

  const ready = data.transport !== "";
  const draft = drafts[open];
  const dirty = JSON.stringify(drafts) !== JSON.stringify(data.templates);

  const patch = (kind: EmailKind, change: Partial<EmailTemplate>) =>
    setDrafts((d) => (d ? { ...d, [kind]: { ...d[kind], ...change } } : d));

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const payload = Object.fromEntries(
        ORDER.map((k) => [
          k,
          { enabled: drafts[k].enabled, subject: drafts[k].subject, body: drafts[k].body, days_before: drafts[k].days_before },
        ]),
      );
      load(await saveEmailSettings(payload));
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
      const { sent_to } = await sendTestEmail(open);
      setNote({ ok: true, text: `Test sent to ${sent_to}${dirty ? " (saved text, not your unsaved edits)" : ""}.` });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not send the test email." });
    } finally {
      setTesting(false);
    }
  };

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
          {ready ? `On: ${data.transport === "smtp" ? "SMTP" : data.transport === "brevo" ? "Brevo API" : "Resend"}` : "Off"}
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-500">
        {ready
          ? `Sent from ${data.from}.${data.public_url_set ? "" : " Set ADCAM_PUBLIC_URL on the api service so the links in emails point at your site."}`
          : "Not set up yet. Add the SMTP variables on the api service (see docs/EMAIL.md). You can edit the emails now; they start going out once the server can send."}
      </p>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={open === kind}
            onClick={() => setOpen(kind)}
            className={
              open === kind
                ? "rounded-full bg-meta-500 px-3 py-1 text-xs font-semibold text-white"
                : "rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/70 hover:border-black/25 dark:border-white/15 dark:text-slate-300"
            }
          >
            {drafts[kind].label}
            {!drafts[kind].enabled ? <span className="ml-1 opacity-70">(off)</span> : null}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-xs text-ink-faint dark:text-slate-500">{draft.when}</p>
        <label className="flex items-center gap-2 text-sm text-black dark:text-slate-100">
          <input
            type="checkbox"
            className="h-4 w-4 accent-meta-500"
            checked={draft.enabled}
            onChange={(e) => patch(open, { enabled: e.target.checked })}
          />
          Send this email
        </label>
        {draft.days_before !== undefined ? (
          <label className="block text-xs font-medium text-black/70 dark:text-slate-300">
            Days before the plan ends
            <input
              type="number"
              min={1}
              max={14}
              className="field mt-1 !w-24"
              value={draft.days_before}
              onChange={(e) => patch(open, { days_before: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })}
            />
          </label>
        ) : null}
        <label className="block text-xs font-medium text-black/70 dark:text-slate-300">
          Subject
          <input
            className="field mt-1"
            maxLength={200}
            value={draft.subject}
            onChange={(e) => patch(open, { subject: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-black/70 dark:text-slate-300">
          Message
          <textarea
            className="field mt-1 min-h-[180px] font-mono !text-xs leading-relaxed"
            maxLength={5000}
            value={draft.body}
            onChange={(e) => patch(open, { body: e.target.value })}
          />
        </label>
        <p className="text-[11px] leading-relaxed text-ink-faint dark:text-slate-500">
          You can use:{" "}
          {Object.entries(data.placeholders).map(([key, help], i) => (
            <span key={key} title={help}>
              {i ? ", " : ""}
              <code className="rounded bg-black/5 px-1 dark:bg-white/10">{`{${key}}`}</code>
            </span>
          ))}
          . Links are made clickable. A blank line starts a new paragraph.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !text-xs" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
          Save emails
        </button>
        <button
          type="button"
          className="btn-ghost !text-xs"
          onClick={() => patch(open, { subject: data.defaults[open].subject, body: data.defaults[open].body })}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Default text
        </button>
        <button type="button" className="btn-ghost !text-xs" disabled={!ready || testing} onClick={() => void test()}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Send test to me
        </button>
        {note ? (
          <p className={note.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-red-600 dark:text-red-400"}>
            {note.text}
          </p>
        ) : null}
      </div>
    </NeonCard>
  );
}
