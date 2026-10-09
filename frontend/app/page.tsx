import type { Metadata } from "next";

import BeforeAfter from "@/components/landing/BeforeAfter";
import ClosingCta from "@/components/landing/ClosingCta";
import CursorRing from "@/components/landing/CursorRing";
import Faq from "@/components/landing/Faq";
import FeaturePanels from "@/components/landing/FeaturePanels";
import Funnel from "@/components/landing/Funnel";
import Hero from "@/components/landing/Hero";
import ReportBand from "@/components/landing/ReportBand";
import SiteFooter from "@/components/landing/SiteFooter";
import WhyRadar from "@/components/landing/WhyRadar";
import LandingNav from "@/components/LandingNav";
import PricingSection, { type PublicPlan } from "@/components/PricingSection";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "AdCamouflage — One winning ad, endless fresh copies",
  description:
    "Turn one winning creative into fresh, unique files. Each copy looks the same to people but carries a new fingerprint, new timing and zero metadata, so reused ads stop being matched as duplicates.",
};

// Shown only if the API cannot be reached; normally the admin panel's plans are used.
const FALLBACK_PLANS: PublicPlan[] = [
  { id: "free", label: "Free", monthly_quota: 10, price: 0 },
  { id: "starter", label: "Starter", monthly_quota: 100, price: 19 },
  { id: "pro", label: "Pro", monthly_quota: 500, price: 49 },
  { id: "unlimited", label: "Unlimited", monthly_quota: null, price: 99 },
];

async function loadPlans(): Promise<{ plans: PublicPlan[]; currency: string }> {
  // Server-side, so talk to the API service directly rather than through the /api rewrite.
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/api/v1/plans`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const data = (await response.json()) as { plans?: PublicPlan[]; currency?: string };
      if (data.plans?.length) return { plans: data.plans, currency: data.currency || "USD" };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { plans: FALLBACK_PLANS, currency: "USD" };
}

export default async function LandingPage() {
  // Everyone sees the visitor version of this page, and every start button
  // opens the login page, which also offers to create an account.
  const startHref = "/login";
  const pricing = await loadPlans();

  return (
    <>
      <SiteHeader nav={<LandingNav variant="header" />} />
      <LandingNav variant="dock" />
      <CursorRing />

      <main className="overflow-x-clip">
        <Hero startHref={startHref} />
        <WhyRadar />
        <FeaturePanels />
        <BeforeAfter />
        <Funnel />
        <ReportBand />
        <section id="pricing" className="scroll-mt-24 bg-black py-20 text-white sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <PricingSection plans={pricing.plans} currency={pricing.currency} ctaHref={startHref} />
          </div>
        </section>
        <Faq />
        <ClosingCta startHref={startHref} />
      </main>
      <SiteFooter />
    </>
  );
}
