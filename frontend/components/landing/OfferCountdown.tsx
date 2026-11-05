"use client";

import { Flame } from "lucide-react";
import { useEffect, useState } from "react";

import { T } from "@/components/cms/Cms";

/**
 * Milliseconds left until ``endsAt``, ticking every second. ``null`` until the
 * page has mounted (the server and the browser would print different
 * seconds), 0 once the offer has ended.
 */
export function useTimeLeft(endsAt: string | null | undefined): number | null {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(end)) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [end]);

  return left;
}

const UNITS = [
  { key: "days", label: "Days", ms: 86_400_000 },
  { key: "hours", label: "Hours", ms: 3_600_000 },
  { key: "minutes", label: "Minutes", ms: 60_000 },
  { key: "seconds", label: "Seconds", ms: 1000 },
] as const;

function split(ms: number): Record<(typeof UNITS)[number]["key"], number> {
  let rest = Math.floor(ms / 1000) * 1000;
  const parts = {} as Record<(typeof UNITS)[number]["key"], number>;
  for (const unit of UNITS) {
    parts[unit.key] = Math.floor(rest / unit.ms);
    rest -= parts[unit.key] * unit.ms;
  }
  return parts;
}

interface OfferCountdownProps {
  /** Milliseconds left; null before the page has mounted. */
  left: number | null;
  /** The biggest saving across the plans, in percent (0 hides the line). */
  savePercent: number;
}

/**
 * The shining bar above the pricing cards: "Limited-time launch price" and a
 * Days : Hours : Minutes : Seconds countdown to the real end of the offer.
 * No date is printed, only the time left.
 */
export function OfferCountdown({ left, savePercent }: OfferCountdownProps) {
  const parts = left === null ? null : split(left);

  return (
    <div className="offer-glow relative mx-auto mt-10 max-w-4xl rounded-3xl p-px" role="timer" aria-live="off">
      <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-gradient-to-br from-meta-900/80 via-black to-meta-900/80 px-4 py-4 sm:px-6 sm:py-5">
        {/* The sweeping shine. */}
        <span className="offer-shine pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" aria-hidden />

        <div className="relative flex flex-col items-center gap-4 text-center md:flex-row md:justify-between md:text-left">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-200">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
              </span>
              <T k="pricing.offer.label">Limited-time launch price</T>
            </p>
            <p className="mt-2 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight text-white sm:text-xl md:justify-start">
              <Flame className="hidden h-5 w-5 shrink-0 text-amber-300 sm:block" aria-hidden />
              <span>
                {savePercent > 0 ? (
                  <>
                    <T k="pricing.offer.savePrefix">Save up to</T>{" "}
                    <span className="offer-text">{savePercent}%</span>{" "}
                  </>
                ) : null}
                <T k="pricing.offer.headline">before prices go back up</T>
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-start gap-1.5 sm:gap-2" aria-label="Time left on the launch price">
            {UNITS.map((unit, index) => (
              <div key={unit.key} className="flex items-start gap-1.5 sm:gap-2">
                <div className="flex w-[3.6rem] flex-col items-center sm:w-[4.25rem]">
                  <span className="offer-tile grid h-14 w-full place-items-center rounded-xl border border-white/15 bg-white/[0.06] font-mono text-2xl font-semibold tabular-nums text-white sm:h-16 sm:text-3xl">
                    {parts ? String(parts[unit.key]).padStart(2, "0") : "--"}
                  </span>
                  <span className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white/50 sm:text-[10px]">
                    {unit.label}
                  </span>
                </div>
                {index < UNITS.length - 1 ? (
                  <span className="mt-3 text-xl font-semibold text-meta-300/70 sm:mt-4 sm:text-2xl" aria-hidden>
                    :
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OfferCountdown;
