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
      <div className="flex items-start gap-4 p-5">
        <span
          className={clsx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-black/10 bg-meta-50",
            accent,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="label">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-black">
            {value}
          </p>
          {hint ? <p className="mt-0.5 truncate text-xs text-black0">{hint}</p> : null}
        </div>
      </div>
    </NeonCard>
  );
}

export default StatTile;
