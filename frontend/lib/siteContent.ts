/**
 * Admin-editable site content (Admin > Landing / Workspace).
 *
 * A document only holds overrides. Every component passes its built-in text,
 * media and links as the fallback, so an empty document renders the page
 * exactly as shipped, and "reset" in the editor just deletes the override.
 */

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
  fit?: "cover" | "contain" | "fill";
  width?: number; // max width in px, 0 = natural
  height?: number; // px, 0 = auto
  radius?: number; // px
  align?: "left" | "center" | "right";
  opacity?: number; // 0-1
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
    return data.content && typeof data.content === "object" ? (data.content as SiteContent) : {};
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
