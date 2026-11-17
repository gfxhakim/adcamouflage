/**
 * Text and logos saved from Admin before a rename can still hold an old
 * brand name or point at the old logo files. Saved values override the code
 * defaults, so they are cleaned whenever content is read (server and browser).
 */
import type { SiteContent } from "@/lib/siteContent";

const anyCase = (word: string) => word.replace(/[a-z]/gi, (letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`);

/**
 * Every earlier brand name, in any mix of capitals, with or without a space,
 * dash or underscore inside it (never a line break).
 */
const GAP = String.raw`[ \t\u00a0_-]{0,2}`;
const BLU = anyCase("Blu");
const AD = anyCase("Ad");
const CAMOUFLAGE = anyCase("Camouflage");
const NAME = [
  `${BLU}${GAP}${anyCase("Clo")}[Aa]?[Cc]?[Kk](?:${anyCase("ing")})?`,
  `${BLU}${GAP}${anyCase("Editor")}`,
  `${BLU}${GAP}${CAMOUFLAGE}`,
  `${AD}${GAP}${CAMOUFLAGE}`,
].join("|");
/** Endings that mark a web address or a file even when typed in capitals. */
const KNOWN_ENDINGS = ["online", "com", "net", "org", "io", "co", "app", "ai", "png", "jpg", "jpeg", "svg", "webp", "gif", "mp4", "pdf", "zip"]
  .map(anyCase)
  .join("|");

/**
 * A name is replaced only where it stands as a word in a sentence. Inside an
 * address, a link or a file name it is left exactly as written, so cleaning
 * text never breaks one: support@blucloack.online, blucloack.online,
 * /brand/blucloacking-mark.png, ?ref=blucloack, adcamouflage/backend.
 *
 * Keep in step with backend/app/brand.py: the two are built the same way and
 * must give the same result. The character before the name is captured and
 * put back rather than checked with a look-behind, because iPhones on Safari
 * older than 16.4 cannot load a script that has one.
 */
const OLD_NAME = new RegExp(
  String.raw`(^|[^\w@/\\.=?&#+-])` + // not straight after a character that puts it inside an address
    `(?:${NAME})` +
    String.raw`(?![\w.+-]*[@/\\])` + // not the start of an e-mail address or of a path
    String.raw`(?![\w-]*(?:\.[\w-]+)*\.[a-z][a-z0-9])` + // not a web address or a file name
    String.raw`(?![\w-]*(?:\.[\w-]+)*\.(?:` + KNOWN_ENDINGS + String.raw`)\b)` + // the same, typed in capitals
    String.raw`(?!\w)`,
  "g",
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

// Any saved text entry from before the studio cleanup that still talks about
// hashes, fingerprints, algorithms, duplicate scanners, or ad-review evasion is
// dropped completely so the clean built-in default shows instead.
const DISCARD_SAVED_TEXT =
  /\b(?:fingerprint|phash|dhash|perceptual\s*hash|hash\s*wipe|hashes|algorithm|scanner|scanners|duplicate|mutat(?:e|es|ed|ing|ion)|cloak(?:ing|ed)?|camouflag(?:e|ed|ing)|bypass(?:ing|es|ed)?|evad(?:e|ing)|evasion|undetectable|scrub(?:s|bed|bing)?|23[- ]*layer|micro[- ]*crop|sub[- ]*pixel|inaudible|signature|shadowban|flagged|rejected|disapproved|checksum|spoof(?:ing|ed)?|adversarial|perturbation|stealth|nuclear|blu[\s-]?clo(?:a)?c?k|ad[\s-]?camouflage)\b/i;
// A saved tab title or description with the old price or the old positioning is dropped too.
const DISCARD_SAVED_META = /\$37\.50|variation/i;

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
      if (key.startsWith("faq.items")) continue;
      if (typeof value === "string") {
        if (DISCARD_SAVED_TEXT.test(value)) continue;
        text[key] = cleanLegacyWording(value);
      }
    }
    out.text = text as SiteContent["text"];
  }
  if (isRecord(content.meta)) {
    const meta = { ...content.meta };
    for (const field of ["title", "description"] as const) {
      const value = meta[field];
      if (typeof value !== "string") continue;
      if (DISCARD_SAVED_TEXT.test(value) || DISCARD_SAVED_META.test(value)) delete meta[field];
      else meta[field] = cleanLegacyWording(value);
    }
    // A tab icon pointing at the old logo gives way to the built-in ProteusFlow icon.
    if (typeof meta.favicon === "string" && OLD_LOGO.test(meta.favicon)) delete meta.favicon;
    out.meta = meta;
  }
  if (isRecord(content.media)) {
    const media = { ...content.media };
    for (const [key, value] of Object.entries(media)) {
      if (value && typeof value.src === "string" && OLD_LOGO.test(value.src)) delete media[key];
      else media[key] = withCleanNames(value, ["alt", "caption"]);
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
