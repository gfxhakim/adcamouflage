"use client";

import clsx from "clsx";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  approveProof,
  fetchProofs,
  proofImageUrl,
  rejectProof,
  type PaymentProof,
  type ProofStatus,
} from "@/lib/payments";

const FILTERS: { id: ProofStatus | "all"; label: string }[] = [
  { id: "pending", label: "To review" },
  { id: "matched", label: "Auto-confirmed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

const TONE: Record<ProofStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  matched: "bg-emerald-500/15 text-emerald-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
};

interface PaymentsTabProps {
  refreshKey: number;
  onSelectUser?: (id: number) => void;
}

/**
 * Payment proofs customers sent from their plan page. Approving one applies
 * its order (plan + tokens) exactly once; nothing turns on from a screenshot
 * until an admin approves it here, unless the provider already confirmed it.
 */
export default function PaymentsTab({ refreshKey }: PaymentsTabProps) {
  const [filter, setFilter] = useState<ProofStatus | "all">("pending");
  const [rows, setRows] = useState<PaymentProof[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchProofs(filter));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payment proofs.");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (proof: PaymentProof, approve: boolean) => {
    setBusy(proof.id);
    try {
      const note = notes[proof.id] ?? "";
      const updated = approve ? await approveProof(proof.id, note) : await rejectProof(proof.id, note);
      setRows((current) =>
        (current ?? [])
          .map((row) => (row.id === updated.id ? updated : row))
          .filter((row) => filter === "all" || row.status === filter),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              filter === item.id
                ? "border-meta-400 bg-meta-500/20 text-white"
                : "border-white/10 text-slate-400 hover:text-white",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      {rows === null ? (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-400">
          Nothing here.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((proof) => {
            const image = proofImageUrl(proof.screenshot_url);
            return (
              <li key={proof.id} className="flex gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                {image ? (
                  <button
                    type="button"
                    onClick={() => setZoom(image)}
                    className="h-28 w-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black"
                    aria-label="Open screenshot"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="Payment screenshot" className="h-full w-full object-cover" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-white">{proof.user_email ?? "Unknown user"}</span>
                    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", TONE[proof.status])}>
                      {proof.status}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-slate-300">Transaction: {proof.transaction_id}</p>
                  <p className="font-mono text-[10px] text-slate-500">
                    Order {proof.order_id.slice(0, 12)}… · {proof.order_kind} · {proof.order_plan} · $
                    {proof.order_amount ?? "?"} · {proof.order_provider} · order {proof.order_status}
                  </p>
                  {proof.order_transaction_id ? (
                    <p className="font-mono text-[10px] text-slate-500">
                      Provider transaction on record: {proof.order_transaction_id}
                    </p>
                  ) : null}
                  {proof.duplicate_transaction ? (
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> This transaction id was used before.
                    </p>
                  ) : null}
                  <p className="text-[10px] text-slate-500">{new Date(proof.created_at).toLocaleString()}</p>
                  {proof.status === "pending" ? (
                    <div className="space-y-2 pt-1">
                      <input
                        value={notes[proof.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [proof.id]: e.target.value })}
                        maxLength={500}
                        placeholder="Note to the customer (optional)"
                        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy === proof.id}
                          onClick={() => void act(proof, true)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden /> Approve &amp; activate
                        </button>
                        <button
                          type="button"
                          disabled={busy === proof.id}
                          onClick={() => void act(proof, false)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden /> Reject
                        </button>
                      </div>
                    </div>
                  ) : proof.admin_note ? (
                    <p className="text-[11px] text-slate-400">Note: {proof.admin_note}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {zoom ? (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          aria-label="Close screenshot"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Payment screenshot" className="max-h-full max-w-full rounded-xl" />
        </button>
      ) : null}
    </div>
  );
}
