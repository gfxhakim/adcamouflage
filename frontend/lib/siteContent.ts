/**
 * Admin-editable site content (Admin > Landing / Workspace).
 *
 * A document only holds overrides. Every component passes its built-in text,
 * media and links as the fallback, so an empty document renders the page
 * exactly as shipped, and "reset" in the editor just deletes the override.
 */

import { cleanSiteContent } from "@/lib/legacyWording";

export type Namespace = "landing" | "workspace";

export interface TextStyle {
  color?: string;
  size?: number; // px
  weight?: number;
  align?: "left" | "center" | "right";
  italic?: boolean;
  uppercase?: boolean;
  tracking?: number; // em
  lineHeight?: number;
  font?: "sans" | "display" | "mono";
}

export interface MediaValue {
  src?: string;
  kind?: "image" | "video";
  alt?: string;
  fit?: "cover" | "contain" | "fill" | "scale-down";
  position?: "center" | "top" | "bottom" | "left" | "right";
  aspect?: "auto" | "16/9" | "4/3" | "1/1" | "4/5" | "9/16" | "21/9";
  scale?: number; // width percentage 10-100 (default 100)
  width?: number; // max width in px, 0 = natural
  height?: number; // px, 0 = auto
  radius?: number; // px
  align?: "left" | "center" | "right";
  opacity?: number; // 0-1
  frame?: "none" | "card" | "glow" | "glass" | "border";
  shadow?: "none" | "sm" | "md" | "xl" | "glow";
  background?: string;
  padding?: number; // px
  caption?: string;
  poster?: string;
  loop?: boolean;
  muted?: boolean;
  autoplay?: boolean;
  controls?: boolean;
  link?: string;
}

export interface LinkValue {
  label?: string;
  href?: string;
  newTab?: boolean;
  variant?: "default" | "solid" | "outline" | "ghost";
  color?: string; // button background
  textColor?: string;
}

export interface SectionStyle {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: "cover" | "contain" | "auto";
  backgroundOverlay?: number; // 0-1 black veil over the image
  textColor?: string;
  paddingY?: number; // px
  maxWidth?: number; // px
  radius?: number;
}

export interface ListEntry {
  id: string;
  /** Which built-in item supplies the fallback text, icons and look. */
  from: number;
}

/**
 * The entries a list shows. With nothing saved, the built-in items in `order`
 * (default: as declared). A saved list is used as is, except that built-in
 * items named in `order` which it never mentions (added to the site after the
 * admin saved the list) are slotted in at their built-in position.
 */
export function listEntries(saved: ListEntry[] | undefined, count: number, order?: number[]): ListEntry[] {
  const base = order ?? Array.from({ length: count }, (_, i) => i);
  if (!saved) return base.map((i) => ({ id: String(i), from: i }));
  if (!order) return saved;
  const out = [...saved];
  const seen = new Set(saved.map((e) => e.from));
  order.forEach((from, pos) => {
    if (seen.has(from)) return;
    const before = order.slice(0, pos).reverse().find((i) => seen.has(i));
    const at = before === undefined ? 0 : out.findIndex((e) => e.from === before) + 1;
    out.splice(at, 0, { id: String(from), from });
    seen.add(from);
  });
  return out;
}

export interface ThemeValue {
  accent?: string;
  page?: string;
  dark?: string;
  light?: string;
  soft?: string;
  ink?: string;
  muted?: string;
  fontSans?: string;
  fontDisplay?: string;
  fontMono?: string;
  baseSize?: number; // px, root font size
  radius?: number; // multiplier, 1 = as built
  scrollbar?: "hidden" | "thin" | "default";
  motion?: "full" | "reduced";
  deckDefault?: "dark" | "light";
  cursorRing?: boolean;
  css?: string;
}

/** One customer review on the landing page (Admin > Landing > Reviews). */
export interface ReviewItem {
  id: string;
  name: string;
  handle?: string;
  body: string;
  /** Uploaded (/api/v1/site-media/…) or https picture; initials are shown without one. */
  avatar?: string;
  hidden?: boolean;
}

/**
 * Bump when the default reviews are replaced. Reviews saved in Admin before
 * this version (ids without the prefix) are ignored so the new set shows.
 */
