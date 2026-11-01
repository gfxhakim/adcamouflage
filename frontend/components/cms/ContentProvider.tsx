"use client";

import { MotionConfig } from "framer-motion";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import AutoText from "@/components/cms/AutoText";
import { DECK_THEME_EVENT } from "@/lib/deckTheme";
import { DECK_THEME_ATTR, DECK_THEME_STORAGE_KEY } from "@/lib/deckThemeScript";
import {
  PREVIEW_PARAM,
  accentScale,
  fontStack,
  googleFontsHref,
  rgbTriple,
  type FieldInfo,
  type LinkValue,
  type ListEntry,
  type MediaValue,
  type Namespace,
  type PreviewMessage,
  type SectionStyle,
  type SiteContent,
  type TextStyle,
} from "@/lib/siteContent";

export interface ListItem<T> {
  id: string;
  index: number;
  from: number;
  item: T;
  /** Key prefix for this item's own fields, e.g. "faq.items.2". */
  key: string;
}

export interface CmsApi {
  namespace: Namespace;
  content: SiteContent;
  preview: boolean;
  register: (field: FieldInfo) => void;
  text: (key: string, fallback: string, type?: "text" | "longtext" | "headline", label?: string) => string;
  hidden: (key: string) => boolean;
  textStyle: (key: string) => CSSProperties | undefined;
  media: (key: string, fallback: MediaValue, label?: string) => MediaValue;
  link: (key: string, fallback: LinkValue, label?: string) => LinkValue;
  iconName: (key: string, fallback: string) => string | undefined;
  list: <T>(key: string, defaults: T[], label?: string, items?: string[], fixed?: boolean) => ListItem<T>[];
  section: (key: string, label?: string) => { hidden: boolean; style: CSSProperties | undefined };
  /** data-cms attribute for click-to-edit in the preview. */
  mark: (key: string) => { "data-cms"?: string };
}

const FONT_VARS: Record<string, string> = {
  sans: "var(--font-sans)",
  display: "var(--font-display)",
  mono: "var(--font-mono)",
};

export function textStyleCss(style: TextStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const css: CSSProperties = {};
  if (style.color) css.color = style.color;
  if (style.size) css.fontSize = `${style.size}px`;
  if (style.weight) css.fontWeight = style.weight;
  if (style.align) css.textAlign = style.align;
  if (style.italic) css.fontStyle = "italic";
  if (style.uppercase) css.textTransform = "uppercase";
  if (style.tracking !== undefined && style.tracking !== null) css.letterSpacing = `${style.tracking}em`;
  if (style.lineHeight) css.lineHeight = style.lineHeight;
  if (style.font) css.fontFamily = FONT_VARS[style.font];
  return Object.keys(css).length ? css : undefined;
}

function sectionCss(style: SectionStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const css: CSSProperties = {};
  if (style.background) css.backgroundColor = style.background;
  if (style.backgroundImage) {
    const veil = style.backgroundOverlay ? `linear-gradient(rgb(0 0 0 / ${style.backgroundOverlay}), rgb(0 0 0 / ${style.backgroundOverlay})), ` : "";
    css.backgroundImage = `${veil}url("${style.backgroundImage.replace(/"/g, "%22")}")`;
    css.backgroundSize = style.backgroundSize || "cover";
    css.backgroundPosition = "center";
  }
  if (style.textColor) css.color = style.textColor;
  if (style.paddingY !== undefined && style.paddingY !== null) {
    css.paddingTop = `${style.paddingY}px`;
    css.paddingBottom = `${style.paddingY}px`;
  }
  if (style.radius) {
    css.borderRadius = `${style.radius}px`;
    css.overflow = "hidden";
  }
  return Object.keys(css).length ? css : undefined;
}

function noop() {}

const PAGE_NAMES: Record<string, string> = {
  "/app": "Workspace texts",
  "/app/history": "History texts",
  "/app/plan": "My plan texts",
};

function pageGroup(path: string): string {
  return PAGE_NAMES[path] ?? `Texts on ${path}`;
}

