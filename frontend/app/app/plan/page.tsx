"use client";

import clsx from "clsx";
import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  Crown,
  FileStack,
  History,
  Layers3,
  LineChart,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import Header from "@/components/Header";
import NeonCard from "@/components/NeonCard";
import MonthlyBars from "@/components/plan/MonthlyBars";
import PasswordCard from "@/components/plan/PasswordCard";
import PlanOptions from "@/components/plan/PlanOptions";
import TrustPanel from "@/components/plan/TrustPanel";
import SeriesChart from "@/components/SeriesChart";
import StatTile from "@/components/StatTile";
import {
  fetchMe,
  fetchMyBatches,
  fetchSubscription,
  signOut,
  type BatchSummary,
  type Subscription,
  type UserProfile,
} from "@/lib/auth";
import { formatDate, formatMoney, timeAgo } from "@/lib/format";

const DAY_MS = 86_400_000;

function daysUntil(value: string): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / DAY_MS));
}

function presetName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A status line a client can trust at a glance: active, ending soon or expired. */
function planStatus(sub: Subscription): { text: string; tone: string } {
  if (sub.plan_expired) return { text: "Expired", tone: "border-red-300 bg-red-50 text-red-700" };
  if (sub.plan_expires_at) {
    const days = daysUntil(sub.plan_expires_at);
    if (days <= 7) {
      return { text: `Ends in ${days} day${days === 1 ? "" : "s"}`, tone: "border-amber-400/50 bg-amber-50 text-amber-700" };
    }
  }
  return { text: "Active", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" };
}

export default function PlanPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, subscription, history] = await Promise.all([
        fetchMe(),
        fetchSubscription(),
        fetchMyBatches(),
      ]);
      // Same recovery as the workspace: a cookie the API rejects is cleared first.
      if (!profile || !subscription) {
        await signOut().catch(() => undefined);
        window.location.assign("/");
        return;
      }
      setUser(profile);
      setSub(subscription);
      setBatches(history.slice(0, 8));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your plan.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const quota = sub?.monthly_quota ?? null;
  const ratio = sub && quota ? Math.min(1, sub.used_this_month / quota) : 0;
  const status = sub ? planStatus(sub) : null;
  const overPace = Boolean(sub && quota !== null && sub.projected_this_month > quota && !sub.plan_expired);
  const customLimit = Boolean(sub && sub.monthly_quota !== sub.plan.monthly_quota);

  return (
    <>
      <Header user={user} />

      <main className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <section className="mb-6 flex flex-col gap-1 sm:mb-8">
          <p className="label">My plan</p>
          <h1 className="font-display text-4xl font-normal leading-tight text-black sm:text-5xl">Plan & usage</h1>
          <p className="max-w-2xl text-sm text-ink-muted">
            Everything about your subscription in one place: what you pay, what you have used, and what
            is left until your allowance resets.
          </p>
        </section>

        {error ? (
          <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}

        {!sub ? (
          <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-black/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Plan hero ------------------------------------------------- */}
            <NeonCard glow padding="lg" radius="xl">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-meta-500/30 bg-gradient-to-br from-meta-50 to-meta-100 text-meta-600">
                      <Crown className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <p className="label">Current plan</p>
                      <p className="text-2xl font-bold tracking-tight text-black sm:text-3xl">{sub.plan.label}</p>
                    </div>
                    {status ? <span className={clsx("chip ml-auto lg:ml-2", status.tone)}>{status.text}</span> : null}
                  </div>

                  <p className="mt-5 text-3xl font-bold tracking-tight text-black">
                    {sub.plan.price ? formatMoney(sub.plan.price, sub.currency) : "Free"}
                    {sub.plan.price ? <span className="text-sm font-medium text-ink-subtle"> / month</span> : null}
                  </p>

                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Allowance resets
                      </dt>
                      <dd className="font-medium text-black">{formatDate(sub.resets_at)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Plan end date
                      </dt>
                      <dd className={clsx("font-medium", sub.plan_expired ? "text-red-700" : "text-black")}>
                        {sub.plan_expires_at ? formatDate(sub.plan_expires_at) : "No end date"}
                      </dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                        <UserRound className="h-3.5 w-3.5" aria-hidden /> Member since
                      </dt>
                      <dd className="font-medium text-black">{formatDate(sub.member_since)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Billing
                      </dt>
                      <dd className="font-medium text-black">Handled by our team</dd>
                    </div>
                  </dl>
                </div>

                {/* Usage gauge -------------------------------------------- */}
                <div className="rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white to-meta-50/60 p-5 sm:p-6">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="label">This month</p>
                      <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-black">
                        {sub.used_this_month}
                        <span className="text-lg font-semibold text-ink-faint">
                          {" "}
                          / {quota === null ? "∞" : quota.toLocaleString()}
                        </span>
                      </p>
                      <p className="text-xs text-ink-subtle">files processed</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold tabular-nums text-meta-600">
                        {sub.left_this_month === null ? "∞" : sub.left_this_month.toLocaleString()}
                      </p>
                      <p className="text-xs text-ink-subtle">left</p>
                    </div>
                  </div>

                  <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className={clsx(
                        "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                        quota === null
                          ? "from-meta-200 to-meta-300"
                          : ratio >= 1
                            ? "from-red-400 to-red-600"
                            : ratio >= 0.8
                              ? "from-amber-400 to-amber-500"
                              : "from-meta-400 to-meta-600",
                      )}
                      style={{
                        width: quota === null ? "100%" : `${Math.max(ratio * 100, sub.used_this_month ? 3 : 0)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
                    <span>{quota === null ? "Unlimited" : `${Math.round(ratio * 100)}% used`}</span>
                    <span>
                      {daysUntil(sub.resets_at)} day{daysUntil(sub.resets_at) === 1 ? "" : "s"} until reset
                    </span>
                  </div>

                  <p
                    className={clsx(
                      "mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed",
                      overPace ? "bg-amber-50 text-amber-800" : "bg-white/80 text-ink-muted",
                    )}
                  >
                    <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {sub.used_this_month === 0
                      ? "Nothing processed yet this month."
                      : overPace
                        ? `At this pace you will need about ${sub.projected_this_month} files this month, more than your plan includes. A bigger plan keeps you running.`
                        : `At this pace you will use about ${sub.projected_this_month} files this month.`}
                  </p>
                  {customLimit ? (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      Your account has a custom limit set by our team.
                    </p>
                  ) : null}
                </div>
              </div>
            </NeonCard>

            {/* Totals ---------------------------------------------------- */}
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatTile
                icon={FileStack}
                label="All-time files"
                value={sub.files_total.toLocaleString()}
                hint={`since ${formatDate(sub.member_since)}`}
              />
              <StatTile
                icon={Layers3}
                label="Batches run"
                value={sub.batches_total.toLocaleString()}
                hint={
                  sub.batches_total
                    ? `${(sub.files_total / sub.batches_total).toFixed(1)} files per batch`
                    : "none yet"
                }
                tone="slow"
                accent="text-meta-600"
              />
              <StatTile
                icon={Sparkles}
                label="Favourite preset"
                value={sub.favourite_preset ? presetName(sub.favourite_preset) : "—"}
                hint="most used"
                accent="text-meta-600"
              />
              <StatTile
                icon={ShieldCheck}
                label="Auto-delete"
                value={`${sub.retention_hours} h`}
                hint="files never kept longer"
                tone="success"
                accent="text-meta-600"
              />
            </section>

            {/* Analytics ------------------------------------------------- */}
            <section className="grid gap-6 lg:grid-cols-2">
              <NeonCard padding="lg" radius="xl">
                <div className="mb-4 flex items-center gap-2">
                  <LineChart className="h-4 w-4 text-meta-500" aria-hidden />
                  <h2 className="text-sm font-semibold tracking-tight text-black">Files per day</h2>
                  <span className="chip ml-auto !text-[10px]">last 30 days</span>
                </div>
                <SeriesChart points={sub.daily} unit="files" height={140} />
              </NeonCard>

              <NeonCard tone="slow" padding="lg" radius="xl">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-meta-600" aria-hidden />
                  <h2 className="text-sm font-semibold tracking-tight text-black">Monthly usage</h2>
                  <span className="chip ml-auto !text-[10px]">
                    {quota === null ? "6 months" : `line = ${quota} limit`}
                  </span>
                </div>
                <MonthlyBars months={sub.monthly} quota={quota} />
              </NeonCard>
            </section>

            {/* Plans ----------------------------------------------------- */}
            <section>
              <div className="mb-4 flex items-center gap-2">
                <Crown className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">Plans</h2>
              </div>
              <PlanOptions
                plans={sub.plans}
                currentId={sub.plan.id}
                expired={sub.plan_expired}
                currency={sub.currency}
                pending={sub.pending_request}
                onRequested={(request) => setSub({ ...sub, pending_request: request })}
              />
            </section>

            {/* Trust, account and history ----------------------------------- */}
            <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-6">
                <NeonCard padding="lg" radius="xl">
                  <div className="mb-5 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-meta-500" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">How we look after your work</h2>
                  </div>
                  <TrustPanel retentionHours={sub.retention_hours} />
                </NeonCard>

                <NeonCard padding="lg" radius="xl">
                  <div className="mb-4 flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-meta-500" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">Account</h2>
                  </div>
                  <p className="mb-4 truncate text-sm text-ink-muted">
                    Signed in as <span className="font-medium text-black">{user?.email}</span>
                  </p>
                  <PasswordCard />
                </NeonCard>
              </div>

              <NeonCard tone="slow" padding="lg" radius="xl">
                <div className="mb-4 flex items-center gap-2">
                  <History className="h-4 w-4 text-meta-600" aria-hidden />
                  <h2 className="text-sm font-semibold tracking-tight text-black">Recent batches</h2>
                </div>
                {batches.length === 0 ? (
                  <p className="py-4 text-center text-xs text-ink-faint">
                    No batches yet.{" "}
                    <Link href="/app" className="font-medium text-meta-600 hover:underline">
                      Start one in the workspace
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-y divide-black/[0.06]">
                    {batches.map((batch) => (
                      <li key={batch.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium text-black">
                            {batch.asset_count} file{batch.asset_count === 1 ? "" : "s"}
                          </span>
                          <span className="text-ink-subtle"> · {presetName(batch.preset)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-faint">{timeAgo(batch.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </NeonCard>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
