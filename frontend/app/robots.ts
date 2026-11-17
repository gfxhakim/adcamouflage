import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";

// Read SITE_URL at request time, not at build time.
export const dynamic = "force-dynamic";

// The workspace, admin panel, API and one-off account pages stay out of search
// results. Login and sign-up are crawlable but carry noindex themselves.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api/", "/unsubscribe", "/*?cms_preview"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
