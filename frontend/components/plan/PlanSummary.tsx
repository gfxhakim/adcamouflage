import clsx from "clsx";
import { ArrowRight, CalendarClock, Crown } from "lucide-react";
import Link from "next/link";

import NeonCard from "@/components/NeonCard";
import UsageMeter from "@/components/UsageMeter";
import type { UserProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";

function nextReset(): string {
  const now = new Date();
  return formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString());
}

/** The workspace's one-glance plan readout, linking to the full plan page. */
export function PlanSummary({ user }: { user: UserProfile }) {
  const quota = user.monthly_quota;
  const left = quota === null ? null : Math.max(0, quota - user.used_this_month);
  const low = user.plan_expired || (quota !== null && left !== null && left <= Math.max(1, quota * 0.2));

  return (
    <NeonCard tone={low ? "danger" : "slow"} padding="md" radius="lg" className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-meta-500/30 bg-meta-50 text-meta-600">
            <Crown className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="label">Your plan</p>
            <p className="text-base font-semibold tracking-tight text-black">
              {user.plan_label}
              {user.plan_expired ? <span className="ml-2 text-xs font-medium text-red-700">expired</span> : null}
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1 sm:max-w-sm">
          <UsageMeter used={user.used_this_month} quota={quota} />
          <p className={clsx("mt-1 flex items-center gap-1.5 text-[11px]", low ? "text-red-700" : "text-ink-subtle")}>
            <CalendarClock className="h-3 w-3" aria-hidden />
            {user.plan_expired
              ? "Renew your plan to keep processing files."
              : left === null
                ? `Unlimited files · counter resets ${nextReset()}`
                : `${left} files left · resets ${nextReset()}`}
          </p>
        </div>

        <Link href="/app/plan" className="btn-ghost shrink-0 !text-xs">
          Plan & usage <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </NeonCard>
  );
}

export default PlanSummary;
