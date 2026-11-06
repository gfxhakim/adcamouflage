"use client";

import { BellRing, Link2, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { connectTelegramButtons, getNotifyStatus, sendTestAlert, type NotifyStatus } from "@/lib/admin";

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
  const [connecting, setConnecting] = useState(false);
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

  const connect = async () => {
    setConnecting(true);
    setMessage(null);
    try {
      const result = await connectTelegramButtons();
      setStatus((s) => (s ? { ...s, ...result } : s));
      setMessage(
        result.telegram_buttons === "connected"
          ? { ok: true, text: "Buttons connected. Approve and Reject now work from Telegram." }
          : { ok: false, text: result.telegram_buttons_detail || "Telegram did not confirm. Try again." },
      );
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not connect the buttons." });
    } finally {
      setConnecting(false);
    }
  };

  const on = (status?.channels.length ?? 0) > 0;
  const buttons = status?.telegram_buttons ?? "off";

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
      {buttons !== "off" ? (
        <div className="mb-4 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
          <p className="font-semibold text-black dark:text-slate-100">
            Approve from Telegram:{" "}
            <span className={buttons === "connected" ? "text-emerald-700 dark:text-emerald-300" : "text-ink-faint dark:text-slate-400"}>
              {buttons === "connected" ? "connected" : buttons === "unknown" ? "could not check" : "not connected"}
            </span>
          </p>
          <p className="mt-1 text-ink-faint dark:text-slate-500">
            Checkout and payment-needs-a-look alerts get Approve and Reject buttons. Approve asks once more, then turns
            the plan on exactly like a confirmed payment.
            {status?.telegram_buttons_detail ? ` ${status.telegram_buttons_detail}` : ""}
          </p>
          {buttons !== "connected" ? (
            <button
              type="button"
              className="btn-primary mt-2 !text-xs"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
              Connect buttons
            </button>
          ) : null}
        </div>
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
