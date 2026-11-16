/**
 * Text and logos saved from Admin before a rename can still hold an old
 * brand name or point at the old logo files. Saved values override the code
 * defaults, so they are cleaned whenever content is read (server and browser).
 */
import type { SiteContent } from "@/lib/siteContent";

/**
 * Every earlier brand name, with or without a space, dash or underscore in
 * it. Keep in step with backend/app/brand.py.
 *
 * A name inside an address, a link or a file name is left alone
 * (support@blucloack.online, /brand/blucloacking-mark.png, ?ref=blucloack),
 * so cleaning text never breaks a link. The character before the name is
 * captured and put back rather than checked with a look-behind, because
 * iPhones on Safari older than 16.4 cannot load a script that has one.
 */
const GAP = String.raw`[ \t\r\n\u00a0_-]{0,2}`;
const OLD_NAME = new RegExp(
  String.raw`(^|[^@/.=\w-])` +
    `(?:Blu${GAP}Clo(?:a)?c?k(?:ing)?|Blu${GAP}Editor|Blu${GAP}Camouflage|Ad${GAP}Camouflage)` +
    String.raw`(?![\w.-]*@)(?![\w-]*\.[a-z0-9]{2})(?!\w)`,
  "gi",
);

/** Old wording that may still sit in text saved from Admin before the rebrand. */
const LEGACY_WORDING: [RegExp, string][] = [
  [/\bcamouflaged\b/gi, "refreshed"],
  [/\bcamouflage\b/gi, "variation"],
  [/\bcloaked\b/gi, "refreshed"],
  [/\bcloaking\b/gi, "variation"],
  [/\bbypass(?:ing|es|ed)?\b/gi, "refresh"],
  [/\bundetectable\b/gi, "seamless"],
];

/** Old logo image files (the BluCloacking shield). */
const OLD_LOGO = /blucloacking-(?:mark|wordmark|logo)/i;

/** Only the brand name: an old name becomes ProteusFlow. */
export function cleanOldBrandName(value: string): string {
  return value.replace(OLD_NAME, "$1ProteusFlow");
}

export function cleanLegacyWording(value: string): string {
  let out = cleanOldBrandName(value);
  for (const [pattern, replacement] of LEGACY_WORDING) out = out.replace(pattern, replacement);
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A copy of `item` with the brand name cleaned in the named text fields. */
function withCleanNames<T>(item: T, fields: string[]): T {
  if (!isRecord(item)) return item;
  const out: Record<string, unknown> = { ...item };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === "string") out[field] = cleanOldBrandName(value);
  }
  return out as T;
}

/** Saved content with old names, old logo files and old wording cleaned. */
export function cleanSiteContent(content: SiteContent): SiteContent {
  const out: SiteContent = { ...content };
  if (isRecord(content.text)) {
    const text: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content.text)) {
      text[key] = typeof value === "string" ? cleanLegacyWording(value) : value;
    }
    out.text = text as SiteContent["text"];
  }
  if (isRecord(content.meta)) {
    const meta = { ...content.meta };
    if (typeof meta.title === "string") meta.title = cleanLegacyWording(meta.title);
    if (typeof meta.description === "string") meta.description = cleanLegacyWording(meta.description);
    // A tab icon pointing at the old logo gives way to the built-in ProteusFlow icon.
    if (typeof meta.favicon === "string" && OLD_LOGO.test(meta.favicon)) delete meta.favicon;
    out.meta = meta;
  }
  if (isRecord(content.media)) {
    const media = { ...content.media };
    for (const [key, value] of Object.entries(media)) {
      if (value && typeof value.src === "string" && OLD_LOGO.test(value.src)) delete media[key];
      else media[key] = withCleanNames(value, ["alt"]);
    }
    out.media = media;
  }
  // Button labels and reviews: only the name is replaced, the wording stays as written.
  if (isRecord(content.link)) {
    const link = { ...content.link };
    for (const [key, value] of Object.entries(link)) link[key] = withCleanNames(value, ["label"]);
    out.link = link;
  }
  if (Array.isArray(content.reviews)) {
    out.reviews = content.reviews.map((review) => withCleanNames(review, ["name", "handle", "body"]));
  }
  return out;
}
