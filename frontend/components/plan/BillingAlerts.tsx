import clsx from "clsx";
import { AlertTriangle, ArrowRight, Info, OctagonAlert } from "lucide-react";
import Link from "next/link";

import type { AlertLevel, BillingAlert } from "@/lib/auth";

interface BillingAlertsProps {
  alerts: BillingAlert[];
  /** Leave out levels the surface already covers (the workspace paywall shows the danger ones). */
  levels?: AlertLevel[];
  /** Add a "Plan & tokens" link on each line, for surfaces other than /app/plan. */
  linkToPlan?: boolean;
  className?: string;
}

const TONE: Record<AlertLevel, { icon: typeof Info; box: string; icon_tone: string }> = {
  info: {
    icon: Info,
    box: "border-meta-500/30 bg-meta-50 text-meta-900 dark:bg-meta-500/10 dark:text-meta-100",
    icon_tone: "text-meta-600 dark:text-meta-300",
  },
  warning: {
    icon: AlertTriangle,
    box: "border-amber-400/50 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
    icon_tone: "text-amber-600 dark:text-amber-300",
  },
  danger: {
    icon: OctagonAlert,
    box: "border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200",
    icon_tone: "text-red-600 dark:text-red-300",
  },
};

/** The billing reminders the API sends (period ending, low tokens, cancelled, ended). */
export function BillingAlerts({ alerts, levels, linkToPlan = false, className }: BillingAlertsProps) {
  const shown = levels ? alerts.filter((alert) => levels.includes(alert.level)) : alerts;
  if (shown.length === 0) return null;

  return (
    <ul className={clsx("space-y-2", className)} aria-label="Billing notices">
      {shown.map((alert) => {
        const tone = TONE[alert.level] ?? TONE.info;
        const Icon = tone.icon;
        return (
          <li
            key={alert.code}
            role={alert.level === "danger" ? "alert" : "status"}
            className={clsx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed", tone.box)}
          >
            <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", tone.icon_tone)} aria-hidden />
            <span className="min-w-0 flex-1">{alert.text}</span>
            {linkToPlan ? (
              <Link href="/app/plan" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline">
                Plan &amp; tokens <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default BillingAlerts;
