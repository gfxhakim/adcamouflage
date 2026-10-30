import clsx from "clsx";
import { BadgeCheck, CalendarClock, CalendarDays, Crown, TrendingUp, UserRound } from "lucide-react";

import NeonCard from "@/components/NeonCard";
import type { Subscription } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

const DAY_MS = 86_400_000;

function daysUntil(value: string): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / DAY_MS));
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

/**
 * The plan card for accounts that predate token billing: a monthly file
 * quota, handled by our team, that keeps running until its end date.
 */
export function LegacyHero({ sub }: { sub: Subscription }) {
  const quota = sub.monthly_quota;
  const ratio = quota ? Math.min(1, sub.used_this_month / quota) : 0;
  const status = planStatus(sub);
  const overPace = quota !== null && sub.projected_this_month > quota && !sub.plan_expired;
  const customLimit = sub.monthly_quota !== sub.plan.monthly_quota;

  return (
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
            <span className={clsx("chip ml-auto lg:ml-2", status.tone)}>{status.text}</span>
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

        {/* Usage gauge -------------------------------------------------- */}
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
                ? `At this pace you will need about ${sub.projected_this_month} files this month, more than your plan includes. A token plan below keeps you running.`
                : `At this pace you will use about ${sub.projected_this_month} files this month.`}
          </p>
          {customLimit ? (
            <p className="mt-2 text-[11px] text-ink-faint">Your account has a custom limit set by our team.</p>
          ) : null}
        </div>
      </div>
    </NeonCard>
  );
}

export default LegacyHero;
