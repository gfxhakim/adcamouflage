"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Check, Loader2, RefreshCw, ShoppingCart, X } from "lucide-react";

import NeonCard from "@/components/NeonCard";
import type { TokenSubscription } from "@/lib/auth";
import { formatMoney, formatTokens } from "@/lib/format";
import { PLAN_FEATURE_IDS, PLAN_FEATURES, planIncludes, platformLineForPlan } from "@/lib/plan-features";
import type { ReferralOffer } from "@/lib/referrals";
import { rolloverCap, type TokenPlanCard } from "@/lib/types";

interface TokenPlanCardsProps {
  plans: TokenPlanCard[];
  current: TokenSubscription | null;
  currency: string;
  paymentsEnabled: boolean;
  /** The plan whose checkout is being created, if any. */
  busy: string | null;
  onBuy: (plan: TokenPlanCard) => void;
  /** A referral or creator code waiting on this customer's first payment. */
  offer?: ReferralOffer | null;
  /** Optional plan id pre-selected from the landing page (?plan=pro). */
  preferredPlanId?: string | null;
}

const PLAN_BLURBS: Record<string, string> = {
  starter:
    "Fix your first rejected Meta video ads — clean container exports & studio presets help restricted ads regain approval.",
  pro: "Best for aggressive & policy-flagged creatives — full AI Layer Engine makes rejected Meta, TikTok & YouTube ads pass review and convert higher.",
  max: "Agency volume for strict direct-response verticals — full AI recovery engine, 5 team seats & lowest cost per export.",
};

/** The plan the page highlights when the user has none yet. */
const POPULAR = "pro";

type Action = "subscribe" | "renew" | "upgrade" | "switch";

function actionFor(plan: TokenPlanCard, current: TokenSubscription | null, currentPlan: TokenPlanCard | undefined): Action {
  if (!current || !currentPlan) return "subscribe";
  if (plan.id === current.plan_id) return "renew";
  return plan.price >= currentPlan.price ? "upgrade" : "switch";
}

const ACTION_LABEL: Record<Action, string> = {
  subscribe: "Subscribe",
  renew: "Renew",
  upgrade: "Upgrade",
  switch: "Switch",
};

function rolloverLine(plan: TokenPlanCard): string {
  if (plan.rollover_months <= 0) return "Unused tokens reset each period";
  return `Roll over up to ${formatTokens(rolloverCap(plan))} tokens (${plan.rollover_months} ${plan.rollover_months === 1 ? "period" : "periods"})`;
}

/**
 * Starter, Pro and Max side by side. Buying any of them starts a fresh 30-day
 * period via Whop checkout; the button says whether that is a first
 * subscription, a renewal, an upgrade or a switch down.
 */
