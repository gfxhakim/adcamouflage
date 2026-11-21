import type { Metadata } from "next";

import ScaleLanding from "@/components/scale/ScaleLanding";
import { SITE_NAME, sharePreview } from "@/lib/site";

const TITLE = "Scale Every Winning Ad Angle — ProteusFlow Case Study & Walkthrough";
const DESCRIPTION =
  "Watch how media buyers, brand owners, ecom stores, video editors, and creative strategists turn one master creative into Meta, TikTok, and Shorts variations in minutes.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/scale" },
  ...sharePreview(`${TITLE} | ${SITE_NAME}`, DESCRIPTION, "/scale"),
};

export default function ScalePage() {
  return <ScaleLanding />;
}
