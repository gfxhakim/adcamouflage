import type { Metadata } from "next";

/**
 * The site's public address, used for canonical links, the sitemap, robots.txt
 * and link previews. Set SITE_URL on the Railway `web` service to the address
 * customers use (for example https://proteusflow.com). When set, visits to the
 * other spelling (www or not) are sent to it with a permanent redirect so
 * Google sees one site, not two. Without it this default is used and nothing
 * is redirected.
 */
export const DEFAULT_SITE_URL = "https://www.proteusflow.com";

export function siteUrl(): string {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
}

export const SITE_NAME = "ProteusFlow";
export const SITE_SLOGAN = "Seamless adaptation. Peak efficiency.";

// The title and description shown in the browser tab, in search results and
// in link previews (WhatsApp, Facebook, X). The description is one short line
// so previews show it whole. Admin > Landing page > Tab & SEO can replace both.
export const SITE_TITLE = "ProteusFlow — Creative Variation & Batch Video Studio for Meta, TikTok & YouTube";
export const SITE_DESCRIPTION =
  "Upload one ad, get versions for Reels, TikTok and Shorts in minutes. Software that adapts to your business, not the other way around.";

/**
 * The link-preview tags for a page's title and description. Pass the page's
 * own path where it is known; without one no address is sent and the preview
 * uses the address of the page that was shared.
 */
export function sharePreview(title: string, description: string, path?: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: { type: "website", siteName: SITE_NAME, title, description, ...(path ? { url: path } : {}), locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const SITE_KEYWORDS = [
  "video ad editor",
  "ad creative tool",
  "ad creative variations",
  "resize video for Instagram Reels",
  "TikTok video resizer",
  "YouTube Shorts converter",
  "brand logo overlay on video",
  "video cover frame picker",
  "batch video export",
  "media buyer tools",
];

/** Contact address shown on the legal pages. Set LEGAL_CONTACT_EMAIL on the `web` service. */
export function contactEmail(): string {
  return (process.env.LEGAL_CONTACT_EMAIL || "support@blucloack.online").trim();
}
