/**
 * Text and logos saved from Admin before a rename can still hold an old
 * brand name or point at the old logo files. Saved values override the code
 * defaults, so they are cleaned whenever content is read (server and browser).
 */
import type { SiteContent } from "@/lib/siteContent";

/**
 * Old brand names and wording that may still sit in text saved from Admin
 * before the ProteusFlow rebrand. Saved text overrides the code defaults, so we
 * clean it here on every render.
 */
// Not inside an address or link (support@blucloack.online, /brand/blucloacking-mark.png).
const NOT_IN_LINK = String.raw`(?<![@/.\w-])`;
const NOT_DOMAIN = String.raw`(?![\w.-]*\.(?:online|com|png|jpg|svg)\b)(?!\w)`;
const oldName = (name: string) => new RegExp(NOT_IN_LINK + name + NOT_DOMAIN, "gi");

const LEGACY_WORDING: [RegExp, string][] = [
  [oldName(String.raw`Blu[\s-]?Clo(?:a)?c?k(?:ing)?`), "ProteusFlow"],
  [oldName(String.raw`Blu[\s-]?Editor`), "ProteusFlow"],
  [oldName(String.raw`Blu[\s-]?Camouflage`), "ProteusFlow"],
  [oldName(String.raw`Ad[\s-]?Camouflage`), "ProteusFlow"],
  [/\bcamouflaged\b/gi, "refreshed"],
  [/\bcamouflage\b/gi, "variation"],
  [/\bcloaked\b/gi, "refreshed"],
  [/\bcloaking\b/gi, "variation"],
  [/\bbypass(?:ing|es|ed)?\b/gi, "refresh"],
  [/\bundetectable\b/gi, "seamless"],
];

/** Old logo image files (the BluCloacking shield). */
const OLD_LOGO = /blucloacking-(?:mark|wordmark|logo)/i;

export function cleanLegacyWording(value: string): string {
  let out = value;
  for (const [pattern, replacement] of LEGACY_WORDING) out = out.replace(pattern, replacement);
  return out;
}

/** Saved content with old names, old logo files and old wording cleaned. */
export function cleanSiteContent(content: SiteContent): SiteContent {
  const out: SiteContent = { ...content };
  if (content.text) {
    const text: Record<string, string> = {};
    for (const [key, value] of Object.entries(content.text)) {
      text[key] = typeof value === "string" ? cleanLegacyWording(value) : value;
    }
    out.text = text as SiteContent["text"];
  }
  if (content.meta) {
    const meta = { ...content.meta };
    if (meta.title) meta.title = cleanLegacyWording(meta.title);
    if (meta.description) meta.description = cleanLegacyWording(meta.description);
    // A tab icon pointing at the old logo gives way to the built-in ProteusFlow icon.
    if (meta.favicon && OLD_LOGO.test(meta.favicon)) delete meta.favicon;
    out.meta = meta;
  }
  if (content.media) {
    const media = { ...content.media };
    for (const [key, value] of Object.entries(media)) {
      if (value && typeof value.src === "string" && OLD_LOGO.test(value.src)) delete media[key];
    }
    out.media = media;
  }
  return out;
}

