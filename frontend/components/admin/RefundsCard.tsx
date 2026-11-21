"use client";

import clsx from "clsx";
import { Check, Copy, Loader2, Settings2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  approveRefund,
  getRefundRequests,
  rejectRefund,
  saveRefundRules,
  type AdminRefundRequest,
  type AdminRefunds,
  type RefundRules,
} from "@/lib/admin";
import { formatMoney, timeAgo } from "@/lib/format";

interface RefundsCardProps {
  refreshKey: number;
  onSelectUser: (id: number) => void;
}

const STATUS_TONE: Record<string, string> = {
  pending: "!border-amber-400/50 !bg-amber-50 !text-amber-700",
  approved: "!border-emerald-300 !bg-emerald-50 !text-emerald-700",
  rejected: "!border-red-300 !bg-red-50 !text-red-700",
  withdrawn: "!border-black/10 !text-ink-faint",
};

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-meta-600 hover:underline"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function RequestRow({
  row,
  currency,
  onDone,
  onSelectUser,
}: {
  row: AdminRefundRequest;
  currency: string;
  onDone: () => void;
  onSelectUser: (id: number) => void;
}) {
  const [note, setNote] = useState("");
  const [tx, setTx] = useState("");
  const [removeAccess, setRemoveAccess] = useState(true);
  const [reactivate, setReactivate] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const order = row.order;
  const isWhop = row.network === "whop_card" || order?.provider === "whop";

  const decide = async (action: "approve" | "reject") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "approve") await approveRefund(row.id, { note, refund_tx: isWhop ? "" : tx, remove_access: removeAccess });
      else await rejectRefund(row.id, note, reactivate);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onSelectUser(row.user_id)}
            className="block truncate text-left text-sm font-semibold text-black hover:underline dark:text-slate-100"
          >
            {row.name ? `${row.name} · ` : ""}
            {row.email}
          </button>
          {order ? (
            <p className="text-xs text-ink-muted dark:text-slate-300">
              {formatMoney(order.amount, currency)} paid ·{" "}
              <span className="font-semibold text-black dark:text-white">
                {formatMoney(row.refund_amount ?? order.refund_amount ?? order.amount, currency)} refundable
              </span>{" "}
              ({(row.tokens_remaining ?? order.tokens_remaining ?? Math.max(0, order.tokens - order.tokens_used)).toLocaleString()} of{" "}
              {order.tokens.toLocaleString()} tokens left) ·{" "}
              {order.kind === "subscription" ? `${order.plan_label} plan` : `Top-up on ${order.plan_label}`} ·{" "}
              {order.ref}
            </p>
          ) : null}
          <p className="text-[11px] text-ink-faint dark:text-slate-500">Asked {timeAgo(row.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.user_is_active === false ? (
            <span className="chip !border-amber-400/50 !bg-amber-50 !text-[10px] !text-amber-700">
              Account stopped
            </span>
          ) : null}
          {row.status === "pending" && !row.in_rules ? (
            <span className="chip !border-red-300 !bg-red-50 !text-[10px] !text-red-700" title={row.outside_rules}>
              Outside rules
            </span>
          ) : null}
          <span className={clsx("chip !text-[10px]", STATUS_TONE[row.status])}>{row.status}</span>
        </div>
      </div>

      <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-ink-muted dark:bg-white/5 dark:text-slate-300">
        <p>
          <span className="font-semibold text-black dark:text-slate-100">Why:</span> {row.reason}
          {row.details ? ` · ${row.details}` : ""}
        </p>
        {row.network === "whop_card" ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2">
            <span className="font-semibold text-black dark:text-slate-100">Refund to:</span> Original card / payment method via Whop
            {order?.provider_ref ? (
              <span className="break-all font-mono text-[11px] text-ink-faint dark:text-slate-400">
                ({order.provider_ref})
              </span>
            ) : null}
          </p>
        ) : row.address ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2">
            <span className="font-semibold text-black dark:text-slate-100">Refund to:</span> {row.network}
            <span className="break-all font-mono text-black dark:text-slate-100">{row.address}</span>
            <CopyText text={row.address} />
          </p>
        ) : null}
        {row.status === "pending" && !row.in_rules ? <p className="mt-1 text-red-700">{row.outside_rules}</p> : null}
        {row.status !== "pending" && row.status !== "withdrawn" ? (
          <p className="mt-1">
            {row.status === "approved" ? `Approved, ${row.tokens_removed.toLocaleString()} tokens taken back` : "Rejected"}
            {row.refund_tx ? ` · ${isWhop ? "Whop ref" : "tx"} ${row.refund_tx}` : ""}
            {row.admin_note ? ` · "${row.admin_note}"` : ""}
            {row.decided_by ? ` · by ${row.decided_by}` : ""}
          </p>
        ) : null}
      </div>

      {row.status === "pending" ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-ink-faint dark:text-slate-500">
            {isWhop
              ? "Approving sends the prorated refund (remaining unused tokens only) through Whop back to the customer's card/payment method."
              : "Send the prorated refund (remaining tokens only) to the address above first, then paste the transaction hash and approve."}
          </p>
          <div className={clsx("grid gap-2", isWhop ? "sm:grid-cols-1" : "sm:grid-cols-2")}>
            {!isWhop ? (
              <input
                className="field !py-2 !text-xs font-mono"
                placeholder="Refund transaction hash (goes in the customer's email)"
                value={tx}
                maxLength={200}
                onChange={(e) => setTx(e.target.value)}
              />
            ) : null}
            <input
              className="field !py-2 !text-xs"
              placeholder="Note to the customer (shown when you reject)"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-black dark:text-slate-100">
            <input type="checkbox" checked={removeAccess} onChange={(e) => setRemoveAccess(e.target.checked)} />
            Take back this order&apos;s tokens{order?.kind === "subscription" ? " and end the period it paid for" : ""}
          </label>
          {row.user_is_active === false ? (
            <label className="flex items-center gap-2 text-xs text-black dark:text-slate-100">
              <input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} />
              Reactivate customer&apos;s account if rejecting this request
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-2 !text-xs" disabled={busy !== null} onClick={() => void decide("approve")}>
              {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {isWhop ? "Approve & refund via Whop" : "Approve (refund sent)"}
            </button>
            <button type="button" className="btn-ghost !py-2 !text-xs" disabled={busy !== null} onClick={() => void decide("reject")}>
              {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
              Reject
            </button>
          </div>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function RulesEditor({ rules, onSaved }: { rules: RefundRules; onSaved: (rules: RefundRules) => void }) {
  const [draft, setDraft] = useState(rules);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      onSaved(await saveRefundRules(draft));
      setNote("Saved.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const check = (key: "enabled" | "allow_subscriptions" | "allow_topups", label: string) => (
    <label className="flex items-center gap-2 text-xs text-black dark:text-slate-100">
      <input type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
      {check("enabled", "Customers can ask for refunds from Account settings")}
      {check("allow_subscriptions", "Plan payments can be refunded")}
      {check("allow_topups", "Top-ups can be refunded")}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-black dark:text-slate-100">
          Days after payment a customer can ask
          <input
            type="number"
            min={0}
            max={365}
            className="field mt-1 !py-2 !text-xs"
            value={draft.window_days}
            onChange={(e) => setDraft({ ...draft, window_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="block text-xs text-black dark:text-slate-100">
          Most of the order&apos;s tokens used, % (0 = unused only, 100 = no limit)
          <input
            type="number"
            min={0}
            max={100}
            className="field mt-1 !py-2 !text-xs"
            value={draft.max_used_percent}
            onChange={(e) => setDraft({ ...draft, max_used_percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          />
        </label>
      </div>
      <p className="text-[11px] text-ink-faint dark:text-slate-500">
        These rules decide what a customer may ask for. You can still approve any request.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary !py-2 !text-xs" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Save rules
        </button>
        {note ? <span className="text-xs text-ink-muted dark:text-slate-300">{note}</span> : null}
      </div>
    </div>
  );
}

/** Admin > Sales: customers' refund requests with Approve / Reject, and the refund rules. */
export default function RefundsCard({ refreshKey, onSelectUser }: RefundsCardProps) {
  const [state, setState] = useState<"pending" | "all">("pending");
  const [data, setData] = useState<AdminRefunds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getRefundRequests(state));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load refund requests.");
    }
  }, [state]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-black dark:text-slate-100">
            <Undo2 className="h-4 w-4 text-meta-500" aria-hidden /> Refund requests
            {data?.pending ? <span className="chip !border-amber-400/50 !bg-amber-50 !text-[10px] !text-amber-700">{data.pending} waiting</span> : null}
          </h3>
          <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">
            Customers ask from Account settings. The app never sends money: refund to their wallet, then approve here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-slate-900" role="group" aria-label="Show">
            {(["pending", "all"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setState(id)}
                aria-pressed={state === id}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  state === id ? "bg-meta-500 text-white" : "text-ink-muted hover:bg-meta-50 dark:text-slate-300",
                )}
              >
                {id === "pending" ? "Waiting" : "All"}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden /> Rules
          </button>
        </div>
      </div>

      {showRules && data ? (
        <div className="mt-3">
          <RulesEditor rules={data.rules} onSaved={(rules) => setData({ ...data, rules })} />
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
      {!data ? (
        <p className="py-6 text-center text-xs text-ink-faint">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-hidden />
        </p>
      ) : data.requests.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-faint dark:text-slate-500">
          {state === "pending" ? "No refund requests waiting." : "No refund requests yet."}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-black/[0.06] dark:divide-white/10">
          {data.requests.map((row) => (
            <RequestRow key={row.id} row={row} currency={data.currency} onDone={() => void load()} onSelectUser={onSelectUser} />
          ))}
        </ul>
      )}
    </NeonCard>
  );
}
