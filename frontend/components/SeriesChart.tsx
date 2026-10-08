"use client";

import { useState } from "react";

export interface Point {
  day: string;
  value: number;
}

interface SeriesChartProps {
  points: Point[];
  /** Noun for the tooltip and summary, e.g. "files" or "sign-ups". */
  unit: string;
  /** What the headline number is: the sum over the period, or the latest value. */
  summary?: "total" | "peak";
  height?: number;
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One series per day as thin bars. Hovering (or tapping) a day shows its exact
 * value; the hit area is the whole column, wider than the bar itself.
 */
export function SeriesChart({ points, unit, summary = "total", height = 112 }: SeriesChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, ...points.map((p) => p.value));
  const headline =
    summary === "total" ? points.reduce((sum, p) => sum + p.value, 0) : Math.max(0, ...points.map((p) => p.value));
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <p className="mb-3 min-h-[1.25rem] text-xs text-ink-muted">
        {active ? (
          <>
            <span className="font-semibold tabular-nums text-black">{active.value}</span> {unit} on{" "}
            {dayLabel(active.day)}
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-black">{headline}</span>{" "}
            {summary === "total" ? `${unit} in ${points.length} days` : `${unit} on the busiest day`}
          </>
        )}
      </p>

      <div
        className="relative flex items-end gap-[2px] border-b border-black/10"
        style={{ height }}
        role="img"
        aria-label={`${unit} per day over ${points.length} days, ${headline} ${summary === "total" ? "in total" : "at peak"}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive guide at the halfway mark. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-black/[0.06]" />
        {points.map((point, index) => (
          <button
            type="button"
            key={point.day}
            className="relative flex h-full flex-1 items-end focus:outline-none"
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onClick={() => setHover(index)}
            aria-label={`${dayLabel(point.day)}: ${point.value} ${unit}`}
          >
            <span
              className={
                "block w-full rounded-t-[4px] transition-colors " +
                (hover === index ? "bg-meta-700" : point.value ? "bg-meta-500" : "bg-black/10")
              }
              style={{ height: point.value ? `${Math.max(3, (point.value / peak) * 100)}%` : "2px" }}
            />
          </button>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>{points[0] ? dayLabel(points[0].day) : ""}</span>
        <span>peak {peak === 1 && headline === 0 ? 0 : peak}</span>
        <span>today</span>
      </div>
    </div>
  );
}

export default SeriesChart;
