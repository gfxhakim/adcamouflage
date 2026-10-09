"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import Link from "next/link";

import NeonCard from "@/components/NeonCard";
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
      <div className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
        <p className="label">Pricing</p>
        <h2 className="mt-3 font-display text-4xl font-normal leading-[1.05] text-black sm:text-5xl">
          Pick the volume you run. <em className="italic text-meta-500">Get the whole engine.</em>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Every plan has every feature. Plans only change how many files you can process each
          month. Start free, no card needed.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan, index) => {
          const popular = plan.id === POPULAR;
          const free = plan.price === 0;

          return (
            <motion.div
              key={plan.id}
              className="flex"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <NeonCard
                glow={popular}
                interactive
                padding="lg"
                radius="xl"
                tone={popular ? "default" : "slow"}
                className={cn("flex w-full", popular && "xl:-my-3")}
                innerClassName="flex w-full flex-col"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-2xl font-normal text-black">{plan.label}</h3>
                  {popular ? (
                    <span className="chip !border-meta-500/30 !bg-meta-500 !text-white">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      Most popular
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 min-h-[2.5rem] text-xs leading-relaxed text-ink-subtle">
                  {BLURBS[plan.id] ?? ""}
                </p>

                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold tracking-tight text-black">
                    {price(plan.price, currency)}
                  </span>
                  <span className="text-sm text-ink-faint">/ month</span>
                </p>
                <p className="mt-2 text-sm font-semibold text-meta-600">
                  {quotaText(plan.monthly_quota)}
                </p>

                <ul className="mt-5 flex-1 space-y-2.5 border-t border-black/10 pt-5">
                  {INCLUDED.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-muted">
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
                    "mt-6 w-full justify-center",
                    popular ? "btn-primary !py-3" : "btn-ghost !py-3",
                  )}
                >
                  {free ? "Start free" : `Choose ${plan.label}`}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </NeonCard>
            </motion.div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[11px] text-ink-faint">
        Every uploaded file and every extra variant counts as one file. Usage resets on the 1st of
        each month.
      </p>
    </div>
  );
}

export default PricingSection;
