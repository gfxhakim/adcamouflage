import type { Metadata } from "next";

import BeforeAfter from "@/components/landing/BeforeAfter";
import ClosingCta from "@/components/landing/ClosingCta";
import CursorRing from "@/components/landing/CursorRing";
import Faq from "@/components/landing/Faq";
import FeaturePanels from "@/components/landing/FeaturePanels";
import Hero from "@/components/landing/Hero";
import ReportBand from "@/components/landing/ReportBand";
import SiteFooter from "@/components/landing/SiteFooter";
import WhyRadar from "@/components/landing/WhyRadar";
import LandingNav from "@/components/LandingNav";
import PricingSection from "@/components/PricingSection";
import SiteHeader from "@/components/SiteHeader";
import type { PublicPricing, TokenPlanCard, TopupTable } from "@/lib/types";

export const metadata: Metadata = {
  title: "AdCamouflage — One winning ad, endless fresh copies",
  description:
    "Turn one winning creative into fresh, unique files. Each copy looks the same to people but carries a new fingerprint, new timing and zero metadata, so reused ads stop being matched as duplicates.",
};

// Shown only if the API cannot be reached or sends a price list this page
// cannot show; normally the admin panel's price list is used.
const FALLBACK_PRICING: PublicPricing = {
  currency: "USD",
  plans: [
    { id: "starter", label: "Starter", price: 37.5, tokens: 1500, tokens_per_generation: 100, generations: 15, price_per_generation: 2.5, rollover_months: 0, rollover_cap: 0, topup_rate: 40 },
    { id: "pro", label: "Pro", price: 89, tokens: 4500, tokens_per_generation: 90, generations: 50, price_per_generation: 1.78, rollover_months: 1, rollover_cap: 4500, topup_rate: 50 },
    { id: "max", label: "Max", price: 149, tokens: 9600, tokens_per_generation: 80, generations: 120, price_per_generation: 1.24, rollover_months: 2, rollover_cap: 19200, topup_rate: 65 },
  ],
  topups: {
    amounts: [20, 40, 80, 160, 240],
    bonus: {
      starter: { "20": 0, "40": 100, "80": 300, "160": 1000, "240": 1900 },
      pro: { "20": 0, "40": 100, "80": 400, "160": 1200, "240": 2400 },
      max: { "20": 0, "40": 150, "80": 500, "160": 1550, "240": 3100 },
    },
  },
};

// The numbers each pricing card prints. An API still on the old monthly-file
// price list (for example while it redeploys after the web service) sends
// plans without them, and printing those took the whole page down.
const PLAN_NUMBERS = [
  "price",
  "tokens",
  "tokens_per_generation",
  "generations",
  "price_per_generation",
  "rollover_months",
  "topup_rate",
] as const;

function isTokenPlan(plan: unknown): plan is TokenPlanCard {
  if (!plan || typeof plan !== "object") return false;
  const fields = plan as Record<string, unknown>;
  return (
    typeof fields.id === "string" &&
    typeof fields.label === "string" &&
    PLAN_NUMBERS.every((key) => typeof fields[key] === "number" && Number.isFinite(fields[key]))
  );
}

function isTopupTable(table: unknown): table is TopupTable {
  if (!table || typeof table !== "object") return false;
  const { amounts, bonus } = table as Record<string, unknown>;
  return (
    Array.isArray(amounts) &&
    amounts.every((amount) => typeof amount === "number" && Number.isFinite(amount)) &&
    !!bonus &&
    typeof bonus === "object"
  );
}

async function loadPricing(): Promise<PublicPricing> {
  // Server-side, so talk to the API service directly rather than through the /api rewrite.
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/api/v1/plans`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const data = (await response.json()) as Partial<PublicPricing>;
      if (data.plans?.length && data.plans.every(isTokenPlan)) {
        return {
          currency: data.currency || "USD",
          plans: data.plans,
          topups: isTopupTable(data.topups) ? data.topups : FALLBACK_PRICING.topups,
          rules: data.rules,
        };
      }
    }
  } catch {
    // Fall through to the defaults.
  }
  return FALLBACK_PRICING;
}

export default async function LandingPage() {
  // Everyone sees the visitor version of this page, and every start button
  // opens the login page, which also offers to create an account.
  const startHref = "/login";
  const pricing = await loadPricing();

  return (
    <>
      <SiteHeader floating nav={<LandingNav variant="header" />} />
      <LandingNav variant="dock" />
      <CursorRing />

      <main className="overflow-x-clip">
        <Hero startHref={startHref} />
        <WhyRadar />
        <FeaturePanels />
        <BeforeAfter />
        <ReportBand />
        <section id="pricing" className="scroll-mt-24 bg-black py-20 text-white sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <PricingSection
              plans={pricing.plans}
              topups={pricing.topups}
              currency={pricing.currency}
              ctaHref={startHref}
            />
          </div>
        </section>
        <Faq />
        <ClosingCta startHref={startHref} />
      </main>
      <SiteFooter />
    </>
  );
}
