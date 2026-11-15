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
  unmatched: { label: "No order matched", tone: "bad" },
};

const TONES = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  wait: "bg-black/[0.05] text-ink-muted dark:bg-white/10 dark:text-slate-300",
  bad: "bg-red-500/10 text-red-700 dark:text-red-300",
};

function StatusLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg px-3 py-2 text-xs", ok ? TONES.good : TONES.wait)}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

interface Props {
  refreshKey: number;
  onSelectUser: (id: number) => void;
}

/** Admin > Sales: which payments activate plans by themselves, and the latest payments seen. */
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
  const anyReady = data ? data.usdt_ready || ready : false;

  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Automatic activation</h3>
          <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">
            Payments the app saw by itself (USDT on the blockchain, Volet checkout messages) and what it did with
            each, newest first.
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
          <div className="mt-3 space-y-2">
            <StatusLine ok={data.usdt_ready}>
              {data.usdt_ready ? (
                <>
                  USDT (TRC-20): on. Customers send an exact amount to{" "}
                  <span className="break-all font-mono font-semibold">{data.usdt_address}</span> and the plan activates when
                  the blockchain confirms it.
                </>
              ) : (
                "USDT (TRC-20): off. Set ADCAM_USDT_TRC20_ADDRESS on Railway (api service) to your USDT TRC-20 address."
              )}
            </StatusLine>
            {data.volet_ready || !data.usdt_ready ? (
              <StatusLine ok={Boolean(ready)}>
                {ready ? (
                  <>
                    Volet checkout: on. The Hosted Checkout&apos;s Status URL in Volet must be{" "}
                    <span className="break-all font-mono font-semibold">{data.status_url}</span> (method POST). Volet&apos;s
                    fee is accepted up to {data.fee_allowance_pct}% below the price.
                    {data.sender_check ? "" : " Sender check is off."}
                  </>
                ) : !data.volet_ready ? (
                  "Volet checkout: off (the Volet variables are not set on Railway)."
                ) : (
                  "Volet checkout: off (ADCAM_PUBLIC_URL is not set on Railway)."
                )}
              </StatusLine>
            ) : null}
          </div>

          {data.notices.length === 0 ? (
            <p className="mt-3 py-3 text-xs text-ink-faint dark:text-slate-500">
              {anyReady
                ? "Nothing yet. After the next payment, it shows up here within a minute or two."
                : "Turn on one of the ways above to see payments here."}
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
                          <span className="mr-1.5 rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-muted dark:bg-white/10 dark:text-slate-300">
                            {notice.provider}
                          </span>
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
                          {(notice.outcome === "bad_sender" || notice.provider === "usdt") && notice.sender
                            ? ` · from ${notice.sender}`
                            : ""}
                          {notice.provider === "usdt" && notice.transfer_id ? ` · tx ${notice.transfer_id.slice(0, 10)}…` : ""}
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
