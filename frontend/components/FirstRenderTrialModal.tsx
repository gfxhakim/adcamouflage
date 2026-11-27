"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Crown, Download, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { formatMoney, formatTokens } from "@/lib/format";
import type { TokenPlanCard } from "@/lib/types";

interface FirstRenderTrialModalProps {
  open: boolean;
  freeRemaining: number;
  freeTotal: number;
  plans: TokenPlanCard[];
  currency?: string;
  completedCount?: number;
  onClose: () => void;
}

const FALLBACK_PLAN_SUMMARIES: Pick<TokenPlanCard, "id" | "label" | "price" | "generations">[] = [
  { id: "starter", label: "Starter", price: 37, generations: 15 },
  { id: "pro", label: "Pro", price: 89, generations: 50 },
  { id: "max", label: "Max", price: 149, generations: 120 },
];

const PLAN_HIGHLIGHT: Record<string, string> = {
  starter: "Meta Ads · Clean Container",
  pro: "Recommended · All Platforms",
  max: "Agencies · 5 Team Seats",
};

/**
 * Celebratory + upgrade prompt modal shown once right after a new free-trial
 * user completes their first render/merge, nudging them cleanly to subscribe.
 */
export function FirstRenderTrialModal({
  open,
  freeRemaining,
  freeTotal,
  plans,
  currency = "USD",
  completedCount = 1,
  onClose,
}: FirstRenderTrialModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const total = Math.max(1, freeTotal || 3);
  const left = Math.max(0, Math.min(total, freeRemaining));
  const used = Math.max(0, total - left);
  const shownPlans = plans.length > 0 ? plans : FALLBACK_PLAN_SUMMARIES;
  const outputNoun = completedCount === 1 ? "output" : "outputs";
  const remainingNoun = left === 1 ? "generation" : "generations";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-render-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="offer-glow relative w-full max-w-2xl rounded-[28px] p-px"
          >
            <div className="relative overflow-hidden rounded-[27px] bg-[#070b14] text-white shadow-[0_32px_100px_rgba(0,0,0,0.85)]">
              {/* Ambient glows + subtle light sweep */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-meta-500/25 blur-3xl"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-emerald-500/20 blur-3xl"
              />
              <span aria-hidden className="offer-shine pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 opacity-60" />

              <button
                type="button"
                onClick={onClose}
                aria-label="Close popup"
                className="absolute right-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 transition hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>

              <div className="relative z-10 max-h-[88dvh] overflow-y-auto p-5 sm:p-7">
                {/* Status badge */}
                <div className="pr-8">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]",
                      left > 0
                        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                        : "border-amber-300/45 bg-amber-400/15 text-amber-200",
                    )}
                  >
                    <span className="relative flex h-2 w-2" aria-hidden>
                      <span
                        className={clsx(
                          "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                          left > 0 ? "bg-emerald-300" : "bg-amber-300",
                        )}
                      />
                      <span
                        className={clsx(
                          "relative inline-flex h-2 w-2 rounded-full",
                          left > 0 ? "bg-emerald-300" : "bg-amber-300",
                        )}
                      />
                    </span>
                    {left > 0
                      ? `First Render Complete · ${left} Free Left`
                      : `All ${total} Free Generations Used`}
                  </span>

                  <h2
                    id="first-render-modal-title"
                    className="mt-3 text-2xl font-bold leading-tight tracking-[-0.03em] text-white sm:text-[28px]"
                  >
                    {left > 0
                      ? "Your first studio export is ready!"
                      : "Your first batch is ready — unlock full scale"}
                  </h2>

                  <p className="mt-2 text-xs leading-relaxed text-slate-300 sm:text-sm">
                    {left > 0 ? (
                      <>
                        Your batch ({completedCount} {outputNoun}) just finished merging cleanly on your free trial. You
                        now have{" "}
                        <span className="font-semibold text-white">
                          {left} of {total} free {remainingNoun} left
                        </span>{" "}
                        — subscribe to a plan anytime to keep generating without interruption and unlock full monthly
                        volume.
                      </>
                    ) : (
                      <>
                        Your batch ({completedCount} {outputNoun}) just finished merging and used all{" "}
                        <span className="font-semibold text-white">{total} complimentary signup generations</span>.
                        Subscribe to Starter, Pro, or Max below to keep exporting fresh ad variations right away.
                      </>
                    )}
                  </p>
                </div>

                {/* 3-segment visual free-trial gauge */}
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 font-medium text-white">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                      Free Signup Trial Progress
                    </span>
                    <span className="font-mono font-semibold text-meta-300">
                      {left}/{total} remaining
                    </span>
                  </div>
                  <div
                    className="mt-2.5 grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
                    aria-hidden
                  >
                    {Array.from({ length: total }, (_, index) => {
                      const isUsed = index < used;
                      return (
                        <span
                          key={index}
                          className={clsx(
                            "h-2 rounded-full transition-all",
                            isUsed
                              ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]"
                              : "bg-white/15",
                          )}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Quick 3-plan comparison row */}
                <div className="mt-4">
                  <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    <Sparkles className="h-3 w-3 text-meta-300" aria-hidden />
                    Choose a plan to scale your campaigns
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {shownPlans.map((plan) => {
                      const isPro = plan.id === "pro";
                      return (
                        <Link
                          key={plan.id}
                          href={`/app/plan?plan=${encodeURIComponent(plan.id)}`}
                          onClick={onClose}
                          className={clsx(
                            "group relative flex flex-col rounded-2xl border p-3.5 transition-all",
                            isPro
                              ? "border-meta-300/60 bg-gradient-to-b from-meta-500/25 via-meta-500/10 to-white/[0.04] shadow-[0_0_28px_-8px_rgba(8,102,255,0.65)] hover:border-meta-300"
                              : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">{plan.label}</span>
                            {isPro ? (
                              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-black">
                                Popular
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-xl font-bold tracking-tight text-white">
                            {formatMoney(plan.price, currency)}
                            <span className="text-[11px] font-normal text-slate-400">/mo</span>
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] font-medium text-meta-300">
                            {formatTokens(plan.generations)} generations
                          </p>
                          <p className="mt-1.5 text-[11px] text-slate-300">
                            {PLAN_HIGHLIGHT[plan.id] ?? "Full 30-day access"}
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* Guarantee line */}
                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400 sm:justify-start">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                  100% auto-refund on failed renders · 15-day guarantee · Zero auto-renewal traps
                </p>

                {/* Action buttons */}
                <div className="mt-5 flex flex-col-reverse gap-2.5 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/15"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    {left > 0
                      ? `Download & Continue (${left} free left)`
                      : "Download Outputs First"}
                  </button>
                  <Link
                    href="/app/plan?plan=pro"
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-black shadow-[0_8px_28px_rgba(102,163,255,0.45)] transition hover:bg-meta-50"
                  >
                    <Crown className="h-3.5 w-3.5 text-meta-600" aria-hidden />
                    Subscribe to a Plan
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default FirstRenderTrialModal;
