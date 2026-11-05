"use client";

import clsx from "clsx";
import { CheckCircle2, ImageOff, Loader2, Receipt, RefreshCw, Search, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  approvePayment,
  listPaymentReviews,
  rejectPayment,
  type PaymentReview,
  type PaymentReviewState,
} from "@/lib/admin";
import { API_BASE } from "@/lib/api";
import { formatDate, formatMoney, formatTokens, timeAgo } from "@/lib/format";
import { paymentProviderName } from "@/lib/types";

interface PaymentsTabProps {
  refreshKey: number;
  currency: string;
  onSelectUser: (userId: number) => void;
  onChanged: () => void;
}

const FILTERS: { id: PaymentReviewState; label: string }[] = [
  { id: "submitted", label: "To review" },
  { id: "reviewed", label: "Reviewed" },
  { id: "all", label: "All screenshots" },
];

const ORDER_STATUS: Record<PaymentReview["status"], string> = {
  pending: "Not confirmed by provider",
  paid: "Paid",
  expired: "Expired",
  invalid: "Invalid",
};

function ReviewChip({ row }: { row: PaymentReview }) {
  if (row.status === "paid") {
    return (
      <span className="chip !border-emerald-300 dark:!border-emerald-500/40 !bg-emerald-50 dark:!bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300">
        Paid · active
      </span>
    );
  }
  if (row.review_status === "rejected") {
    return (
      <span className="chip !border-red-300 dark:!border-red-500/40 !bg-red-50 dark:!bg-red-500/10 !text-red-700 dark:!text-red-300">
        Rejected
      </span>
    );
  }
  if (row.review_status === "submitted") {
    return (
      <span className="chip !border-amber-300 dark:!border-amber-500/40 !bg-amber-50 dark:!bg-amber-500/10 !text-amber-700 dark:!text-amber-300">
        Waiting for you
      </span>
    );
  }
  return <span className="chip">{ORDER_STATUS[row.status]}</span>;
}

/**
 * Payment screenshots buyers sent, and a search by transaction ID. Approving
 * applies the order once and turns the plan on; check the money arrived first.
 */
