import clsx from "clsx";

import { usageText } from "@/lib/format";

interface UsageMeterProps {
  used: number;
  quota: number | null;
  /** Show the "7 / 10" readout above the bar. */
  showLabel?: boolean;
  className?: string;
}

/** A slim bar of this month's usage against the plan's monthly limit. */
export function UsageMeter({ used, quota, showLabel = true, className }: UsageMeterProps) {
  const ratio = quota === null ? 0 : quota === 0 ? 1 : Math.min(1, used / quota);
  const tone = ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-meta-500";

  return (
    <div className={clsx("min-w-0", className)}>
      {showLabel ? (
        <p className="mb-1 text-xs font-medium tabular-nums text-black">
          {usageText(used, quota)}
          <span className="ml-1 font-normal text-ink-faint">this month</span>
        </p>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className={clsx("h-full rounded-full transition-all", quota === null ? "bg-meta-200" : tone)}
          style={{ width: quota === null ? "100%" : `${Math.max(ratio * 100, used > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export default UsageMeter;
