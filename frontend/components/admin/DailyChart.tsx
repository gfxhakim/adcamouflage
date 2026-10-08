import type { Overview } from "@/lib/admin";

/** Files processed per day for the last two weeks, as simple bars. */
export function DailyChart({ daily }: { daily: Overview["daily"] }) {
  const peak = Math.max(1, ...daily.map((d) => d.files));
  const total = daily.reduce((sum, d) => sum + d.files, 0);

  return (
    <div>
      <p className="mb-3 text-xs text-ink-muted">
        <span className="font-semibold text-black tabular-nums">{total}</span> files in the last{" "}
        {daily.length} days
      </p>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={`Files processed per day, peak ${peak}`}>
        {daily.map((d) => {
          const label = new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          return (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t-[3px] bg-meta-500/80 transition-colors group-hover:bg-meta-600"
                style={{ height: `${d.files ? Math.max(4, (d.files / peak) * 100) : 1.5}%` }}
                title={`${label}: ${d.files} files, ${d.batches} batches`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>
          {daily[0]
            ? new Date(`${daily[0].day}T00:00:00Z`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            : ""}
        </span>
        <span>today</span>
      </div>
    </div>
  );
}

export default DailyChart;
