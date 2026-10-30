"use client";

import { Coins, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import NeonCard from "@/components/NeonCard";
import {
  getBillingConfig,
  updateBillingConfig,
  type BillingConfig,
  type TokenPlanEdit,
} from "@/lib/admin";
import { formatMoney } from "@/lib/format";

interface TokenPlansCardProps {
  /** Called after a save so the rest of the panel re-reads prices. */
  onSaved: () => void;
}

/** Every number is kept as typed until Save, so a half-typed value never jumps. */
interface PlanDraft {
  label: string;
  price: string;
  tokens: string;
  tokens_per_generation: string;
  rollover_months: string;
  topup_rate: string;
}

interface Draft {
  plans: Record<string, PlanDraft>;
  amounts: string;
  /** plan id → amount (string) → bonus tokens as typed */
  bonus: Record<string, Record<string, string>>;
  grace_days: string;
  period_days: string;
}

const PLAN_FIELDS: { key: keyof Omit<PlanDraft, "label">; label: string; step?: string; hint: string }[] = [
  { key: "price", label: "Price", step: "0.01", hint: "per 30-day period" },
  { key: "tokens", label: "Tokens", hint: "granted each period" },
  { key: "tokens_per_generation", label: "Per generation", hint: "tokens one output costs" },
  { key: "rollover_months", label: "Rollover", hint: "periods of tokens kept (0–12)" },
  { key: "topup_rate", label: "Top-up rate", hint: "tokens per 1 unit of currency" },
];

function draftOf(config: BillingConfig): Draft {
  const amounts = config.topups.amounts;
  return {
    plans: Object.fromEntries(
      Object.entries(config.plans).map(([id, plan]) => [
        id,
        {
          label: plan.label,
          price: String(plan.price),
          tokens: String(plan.tokens),
          tokens_per_generation: String(plan.tokens_per_generation),
          rollover_months: String(plan.rollover_months),
          topup_rate: String(plan.topup_rate),
        },
      ]),
    ),
    amounts: amounts.join(", "),
    bonus: Object.fromEntries(
      Object.keys(config.plans).map((id) => [
        id,
        Object.fromEntries(amounts.map((amount) => [String(amount), String(config.topups.bonus[id]?.[String(amount)] ?? 0)])),
      ]),
    ),
    grace_days: String(config.rules.grace_days),
    period_days: String(config.rules.period_days),
  };
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>;
  if (notice) return <p className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>;
  return null;
}

/**
 * The token price list: the three plans, the top-up amounts with their bonus
 * table and the billing rules, saved together with PUT /billing/config.
 */
export function TokenPlansCard({ onSaved }: TokenPlansCardProps) {
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getBillingConfig()
      .then((data) => {
        setConfig(data);
        setDraft(draftOf(data));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the token plans."));
  }, []);

  // The amounts the bonus table shows follow the amounts field as it is typed.
  const amounts = useMemo(
    () =>
      Array.from(
        new Set(
          (draft?.amounts ?? "")
            .split(/[,\s]+/)
            .map((part) => Number.parseInt(part, 10))
            .filter((n) => Number.isFinite(n) && n > 0),
        ),
      ).sort((a, b) => a - b),
    [draft?.amounts],
  );

  const setPlan = (id: string, patch: Partial<PlanDraft>) =>
    setDraft((d) => (d ? { ...d, plans: { ...d.plans, [id]: { ...d.plans[id], ...patch } } } : d));
  const setBonus = (id: string, amount: number, value: string) =>
    setDraft((d) =>
      d ? { ...d, bonus: { ...d.bonus, [id]: { ...(d.bonus[id] ?? {}), [String(amount)]: value } } } : d,
    );

  const save = async () => {
    if (!draft || !config) return;
    const plans: Record<string, TokenPlanEdit> = {};
    for (const [id, plan] of Object.entries(draft.plans)) {
      const edit: TokenPlanEdit = {
        label: plan.label.trim() || config.plans[id]?.label || id,
        price: Number.parseFloat(plan.price),
        tokens: Number.parseInt(plan.tokens, 10),
        tokens_per_generation: Number.parseInt(plan.tokens_per_generation, 10),
        rollover_months: Number.parseInt(plan.rollover_months, 10),
        topup_rate: Number.parseInt(plan.topup_rate, 10),
      };
      if (Number.isNaN(edit.price) || edit.price < 0) return setError(`${edit.label}: enter a price of 0 or more.`);
      if (!(edit.tokens > 0)) return setError(`${edit.label}: tokens per period must be above 0.`);
      if (!(edit.tokens_per_generation > 0)) return setError(`${edit.label}: tokens per generation must be above 0.`);
      if (Number.isNaN(edit.rollover_months) || edit.rollover_months < 0 || edit.rollover_months > 12) {
        return setError(`${edit.label}: rollover is a number of periods from 0 to 12.`);
      }
      if (!(edit.topup_rate > 0)) return setError(`${edit.label}: the top-up rate must be above 0.`);
      plans[id] = edit;
    }
    if (amounts.length === 0) return setError("Enter at least one top-up amount, e.g. 20, 40, 80.");
    const bonus: Record<string, Record<string, number>> = {};
    for (const id of Object.keys(draft.plans)) {
      bonus[id] = {};
      for (const amount of amounts) {
        const value = Number.parseInt(draft.bonus[id]?.[String(amount)] ?? "0", 10) || 0;
        if (value < 0) return setError("Bonus tokens cannot be negative.");
        bonus[id][String(amount)] = value;
      }
    }
    const grace_days = Number.parseInt(draft.grace_days, 10);
    const period_days = Number.parseInt(draft.period_days, 10);
    if (Number.isNaN(grace_days) || grace_days < 0) return setError("Grace days must be 0 or more.");
    if (!(period_days > 0)) return setError("A period must be at least 1 day.");

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateBillingConfig({ plans, topups: { amounts, bonus }, rules: { grace_days, period_days } });
      setConfig(saved);
      setDraft(draftOf(saved));
      setNotice("Token plans saved. New purchases use the new prices; running periods are unchanged.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the token plans.");
    } finally {
      setBusy(false);
    }
  };

  if (!draft || !config) {
    return (
      <NeonCard padding="lg" radius="xl">
        <div className="grid place-items-center py-10 text-ink-faint dark:text-slate-500">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        </div>
      </NeonCard>
    );
  }

  const currency = config.currency;

  return (
    <NeonCard padding="lg" radius="xl" glow>
      <div className="mb-1 flex items-center gap-2">
        <Coins className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">Token plans</h2>
      </div>
      <p className="mb-4 text-xs text-ink-faint dark:text-slate-500">
        What new sign-ups buy: a paid {draft.period_days || 30}-day period of tokens. One output file costs the plan&apos;s
        tokens per generation. Prices are in {currency}; the public pricing section reads this table.
      </p>

      {/* Plans ------------------------------------------------------------- */}
      <div className="space-y-3">
        {Object.entries(draft.plans).map(([id, plan]) => {
          const tokens = Number.parseInt(plan.tokens, 10) || 0;
          const per = Number.parseInt(plan.tokens_per_generation, 10) || 0;
          const price = Number.parseFloat(plan.price) || 0;
          const generations = per > 0 ? Math.floor(tokens / per) : 0;
          const rollover = (Number.parseInt(plan.rollover_months, 10) || 0) * tokens;
          return (
            <div key={id} className="rounded-xl border border-black/[0.08] dark:border-white/10 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint dark:text-slate-500">
                <span className="font-mono">{id}</span>
                <span className="tabular-nums">
                  {generations} generations · {generations ? formatMoney(price / generations, currency) : "—"} each · rollover cap{" "}
                  {rollover.toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <label className="col-span-2 block sm:col-span-3 lg:col-span-1">
                  <span className="label">Name</span>
                  <input className="field mt-1" value={plan.label} maxLength={40} onChange={(e) => setPlan(id, { label: e.target.value })} />
                </label>
                {PLAN_FIELDS.map((field) => (
                  <label key={field.key} className="block" title={field.hint}>
                    <span className="label">{field.label}</span>
                    <input
                      className="field mt-1"
                      type="number"
                      min={0}
                      step={field.step ?? 1}
                      inputMode={field.step ? "decimal" : "numeric"}
                      value={plan[field.key]}
                      aria-label={`${plan.label || id} ${field.label.toLowerCase()} (${field.hint})`}
                      onChange={(e) => setPlan(id, { [field.key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Top-ups ------------------------------------------------------------ */}
      <div className="mt-5 rounded-xl border border-black/[0.08] dark:border-white/10 p-3">
        <h3 className="text-sm font-semibold text-black dark:text-slate-100">Top-ups</h3>
        <p className="mb-3 text-xs text-ink-faint dark:text-slate-500">
          Tokens = amount × the plan&apos;s top-up rate + the bonus below. Subscribers only, at their current plan&apos;s rate.
        </p>
        <label className="block max-w-sm">
          <span className="label">Amounts ({currency}, comma-separated)</span>
          <input
            className="field mt-1"
            value={draft.amounts}
            placeholder="20, 40, 80, 160, 240"
            onChange={(e) => setDraft({ ...draft, amounts: e.target.value })}
          />
        </label>

        {amounts.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-xs">
              <caption className="sr-only">Bonus tokens per plan and top-up amount</caption>
              <thead>
                <tr className="text-left text-ink-faint dark:text-slate-500">
                  <th scope="col" className="py-1 pr-2 font-medium">Bonus tokens</th>
                  {amounts.map((amount) => (
                    <th key={amount} scope="col" className="py-1 pr-2 font-medium tabular-nums">
                      {formatMoney(amount, currency)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(draft.plans).map(([id, plan]) => {
                  const rate = Number.parseInt(plan.topup_rate, 10) || 0;
                  return (
                    <tr key={id} className="border-t border-black/[0.06] dark:border-white/10">
                      <th scope="row" className="py-1.5 pr-2 text-left font-medium text-black dark:text-slate-100">
                        {plan.label || id}
                        <span className="block font-normal text-ink-faint dark:text-slate-500">{rate} / {formatMoney(1, currency)}</span>
                      </th>
                      {amounts.map((amount) => {
                        const bonus = Number.parseInt(draft.bonus[id]?.[String(amount)] ?? "0", 10) || 0;
                        return (
                          <td key={amount} className="py-1.5 pr-2 align-top">
                            <input
                              className="field !px-2 !py-1.5"
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={draft.bonus[id]?.[String(amount)] ?? "0"}
                              aria-label={`${plan.label || id} bonus for ${formatMoney(amount, currency)}`}
                              onChange={(e) => setBonus(id, amount, e.target.value)}
                            />
                            <span className="mt-0.5 block tabular-nums text-ink-faint dark:text-slate-500">
                              = {(amount * rate + bonus).toLocaleString()}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* Rules -------------------------------------------------------------- */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Grace days after a period ends</span>
          <input
            className="field mt-1"
            type="number"
            min={0}
            max={90}
            inputMode="numeric"
            value={draft.grace_days}
            onChange={(e) => setDraft({ ...draft, grace_days: e.target.value })}
          />
          <span className="mt-1 block text-[11px] text-ink-faint dark:text-slate-500">
            A renewal inside this window keeps the rolled-over tokens; nothing can be generated meanwhile.
          </span>
        </label>
        <label className="block">
          <span className="label">Period length (days)</span>
          <input
            className="field mt-1"
            type="number"
            min={1}
            max={366}
            inputMode="numeric"
            value={draft.period_days}
            onChange={(e) => setDraft({ ...draft, period_days: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        <Feedback error={error} notice={notice} />
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Save token plans
        </button>
      </div>
    </NeonCard>
  );
}

export default TokenPlansCard;
