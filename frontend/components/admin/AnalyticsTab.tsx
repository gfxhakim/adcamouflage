"use client";

import clsx from "clsx";
import { Activity, BadgeDollarSign, Loader2, Percent, TrendingUp, Users, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import SeriesChart from "@/components/SeriesChart";
import UsageMeter from "@/components/UsageMeter";
import NeonCard from "@/components/NeonCard";
import StatTile from "@/components/StatTile";
import { getAnalytics, type Analytics, type UserExpiry, type UserUsage } from "@/lib/admin";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";

const PERIODS = [7, 30, 90];

interface AnalyticsTabProps {
  refreshKey: number;
  onSelectUser: (id: number) => void;
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <NeonCard padding="lg" radius="xl" tone="muted">
      <h3 className="text-sm font-semibold tracking-tight text-black">{title}</h3>
      {hint ? <p className="mb-3 mt-0.5 text-xs text-ink-faint">{hint}</p> : <div className="mb-3" />}
      {children}
    </NeonCard>
  );
}

function UsageList({ users, empty, onSelectUser }: { users: UserUsage[]; empty: string; onSelectUser: (id: number) => void }) {
  if (users.length === 0) return <p className="py-3 text-xs text-ink-faint">{empty}</p>;
  return (
    <ul className="divide-y divide-black/[0.06]">
      {users.map((user) => (
        <li key={user.id}>
          <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-meta-50/50" onClick={() => onSelectUser(user.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-black">{user.email}</span>
              <span className="text-[11px] text-ink-faint">{user.plan_label}</span>
            </span>
            <UsageMeter className="w-28 shrink-0" used={user.used} quota={user.monthly_quota} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ExpiryList({ users, empty, onSelectUser }: { users: UserExpiry[]; empty: string; onSelectUser: (id: number) => void }) {
  if (users.length === 0) return <p className="py-3 text-xs text-ink-faint">{empty}</p>;
  return (
    <ul className="divide-y divide-black/[0.06]">
      {users.map((user) => (
        <li key={user.id}>
          <button type="button" className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-meta-50/50" onClick={() => onSelectUser(user.id)}>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-black">{user.email}</span>
              <span className="text-[11px] text-ink-faint">{user.plan_label}</span>
            </span>
            <span className="shrink-0 text-xs text-ink-muted">{formatDate(user.plan_expires_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsTab({ refreshKey, onSelectUser }: AnalyticsTabProps) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAnalytics(days)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load analytics.");
      });
    return () => {
      cancelled = true;
    };
  }, [days, refreshKey]);

  if (!data) {
    return (
      <div className="grid place-items-center py-24 text-ink-faint">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
      </div>
    );
  }

  const money = (amount: number) => formatMoney(amount, data.currency);
  const maxRevenue = Math.max(1, ...data.revenue_by_plan.map((p) => p.revenue));
  const presetEntries = Object.entries(data.presets);
  const presetTotal = presetEntries.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          Revenue is worked out from each live account&apos;s plan price. Change prices in Settings.
        </p>
        <div className="flex gap-1 rounded-xl border border-black/10 bg-white p-1" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => setDays(period)}
              aria-pressed={days === period}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                days === period ? "bg-meta-500 text-white" : "text-ink-muted hover:bg-meta-50",
              )}
            >
              {period} days
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile icon={Wallet} label="Monthly revenue" value={money(data.mrr)} hint={`${money(data.arr)} a year`} tone="success" />
        <StatTile icon={BadgeDollarSign} label="Paying users" value={String(data.paying_users)} hint={`${money(data.arpu)} average each`} />
        <StatTile icon={Percent} label="Paid share" value={formatPercent(data.paid_share)} hint="of live accounts pay" tone="slow" />
        <StatTile icon={Users} label="Active users" value={String(data.mau)} hint={`${data.dau} today · ${data.wau} this week`} />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Panel title="New sign-ups">
          <SeriesChart points={data.signups} unit="sign-ups" />
        </Panel>
        <Panel title="Active users per day" hint="Signed in, signed up or ran a batch">
          <SeriesChart points={data.active} unit="active users" summary="peak" />
        </Panel>
        <Panel title="Files processed">
          <SeriesChart points={data.files} unit="files" />
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Revenue by plan" hint="Live accounts only: suspended and expired ones are left out">
          <ul className="space-y-3">
            {data.revenue_by_plan.map((plan) => (
              <li key={plan.id}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-semibold text-black">
                    {plan.label}{" "}
                    <span className="font-normal text-ink-faint">
                      · {plan.users} {plan.users === 1 ? "user" : "users"} at {money(plan.price)}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-black">{money(plan.revenue)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/[0.05]">
                  <div
                    className="h-full rounded-full bg-meta-500"
                    style={{ width: plan.revenue ? `${Math.max(3, (plan.revenue / maxRevenue) * 100)}%` : 0 }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="This month's usage" hint={`${data.files_this_month} files in ${data.batches_this_month} batches · ${data.avg_files_per_batch} files per batch`}>
          {presetEntries.length === 0 ? (
            <p className="py-3 text-xs text-ink-faint">No batches yet this month.</p>
          ) : (
            <ul className="space-y-2">
              {presetEntries.map(([preset, count]) => (
                <li key={preset} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 capitalize text-black">{preset}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                    <div className="h-full rounded-full bg-meta-500" style={{ width: `${(count / presetTotal) * 100}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">
                    {count} · {formatPercent(count / presetTotal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel title="Hit their limit this month" hint="They tried to upload more than their plan allows: offer an upgrade">
          <UsageList users={data.hit_limit} empty="Nobody has been blocked this month." onSelectUser={onSelectUser} />
        </Panel>
        <Panel title="Close to their limit" hint="80% or more of this month's allowance used">
          <UsageList users={data.near_limit} empty="Nobody is close to their limit." onSelectUser={onSelectUser} />
        </Panel>
        <Panel title="Plans ending in 7 days" hint="Remind them to renew, then use Extend on their profile">
          <ExpiryList users={data.expiring_soon} empty="No plans end this week." onSelectUser={onSelectUser} />
        </Panel>
        <Panel title="Expired plans" hint="These users cannot start new batches">
          <ExpiryList users={data.expired} empty="No expired plans." onSelectUser={onSelectUser} />
        </Panel>
      </section>

      <Panel title="Top users this month" hint="By files processed">
        <UsageList users={data.top_users} empty="No usage yet this month." onSelectUser={onSelectUser} />
      </Panel>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
        Active users counts people seen in the last 1, 7 and 30 days.
        <Activity className="ml-2 h-3.5 w-3.5" aria-hidden />
        {data.total_users} accounts in total.
      </p>
    </div>
  );
}

export default AnalyticsTab;
