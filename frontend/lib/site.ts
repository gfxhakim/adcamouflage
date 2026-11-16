/**
 * Fallback public address. The real one comes from SITE_URL on the Railway
 * `web` service (or the request's host); see siteUrl() in lib/seo.ts. When
 * SITE_URL is set, visits to www.<host> are sent to it with a permanent
 * redirect so Google sees one site, not two.
 */
export const DEFAULT_SITE_URL = "https://blucloack.online";

export const SITE_NAME = "ProteusFlow";
export const SITE_SLOGAN = "Seamless adaptation. Peak efficiency.";

// Search results and link previews. Honest and specific: say what the product
// does, in the words people search with. Google shows about 60 characters of a
// title and 155 of a description.
export const SITE_TITLE = "ProteusFlow: Ad Creative Variations & Batch Video Studio";
export const SITE_DESCRIPTION =
  "Turn one winning video or image ad into up to 10 polished, branded variations in minutes. " +
  "Color grading, logo overlays and cover frames for Meta, TikTok and YouTube ads.";

export const SITE_KEYWORDS = [
  "ad creative variations",
  "video ad variations",
  "creative testing tool",
  "batch video editing",
  "video ad editor",
  "add logo to video",
  "video cover frame",
  "Meta ad creatives",
  "TikTok ad creatives",
  "media buyer tools",
];

/** Contact address shown on the legal pages. Set LEGAL_CONTACT_EMAIL on the `web` service. */
export function contactEmail(): string {
  return (process.env.LEGAL_CONTACT_EMAIL || "support@blucloack.online").trim();
}
