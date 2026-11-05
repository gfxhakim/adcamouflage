"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles, Users } from "lucide-react";

import { CmsIcon, CmsLink, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline } from "@/components/landing/primitives";
import { rolloverCap, type TokenPlanCard, type TopupTable } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PricingSectionProps {
  plans: TokenPlanCard[];
  /** Still passed by the page; the cards show each plan's own top-up rate. */
  topups?: TopupTable;
  currency: string;
  /** Where the plan buttons go: sign-up for visitors, the workspace once signed in. */
  ctaHref: string;
}

/** The plan the section highlights. */
const POPULAR = "pro";

const BLURBS: Record<string, string> = {
  starter: "For solo media buyers refreshing a handful of creatives a month.",
  pro: "For daily media buyers who launch new variations every week.",
  max: "For teams and agencies producing creatives at volume.",
};

const INCLUDED = [
  "Full Probe, Mutate & Scrub Engine",
  "Video & Static Image Support",
  "Complete Metadata & Hash Wipe",
  "Standard Processing Queue",
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

/** Seats are printed per plan, so a "single user" line in the shared list would contradict Max. */
const SEAT_LINE = /single[\s-]*user/i;

export function PricingSection({ plans, currency, ctaHref }: PricingSectionProps) {
  const cms = useCms();
  const popularId = cms.text("pricing.popularPlan", POPULAR, "text", "Highlighted plan id (starter, pro, max)").trim();
  const included = cms
    .list("pricing.included", INCLUDED, "Included in every plan", INCLUDED)
    .filter(({ item }) => !SEAT_LINE.test(item));

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
        <div>
          <CmsHeadline
            k="pricing.headline"
            dark
            text="One Saved Campaign Pays for Your Entire Year."
            className="text-4xl sm:text-5xl lg:text-6xl"
          />
        </div>
        <T k="pricing.lede" long as="p" className="text-sm leading-relaxed text-white/65">
          Pick the volume that matches your ad spend. Every plan is a paid 30-day period of tokens: one output
          file is one generation. No contracts, nothing renews on its own, and you can switch plans whenever you
          like.
        </T>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan, index) => {
          const popular = plan.id === popularId;

          return (
            <motion.div
              key={plan.id}
              className={cn(
                "group relative flex flex-col rounded-3xl border p-6 transition-colors duration-300",
                popular
                  ? "border-meta-500 bg-gradient-to-b from-meta-900 to-black shadow-[0_0_0_1px_rgba(8,102,255,0.4),0_30px_80px_-30px_rgba(8,102,255,0.8)] xl:-my-3"
                  : "border-white/10 bg-white/[0.04] hover:border-meta-500/50",
              )}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-white/45">0{index + 1}</span>
                {popular ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-black">
                    <CmsIcon k="pricing.popular.icon" fallback={Sparkles} className="h-3 w-3 text-meta-500" aria-hidden />
                    <T k="pricing.popular">Most popular</T>
                  </span>
                ) : null}
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white">{plan.label}</h3>
              <T k={`pricing.blurb.${plan.id}`} long as="p" className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-white/55">
                {BLURBS[plan.id] ?? ""}
              </T>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-[-0.05em] text-white">
                  {price(plan.price, currency)}
                </span>
                <T k="pricing.perMonth" className="text-sm text-white/45">/mo</T>
              </p>
              <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-meta-300">
                <span className="h-1.5 w-1.5 rounded-full bg-meta-400" aria-hidden />
                {number(plan.tokens)} <T k="pricing.tokensWord">tokens</T> · {number(plan.generations)} <T k="pricing.generationsWord">generations</T>
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <div>
                  <T k="pricing.rollover" as="dt" className="text-white/45">Rollover</T>
                  <dd className="font-semibold text-white">{rolloverText(plan)}</dd>
                </div>
                <div>
                  <T k="pricing.topups" as="dt" className="text-white/45">Top-ups</T>
                  <dd className="font-semibold text-white">
                    {plan.topup_rate} tokens per {price(1, currency)}
                  </dd>
                </div>
              </dl>

              <ul className="mt-5 flex-1 space-y-2.5 border-t border-white/10 pt-5">
                {included.map(({ item: feature, key, id }) => (
                  <li key={id} className="flex items-start gap-2.5 text-sm text-white/75">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    </span>
                    <T k={`${key}.text`}>{feature}</T>
                  </li>
                ))}
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
              </ul>

              <CmsLink
                k="pricing.choose"
                href={ctaHref}
                label="Choose"
                className={cn(
                  "group/btn mt-7 flex w-full items-center justify-between rounded-full py-1.5 pl-5 pr-1.5 text-sm font-semibold transition-colors",
                  popular ? "bg-white text-black hover:bg-meta-50" : "bg-white/[0.08] text-white hover:bg-white/[0.14]",
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
    </div>
  );
}

export default PricingSection;
