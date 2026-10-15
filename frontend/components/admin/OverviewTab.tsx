"use client";

import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Cpu,
  DollarSign,
  Files,
  Gauge,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import ActivityFeed from "@/components/admin/ActivityFeed";
import SeriesChart from "@/components/SeriesChart";
import NeonCard from "@/components/NeonCard";
import StatTile from "@/components/StatTile";
import { getActivity, type ActivityEvent, type Overview } from "@/lib/admin";
import { getHealth } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { HealthReport } from "@/lib/types";

const FEED_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "signup", label: "Sign-ups" },
  { id: "plan_request", label: "Plan requests" },
  { id: "batch", label: "Batches" },
  { id: "blocked", label: "Blocked" },
  { id: "login", label: "Logins" },
  { id: "admin", label: "Admin" },
];

interface OverviewTabProps {
  overview: Overview | null;
  refreshKey: number;
  onSelectUser: (id: number) => void;
  onOpenAnalytics: () => void;
}

export function OverviewTab({ overview, refreshKey, onSelectUser, onOpenAnalytics }: OverviewTabProps) {
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [kind, setKind] = useState("");
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getActivity(60, kind)
      .then((events) => {
        if (!cancelled) setFeed(events);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, refreshKey]);

  useEffect(() => {
    getHealth()
      .then((report) => {
        setHealth(report);
        setHealthError(false);
      })
      .catch(() => setHealthError(true));
  }, [refreshKey]);

  const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const attention = overview
    ? [
        {
          icon: AlertTriangle,
          text: people(overview.hit_limit_this_month, "user hit their limit", "users hit their limit") + " this month",
          hint: "Good upgrade candidates",
          tone: "text-red-600 bg-red-50",
        },
        {
          icon: Gauge,
          text:
            people(overview.near_limit, "user has", "users have") + " used 80% or more of their limit",
          hint: "May need a bigger plan soon",
          tone: "text-amber-700 bg-amber-50",
        },
        {
          icon: CalendarClock,
          text: people(overview.expiring_soon, "plan ends", "plans end") + " in the next 7 days",
          hint: "Remind them to renew",
          tone: "text-meta-700 bg-meta-50",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          icon={DollarSign}
          label="Monthly revenue"
          value={overview ? formatMoney(overview.mrr, overview.currency) : "—"}
          hint={overview ? `${overview.paying_users} paying users` : "loading"}
          tone="success"
        />
        <StatTile
          icon={Users}
          label="Users"
          value={overview ? String(overview.total_users) : "—"}
          hint={overview ? `${overview.signups_7d} new this week` : "loading"}
        />
        <StatTile
          icon={Activity}
          label="Active, 7 days"
          value={overview ? String(overview.active_7d) : "—"}
          hint={overview ? `${overview.suspended_users} suspended` : "loading"}
          tone="slow"
        />
        <StatTile
          icon={Files}
          label="Files this month"
          value={overview ? String(overview.files_this_month) : "—"}
          hint={overview ? `${overview.batches_today} batches today` : "loading"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <NeonCard padding="lg" radius="xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-black">Needs your attention</h2>
              <button type="button" className="text-xs font-semibold text-meta-600 hover:underline" onClick={onOpenAnalytics}>
                See who
              </button>
            </div>
            <ul className="space-y-2">
              {attention.map((item) => (
                <li key={item.text} className="flex items-center gap-3 rounded-xl border border-black/[0.06] p-3">
                  <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", item.tone)}>
                    <item.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-black">{item.text}</p>
                    <p className="text-xs text-ink-faint">{item.hint}</p>
                  </div>
                </li>
              ))}
            </ul>
          </NeonCard>

          <NeonCard padding="lg" radius="xl" tone="slow">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-meta-500" aria-hidden />
              <h2 className="text-sm font-semibold tracking-tight text-black">Files processed per day</h2>
            </div>
            {overview ? (
              <SeriesChart points={overview.daily.map((d) => ({ day: d.day, value: d.files }))} unit="files" />
            ) : (
              <div className="h-36" />
            )}
          </NeonCard>

          <NeonCard padding="lg" radius="xl" tone={healthError || health?.status === "degraded" ? "danger" : "muted"}>
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-meta-500" aria-hidden />
              <h2 className="text-sm font-semibold tracking-tight text-black">System</h2>
              <span
                className={clsx(
                  "chip ml-auto",
                  healthError
                    ? "!border-red-300 !bg-red-50 !text-red-700"
                    : health?.status === "ok"
                      ? "!border-emerald-300 !bg-emerald-50 !text-emerald-700"
                      : "!border-amber-300 !bg-amber-50 !text-amber-700",
                )}
              >
                {healthError ? "Offline" : health ? (health.status === "ok" ? "Healthy" : "Degraded") : "Checking"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              {[
                ["Jobs running", health ? String(health.active_jobs) : "—"],
                ["Waiting in queue", health ? String(health.queue_depth) : "—"],
                ["Video engine", health ? (health.ffmpeg ? "Ready" : "Missing") : "—"],
                ["Job queue", health ? (health.redis ? "Connected" : health.worker_mode) : "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-faint">{label}</dt>
                  <dd className="font-medium text-black">{value}</dd>
                </div>
              ))}
            </dl>
          </NeonCard>
        </div>

        <NeonCard padding="lg" radius="xl">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-meta-500" aria-hidden />
            <h2 className="text-sm font-semibold tracking-tight text-black">Live activity</h2>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
            {FEED_FILTERS.map((filter) => (
              <button
                key={filter.id || "all"}
                type="button"
                onClick={() => setKind(filter.id)}
                className={clsx(
                  "chip transition-colors",
                  kind === filter.id && "!border-meta-500/50 !bg-meta-50 !text-meta-700",
                )}
                aria-pressed={kind === filter.id}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="max-h-[640px] overflow-y-auto pr-1">
            <ActivityFeed events={feed} onSelectUser={onSelectUser} />
          </div>
        </NeonCard>
      </section>
    </div>
  );
}

export default OverviewTab;
