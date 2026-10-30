"use client";

import clsx from "clsx";
import { CalendarPlus, Coins, Loader2, Repeat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  adjustTokens,
  getBillingConfig,
  getUserBilling,
  grantPeriod,
  setBillingMode,
  type AdminUser,
  type LedgerEntry,
  type UserBilling,
} from "@/lib/admin";
import { formatDate, formatMoney, formatTokens, timeAgo } from "@/lib/format";
import { paymentProviderName, type BillingMode, type TokenPlanCard } from "@/lib/types";

interface BillingPanelProps {
  user: AdminUser;
  currency: string;
  /** Called after any change so the parent re-reads the user row. */
  onChanged: () => void;
}

const LEDGER_KIND: Record<LedgerEntry["kind"], string> = {
  grant: "Period tokens",
  rollover: "Rolled over",
  expire: "Expired",
  topup: "Top-up",
  bonus: "Top-up bonus",
  consume: "Generation",
  refund: "Refund",
  admin: "Admin",
};

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>;
  if (notice) return <p className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>;
  return null;
}

/** One user's token billing: period, balances, ledger, orders and the hand controls. */
export function BillingPanel({ user, currency, onChanged }: BillingPanelProps) {
  const [billing, setBilling] = useState<UserBilling | null>(null);
  const [plans, setPlans] = useState<TokenPlanCard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [grantPlan, setGrantPlan] = useState("");
  const [grantMonths, setGrantMonths] = useState("1");
  const [tokenAmount, setTokenAmount] = useState("");
  const [tokenNote, setTokenNote] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await getUserBilling(user.id);
      setBilling(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing.");
    }
  }, [user.id]);

  useEffect(() => {
    setBilling(null);
    setNotice(null);
    void load();
  }, [load]);

  useEffect(() => {
    getBillingConfig()
      .then((config) => {
        const list = Object.values(config.plans);
        setPlans(list);
        setGrantPlan((current) => current || user.sub_plan || list[0]?.id || "");
      })
      .catch(() => undefined);
  }, [user.sub_plan]);

  const run = async (label: string, action: () => Promise<UserBilling>, done: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setBilling(await action());
      setNotice(done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change did not go through.");
    } finally {
      setBusy(null);
    }
  };

  const grant = () => {
    const months = Number.parseInt(grantMonths, 10);
    const plan = plans.find((p) => p.id === grantPlan);
    if (!plan) return setError("Pick a plan to grant.");
    if (!(months >= 1)) return setError("Enter at least 1 month.");
    if (!window.confirm(`Give ${user.email} ${months} month${months === 1 ? "" : "s"} of ${plan.label} without payment? This moves them to token billing.`)) {
      return;
    }
    void run("grant", () => grantPeriod(user.id, plan.id, months), `${plan.label} granted for ${months} month${months === 1 ? "" : "s"}.`);
  };

  const addTokens = () => {
    const amount = Number.parseInt(tokenAmount, 10);
    if (!amount) return setError("Enter a number of tokens other than zero (negative takes tokens away).");
    void run("tokens", () => adjustTokens(user.id, amount, tokenNote.trim()), `${amount > 0 ? "+" : ""}${amount} top-up tokens recorded.`).then(() => {
      setTokenAmount("");
      setTokenNote("");
    });
  };

  const switchMode = (mode: BillingMode) => {
    const text =
      mode === "tokens"
        ? `Switch ${user.email} to token billing? They will need a subscription to generate; their legacy quota stops counting.`
        : `Switch ${user.email} back to legacy billing? Their monthly file quota applies again until it expires.`;
    if (!window.confirm(text)) return;
    void run("mode", () => setBillingMode(user.id, mode), mode === "tokens" ? "Now on token billing." : "Back on legacy billing.");
  };

  const sub = billing?.subscription ?? null;
  const balance = billing?.balance;
  const status = !sub
    ? { text: "Never subscribed", tone: "!border-black/10 !text-ink-faint dark:!text-slate-500" }
    : !sub.active
      ? { text: sub.in_grace ? "Ended · in grace" : "Ended", tone: "!border-red-300 dark:!border-red-500/40 !bg-red-50 dark:!bg-red-500/10 !text-red-700 dark:!text-red-300" }
      : sub.cancelled
        ? { text: "Cancelled · runs to end", tone: "!border-amber-300 dark:!border-amber-500/40 !bg-amber-50 dark:!bg-amber-500/10 !text-amber-700 dark:!text-amber-300" }
        : { text: `Active · ${sub.days_left} d left`, tone: "!border-emerald-300 dark:!border-emerald-500/40 !bg-emerald-50 dark:!bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300" };

  return (
    <NeonCard padding="md" radius="lg" tone="slow">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Coins className="h-4 w-4 text-meta-500" aria-hidden />
        <h3 className="text-sm font-semibold text-black dark:text-slate-100">Token billing</h3>
        <span className="chip ml-auto !text-[10px]">
          {(billing?.billing_mode ?? user.billing_mode) === "tokens" ? "Token billing" : "Legacy billing"}
        </span>
      </div>

      {!billing ? (
        <div className="grid place-items-center py-8 text-ink-faint dark:text-slate-500">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        </div>
      ) : (
        <div className="space-y-4">
          {/* State ----------------------------------------------------------- */}
          <div className="rounded-xl border border-black/[0.06] dark:border-white/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-black dark:text-slate-100">{sub ? sub.plan_label : "No plan"}</p>
              <span className={clsx("chip !text-[10px]", status.tone)}>{status.text}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Period ends</dt>
                <dd className="text-black dark:text-slate-100">{sub?.period_end ? formatDate(sub.period_end) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Grace until</dt>
                <dd className="text-black dark:text-slate-100">{sub?.grace_until ? formatDate(sub.grace_until) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Per generation</dt>
                <dd className="text-black tabular-nums dark:text-slate-100">{sub ? `${sub.tokens_per_generation} tokens` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Subscription tokens</dt>
                <dd className="text-black tabular-nums dark:text-slate-100">{formatTokens(balance?.subscription_tokens)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Top-up tokens</dt>
                <dd className="text-black tabular-nums dark:text-slate-100">
                  {formatTokens(balance?.topup_tokens)}
                  {balance?.frozen_topup ? <span className="ml-1 text-amber-700 dark:text-amber-300">(on hold)</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint dark:text-slate-500">Usable now</dt>
                <dd className="font-semibold text-black tabular-nums dark:text-slate-100">
                  {formatTokens(balance?.usable_tokens)} · {formatTokens(balance?.generations_left)} gen.
                </dd>
              </div>
            </dl>
          </div>

          <Feedback error={error} notice={notice} />

          {/* Grant a period -------------------------------------------------- */}
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
            <label className="block">
              <span className="label">Grant period</span>
              <select className="field mt-1" value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)} aria-label="Plan to grant">
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.label} · {formatTokens(plan.tokens)} tokens
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Months</span>
              <input
                className="field mt-1"
                type="number"
                min={1}
                max={24}
                inputMode="numeric"
                value={grantMonths}
                onChange={(e) => setGrantMonths(e.target.value)}
              />
            </label>
            <button type="button" className="btn-ghost" disabled={busy !== null || plans.length === 0} onClick={grant}>
              {busy === "grant" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
              Grant period
            </button>
          </div>
          <p className="-mt-2 text-[11px] text-ink-faint dark:text-slate-500">
            Same rules as a purchase (period extends from the current end, rollover applies), recorded as a paid order of {formatMoney(0, currency)}.
          </p>

          {/* Add tokens ------------------------------------------------------- */}
          <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
            <label className="block">
              <span className="label">Tokens</span>
              <input
                className="field mt-1"
                type="number"
                step={1}
                inputMode="numeric"
                placeholder="500"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                aria-label="Tokens to add (negative removes)"
              />
            </label>
            <label className="block">
              <span className="label">Note</span>
              <input
                className="field mt-1"
                maxLength={500}
                placeholder="e.g. goodwill for the failed batch"
                value={tokenNote}
                onChange={(e) => setTokenNote(e.target.value)}
              />
            </label>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={addTokens}>
              {busy === "tokens" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Coins className="h-4 w-4" aria-hidden />}
              Add tokens
            </button>
          </div>
          <p className="-mt-2 text-[11px] text-ink-faint dark:text-slate-500">
            Goes into the top-up bucket, so it never expires; a negative number takes tokens away.
          </p>

          {/* Billing mode ----------------------------------------------------- */}
          <div>
            {billing.billing_mode === "tokens" ? (
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => switchMode("legacy")}>
                {busy === "mode" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat className="h-4 w-4" aria-hidden />}
                Switch to legacy billing
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => switchMode("tokens")}>
                {busy === "mode" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Repeat className="h-4 w-4" aria-hidden />}
                Switch to token billing
              </button>
            )}
          </div>

          {/* Ledger ------------------------------------------------------------ */}
          <div>
            <p className="label mb-1">Ledger (last 20)</p>
            {billing.ledger.length === 0 ? (
              <p className="py-2 text-xs text-ink-faint dark:text-slate-500">No token movements yet.</p>
            ) : (
              <ul className="divide-y divide-black/[0.06] dark:divide-white/10">
                {billing.ledger.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="min-w-0">
                      <span className="text-black dark:text-slate-100">{LEDGER_KIND[row.kind] ?? row.kind}</span>
                      <span className="text-ink-faint dark:text-slate-500"> · {row.bucket}</span>
                      {row.note ? <span className="block truncate text-ink-faint dark:text-slate-500">{row.note}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={clsx("font-semibold tabular-nums", row.amount < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>
                        {row.amount > 0 ? "+" : ""}
                        {formatTokens(row.amount)}
                      </span>
                      <time className="text-ink-faint dark:text-slate-500" dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>
                        {timeAgo(row.created_at)}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Orders ------------------------------------------------------------ */}
          <div>
            <p className="label mb-1">Orders</p>
            {billing.orders.length === 0 ? (
              <p className="py-2 text-xs text-ink-faint dark:text-slate-500">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-black/[0.06] dark:divide-white/10">
                {billing.orders.map((order) => {
                  const providerName = paymentProviderName(order.provider);
                  return (
                    <li key={order.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="min-w-0 truncate text-black dark:text-slate-100">
                        {order.kind === "subscription" ? `${order.plan_id} period` : `top-up on ${order.plan_id}`} ·{" "}
                        {formatMoney(order.amount, currency)} · {formatTokens(order.tokens)} tokens
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {providerName ? <span className="chip !text-[10px]">{providerName}</span> : null}
                        <span
                          className={clsx(
                            "chip !text-[10px]",
                            order.status === "paid"
                              ? "!border-emerald-300 dark:!border-emerald-500/40 !bg-emerald-50 dark:!bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300"
                              : order.status === "pending"
                                ? "!border-amber-300 dark:!border-amber-500/40 !bg-amber-50 dark:!bg-amber-500/10 !text-amber-700 dark:!text-amber-300"
                                : "",
                          )}
                        >
                          {order.status}
                        </span>
                        <time className="text-ink-faint dark:text-slate-500" dateTime={order.paid_at ?? order.created_at}>
                          {timeAgo(order.paid_at ?? order.created_at)}
                        </time>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </NeonCard>
  );
}

export default BillingPanel;
