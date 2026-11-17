import type { Metadata } from "next";

import AffiliateLanding from "@/components/affiliates/AffiliateLanding";
import { loadPublicAffiliateProgram } from "@/lib/referrals";
import { SITE_NAME, sharePreview } from "@/lib/site";

export const dynamic = "force-dynamic";

const TITLE = "Affiliate Program — Partner with ProteusFlow";
const DESCRIPTION =
  "Join the ProteusFlow Affiliate Partner Program. Apply with your channels and content details to receive your personal Whop promo code and affiliate link.";

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
