import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

import NeonCard, { type NeonTone } from "./NeonCard";

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: NeonTone;
  accent?: string;
}

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  accent = "text-meta-500",
}: StatTileProps) {
  return (
    <NeonCard tone={tone} interactive padding="none" radius="lg">
      <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:gap-4 sm:p-5">
        <span
          className={clsx(
            "grid h-9 w-9 shrink-0 sm:h-11 sm:w-11 place-items-center rounded-xl border border-black/10 bg-meta-50",
            accent,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="label">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold sm:text-2xl tracking-tight text-black">
            {value}
          </p>
          {hint ? <p className="mt-0.5 truncate text-xs text-ink-subtle">{hint}</p> : null}
        </div>
      </div>
    </NeonCard>
  );
}

export default StatTile;