export default function PaymentsTab({ refreshKey, currency, onSelectUser, onChanged }: PaymentsTabProps) {
  const [state, setState] = useState<PaymentReviewState>("submitted");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [rows, setRows] = useState<PaymentReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listPaymentReviews(state, submittedQuery));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payments.");
    }
  }, [state, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const decide = async (row: PaymentReview, approve: boolean) => {
    if (approve) {
      const ok = window.confirm(
        `Approve ${row.ref_code ?? row.order_id} for ${row.email}?\n\n` +
          `Only approve after checking that ${formatMoney(row.amount, currency)} really arrived in your ` +
          `${paymentProviderName(row.provider) || "payment"} account. This turns the plan on and adds ` +
          `${formatTokens(row.tokens)} tokens.`,
      );
      if (!ok) return;
    }
    setBusy(row.order_id);
    try {
      const note = notes[row.order_id] ?? "";
      const updated = approve ? await approvePayment(row.order_id, note) : await rejectPayment(row.order_id, note);
      setRows((list) => (list ?? []).map((r) => (r.order_id === row.order_id ? updated : r)));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the decision.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <NeonCard padding="lg" radius="xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Receipt className="h-4 w-4 text-meta-500" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Payments to review</h2>
          <button type="button" className="btn-ghost ml-auto !px-3 !py-1.5 !text-xs" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-ink-muted dark:text-slate-400">
          A plan turns on by itself when Volet or BTCPay confirms the payment. When a buyer says they paid but it
          didn&rsquo;t confirm, their screenshot lands here. Check the money in your account, then approve. A screenshot
          alone is never proof: images are easy to edit.
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              className="field !pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by transaction ID (BC-XXXX-XXXX), Volet transaction or email"
              aria-label="Find a payment"
            />
          </div>
          <div className="flex gap-1 rounded-xl border border-black/10 dark:border-white/10 p-1" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={state === f.id && !submittedQuery}
                onClick={() => {
                  setQuery("");
                  setSubmittedQuery("");
                  setState(f.id);
                }}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  state === f.id && !submittedQuery ? "bg-meta-500 text-white" : "text-ink-muted dark:text-slate-400 hover:bg-meta-50 dark:hover:bg-white/5",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </form>
      </NeonCard>

      {error ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <div className="h-32 animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/5" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint dark:text-slate-500">
          {submittedQuery ? "No order matches that." : state === "submitted" ? "Nothing waiting. All caught up." : "No screenshots yet."}
        </p>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {rows.map((row) => {
            const open = row.status !== "paid";
            const proof = row.proof_url ? `${API_BASE}${row.proof_url}` : null;
            return (
              <li key={row.order_id}>
                <NeonCard padding="lg" radius="xl" tone={row.review_status === "submitted" && open ? "slow" : "muted"}>
                  <div className="flex gap-4">
                    {proof ? (
                      <button
                        type="button"
                        onClick={() => setZoom(proof)}
                        className="h-28 w-24 shrink-0 overflow-hidden rounded-xl border border-black/10 dark:border-white/10"
                        aria-label="Open screenshot"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proof} alt="Payment screenshot" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <div className="grid h-28 w-24 shrink-0 place-items-center rounded-xl border border-dashed border-black/15 dark:border-white/15 text-ink-faint">
                        <ImageOff className="h-5 w-5" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-base font-semibold tracking-wider text-black dark:text-slate-100">
                          {row.ref_code ?? row.order_id.slice(0, 10)}
                        </code>
                        <ReviewChip row={row} />
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectUser(row.user_id)}
                        className="block max-w-full truncate text-left text-meta-600 dark:text-meta-300 hover:underline"
                      >
                        {row.email}
                      </button>
                      <p className="text-xs text-ink-muted dark:text-slate-400">
                        {row.kind === "subscription" ? `${row.plan_label} period` : `Top-up on ${row.plan_label}`} ·{" "}
                        <span className="font-semibold text-black dark:text-slate-100">{formatMoney(row.amount, currency)}</span> ·{" "}
                        {formatTokens(row.tokens)} tokens
                      </p>
                      <p className="text-xs text-ink-faint dark:text-slate-500">
                        {paymentProviderName(row.provider) || row.provider} · ordered {formatDate(row.created_at)}
                        {row.proof_uploaded_at ? ` · screenshot ${timeAgo(row.proof_uploaded_at)}` : ""}
                        {row.provider_ref ? ` · provider ref ${row.provider_ref}` : ""}
                      </p>
                      {row.proof_note ? (
                        <p className="rounded-lg bg-black/[0.03] dark:bg-white/5 px-2 py-1 text-xs text-ink-muted dark:text-slate-300">
                          &ldquo;{row.proof_note}&rdquo;
                        </p>
                      ) : null}
                      {row.reviewed_by ? (
                        <p className="text-[11px] text-ink-faint dark:text-slate-500">
                          {row.review_status === "approved" ? "Approved" : "Rejected"} by {row.reviewed_by}{" "}
                          {timeAgo(row.reviewed_at)}
                          {row.review_note ? `: ${row.review_note}` : ""}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {open ? (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <input
                        className="field min-w-0 flex-1 !py-2 !text-xs"
                        placeholder="Note (optional, shown to the buyer if rejected)"
                        maxLength={500}
                        value={notes[row.order_id] ?? ""}
                        onChange={(event) => setNotes((n) => ({ ...n, [row.order_id]: event.target.value }))}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-primary flex-1 whitespace-nowrap !py-2 !text-xs"
                          disabled={busy === row.order_id}
                          onClick={() => void decide(row, true)}
                        >
                          {busy === row.order_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Approve &amp; activate
                        </button>
                        <button
                          type="button"
                          className="btn-danger flex-1 whitespace-nowrap !py-2 !text-xs"
                          disabled={busy === row.order_id}
                          onClick={() => void decide(row, false)}
                        >
                          <XCircle className="h-3.5 w-3.5" aria-hidden /> Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </NeonCard>
              </li>
            );
          })}
        </ul>
      )}

      {zoom ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4" onClick={() => setZoom(null)} role="presentation">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Payment screenshot, full size" className="max-h-[90vh] max-w-full rounded-xl object-contain" />
        </div>
      ) : null}
    </div>
  );
}