export const REVIEWS_VERSION = "v3";
const REVIEW_ID_PREFIX = `${REVIEWS_VERSION}-`;

/** A fresh id for a review added in Admin, tied to the current version. */
export function newReviewId(): string {
  return `${REVIEW_ID_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

/** Saved reviews if they belong to the current set, otherwise the defaults. */
export function currentReviews(saved: ReviewItem[] | undefined): ReviewItem[] {
  if (saved?.length && saved.some((r) => typeof r.id === "string" && r.id.startsWith(REVIEW_ID_PREFIX))) return saved;
  return DEFAULT_REVIEWS;
}

export const DEFAULT_REVIEWS: ReviewItem[] = [
  {
    id: "v3-1",
    name: "Karim B.",
    handle: "Media Buyer · Meta & TikTok",
    body: "Formatting campaign videos for Reels, TikTok, and Shorts used to take our team two days. Now we drop in the master cut, apply our brand preset, and export the whole batch in minutes.",
  },
  {
    id: "v3-2",
    name: "Laura M.",
    handle: "Skincare Brand Owner",
    body: "I'm not a professional video editor. With ProteusFlow I upload our product clips, pick the Instagram Reels preset, add our logo watermark, and download clean HD videos ready to post.",
  },
  {
    id: "v3-3",
    name: "Daniel R.",
    handle: "Creative Strategist · DTC Agency",
    body: "We produce dozens of social deliverables every week. ProteusFlow handles the aspect-ratio formatting, color grading, and cover frames so our strategists stay focused on creative direction.",
  },
  {
    id: "v3-4",
    name: "Aditya S.",
    handle: "Freelance Video Editor",
    body: "Clients always ask for multiple aspect ratios and branded cuts. I finish the main edit, run the batch through ProteusFlow, and deliver a single organized ZIP in minutes.",
  },
  {
    id: "v3-5",
    name: "Lucas F.",
    handle: "Senior Media Buyer",
    body: "Having our brand watermark, frame-0 thumbnail, and −14 LUFS audio leveling applied automatically across every video in a campaign saves us hours on every launch.",
  },
  {
    id: "v3-6",
    name: "Reem A.",
    handle: "Supplements E-Com Founder",
    body: "I run my store and social channels myself. The built-in logo placement and custom cover frame picker mean every product video goes out looking polished without opening Premiere.",
  },
  {
    id: "v3-7",
    name: "Sofia G.",
    handle: "Creative Strategist",
    body: "What impressed me most is the export quality. On-screen captions stay razor-sharp, skin tones look natural with the Rec.709 LUT, and the voiceover leveling is broadcast-clean.",
  },
  {
    id: "v3-8",
    name: "Miguel T.",
    handle: "Video Editor · UGC Studio",
    body: "I edit 30+ UGC videos a week. Batch-processing 20 clips at once with consistent audio normalization and downloading one ZIP saves me hours of manual timeline exports.",
  },
  {
    id: "v3-9",
    name: "Hamza Q.",
    handle: "Performance Media Buyer",
    body: "Customer support is genuinely fast. I had a question about setting up custom cover thumbnails, the assistant guided me right away, and a live agent followed up in under 20 minutes.",
  },
  {
    id: "v3-10",
    name: "Nadia K.",
    handle: "Cosmetics Brand Owner",
    body: "Product launches require so many video formats at once. One shoot day turns into a complete set of branded Reels, TikToks, and YouTube Shorts in a single afternoon.",
  },
  {
    id: "v3-11",
    name: "Tom W.",
    handle: "Head of Creative · E-Com Brand",
    body: "We standardized our post-production around ProteusFlow: edit the hero cut once, apply our brand overlay and audio master in the cloud, and hand the finished ZIP to the marketing team.",
  },
  {
    id: "v3-12",
    name: "Priya N.",
    handle: "Freelance Motion Editor",
    body: "I compared the H.264 exports frame by frame against my local render queue. Clean gradients, zero banding, and crisp typography—now it's a permanent part of my delivery pipeline.",
  },
  {
    id: "v3-13",
    name: "Ahmed E.",
    handle: "Media Buyer · E-Com",
    body: "The platform presets take all the guesswork out of export specs. Whether we're preparing assets for Reels, TikTok, or Shorts, the framing and audio levels come out right every time.",
  },
  {
    id: "v3-14",
    name: "Carla D.",
    handle: "Parapharmacy Store Owner",
    body: "Transparent token pricing and automatic refunds if an upload ever fails. It's refreshing to use a cloud video studio where billing is completely predictable.",
  },
  {
    id: "v3-15",
    name: "Jonas H.",
    handle: "Creative Strategist · Paid Social",
    body: "Our agency manages eight e-commerce brands. Being able to drag each client's PNG watermark onto the live preview and batch-export their campaigns has doubled our weekly output.",
  },
  {
    id: "v3-16",
    name: "Rizal P.",
    handle: "Video Editor · Agency",
    body: "The interactive watermark preview is spot on. Position the logo, set the opacity and fade timing, pick a cover frame, and apply it across the entire batch in one click.",
  },
  {
    id: "v3-17",
    name: "Fatima Z.",
    handle: "Fashion E-Com Founder",
    body: "We shoot lookbooks on iPhone and polish them in ProteusFlow. The color grading and aspect-ratio tools make our vertical videos look like they came from a dedicated post house.",
  },
  {
    id: "v3-18",
    name: "Bruno C.",
    handle: "Media Buying Team Lead",
    body: "Our marketers don't have to bottleneck the video editors for simple logo placements or aspect-ratio exports anymore. The 5-seat Max plan lets the whole team collaborate seamlessly.",
  },
  {
    id: "v3-19",
    name: "Elif Y.",
    handle: "Creative Strategist · Beauty",
    body: "The 4-step studio layout and interactive walkthrough got our entire creative team onboarded in ten minutes. Clean interface, fast cloud queue, and reliable ZIP downloads.",
  },
  {
    id: "v3-20",
    name: "Owen L.",
    handle: "Freelance Editor & Media Buyer",
    body: "I handle both post-production and campaign launches for my clients. ProteusFlow bridges that gap perfectly—finish the edit, apply branding and audio polish, and export the batch.",
  },
];

export interface SiteContent {
  text?: Record<string, string>;
  style?: Record<string, TextStyle>;
  media?: Record<string, MediaValue>;
  link?: Record<string, LinkValue>;
  icon?: Record<string, string>;
  hide?: Record<string, boolean>;
  list?: Record<string, ListEntry[]>;
  section?: Record<string, SectionStyle>;
  theme?: ThemeValue;
  meta?: { title?: string; description?: string; favicon?: string };
  reviews?: ReviewItem[];
}

export interface ContentRecord {
  draft: SiteContent;
  published: SiteContent;
  draft_updated_at: string | null;
  published_at: string | null;
}

/** What a rendered component tells the editor about one editable thing. */
export type FieldType = "text" | "longtext" | "headline" | "media" | "slot" | "link" | "icon" | "list" | "section" | "toggle";

export interface FieldInfo {
  key: string;
  type: FieldType;
  label?: string;
  /** The built-in value, so the editor can show it and reset to it. */
  fallback?: unknown;
  /** For lists: how many built-in items there are. */
  count?: number;
  /** For lists: a short name for each built-in item. */
  items?: string[];
  /** For lists whose items cannot be duplicated (page sections). */
  fixed?: boolean;
  /** For lists: built-in items that were removed from the site (hidden in the editor). */
  retired?: number[];
  /** For lists: the built-in arrangement, by item number (default: as declared). */
  order?: number[];
  /** Editor heading to list the field under (auto-found labels use their page). */
  group?: string;
  page?: string;
}

/** Messages between the admin editor and the preview frame. */
export type PreviewMessage =
  | { type: "cms:ready"; namespace: Namespace; page: string }
  | { type: "cms:fields"; namespace: Namespace; page: string; fields: FieldInfo[] }
  | { type: "cms:content"; content: SiteContent }
  | { type: "cms:pick"; on: boolean }
  | { type: "cms:picked"; key: string };

export const PREVIEW_PARAM = "cms_preview";

/** Server components: the published document, or {} if the API is unreachable. */
export async function loadPublishedContent(namespace: Namespace): Promise<SiteContent> {
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/api/v1/site-content/${namespace}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return {};
    const data = (await response.json()) as { content?: unknown };
    return data.content && typeof data.content === "object" ? cleanSiteContent(data.content as SiteContent) : {};
  } catch {
    return {};
  }
}

/** Browser: the published document. */
export async function fetchPublishedContent(namespace: Namespace): Promise<SiteContent> {
  try {
    const response = await fetch(`/api/v1/site-content/${namespace}`, { cache: "no-store" });
    if (!response.ok) return {};
    const data = (await response.json()) as { content?: SiteContent };
    return data.content ?? {};
  } catch {
    return {};
  }
}

// --- admin -----------------------------------------------------------------

async function adminCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/admin/site-content${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const contentAdmin = {
  read: (ns: Namespace) => adminCall<ContentRecord>(`/${ns}`),
  saveDraft: (ns: Namespace, draft: SiteContent) =>
    adminCall<ContentRecord>(`/${ns}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
  publish: (ns: Namespace) => adminCall<ContentRecord>(`/${ns}/publish`, { method: "POST" }),
  discard: (ns: Namespace) => adminCall<ContentRecord>(`/${ns}/discard`, { method: "POST" }),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return adminCall<{ url: string; name: string; type: string; size: number }>(`/media`, { method: "POST", body });
  },
};

