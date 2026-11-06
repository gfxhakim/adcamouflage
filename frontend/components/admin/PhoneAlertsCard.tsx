"use client";

import { BellRing, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { getNotifyStatus, sendTestAlert, type NotifyStatus } from "@/lib/admin";

const EVENT_LABELS: Record<string, string> = {
  plan_click: "Plan clicks on the landing page",
  checkout: "Checkout started (Subscribe / Renew / Top up)",
  paid: "Payment confirmed",
  review: "Payment that needs a look",
};

/** Shows whether phone alerts are set up on the server and sends a test one. */
export default function PhoneAlertsCard() {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getNotifyStatus()
      .then(setStatus)
      .catch(() => setStatus({ channels: [], events: [] }));
  }, []);

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { results } = await sendTestAlert();
      const failed = Object.entries(results).filter(([, r]) => r !== "ok");
      setMessage(
        failed.length
          ? { ok: false, text: failed.map(([c, r]) => `${c}: ${r}`).join(" · ") }
          : { ok: true, text: "Sent. Check your phone." },
      );
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not send the test alert." });
    } finally {
      setBusy(false);
    }
  };

  const on = (status?.channels.length ?? 0) > 0;

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <BellRing className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Phone alerts</h2>
        {status ? (
          <span
            className={
              on
                ? "ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "ml-auto rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-ink-faint dark:bg-white/10 dark:text-slate-400"
            }
          >
            {on ? `On: ${status.channels.join(" + ")}` : "Off"}
          </span>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-ink-faint dark:text-slate-500">
        {on
          ? "Your phone gets an instant message for:"
          : "Not set up yet. Add the Telegram or ntfy variables on the api service (see docs/PHONE_ALERTS.md), then come back and send a test."}
      </p>
      {on ? (
        <ul className="mb-4 space-y-1 text-xs text-black/75 dark:text-slate-300">
          {status!.events.map((e) => (
            <li key={e}>• {EVENT_LABELS[e] ?? e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !text-xs" disabled={!on || busy} onClick={() => void test()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Send test alert
        </button>
        {message ? (
          <p className={message.ok ? "text-xs text-emerald-700 dark:text-emerald-300" : "text-xs text-red-600 dark:text-red-400"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </NeonCard>
  );
}
