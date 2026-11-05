/**
 * The site's public address, used for canonical links, the sitemap, robots.txt
 * and social previews. Set SITE_URL on the Railway `web` service (for example
 * https://blucloack.online). When set, visits to www.<host> are sent to it with
 * a permanent redirect so Google sees one site, not two.
 */
export const DEFAULT_SITE_URL = "https://blucloack.online";

export function siteUrl(): string {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
}

export const SITE_NAME = "BluCloacking";

// Honest, keyword-focused description used for search results and link previews.
export const SITE_TITLE = "BluCloacking — Video ad creative editor for Meta, TikTok & YouTube";
export const SITE_DESCRIPTION =
  "Upload a finished video or image ad and get platform-ready versions in minutes: reframe for Reels, TikTok and YouTube Shorts, add brand overlays, pick a cover frame and export in high quality. Plans from $37.50 a month.";

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
