"use client";

import clsx from "clsx";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import { getPaymentNotices, type AutoPayments, type PaymentNotice } from "@/lib/admin";

const OUTCOMES: Record<PaymentNotice["outcome"], { label: string; tone: "good" | "wait" | "bad" }> = {
  activated: { label: "Plan activated", tone: "good" },
  already_paid: { label: "Already paid", tone: "wait" },
  waiting: { label: "Payment in progress", tone: "wait" },
  canceled: { label: "Canceled", tone: "wait" },
  set_aside: { label: "Needs your approval", tone: "bad" },
  unknown_order: { label: "Unknown order", tone: "bad" },
  bad_sender: { label: "Refused: unknown address", tone: "bad" },
  bad_hash: { label: "Refused: wrong password", tone: "bad" },
};

const TONES = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  wait: "bg-black/[0.05] text-ink-muted dark:bg-white/10 dark:text-slate-300",
  bad: "bg-red-500/10 text-red-700 dark:text-red-300",
};

interface Props {
  refreshKey: number;
  onSelectUser: (id: number) => void;
}

/** Admin > Sales: whether Volet activates plans by itself, and the last messages it sent. */
export function AutoPaymentsCard({ refreshKey, onSelectUser }: Props) {
  const [data, setData] = useState<AutoPayments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getPaymentNotices(30)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Volet messages."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, refreshKey]);

  const ready = data?.volet_ready && data.status_url;

  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Automatic activation (Volet)</h3>
          <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">
            When a customer pays through the Volet checkout, Volet tells the app and the plan turns on by itself. Every
            message Volet sent is listed here, newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-[11px] font-semibold text-ink-muted hover:bg-meta-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-meta-500/10"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</p>
      ) : null}

      {data ? (
        <>
          <div
            className={clsx(
              "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
              ready ? TONES.good : TONES.bad,
            )}
          >
            {ready ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">
              {ready ? (
                <>
                  On. In Volet, the Hosted Checkout&apos;s Status URL must be{" "}
                  <span className="font-mono font-semibold">{data.status_url}</span> (method POST). Volet&apos;s fee is
                  accepted up to {data.fee_allowance_pct}% below the price.
                  {data.sender_check ? "" : " Sender check is off."}
                </>
              ) : !data.volet_ready ? (
                "Off: the Volet variables are not set on Railway (api service)."
              ) : (
                "Off: ADCAM_PUBLIC_URL is not set on Railway (api service)."
              )}
            </span>
          </div>

          {data.notices.length === 0 ? (
            <p className="mt-3 py-3 text-xs text-ink-faint dark:text-slate-500">
              No message from Volet yet. After the next payment, one should appear here within a minute. If a customer paid
              and nothing shows up, the Status URL in Volet is wrong or missing.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-black/[0.06] dark:divide-white/10">
              {data.notices.map((notice) => {
                const outcome = OUTCOMES[notice.outcome] ?? { label: notice.outcome, tone: "wait" as const };
                const clickable = notice.user_id !== null;
                return (
                  <li key={notice.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => notice.user_id !== null && onSelectUser(notice.user_id)}
                      className="flex w-full items-start gap-3 py-2.5 text-left enabled:hover:bg-meta-50/50 dark:enabled:hover:bg-meta-500/10"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-black dark:text-slate-100">
                          {notice.email ?? (notice.order_id ? `Order ${notice.order_id.slice(0, 8)}` : "No order")}
                          {notice.order_ref ? (
                            <span className="font-normal text-ink-faint dark:text-slate-500"> · {notice.order_ref}</span>
                          ) : null}
                        </span>
                        <span className="block break-words text-[11px] text-ink-faint dark:text-slate-500">
                          {new Date(notice.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {notice.amount ? ` · ${notice.amount} ${notice.currency}` : ""}
                          {notice.status ? ` · ${notice.status}` : ""}
                          {notice.detail ? ` · ${notice.detail}` : ""}
                          {notice.outcome === "bad_sender" && notice.sender ? ` · from ${notice.sender}` : ""}
                        </span>
                      </span>
                      <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", TONES[outcome.tone])}>
                        {outcome.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : !error ? (
        <div className="grid place-items-center py-8 text-ink-faint dark:text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : null}
    </NeonCard>
  );
}

export default AutoPaymentsCard;
