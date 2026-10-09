"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import Link from "next/link";

import { Headline, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

export interface PublicPlan {
  id: string;
  label: string;
  monthly_quota: number | null;
  price: number;
}

interface PricingSectionProps {
  plans: PublicPlan[];
  currency: string;
  /** Where the plan buttons go: sign-up for visitors, the workspace once signed in. */
  ctaHref: string;
}

/** The plan the section highlights. */
const POPULAR = "pro";

const BLURBS: Record<string, string> = {
  free: "Try the engine on your first creatives.",
  starter: "For one brand testing new angles every week.",
  pro: "For media buyers shipping batches every day.",
  unlimited: "For agencies that never stop launching.",
};

// Every plan gets the whole engine; plans differ only in monthly volume.
const INCLUDED = [
  "Every camouflage preset",
  "Metadata and fingerprint scrub",
  "Brand overlay on any frames",
  "Batch download as a zip",
];

function price(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function quotaText(quota: number | null) {
  if (quota === null) return "Unlimited files a month";
  return `${quota.toLocaleString("en-US")} files a month`;
}

export function PricingSection({ plans, currency, ctaHref }: PricingSectionProps) {
  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
        <div>
          <SectionTag index="06" dark>
            Pricing
          </SectionTag>
          <Headline
            dark
            text="Pick the volume you run. | [Get the whole engine.]"
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
        </div>
        <p className="text-sm leading-relaxed text-white/65">
          Every plan has every feature. Plans only change how many files you can process each
          month. Start free, no card needed.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan, index) => {
          const popular = plan.id === POPULAR;
          const free = plan.price === 0;

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
                {quotaText(plan.monthly_quota)}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 border-t border-white/10 pt-6">
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
                {free ? "Start free" : `Choose ${plan.label}`}
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

      <p className="mt-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/45">
        <span className="h-1.5 w-1.5 rounded-full bg-meta-500" aria-hidden />
        Every uploaded file and every extra variant counts as one file. Usage resets on the 1st of
        each month.
      </p>
    </div>
  );
}

export default PricingSection;
