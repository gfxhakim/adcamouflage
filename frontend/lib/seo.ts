import { headers } from "next/headers";

import { DEFAULT_SITE_URL } from "@/lib/site";

/**
 * Server only. The site's public address for canonical links, the sitemap,
 * robots.txt and structured data: SITE_URL on the Railway `web` service when
 * set; otherwise the address the visitor (or Googlebot) actually used, so a
 * new domain works before anyone remembers to set the variable.
 */
export function siteUrl(): string {
  const configured = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  try {
    const h = headers();
    const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
    if (host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) && !host.endsWith(".railway.internal")) {
      return `https://${host.replace(/\/+$/, "")}`;
    }
  } catch {
    // Outside a request (build time): fall through.
  }
  return DEFAULT_SITE_URL;
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so content can never close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
