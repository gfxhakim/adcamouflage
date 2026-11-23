"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles, Users, X } from "lucide-react";
import { useEffect, useState } from "react";

import { CmsIcon, CmsLink, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import OfferCountdown, { useTimeLeft } from "@/components/landing/OfferCountdown";
import { CmsHeadline } from "@/components/landing/primitives";
import { fetchVisitorOffer, subscribeVisitorOffer, type ReferralOffer } from "@/lib/referrals";
import { rolloverCap, type PricePromo, type TokenPlanCard, type TopupTable } from "@/lib/types";
import { reportPlanClick } from "@/lib/notify";
import { featureForLine, PLAN_FEATURES, planIncludes, platformLineForPlan } from "@/lib/plan-features";
import { cn } from "@/lib/utils";

interface PricingSectionProps {
  plans: TokenPlanCard[];
  /** Still passed by the page; the cards no longer show top-up rates. */
  topups?: TopupTable;
  currency: string;
  /** Where the plan buttons go: sign-up for visitors, the workspace once signed in. */
  ctaHref: string;
  /** The limited-time launch offer, when one runs. */
  promo?: PricePromo;
}

/** The plan the section highlights. */
const POPULAR = "pro";

const BLURBS: Record<string, string> = {
  starter:
    "Fix your first rejected Meta ads — clean container exports & studio formatting so restricted creatives pass review cleanly.",
  pro: "Recommended for aggressive, policy-flagged video ads — full AI layer engine makes rejected Meta, TikTok & YouTube ads work and convert better.",
  max: "For agencies & media buyers scaling strict-policy creatives at volume — full AI recovery engine, 5 team seats & lowest cost per export.",
};

const INCLUDED = [
  "Full AI Engine for Rejected & Aggressive Video Ads",
  "Turns Policy-Flagged Creatives Into Approved Winners",
  "Clean Container, Fresh Encoding & Policy-Safe Re-Export",
  "Brand Watermark & High-CTR Cover Frame Studio",
];

function price(amount: number, currency: string, digits?: number) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits ?? (amount % 1 === 0 ? 0 : 2),
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function number(value: number) {
  return value.toLocaleString("en-US");
}

function rolloverText(plan: TokenPlanCard) {
  if (plan.rollover_months <= 0) return "Tokens reset each period";
  return `Roll over up to ${number(rolloverCap(plan))} tokens`;
}

/** The seat line each card ends its feature list with. */
function seatsText(plan: TokenPlanCard): string {
  const seats = plan.seats ?? 1;
  return seats > 1 ? `Up to ${number(seats)} users` : "Single user";
}

/** Seats and platform access are printed per plan, so static duplicates in CMS are skipped. */
const SEAT_LINE = /single[\s-]*user/i;
const PLATFORM_LINE = /^meta(?:\s+ads)?(?:\s*,|\s+and|\s*$)|tiktok|youtube/i;

/** Whole-percent saving of the launch price on the regular price. */
function savePercent(launch: number, regular: number): number {
  return regular > launch ? Math.round(((regular - launch) / regular) * 100) : 0;
}

export function PricingSection({
  plans: listed,
  currency,
  ctaHref,
  promo,
}: PricingSectionProps) {
  const cms = useCms();
  const [referralOffer, setReferralOffer] = useState<ReferralOffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVisitorOffer()
      .then((res) => {
        if (!cancelled) setReferralOffer(res.offer ?? null);
      })
      .catch(() => undefined);
    const unsub = subscribeVisitorOffer(setReferralOffer);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // The offer ends at the same instant for every plan; the server sends it per plan.
  const endsAt = promo?.active ? promo.ends_at : listed.find((plan) => plan.offer_ends_at)?.offer_ends_at;
  const left = useTimeLeft(endsAt);
  // Once the countdown reaches zero the server bills the regular price, so the cards show it too.
  const ended = left === 0;
  const plans = listed.map((plan) =>
    plan.regular_price && ended ? { ...plan, price: plan.regular_price, regular_price: null } : plan,
  );
  const onOffer = !ended && plans.some((plan) => plan.regular_price && plan.regular_price > plan.price);
  const bestSaving = Math.max(0, ...plans.map((plan) => (plan.regular_price ? savePercent(plan.price, plan.regular_price) : 0)));
  const popularId = cms.text("pricing.popularPlan", POPULAR, "text", "Highlighted plan id (starter, pro, max)").trim();
  const included = cms
    .list("pricing.studioIncluded", INCLUDED, "Included in every plan", INCLUDED)
    .filter(({ item }) => !SEAT_LINE.test(item) && !PLATFORM_LINE.test(item));
  const chooseHrefFor = (planId: string) =>
    ctaHref.startsWith("/signup") || ctaHref.startsWith("/login")
      ? `/signup?next=${encodeURIComponent(`/app/plan?plan=${planId}&welcome=1`)}`
      : ctaHref;

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
        <div>
          <CmsHeadline
            k="pricing.studioHeadline"
            dark
            text="Choose a Plan to Fix & Scale Rejected Ads."
            className="text-4xl sm:text-5xl lg:text-6xl"
          />
        </div>
        <T k="pricing.studioLede" long as="p" className="text-sm leading-relaxed text-white/65">
          Activate a 30-day plan to unlock our AI layer engine built for aggressive and rejected ad creatives on Meta,
          TikTok, and YouTube—making restricted video ads pass review, deliver cleanly, and convert better with zero
          auto-renewal lock-in.
        </T>
      </div>

      {onOffer ? <OfferCountdown left={left} savePercent={bestSaving} /> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { kpi: "From $37 / mo", label: "Lower entry than $45.90–$47.90 alternatives" },
          { kpi: "50 renders on Pro", label: "2.5× more video volume at $89 vs 20-limit mid plans" },
          { kpi: "5 seats on Max", label: "Collaborate across your media-buying team (120 renders)" },
          { kpi: "100% auto-refund", label: "Failed server renders credit tokens back · no auto-renewal" },
        ].map(({ kpi, label }) => (
          <div
            key={kpi}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left"
          >
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-meta-300">{kpi}</p>
            <p className="mt-1 text-xs leading-snug text-white/65">{label}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", onOffer ? "mt-8" : "mt-10")}>
        {plans.map((plan, index) => {
          const popular = plan.id === popularId;
          const regular = !ended && plan.regular_price && plan.regular_price > plan.price ? plan.regular_price : null;
          const couponPrice = referralOffer?.prices?.[plan.id];
          const hasReferralDiscount = Boolean(
            referralOffer && couponPrice !== undefined && couponPrice < plan.price,
          );
          const activePrice = hasReferralDiscount && couponPrice !== undefined ? couponPrice : plan.price;
          const strikePrice = hasReferralDiscount ? plan.price : regular;

          return (
            <motion.div
              key={plan.id}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300",
                popular
                  ? "pro-glass border-meta-200/45 xl:-my-3"
                  : "border-white/10 bg-white/[0.04] hover:border-meta-500/50",
              )}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              {popular ? (
                <>
                  {/* Specular top edge, frosted glass reflection dome & animated light sweep */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/85 to-transparent"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-meta-300/25 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-meta-500/25 blur-3xl"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.14] via-white/[0.02] to-transparent opacity-80"
                  />
                  <span
                    aria-hidden
                    className="pro-shine pointer-events-none absolute inset-y-0 -left-1/3 w-2/3"
                  />
                </>
              ) : null}
              <div className="relative z-10 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-white/45">0{index + 1}</span>
                {popular ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-black shadow-[0_0_24px_rgba(255,255,255,0.45)]">
                    <CmsIcon k="pricing.popular.icon" fallback={Sparkles} className="h-3 w-3 text-meta-500" aria-hidden />
                    <T k="pricing.popular">Most popular</T>
                  </span>
                ) : null}
              </div>
              <h3 className="relative z-10 mt-4 text-2xl font-semibold tracking-tight text-white">{plan.label}</h3>
              <T k={`pricing.blurb.${plan.id}`} long as="p" className="relative z-10 mt-1 min-h-[2.5rem] text-xs leading-relaxed text-white/55">
                {BLURBS[plan.id] ?? ""}
              </T>

              {hasReferralDiscount && referralOffer ? (
                <p className="relative z-10 mt-6 flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium text-white/45 line-through decoration-red-400/80 decoration-2">
                    <span className="sr-only">Regular price </span>
                    {price(plan.price, currency)}
                  </span>
                  <span className="rounded-full bg-emerald-400 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-black">
                    −
                    {referralOffer.promo_type === "flat_amount" && (referralOffer.discount_amount ?? 0) > 0
                      ? price(referralOffer.discount_amount ?? 0, currency)
                      : `${referralOffer.discount_pct}%`}{" "}
                    · {referralOffer.code}
                  </span>
                </p>
              ) : regular ? (
                <p className="relative z-10 mt-6 flex flex-wrap items-center gap-2">
                  <span className="text-lg font-medium text-white/45 line-through decoration-red-400/80 decoration-2">
                    <span className="sr-only">Regular price </span>
                    {price(regular, currency)}
                  </span>
                  <span className="rounded-full bg-amber-300 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-black">
                    −{savePercent(plan.price, regular)}%
                  </span>
                </p>
              ) : null}
              <p className={cn("relative z-10 flex items-baseline gap-1.5", strikePrice ? "mt-1" : "mt-6")}>
                {strikePrice ? <span className="sr-only">Discounted price </span> : null}
                <span className="text-5xl font-semibold tracking-[-0.05em] text-white">
                  {price(activePrice, currency)}
                </span>
                <T k="pricing.perMonth" className="text-sm text-white/45">/mo</T>
              </p>
              {hasReferralDiscount && referralOffer ? (
                <p className="relative z-10 mt-1 text-[11px] font-medium text-emerald-300">
                  First payment with <span className="font-semibold">{referralOffer.code}</span>, then{" "}
                  {price(plan.price, currency)}/mo
                </p>
              ) : null}
              <p className="relative z-10 mt-1 text-[11px] text-white/45">
                + applicable sales tax / VAT calculated at checkout
              </p>
              <p className="relative z-10 mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-meta-300">
                <span className="h-1.5 w-1.5 rounded-full bg-meta-400" aria-hidden />
                {number(plan.tokens)} <T k="pricing.tokensWord">tokens</T> · {number(plan.generations)} <T k="pricing.generationsWord">generations</T>
              </p>

              <dl
                className={cn(
                  "relative z-10 mt-5 rounded-2xl border p-3 text-xs",
                  popular
                    ? "border-white/20 bg-white/[0.08] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    : "border-white/10 bg-white/[0.03]",
                )}
              >
                <div>
                  <T k="pricing.rollover" as="dt" className="text-white/45">Rollover</T>
                  <dd className="font-semibold text-white">{rolloverText(plan)}</dd>
                </div>
              </dl>

              <ul className="relative z-10 mt-5 flex flex-1 flex-col gap-2.5 border-t border-white/10 pt-5">
                {included.map(({ item: feature, key, id }) => {
                  // The engine and metadata lines follow each plan's switches in Admin > Token plans.
                  const gate = featureForLine(feature);
                  const unavailable = gate !== null && !planIncludes(plan, gate);
                  return (
                    <li
                      key={id}
                      // Lines this plan lacks sit at the bottom of the list, below the seat line.
                      className={cn("flex items-start gap-2.5 text-sm", unavailable ? "order-last text-white/35" : "text-white/75")}
                    >
                      {unavailable ? (
                        <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-white/45">
                          <X className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                        </span>
                      ) : (
                        <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                        </span>
                      )}
                      <span className={cn(unavailable && "line-through decoration-white/40")}>
                        <T k={`${key}.text`}>{feature}</T>
                        {unavailable ? <span className="sr-only"> (not included in {plan.label})</span> : null}
                      </span>
                    </li>
                  );
                })}
                <li className="flex items-start gap-2.5 text-sm text-white/75">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                    {(plan.seats ?? 1) > 1 ? (
                      <Users className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    ) : (
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    )}
                  </span>
                  <span className={cn((plan.seats ?? 1) > 1 && "font-semibold text-white")}>{seatsText(plan)}</span>
                </li>
                <li className="flex items-start gap-2.5 text-sm text-white/75">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                  </span>
                  <span className="font-medium text-white">{platformLineForPlan(plan)}</span>
                </li>
                {!planIncludes(plan, "multi_platform") ? (
                  <li className="order-last flex items-start gap-2.5 text-sm text-white/35">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-white/45">
                      <X className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    </span>
                    <span className="line-through decoration-white/40">
                      {PLAN_FEATURES.multi_platform.label}
                      <span className="sr-only"> (not included in {plan.label})</span>
                    </span>
                  </li>
                ) : null}
              </ul>

              <CmsLink
                k="pricing.choose"
                href={chooseHrefFor(plan.id)}
                label="Choose"
                onClick={() => reportPlanClick(plan.id)}
                className={cn(
                  "group/btn relative z-10 mt-7 flex w-full items-center justify-between rounded-full py-1.5 pl-5 pr-1.5 text-sm font-semibold transition-all",
                  popular
                    ? "bg-white text-black shadow-[0_6px_28px_rgba(102,163,255,0.45)] hover:bg-meta-50"
                    : "bg-white/[0.08] text-white hover:bg-white/[0.14]",
                )}
              >
                {(label) => (
                <>
                {label} {plan.label}
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full transition-transform group-hover/btn:rotate-[-45deg]",
                    popular ? "bg-meta-500 text-white" : "bg-white/10 text-white",
                  )}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
                </>
                )}
              </CmsLink>
            </motion.div>
          );
        })}
      </div>

      <p className="mx-auto mt-10 max-w-4xl text-center text-base font-semibold leading-relaxed tracking-[-0.01em] text-white [text-shadow:0_0_16px_rgba(255,255,255,0.9),0_0_34px_rgba(255,255,255,0.48),0_0_54px_rgba(56,189,248,0.42)] sm:text-lg md:text-xl">
        Account signup is free; rendering unlocks as soon as you activate a plan. Server-failed renders refund 100% of
        tokens automatically — no auto-renewal surprises.
      </p>
    </div>
  );
}

export default PricingSection;
