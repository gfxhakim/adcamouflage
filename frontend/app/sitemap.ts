import type { MetadataRoute } from "next";

import { loadGuides } from "@/lib/guides";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Dates of the last real change to these pages (not "now", which tells Google
// every page changes on every crawl and makes it trust the dates less).
const LEGAL_UPDATED = new Date("2026-11-05T00:00:00Z");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const guides = await loadGuides();
  const newestGuide = guides.reduce<string>((latest, g) => ((g.updated_at || "") > latest ? g.updated_at || "" : latest), "");
  const date = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : undefined);

  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/affiliates`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/guides`, lastModified: date(newestGuide), changeFrequency: "weekly", priority: 0.8 },
    ...guides.map((g) => ({
      url: `${base}/guides/${g.slug}`,
      lastModified: date(g.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${base}/privacy`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly", priority: 0.2 },
  ];
}