// --- colours -----------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
}

/** The ten accent shades (50-900) from one colour, as "r g b" triples for Tailwind. */
export function accentScale(hex: string): Record<string, string> | null {
  const base = hexToRgb(hex);
  if (!base) return null;
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const steps: Record<string, [number, number, number]> = {
    50: mix(base, white, 0.9),
    100: mix(base, white, 0.8),
    200: mix(base, white, 0.6),
    300: mix(base, white, 0.4),
    400: mix(base, white, 0.2),
    500: base,
    600: mix(base, black, 0.2),
    700: mix(base, black, 0.4),
    800: mix(base, black, 0.6),
    900: mix(base, black, 0.8),
  };
  return Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.join(" ")]));
}

export function rgbTriple(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(" ") : null;
}

/** Fonts offered in the editor; each is loaded from Google Fonts when picked. */
export const FONT_CHOICES = [
  "Geist",
  "Geist Mono",
  "Instrument Serif",
  "Inter",
  "Manrope",
  "DM Sans",
  "Plus Jakarta Sans",
  "Space Grotesk",
  "Sora",
  "Outfit",
  "Urbanist",
  "Poppins",
  "Montserrat",
  "Work Sans",
  "Archivo",
  "Syne",
  "Unbounded",
  "Bricolage Grotesque",
  "Playfair Display",
  "DM Serif Display",
  "Fraunces",
  "Cormorant Garamond",
  "Libre Baskerville",
  "Bebas Neue",
  "Anton",
  "Oswald",
  "JetBrains Mono",
  "IBM Plex Mono",
  "Space Mono",
  "Fira Code",
  "Roboto Mono",
  "Cairo",
  "Tajawal",
  "Almarai",
];

/** Fonts that ship with the app and need no download. */
export const BUILT_IN_FONTS: Record<string, string> = {
  Geist: "var(--font-geist-sans)",
  "Geist Mono": "var(--font-geist-mono)",
};

export function googleFontsHref(families: string[]): string | null {
  const wanted = Array.from(new Set(families.filter((f) => f && !BUILT_IN_FONTS[f])));
  if (!wanted.length) return null;
  const query = wanted
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:ital,wght@0,400;0,500;0,600;0,700;1,400`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

export function fontStack(family: string | undefined, fallback: string): string | null {
  if (!family) return null;
  if (BUILT_IN_FONTS[family]) return `${BUILT_IN_FONTS[family]}, ${fallback}`;
  return `"${family.replace(/"/g, "")}", ${fallback}`;
}

/** True when a URL looks like a video file. */
export function isVideoUrl(src: string | undefined): boolean {
  return !!src && /\.(mp4|webm|mov)(\?|#|$)/i.test(src);
}
