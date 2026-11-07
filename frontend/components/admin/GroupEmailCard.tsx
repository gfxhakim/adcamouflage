"use client";

import { AlertTriangle, Eye, Loader2, RotateCcw, Save, Search, Send, Square, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  getGroupEmail,
  getGroupEmails,
  previewGroupEmail,
  retryGroupEmail,
  saveGroupEmailRules,
  sendGroupEmail,
  stopGroupEmail,
  testGroupEmail,
  type EmailPerson,
  type GroupEmailCampaign,
  type GroupEmailRecipient,
  type GroupEmailStatus,
} from "@/lib/admin";

type Note = { ok: boolean; text: string } | null;

const chip = (on: boolean) =>
  on
    ? "rounded-full bg-meta-500 px-3 py-1 text-xs font-semibold text-white"
    : "rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/70 hover:border-black/25 dark:border-white/15 dark:text-slate-300";

const label = "block text-xs font-medium text-black/70 dark:text-slate-300";
const faint = "text-[11px] leading-relaxed text-ink-faint dark:text-slate-500";

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

/** Admin > Settings > Customer emails: write one email and send it to a chosen group of customers. */
export default function GroupEmailCard() {
  const [data, setData] = useState<GroupEmailStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // who
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);

  // what
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [button, setButton] = useState("");
  const [preview, setPreview] = useState<{ html: string; for: string } | null>(null);

  // send
  const [confirming, setConfirming] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  // rules
  const [rules, setRules] = useState<{ daily_limit: number; seconds_between: number } | null>(null);

  // history
  const [openCampaign, setOpenCampaign] = useState<number | null>(null);
  const [recipients, setRecipients] = useState<GroupEmailRecipient[]>([]);

  const load = useCallback(async () => {
    try {
      const next = await getGroupEmails();
      setData(next);
      setRules((r) => r ?? next.rules);
      setLoadError(null);
    } catch (err) {
      setLoadError(message(err, "Could not load group emails."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh progress while something is still sending.
  const sending = data?.campaigns.some((c) => c.status === "sending") ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => {
      void load();
      if (openCampaign) void getGroupEmail(openCampaign).then((d) => setRecipients(d.recipients)).catch(() => undefined);
    }, 10000);
    return () => clearInterval(timer);
  }, [sending, load, openCampaign]);

  const isPicked = useCallback(
    (p: EmailPerson) =>
      !p.unsubscribed && (added.has(p.id) || (!removed.has(p.id) && p.groups.some((g) => groups.has(g)))),
    [added, removed, groups],
  );

  const picked = useMemo(() => (data ? data.people.filter(isPicked) : []), [data, isPicked]);

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.people.filter(
      (p) =>
        (!onlyPicked || isPicked(p)) &&
        (!q || p.email.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)),
    );
  }, [data, query, onlyPicked, isPicked]);

  if (!data) {
    return (
      <NeonCard padding="lg" radius="xl">
        <div className="flex items-center gap-2 text-xs text-ink-faint dark:text-slate-500">
          {loadError ? <span className="text-red-600 dark:text-red-400">{loadError}</span> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        </div>
      </NeonCard>
    );
  }

  const ready = data.transport !== "" && data.public_url_set;
  const groupLabel = (id: string) => data.groups.find((g) => g.id === id)?.label ?? id;

  const toggleGroup = (id: string) => {
    setGroups((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePerson = (p: EmailPerson) => {
    const on = isPicked(p);
    setAdded((s) => {
      const next = new Set(s);
      if (on) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
    setRemoved((s) => {
      const next = new Set(s);
      if (on) next.add(p.id);
      else next.delete(p.id);
      return next;
    });
  };

  const pickShown = (on: boolean) => {
    const ids = shown.filter((p) => !p.unsubscribed).map((p) => p.id);
    setAdded((s) => {
      const next = new Set(s);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
    setRemoved((s) => {
      const next = new Set(s);
      ids.forEach((id) => (on ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const clearAll = () => {
    setGroups(new Set());
    setAdded(new Set());
    setRemoved(new Set());
  };

  const audience = () => {
    const names = Array.from(groups).map(groupLabel);
    const extra = added.size ? [`+${added.size} picked`] : [];
    const less = removed.size ? [`-${removed.size} removed`] : [];
    return [...names, ...extra, ...less].join(", ") || "Picked one by one";
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote({ ok: false, text: message(err, "Something went wrong.") });
    } finally {
      setBusy(null);
    }
  };

  const hasMessage = subject.trim() !== "" && body.trim() !== "";
  const days = Math.max(1, Math.ceil(Math.max(0, picked.length - data.left_today) / data.rules.daily_limit) + 1);
  const spreadNote =
    picked.length <= data.left_today
      ? `All ${picked.length} can go out today, one every ${data.rules.seconds_between}s.`
      : `${data.left_today} go out today; the rest over about ${days - 1} more day${days - 1 === 1 ? "" : "s"} (limit ${data.rules.daily_limit}/day).`;

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <Users className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Send to a group</h2>
        <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-ink-faint dark:bg-white/10 dark:text-slate-400">
          {data.left_today} of {data.rules.daily_limit} left today
        </span>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-500">
        Write one email and send it to the customers you pick. It goes out one person at a time, with their own name,
        plan and tokens filled in, and an unsubscribe link at the bottom.
      </p>

      {!ready ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {data.transport === ""
            ? "Email is not set up on the server yet (see docs/EMAIL.md). You can pick people and write now; sending needs it."
            : "Set ADCAM_PUBLIC_URL on the api service so the unsubscribe link works. Sending stays off until then."}
        </p>
      ) : null}

      {/* 1. who */}
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-slate-400">1. Who gets it</h3>
      <div className="mb-2 flex flex-wrap gap-2">
        {data.groups.map((g) => (
          <button
            key={g.id}
            type="button"
            title={g.hint}
            disabled={g.id === "unsubscribed"}
            onClick={() => toggleGroup(g.id)}
            className={g.id === "unsubscribed" ? `${chip(false)} cursor-default opacity-60` : chip(groups.has(g.id))}
          >
            {g.label} <span className="opacity-70">{g.count}</span>
          </button>
        ))}
      </div>
      <p className={`${faint} mb-3`}>
        Tap groups to add everyone in them (hover a group to see who it means). Then tick or untick people below. People
        who unsubscribed are never sent to.
      </p>

      <div className="rounded-xl border border-black/10 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
          <span className="text-xs font-semibold text-black dark:text-slate-100">{picked.length} picked</span>
          <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-[240px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input className="field !py-1 !pl-7 !text-xs" placeholder="Search email or name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="flex items-center gap-1 text-xs text-black/70 dark:text-slate-300">
            <input type="checkbox" className="h-3.5 w-3.5 accent-meta-500" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} />
            Only picked
          </label>
          <button type="button" className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => pickShown(true)}>
            Select all shown
          </button>
          <button type="button" className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => pickShown(false)}>
            Unselect shown
          </button>
          <button type="button" className="btn-ghost !px-2 !py-1 !text-xs" onClick={clearAll}>
            Clear
          </button>
        </div>
        <ul className="max-h-72 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
          {shown.length === 0 ? <li className="px-3 py-4 text-xs text-ink-faint dark:text-slate-500">Nobody here.</li> : null}
          {shown.map((p) => {
            const on = isPicked(p);
            return (
              <li key={p.id}>
                <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-xs ${p.unsubscribed ? "cursor-default opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-meta-500"
                    checked={on}
                    disabled={p.unsubscribed}
                    onChange={() => togglePerson(p)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-black dark:text-slate-100">{p.email}</span>
                    <span className="block truncate text-ink-faint dark:text-slate-500">
                      {[p.name, p.plan ? `${p.plan} · ${p.tokens.toLocaleString()} tokens` : "no plan", p.unsubscribed ? "unsubscribed" : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 2. what */}
      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-slate-400">2. The email</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="self-center text-xs text-ink-faint dark:text-slate-500">Start from:</span>
        {data.drafts.map((d) => (
          <button
            key={d.id}
            type="button"
            className={chip(false)}
            title={`Good for: ${d.groups.map(groupLabel).join(", ")}`}
            onClick={() => {
              setSubject(d.subject);
              setBody(d.body);
              setButton(d.button);
              setPreview(null);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <label className={label}>
          Subject
          <input className="field mt-1" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className={label}>
          Message
          <textarea
            className="field mt-1 min-h-[180px] font-mono !text-xs leading-relaxed"
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className={label}>
          Button text
          <input
            className="field mt-1 sm:!w-72"
            maxLength={60}
            placeholder="e.g. Choose a plan"
            value={button}
            onChange={(e) => setButton(e.target.value)}
          />
          <span className={`${faint} mt-1 block font-normal`}>
            The first line of the message that is only a link (like {"{plan_url}"}) becomes a button with this text. Leave
            empty to keep it a plain link.
          </span>
        </label>
        <p className={faint}>
          You can use:{" "}
          {Object.entries(data.placeholders).map(([key, help], i) => (
            <span key={key} title={help}>
              {i ? ", " : ""}
              <code className="rounded bg-black/5 px-1 dark:bg-white/10">{`{${key}}`}</code>
            </span>
          ))}
          . Each person gets their own values. The subject is the big headline, and your logo, colours and the unsubscribe line are added for you.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost !text-xs"
          disabled={!hasMessage || busy !== null}
          onClick={() =>
            void run("preview", async () => {
              const r = await previewGroupEmail({ subject, body, button, user_id: picked[0]?.id });
              setPreview({ html: r.html, for: `${r.subject} (as ${r.for} sees it)` });
            })
          }
        >
          {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
          Preview
        </button>
        <button
          type="button"
          className="btn-ghost !text-xs"
          disabled={!hasMessage || data.transport === "" || busy !== null}
          onClick={() =>
            void run("test", async () => {
              const { sent_to } = await testGroupEmail({ subject, body, button });
              setNote({ ok: true, text: `Test sent to ${sent_to}.` });
            })
          }
        >
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Send test to me
        </button>
      </div>
      {preview ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
          <p className="border-b border-black/10 px-3 py-2 text-xs text-ink-faint dark:border-white/10 dark:text-slate-400">{preview.for}</p>
          <iframe title="Email preview" className="h-[640px] w-full bg-white" sandbox="" srcDoc={preview.html} />
        </div>
      ) : null}

      {/* 3. send */}
      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-slate-400">3. Send</h3>
      <p className={`${faint} mb-3`}>
        {picked.length ? spreadNote : "Pick at least one person."} Brevo&apos;s free plan allows about 300 emails a day in
        total, and the welcome, plan and reminder emails count too, so keep the daily limit a bit under that.
      </p>
      {!confirming ? (
        <button
          type="button"
          className="btn-primary !text-xs"
          disabled={!ready || !hasMessage || picked.length === 0 || busy !== null}
          onClick={() => {
            setConfirming(true);
            setConfirmWord("");
          }}
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Send to {picked.length} {picked.length === 1 ? "person" : "people"}
        </button>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="mb-2 text-xs text-amber-900 dark:text-amber-100">
            This emails <b>{picked.length}</b> {picked.length === 1 ? "person" : "people"} &ldquo;{subject}&rdquo;. It cannot be
            unsent, but you can stop the rest while it is going out. Type <b>SEND</b> to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="field !w-32 !text-xs"
              value={confirmWord}
              autoFocus
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder="SEND"
            />
            <button
              type="button"
              className="btn-primary !text-xs"
              disabled={confirmWord.trim() !== "SEND" || busy !== null}
              onClick={() =>
                void run("send", async () => {
                  const r = await sendGroupEmail({
                    subject,
                    body,
                    button,
                    user_ids: picked.map((p) => p.id),
                    audience: audience(),
                    confirm: confirmWord.trim(),
                  });
                  setConfirming(false);
                  setNote({
                    ok: true,
                    text: `Queued for ${r.campaign.total}.${r.left_out_unsubscribed ? ` ${r.left_out_unsubscribed} unsubscribed left out.` : ""} Progress is below.`,
                  });
                  await load();
                })
              }
            >
              {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
              Confirm and send
            </button>
            <button type="button" className="btn-ghost !text-xs" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {note ? (
        <p className={`mt-3 ${note.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-red-600 dark:text-red-400"}`}>{note.text}</p>
      ) : null}

      {/* pace */}
      {rules ? (
        <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-black/10 pt-4 dark:border-white/10">
          <label className={label}>
            Daily limit
            <input
              type="number"
              min={1}
              max={100000}
              className="field mt-1 !w-28"
              value={rules.daily_limit}
              onChange={(e) => setRules({ ...rules, daily_limit: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label className={label}>
            Seconds between emails
            <input
              type="number"
              min={0}
              max={60}
              className="field mt-1 !w-28"
              value={rules.seconds_between}
              onChange={(e) => setRules({ ...rules, seconds_between: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
            />
          </label>
          <button
            type="button"
            className="btn-ghost !text-xs"
            disabled={busy !== null || JSON.stringify(rules) === JSON.stringify(data.rules)}
            onClick={() =>
              void run("rules", async () => {
                const next = await saveGroupEmailRules(rules);
                setData(next);
                setRules(next.rules);
                setNote({ ok: true, text: "Sending pace saved." });
              })
            }
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            Save pace
          </button>
          <span className={faint}>{data.sent_today} group emails sent today (UTC).</span>
        </div>
      ) : null}

      {/* history */}
      {data.campaigns.length ? (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-slate-400">Sent group emails</h3>
          <ul className="space-y-2">
            {data.campaigns.map((c) => (
              <CampaignRow
                key={c.id}
                c={c}
                open={openCampaign === c.id}
                recipients={openCampaign === c.id ? recipients : []}
                busy={busy}
                onToggle={() => {
                  if (openCampaign === c.id) {
                    setOpenCampaign(null);
                    return;
                  }
                  setOpenCampaign(c.id);
                  setRecipients([]);
                  void getGroupEmail(c.id).then((d) => setRecipients(d.recipients)).catch(() => undefined);
                }}
                onStop={() =>
                  void run(`stop-${c.id}`, async () => {
                    await stopGroupEmail(c.id);
                    await load();
                  })
                }
                onRetry={() =>
                  void run(`retry-${c.id}`, async () => {
                    await retryGroupEmail(c.id);
                    await load();
                  })
                }
              />
            ))}
          </ul>
        </div>
      ) : null}
    </NeonCard>
  );
}

const STATUS_STYLE: Record<string, string> = {
  sending: "bg-meta-500/10 text-meta-600 dark:text-meta-300",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  cancelled: "bg-black/5 text-ink-faint dark:bg-white/10 dark:text-slate-400",
};

function CampaignRow({
  c,
  open,
  recipients,
  busy,
  onToggle,
  onStop,
  onRetry,
}: {
  c: GroupEmailCampaign;
  open: boolean;
  recipients: GroupEmailRecipient[];
  busy: string | null;
  onToggle: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const done = c.sent + c.failed + c.skipped;
  const pct = c.total ? Math.round((done / c.total) * 100) : 100;
  return (
    <li className="rounded-xl border border-black/10 p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[c.status] ?? STATUS_STYLE.cancelled}`}>
          {c.status === "sending" ? "Sending" : c.status === "done" ? "Done" : "Stopped"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-black dark:text-slate-100">{c.subject}</span>
        <span className="text-[11px] text-ink-faint dark:text-slate-500">
          {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-ink-faint dark:text-slate-500">To: {c.audience}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className="h-full bg-meta-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-black/70 dark:text-slate-300">
        <span>{c.sent} sent</span>
        {c.pending ? <span>{c.pending} waiting</span> : null}
        {c.failed ? <span className="text-red-600 dark:text-red-400">{c.failed} failed</span> : null}
        {c.skipped ? <span>{c.skipped} skipped</span> : null}
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={onToggle}>
            {open ? "Hide list" : "Who got it"}
          </button>
          {c.failed ? (
            <button type="button" className="btn-ghost !px-2 !py-1 !text-[11px]" disabled={busy !== null} onClick={onRetry}>
              <RotateCcw className="h-3 w-3" aria-hidden />
              Retry failed
            </button>
          ) : null}
          {c.status === "sending" ? (
            <button type="button" className="btn-ghost !px-2 !py-1 !text-[11px]" disabled={busy !== null} onClick={onStop}>
              <Square className="h-3 w-3" aria-hidden />
              Stop
            </button>
          ) : null}
        </span>
      </div>
      {open ? (
        <ul className="mt-2 max-h-56 divide-y divide-black/5 overflow-y-auto text-[11px] dark:divide-white/5">
          {recipients.length === 0 ? <li className="py-2 text-ink-faint">Loading…</li> : null}
          {recipients.map((r) => (
            <li key={r.email} className="flex flex-wrap gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-black dark:text-slate-100">{r.email}</span>
              <span className={r.status === "failed" ? "text-red-600 dark:text-red-400" : "text-ink-faint dark:text-slate-400"}>
                {r.status}
                {r.error ? ` (${r.error})` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
