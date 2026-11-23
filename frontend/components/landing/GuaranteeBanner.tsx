"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import { T } from "@/components/cms/Cms";

const GUARANTEE_TILES = [
  { value: "15", label: "Days window", detail: "Unused tokens" },
  { value: "100%", label: "Auto-refund", detail: "Failed renders" },
  { value: "$0", label: "Auto-lock", detail: "No traps" },
] as const;

/**
 * The shining 15-day guarantee banner below the pricing cards, visually
 * matching OfferCountdown's animated border glow, sweeping light shine, and
 * glowing metric tiles.
 */
export function GuaranteeBanner() {
  return (
    <div
      className="offer-glow relative mt-10 w-full rounded-3xl p-px"
      role="region"
      aria-label="15-day money-back guarantee"
    >
      <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-gradient-to-br from-meta-900/80 via-black to-meta-900/80 px-4 py-5 sm:px-6 sm:py-6">
        {/* Sweeping highlight matching OfferCountdown */}
        <span className="offer-shine pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" aria-hidden />

        <div className="relative flex flex-col items-center gap-5 text-center md:flex-row md:justify-between md:text-left">
          <div className="min-w-0 max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-200">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              <T k="pricing.guarantee.label">15-Day Guarantee · Risk-Free</T>
            </p>
            <p className="mt-2.5 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight text-white sm:text-xl md:justify-start">
              <ShieldCheck className="hidden h-5 w-5 shrink-0 text-emerald-300 sm:block" aria-hidden />
              <span>
                <T k="pricing.guarantee.prefix">Protected by Our</T>{" "}
                <span className="offer-text">15-Day Money-Back Guarantee</span>
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-white/75 sm:text-sm">
              <T k="pricing.guarantee.body" long>
                Test ProteusFlow on your campaigns with zero stress. Request a prorated refund on remaining unused
                tokens anytime within 15 days of payment—plus any render failed on our servers credits 100% of tokens
                back automatically.
              </T>{" "}
              <Link
                href="/refund-policy"
                className="font-semibold text-meta-300 underline decoration-meta-300/60 underline-offset-2 transition hover:text-white"
              >
                Refund policy
              </Link>
              .
            </p>
          </div>

          <div
            className="flex shrink-0 items-start gap-2 sm:gap-2.5"
            aria-label="15-day guarantee highlights"
          >
            {GUARANTEE_TILES.map((tile) => (
              <div key={tile.label} className="flex w-[4.6rem] flex-col items-center sm:w-[5.25rem]">
                <span className="offer-tile grid h-14 w-full place-items-center rounded-xl border border-white/15 bg-white/[0.06] font-mono text-xl font-semibold tabular-nums text-white sm:h-16 sm:text-2xl">
                  {tile.value}
                </span>
                <span className="mt-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white/75 sm:text-[10px]">
                  {tile.label}
                </span>
                <span className="font-mono text-[9px] tracking-wider text-white/45">{tile.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GuaranteeBanner;
