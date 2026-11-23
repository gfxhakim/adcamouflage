import type { SiteContent } from "@/lib/siteContent";

/**
 * The landing page FAQ as shipped. Kept outside the (client) Faq component so
 * the server can also turn it into FAQPage structured data for Google.
 */
export const FAQS = [
  {
    q: "How does ProteusFlow fix rejected or restricted video ads?",
    a: "When an aggressive or direct-response winning ad gets rejected or throttled by Meta, TikTok, or YouTube, ProteusFlow uses its multi-layer AI engine to rebuild visual frames, Rec.709 color profiles, −14 LUFS broadcast audio, and clean container metadata—turning flagged creatives into fresh studio assets built to get approved and regain delivery.",
    tag: "Ad Recovery",
  },
  {
    q: "Do rebuilt aggressive creatives actually convert better?",
    a: "Yes. We preserve your exact hook, fast pacing, voiceover clarity, and crisp burned-in captions while refreshing underlying visual, audio, and encoding layers so campaigns stop stalling in review and sustain strong CTR and ROAS.",
    tag: "Performance",
  },
  {
    q: "Do I need a paid plan before generating videos?",
    a: "Creating an account is free, and once inside you activate a 30-day Starter, Pro, or Max plan to load studio render tokens. Pro and Max unlock the full AI layer engine for aggressive Meta, TikTok, and YouTube ads—while any render blocked or failed on our servers refunds 100% of tokens automatically.",
    tag: "Plans & Refunds",
  },
  {
    q: "Which ad platforms and file formats are supported?",
    a: "ProteusFlow accepts MP4, MOV, WEBM, and MKV videos as well as PNG, JPG, and WEBP images (up to 512 MB per upload), with studio presets tuned for Meta Feed/Reels, TikTok Ads, and YouTube Shorts/Ads.",
    tag: "Platforms",
  },
  {
    q: "How many files or variations can I render at once?",
    a: "You can render from 1 video × 1 variation up to 5 total outputs per batch (for example 5 creatives × 1 variant or 1 creative × 5 variants) for optimal quality and speed. Renders continue in the background even if you switch pages, and files stay downloadable in History for 48 hours.",
    tag: "Batching",
  },
  {
    q: "How do tokens, renewals, and unused-token refunds work?",
    a: "Each 30-day plan grants render tokens with zero automatic renewal trap. Unused tokens roll over on Pro and Max when renewed on time, server-failed renders cost 0 tokens, and eligible refunds cover the unused tokens remaining in your account (Max includes up to 5 team seats).",
    tag: "Billing",
  },
];

/** Position of the FAQ in the landing page's section list (app/page.tsx). */
const FAQ_SECTION_INDEX = 6;

/**
 * The questions visitors actually see, after Admin > Landing edits: same
 * order, same hidden items, same rewritten text. Empty when the section is off.
 */
export function publishedFaqs(content: SiteContent): { q: string; a: string }[] {
  const hide = content.hide ?? {};
  if (hide.faq) return [];
  const sections = content.list?.["page.sections"];
  if (sections) {
    const entry = sections.find((s) => s.from === FAQ_SECTION_INDEX);
    if (!entry || hide[`page.sections.${entry.id}`]) return [];
  } else if (hide[`page.sections.${FAQ_SECTION_INDEX}`]) {
    return [];
  }
  const entries = content.list?.["faq.studioItems"] ?? FAQS.map((_, i) => ({ id: String(i), from: i }));
  const text = content.text ?? {};
  return entries
    .filter((entry) => !hide[`faq.studioItems.${entry.id}`] && FAQS[entry.from])
    .map((entry) => {
      const item = FAQS[entry.from];
      const key = `faq.studioItems.${entry.id}`;
      return {
        q: (typeof text[`${key}.q`] === "string" ? text[`${key}.q`] : item.q).trim(),
        a: (typeof text[`${key}.a`] === "string" ? text[`${key}.a`] : item.a).trim(),
      };
    })
    .filter((f) => f.q && f.a);
}