function buildApi(
  namespace: Namespace,
  content: SiteContent,
  preview: boolean,
  register: (field: FieldInfo) => void,
): CmsApi {
  const hide = content.hide ?? {};
  return {
    namespace,
    content,
    preview,
    register,
    text(key, fallback, type = "text", label) {
      register({ key, type, fallback, label });
      const value = content.text?.[key];
      return typeof value === "string" ? value : fallback;
    },
    hidden: (key) => !!hide[key],
    textStyle: (key) => textStyleCss(content.style?.[key]),
    media(key, fallback, label) {
      register({ key, type: "media", fallback, label });
      return { ...fallback, ...(content.media?.[key] ?? {}) };
    },
    link(key, fallback, label) {
      register({ key, type: "link", fallback, label });
      return { ...fallback, ...(content.link?.[key] ?? {}) };
    },
    iconName(key, fallback) {
      register({ key, type: "icon", fallback });
      return content.icon?.[key];
    },
    list<T>(key: string, defaults: T[], label?: string, items?: string[], fixed?: boolean) {
      register({ key, type: "list", count: defaults.length, label, items, fixed });
      const entries: ListEntry[] = content.list?.[key] ?? defaults.map((_, i) => ({ id: String(i), from: i }));
      return entries
        .filter((entry) => !hide[`${key}.${entry.id}`])
        .map((entry, index) => ({
          id: entry.id,
          index,
          from: entry.from,
          item: defaults[entry.from] ?? defaults[0],
          key: `${key}.${entry.id}`,
        }))
        .filter((entry) => entry.item !== undefined);
    },
    section(key, label) {
      register({ key, type: "section", label });
      return { hidden: !!hide[key], style: sectionCss(content.section?.[key]) };
    },
    mark: (key) => (preview ? { "data-cms": key } : {}),
  };
}

const CmsContext = createContext<CmsApi>(buildApi("landing", {}, false, noop));

export function useCms(): CmsApi {
  return useContext(CmsContext);
}

function ThemeStyle({ namespace, content }: { namespace: Namespace; content: SiteContent }) {
  const theme = content.theme ?? {};
  const scope = `.cms-${namespace}`;
  const rules: string[] = [];
  const vars: string[] = [];

  const scale = theme.accent ? accentScale(theme.accent) : null;
  if (scale) for (const [step, rgb] of Object.entries(scale)) vars.push(`--meta-${step}-rgb: ${rgb}; --meta-${step}: rgb(${rgb});`);

  const ink = theme.ink && rgbTriple(theme.ink);
  if (ink) vars.push(`--ink-rgb: ${ink}; --ink: ${theme.ink};`);
  const muted = theme.muted && rgbTriple(theme.muted);
  if (muted) vars.push(`--ink-muted-rgb: ${muted}; --ink-subtle-rgb: ${muted}; --ink-muted: ${theme.muted};`);
  if (theme.page) vars.push(`--page: ${theme.page};`);

  const sans = fontStack(theme.fontSans, "ui-sans-serif, system-ui, sans-serif");
  const display = fontStack(theme.fontDisplay, "Georgia, serif");
  const mono = fontStack(theme.fontMono, "ui-monospace, monospace");
  if (sans) vars.push(`--font-sans: ${sans};`);
  if (display) vars.push(`--font-display: ${display};`);
  if (mono) vars.push(`--font-mono: ${mono};`);
  if (theme.baseSize) vars.push(`font-size: ${theme.baseSize}px;`);

  // html:root outranks the font classes next/font puts on <html>.
  if (vars.length) rules.push(`html:root { ${vars.join(" ")} }`);
  if (sans) rules.push(`body, ${scope} { font-family: var(--font-sans); }`);
  if (theme.page) rules.push(`body { background-color: var(--page); }`);

  // Recolour the fixed black/white/grey surfaces the landing is built from.
  if (theme.dark) {
    rules.push(
      `${scope} .bg-black { background-color: ${theme.dark}; } ${scope} .from-black { --tw-gradient-from: ${theme.dark} var(--tw-gradient-from-position); --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); } ${scope} .via-black { --tw-gradient-to: transparent var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${theme.dark} var(--tw-gradient-via-position), var(--tw-gradient-to); } ${scope} .to-black { --tw-gradient-to: ${theme.dark} var(--tw-gradient-to-position); }`,
    );
  }
  if (theme.light) rules.push(`${scope} .bg-white { background-color: ${theme.light}; }`);
  if (theme.soft) {
    rules.push(`${scope} .bg-\\[\\#F4F5F7\\], ${scope} .bg-\\[\\#E9EBEF\\] { background-color: ${theme.soft}; }`);
  }
  if (theme.ink) rules.push(`${scope} .text-black { color: ${theme.ink}; }`);
  if (theme.radius && theme.radius !== 1) {
    const r = theme.radius;
    rules.push(
      `${scope} .rounded-3xl { border-radius: ${1.5 * r}rem; } ${scope} .rounded-2xl { border-radius: ${1 * r}rem; } ${scope} .rounded-xl { border-radius: ${0.75 * r}rem; } ${scope} .rounded-\\[28px\\] { border-radius: ${28 * r}px; } ${scope} .rounded-\\[22px\\] { border-radius: ${22 * r}px; } ${scope} .rounded-\\[20px\\] { border-radius: ${20 * r}px; }`,
    );
  }

  const scrollbar = theme.scrollbar ?? (namespace === "landing" ? "hidden" : undefined);
  if (scrollbar === "hidden") {
    // The page and every box inside it: they all keep scrolling, just without a visible bar.
    rules.push(
      `html, body, ${scope} * { scrollbar-width: none; -ms-overflow-style: none; } html::-webkit-scrollbar, body::-webkit-scrollbar, ${scope} *::-webkit-scrollbar { display: none; width: 0; height: 0; }`,
    );
  } else if (scrollbar === "default") {
    rules.push(`html { scrollbar-width: auto; scrollbar-color: auto; } html::-webkit-scrollbar { width: auto; } html::-webkit-scrollbar-thumb { background: rgb(0 0 0 / 0.3); }`);
  }

  if (theme.css) rules.push(theme.css);

  const fonts = googleFontsHref([theme.fontSans ?? "", theme.fontDisplay ?? "", theme.fontMono ?? ""]);
  const css = rules.join("\n").replace(/<\/style/gi, "<\\/style");

  return (
    <>
      {fonts ? <link rel="stylesheet" href={fonts} /> : null}
      {css ? <style data-cms-theme={namespace} dangerouslySetInnerHTML={{ __html: css }} /> : null}
    </>
  );
}

