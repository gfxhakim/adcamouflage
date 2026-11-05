import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// Read SITE_URL at request time, not at build time.
export const dynamic = "force-dynamic";

// The workspace, admin panel, API and account pages stay out of search results.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
