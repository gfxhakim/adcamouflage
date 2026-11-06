"use client";

import clsx from "clsx";
import { BadgeCheck, Loader2, ShoppingCart, UserPlus, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import NeonCard from "@/components/NeonCard";
import SeriesChart from "@/components/SeriesChart";
import StatTile from "@/components/StatTile";
import { getSales, type Sales, type SalesTotals } from "@/lib/admin";
import { formatMoney, formatPercent } from "@/lib/format";

interface SalesTabProps {
  refreshKey: number;
  onSelectUser: (id: number) => void;
}

type PresetId = "today" | "7" | "30" | "90" | "month" | "custom";

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

type MetricId = "revenue" | "approved" | "checkouts" | "signups";

const METRICS: { id: MetricId; label: string; unit: string }[] = [
  { id: "revenue", label: "Revenue", unit: "revenue" },
  { id: "approved", label: "Approved payments", unit: "approved payments" },
  { id: "checkouts", label: "Checkouts", unit: "checkouts started" },
  { id: "signups", label: "Sign-ups", unit: "sign-ups" },
];

/** YYYY-MM-DD for a UTC day, which is how the API buckets days. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function presetRange(id: PresetId): { start: string; end: string } | null {
  const today = utcToday();
  const back = (n: number) => iso(new Date(today.getTime() - n * 86400000));
  switch (id) {
    case "today":
      return { start: iso(today), end: iso(today) };
    case "7":
      return { start: back(6), end: iso(today) };
    case "30":
      return { start: back(29), end: iso(today) };
    case "90":
      return { start: back(89), end: iso(today) };
    case "month":
      return { start: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), end: iso(today) };
    default:
      return null;
  }
}

function rangeLabel(start: string, end: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

function change(now: number, before: number): string {
  if (!before) return now ? "new this period" : "no change";
  const pct = ((now - before) / before) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${Math.round(pct)}% vs previous period`;
}

function Panel({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-black dark:text-slate-100">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </NeonCard>
  );
}

function Funnel({ totals }: { totals: SalesTotals }) {
  const steps = [
    { label: "Sign-ups", value: totals.signups },
    { label: "Checkouts started", value: totals.checkouts },
    { label: "Approved payments", value: totals.approved },
  ];
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ul className="space-y-3">
      {steps.map((step) => (
        <li key={step.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="font-semibold text-black dark:text-slate-100">{step.label}</span>
            <span className="font-semibold tabular-nums text-black dark:text-slate-100">{step.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/10">
            <div
              className="h-full rounded-full bg-meta-500"
              style={{ width: step.value ? `${Math.max(3, (step.value / top) * 100)}%` : 0 }}
            />
          </div>
        </li>
      ))}
      <li className="pt-1 text-xs text-ink-muted dark:text-slate-300">
        <span className="font-semibold text-black dark:text-slate-100">{formatPercent(totals.conversion)}</span> of checkouts
        were paid · {totals.subscriptions} {totals.subscriptions === 1 ? "subscription" : "subscriptions"} ·{" "}
        {totals.topups} {totals.topups === 1 ? "top-up" : "top-ups"}
      </li>
    </ul>
  );
}

export function SalesTab({ refreshKey, onSelectUser }: SalesTabProps) {
  const [preset, setPreset] = useState<PresetId>("30");
  const [range, setRange] = useState(() => presetRange("30")!);
  const [metric, setMetric] = useState<MetricId>("revenue");
  const [data, setData] = useState<Sales | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!range.start || !range.end) return;
    let cancelled = false;
    setLoading(true);
    getSales(range.start, range.end)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sales.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, refreshKey]);

  const pickPreset = (id: PresetId) => {
    setPreset(id);
    const next = presetRange(id);
    if (next) setRange(next);
  };

  const money = useMemo(() => (amount: number) => formatMoney(amount, data?.currency ?? "USD"), [data?.currency]);
  const today = iso(utcToday());

  const controls = (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-xs text-ink-muted dark:text-slate-300">
        {data ? rangeLabel(data.start, data.end) : "Loading…"} · days are UTC
        {loading && data ? <Loader2 className="ml-2 inline h-3 w-3 animate-spin" aria-hidden /> : null}
      </p>
      <div className="flex flex-col gap-2 sm:items-end">
        <div
          className="-mx-1 flex gap-1 overflow-x-auto rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-slate-900"
          role="group"
          aria-label="Date range"
        >
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pickPreset(item.id)}
              aria-pressed={preset === item.id}
              className={clsx(
                "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                preset === item.id
                  ? "bg-meta-500 text-white"
                  : "text-ink-muted hover:bg-meta-50 dark:text-slate-300 dark:hover:bg-meta-500/10",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted dark:text-slate-300">
            <label className="flex items-center gap-1.5">
              From
              <input
                type="date"
                value={range.start}
                max={range.end || today}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, start: e.target.value }))}
                className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-black dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex items-center gap-1.5">
              To
              <input
                type="date"
                value={range.end}
                min={range.start}
                max={today}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, end: e.target.value }))}
                className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-black dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {controls}
        <div className="grid place-items-center py-24 text-ink-faint dark:text-slate-500">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        </div>
      </div>
    );
  }

  const { totals, previous } = data;
  const active = METRICS.find((m) => m.id === metric)!;
  const maxPlan = Math.max(1, ...data.by_plan.map((p) => p.revenue));

  return (
    <div className="space-y-6">
      {controls}
      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile icon={UserPlus} label="Sign-ups" value={String(totals.signups)} hint={change(totals.signups, previous.signups)} />
        <StatTile icon={ShoppingCart} label="Checkouts" value={String(totals.checkouts)} hint={change(totals.checkouts, previous.checkouts)} tone="slow" />
        <StatTile icon={BadgeCheck} label="Approved payments" value={String(totals.approved)} hint={change(totals.approved, previous.approved)} />
        <StatTile
          icon={Wallet}
          label="Revenue"
          value={money(totals.revenue)}
          hint={`${change(totals.revenue, previous.revenue)} · ${money(totals.average_order)} avg`}
          tone="success"
        />
      </section>

      <Panel
        title="Daily"
        hint="Hover or tap a day for its number"
        action={
          <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto" role="group" aria-label="Chart">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                aria-pressed={metric === m.id}
                className={clsx(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                  metric === m.id
                    ? "border-meta-500 bg-meta-500 text-white"
                    : "border-black/10 text-ink-muted hover:bg-meta-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-meta-500/10",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <SeriesChart
          key={metric}
          points={data[metric]}
          unit={active.unit}
          height={160}
          format={metric === "revenue" ? money : undefined}
        />
      </Panel>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Funnel" hint="Everything that happened in the range">
          <Funnel totals={totals} />
        </Panel>
        <Panel title="Revenue by plan" hint="Approved payments only. Free admin grants are left out.">
          {data.by_plan.length === 0 ? (
            <p className="py-3 text-xs text-ink-faint dark:text-slate-500">No approved payments in this range.</p>
          ) : (
            <ul className="space-y-3">
              {data.by_plan.map((plan) => (
                <li key={plan.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-semibold text-black dark:text-slate-100">
                      {plan.label}{" "}
                      <span className="font-normal text-ink-faint dark:text-slate-500">
                        · {plan.approved} {plan.approved === 1 ? "payment" : "payments"}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-black dark:text-slate-100">{money(plan.revenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-meta-500"
                      style={{ width: plan.revenue ? `${Math.max(3, (plan.revenue / maxPlan) * 100)}%` : 0 }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel title="Latest approved payments" hint="Newest first, up to 25. Tap one to open the customer.">
        {data.recent.length === 0 ? (
          <p className="py-3 text-xs text-ink-faint dark:text-slate-500">No approved payments in this range.</p>
        ) : (
          <ul className="divide-y divide-black/[0.06] dark:divide-white/10">
            {data.recent.map((sale) => (
              <li key={sale.id}>
                <button
                  type="button"
                  onClick={() => onSelectUser(sale.user_id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-meta-50/50 dark:hover:bg-meta-500/10"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-black dark:text-slate-100">{sale.email}</span>
                    <span className="block truncate text-[11px] text-ink-faint dark:text-slate-500">
                      {sale.plan_label}
                      {sale.provider ? ` · ${sale.provider}` : ""} ·{" "}
                      {new Date(sale.paid_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-black dark:text-slate-100">{money(sale.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default SalesTab;
