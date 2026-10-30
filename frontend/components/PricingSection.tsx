"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import Link from "next/link";

import { Headline, SectionTag } from "@/components/landing/primitives";
import { rolloverCap, type TokenPlanCard, type TopupTable } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PricingSectionProps {
  plans: TokenPlanCard[];
  topups: TopupTable;
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
  "Single User Access",
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

/** "Top up from $20: 40–65 tokens per $1, with bonus tokens from $40 up." */
function topupLine(plans: TokenPlanCard[], topups: TopupTable, currency: string): string {
  const rates = plans.map((p) => p.topup_rate).filter((r) => r > 0);
  if (rates.length === 0 || topups.amounts.length === 0) return "";
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  const rate = low === high ? `${low}` : `${low}–${high}`;
  const smallest = Math.min(...topups.amounts);
  const bonusFrom = topups.amounts
    .filter((amount) => plans.some((p) => (topups.bonus[p.id]?.[String(amount)] ?? 0) > 0))
    .sort((a, b) => a - b)[0];
  const bonus = bonusFrom ? `, with bonus tokens from ${price(bonusFrom, currency)} up` : "";
  return `Need more? Top up from ${price(smallest, currency)} at ${rate} tokens per ${price(1, currency)}${bonus}.`;
}

export function PricingSection({ plans, topups, currency, ctaHref }: PricingSectionProps) {
  const extra = topupLine(plans, topups, currency);

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
        <div>
          <SectionTag index="05" dark>
            TRANSPARENT PRICING
          </SectionTag>
          <Headline
            dark
            text="One Saved Campaign Pays for Your Entire Year."
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
        </div>
        <p className="text-sm leading-relaxed text-white/65">
          Pick the volume that matches your ad spend. Every plan is a paid 30-day period of tokens: one output
          file is one generation. No contracts, nothing renews on its own, and you can switch plans whenever you
          like.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan, index) => {
          const popular = plan.id === POPULAR;

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
                    <Sparkles className="h-3 w-3 text-meta-500" aria-hidden />
                    Most popular
                  </span>
                ) : null}
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white">{plan.label}</h3>
              <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-white/55">
                {BLURBS[plan.id] ?? ""}
              </p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-[-0.05em] text-white">
                  {price(plan.price, currency)}
                </span>
                <span className="text-sm text-white/45">/mo</span>
              </p>
              <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-meta-300">
                <span className="h-1.5 w-1.5 rounded-full bg-meta-400" aria-hidden />
                {number(plan.tokens)} tokens · {number(plan.generations)} generations
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <div>
                  <dt className="text-white/45">Per generation</dt>
                  <dd className="font-semibold text-white">
                    {price(plan.price_per_generation, currency, 2)}{" "}
                    <span className="font-normal text-white/45">· {plan.tokens_per_generation} tokens</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">Rollover</dt>
                  <dd className="font-semibold text-white">{rolloverText(plan)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-white/45">Top-ups</dt>
                  <dd className="font-semibold text-white">
                    {plan.topup_rate} tokens per {price(1, currency)}
                  </dd>
                </div>
              </dl>

              <ul className="mt-5 flex-1 space-y-2.5 border-t border-white/10 pt-5">
                {INCLUDED.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-white/75">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={ctaHref}
                className={cn(
                  "group/btn mt-7 flex w-full items-center justify-between rounded-full py-1.5 pl-5 pr-1.5 text-sm font-semibold transition-colors",
                  popular ? "bg-white text-black hover:bg-meta-50" : "bg-white/[0.08] text-white hover:bg-white/[0.14]",
                )}
              >
                Choose {plan.label}
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full transition-transform group-hover/btn:rotate-[-45deg]",
                    popular ? "bg-meta-500 text-white" : "bg-white/10 text-white",
                  )}
                >
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 space-y-2 font-mono text-[11px] uppercase tracking-wider text-white/45">
        <p className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-meta-500" aria-hidden />
          One uploaded file × one variant = one generation. Paid in crypto through BTCPay, per 30-day period.
        </p>
        {extra ? (
          <p className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-meta-500" aria-hidden />
            {extra}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default PricingSection;