const PICK_CSS = `[data-cms], [data-cms-auto] { cursor: crosshair !important; } [data-cms]:hover, [data-cms-auto]:hover { outline: 2px dashed #0866ff !important; outline-offset: 3px; }`;

export function ContentProvider({
  namespace,
  initial,
  autoText = false,
  children,
}: {
  namespace: Namespace;
  initial?: SiteContent;
  /** Also make every plain label on the page editable (see AutoText). */
  autoText?: boolean;
  children: ReactNode;
}) {
  const [content, setContent] = useState<SiteContent>(initial ?? {});
  const [preview, setPreview] = useState(false);
  const [pick, setPick] = useState(false);
  const pathname = usePathname() || "/";

  const fields = useRef(new Map<string, FieldInfo>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(pathname);
  pageRef.current = pathname;

  useEffect(() => {
    setContent(initial ?? {});
  }, [initial]);

  // The admin editor loads pages in a frame with ?cms_preview=1 and pushes the draft in.
  useEffect(() => {
    const inFrame = window.parent !== window;
    if (!inFrame || !new URLSearchParams(window.location.search).has(PREVIEW_PARAM)) return;
    setPreview(true);
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "cms:content") setContent(event.data.content ?? {});
      if (event.data.type === "cms:pick") setPick(!!event.data.on);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = useCallback((message: PreviewMessage) => {
    window.parent.postMessage(message, window.location.origin);
  }, []);

  // Each page tells the editor once it has loaded, so the editor sends the draft.
  useEffect(() => {
    if (!preview) return;
    fields.current = new Map();
    post({ type: "cms:ready", namespace, page: pathname });
  }, [preview, pathname, namespace, post]);

  const register = useCallback(
    (field: FieldInfo) => {
      if (!preview) return;
      const known = fields.current.get(field.key);
      if (known && known.type === field.type && JSON.stringify(known.fallback) === JSON.stringify(field.fallback)) return;
      fields.current.set(field.key, { ...field, page: pageRef.current });
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        post({ type: "cms:fields", namespace, page: pageRef.current, fields: Array.from(fields.current.values()) });
      }, 150);
    },
    [preview, namespace, post],
  );

  // Click-to-edit: in pick mode a click on any editable element selects its field.
  useEffect(() => {
    if (!preview || !pick) return;
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-cms], [data-cms-auto]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      post({ type: "cms:picked", key: target.dataset.cms ?? target.dataset.cmsAuto ?? "" });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [preview, pick, post]);

  const api = useMemo(() => buildApi(namespace, content, preview, register), [namespace, content, preview, register]);

  // The workspace's starting theme, for visitors who never picked one themselves.
  const deckDefault = content.theme?.deckDefault;
  useEffect(() => {
    if (namespace !== "workspace" || !deckDefault) return;
    try {
      if (window.localStorage.getItem(DECK_THEME_STORAGE_KEY)) return;
    } catch {
      /* storage blocked: still apply the default */
    }
    if (deckDefault === "light") document.documentElement.setAttribute(DECK_THEME_ATTR, "light");
    else document.documentElement.removeAttribute(DECK_THEME_ATTR);
    window.dispatchEvent(new Event(DECK_THEME_EVENT));
  }, [namespace, deckDefault]);

  return (
    <CmsContext.Provider value={api}>
      <ThemeStyle namespace={namespace} content={content} />
      {pick ? <style dangerouslySetInnerHTML={{ __html: PICK_CSS }} /> : null}
      <MotionConfig reducedMotion={content.theme?.motion === "reduced" ? "always" : "user"}>
        <div className={`cms-${namespace} contents`}>{children}</div>
        {autoText ? <AutoText group={pageGroup} /> : null}
      </MotionConfig>
    </CmsContext.Provider>
  );
}