export function TokenPlanCards({
  plans,
  current,
  currency,
  paymentsEnabled,
  busy,
  onBuy,
  offer,
  preferredPlanId,
}: TokenPlanCardsProps) {
  const currentPlan = current ? plans.find((p) => p.id === current.plan_id) : undefined;
  const activePreferred = !current ? (preferredPlanId ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const action = actionFor(plan, current, currentPlan);
          const isCurrent = current?.plan_id === plan.id;
          const couponPrice = offer?.prices?.[plan.id];
          const discounted = !current && couponPrice !== undefined && couponPrice < plan.price;
          const highlight =
            isCurrent || (activePreferred ? plan.id === activePreferred : !current && plan.id === POPULAR);
          const note =
            action === "switch"
              ? "Switching down starts a new period with no rolled-over tokens."
              : action === "upgrade" && plan.rollover_months > 0
                ? "Leftover subscription tokens carry over, up to the new cap."
                : plan.rollover_months === 0 && (action === "upgrade" || action === "renew")
                  ? "Starter does not roll tokens over: leftover subscription tokens expire."
                  : null;

          return (
            <NeonCard
              key={plan.id}
              glow={highlight}
              tone={highlight ? "default" : "muted"}
              interactive={!isCurrent}
              padding="md"
              radius="lg"
              className="h-full"
              innerClassName={clsx(
                "relative flex h-full flex-col overflow-hidden",
                plan.id === "pro" &&
                  "bg-gradient-to-b from-meta-50/80 via-white/85 to-white/95 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:from-[#0c2e70]/75 dark:via-[#07183d]/70 dark:to-[#050a16]/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
              )}
            >
              {plan.id === "pro" ? (
                <>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
                  />
                  <span
                    aria-hidden
                    className="pro-shine-subtle pointer-events-none absolute inset-y-0 -left-1/3 w-2/3"
                  />
                </>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-black">{plan.label}</p>
                {isCurrent ? (
                  <span
                    className={clsx(
                      "chip !text-[10px]",
                      current && !current.active ? "!border-red-300 !bg-red-50 !text-red-700" : "!border-meta-500/40 !bg-meta-50 !text-meta-700",
                    )}
                  >
                    {current && !current.active ? "Ended" : "Current plan"}
                  </span>
                ) : activePreferred === plan.id ? (
                  <span className="chip !border-meta-500/50 !bg-meta-50 !text-[10px] !text-meta-700">Selected plan</span>
                ) : !current && plan.id === POPULAR ? (
                  <span className="chip !border-meta-500/40 !bg-meta-50 !text-[10px] !text-meta-700">Most popular</span>
                ) : null}
              </div>
              {PLAN_BLURBS[plan.id] ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{PLAN_BLURBS[plan.id]}</p>
              ) : null}

              {discounted && offer ? (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-ink-faint line-through">
                    {formatMoney(plan.price, currency)}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                    −
                    {offer.promo_type === "flat_amount" && (offer.discount_amount ?? 0) > 0
                      ? formatMoney(offer.discount_amount ?? 0, currency)
                      : `${offer.discount_pct}%`}{" "}
                    · {offer.code}
                  </span>
                </p>
              ) : plan.regular_price && plan.regular_price > plan.price ? (
                <p className="mt-3 text-xs font-medium text-ink-subtle">
                  <span className="line-through">{formatMoney(plan.regular_price, currency)}</span>{" "}
                  <span className="font-semibold text-amber-700">Launch price</span>
                </p>
              ) : null}
              <p
                className={clsx(
                  discounted || (plan.regular_price && plan.regular_price > plan.price) ? "mt-0.5" : "mt-3",
                  "text-2xl font-bold tracking-tight text-black",
                )}
              >
                {formatMoney(discounted ? couponPrice : plan.price, currency)}
                <span className="text-xs font-medium text-ink-subtle"> / 30 days</span>
              </p>
              {discounted && offer ? (
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  First payment with <span className="font-semibold">{offer.code}</span>, then{" "}
                  {formatMoney(plan.price, currency)} / 30 days
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-ink-faint">+ applicable sales tax / VAT calculated at checkout</p>

              <ul className="mt-3 space-y-1.5 text-xs text-ink-muted">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  <span>
                    <span className="font-semibold text-black">{formatTokens(plan.tokens)}</span> tokens ={" "}
                    <span className="font-semibold text-black">{formatTokens(plan.generations)}</span> generations
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  <span className="font-semibold text-black">{platformLineForPlan(plan)}</span>
                </li>
                {PLAN_FEATURE_IDS.filter((feature) => feature !== "multi_platform" && planIncludes(plan, feature)).map((feature) => (
                  <li key={feature} className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                    {PLAN_FEATURES[feature].label}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  {(plan.seats ?? 1) > 1 ? `Up to ${plan.seats} users sharing the tokens` : "Single user"}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  {rolloverLine(plan)}
                </li>
                {/* Features this plan does not include go last. */}
                {PLAN_FEATURE_IDS.filter((feature) => !planIncludes(plan, feature)).map((feature) => (
                  <li key={feature} className="flex items-center gap-1.5 text-ink-faint">
                    <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="line-through">{PLAN_FEATURES[feature].label}</span>
                    <span className="sr-only"> (not included)</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-4">
                {paymentsEnabled ? (
                  <button
                    type="button"
                    className={clsx("w-full !py-2 !text-xs", action === "switch" ? "btn-ghost" : "btn-primary")}
                    disabled={busy !== null}
                    aria-label={`${ACTION_LABEL[action]} ${plan.label} for ${formatMoney(plan.price, currency)}`}
                    onClick={() => onBuy(plan)}
                  >
                    {busy === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : action === "renew" ? (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    ) : action === "upgrade" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    ) : action === "switch" ? (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {busy === plan.id ? "Opening checkout…" : ACTION_LABEL[action]}
                  </button>
                ) : (
                  <p className="rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-800">
                    Payments are being set up — contact support to get started.
                  </p>
                )}
                {note ? <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{note}</p> : null}
              </div>
            </NeonCard>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Every purchase starts a new 30-day period from today, and days left on the current one are added on. You pay
        once per period; nothing renews on its own.
      </p>
    </div>
  );
}

export default TokenPlanCards;
