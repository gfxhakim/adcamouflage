import type { Metadata } from "next";

import AffiliateLanding from "@/components/affiliates/AffiliateLanding";
import { loadPublicAffiliateProgram } from "@/lib/referrals";
import { SITE_NAME, sharePreview } from "@/lib/site";

export const dynamic = "force-dynamic";

const TITLE = "Affiliate Program — Earn 25%–35% Recurring Revenue";
const DESCRIPTION =
  "Join the ProteusFlow Affiliate Partner Program. Give your audience 15% off their first payment and earn 25% to 35% recurring commissions on subscriptions, renewals, upgrades, and top-ups.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/affiliates" },
  ...sharePreview(`${TITLE} | ${SITE_NAME}`, DESCRIPTION, "/affiliates"),
};

export default async function AffiliatesPage() {
  const program = await loadPublicAffiliateProgram(true);
  return <AffiliateLanding program={program} />;
}
