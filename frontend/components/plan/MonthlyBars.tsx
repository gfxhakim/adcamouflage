import clsx from "clsx";

interface MonthlyBarsProps {
  months: { month: string; files: number; batches: number }[];
  /** The account's monthly limit, drawn as a marker on each bar; null for unlimited. */
  quota: number | null;
}

function monthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

/** One row per month: files processed against the monthly limit. */
export function MonthlyBars({ months, quota }: MonthlyBarsProps) {
  // Headroom past the limit keeps its marker off the very end of the track.
  const scale = Math.max(1, quota ?? 0, ...months.map((m) => m.files)) * 1.1;

  return (
    <ul className="space-y-3">
      {months.map((month, index) => {
        const current = index === months.length - 1;
        const over = quota !== null && month.files >= quota && quota > 0;
        return (
          <li key={month.month} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
            <span className={clsx("text-xs", current ? "font-semibold text-black" : "text-ink-muted")}>
              {monthLabel(month.month)}
            </span>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-black/[0.05]">
              <div
                className={clsx(
                  "h-full rounded-full transition-all",
                  over ? "bg-amber-500" : current ? "bg-meta-500" : "bg-meta-300",
                )}
                style={{ width: `${month.files ? Math.max(3, (month.files / scale) * 100) : 0}%` }}
              />
              {quota !== null && quota > 0 ? (
                <span
                  className="absolute inset-y-0 w-px bg-black/30"
                  style={{ left: `${Math.min(100, (quota / scale) * 100)}%` }}
                  aria-hidden
                />
              ) : null}
            </div>
            <span className="text-right text-xs tabular-nums text-ink-muted">
              <span className="font-semibold text-black">{month.files}</span> files
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default MonthlyBars;
