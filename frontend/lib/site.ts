import type { Metadata } from "next";

/**
 * Fallback public address. The real one comes from SITE_URL on the Railway
 * `web` service (or the request's host); see siteUrl() in lib/seo.ts. When
 * SITE_URL is set, visits to the other spelling (www or not) are sent to it
 * with a permanent redirect so Google sees one site, not two.
 */
export const DEFAULT_SITE_URL = "https://www.proteusflow.com";

export const SITE_NAME = "ProteusFlow";
export const SITE_SLOGAN = "Seamless adaptation. Peak efficiency.";

// The title and description shown in the browser tab, in search results and
// in link previews (WhatsApp, Facebook, X). Both are kept short so previews
// show them whole. Admin > Landing page > Tab & SEO can replace both.
export const SITE_TITLE = "ProteusFlow — Online Video Formatter, Brand Overlay & Batch Export Studio";
export const SITE_DESCRIPTION =
  "Format, brand and export your videos for Reels, TikTok and Shorts in minutes. Software that adapts to your business, not the other way around.";

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

/**
 * The business inbox customers can write to. Cloudflare Email Routing
 * receives it and forwards it to the owner's mailbox.
 */
export const SUPPORT_EMAIL = "support@proteusflow.com";

/** Contact address shown on the legal pages. LEGAL_CONTACT_EMAIL on the `web` service overrides it. */
export function contactEmail(): string {
  return (process.env.LEGAL_CONTACT_EMAIL || SUPPORT_EMAIL).trim();
}
