import type { SiteContent } from "@/lib/siteContent";

/**
 * The landing page FAQ as shipped. Kept outside the (client) Faq component so
 * the server can also turn it into FAQPage structured data for Google.
 */
export const FAQS = [
  {
    q: "How is ProteusFlow different from a traditional timeline editor like CapCut or Premiere?",
    a: "Traditional editors require manual cutting, color grading, and exporting one file at a time. ProteusFlow is an automated creative variation studio: upload your finished video or image once, and our cloud pipeline renders up to 10 studio-polished variations—complete with color grading, framing adjustments, audio mastering, and brand overlays—in under a minute.",
    tag: "Studio",
  },
  {
    q: "Will generating variations reduce my video or audio quality?",
    a: "No. ProteusFlow's 23 studio variation layers are engineered to preserve 1:1 visual sharpness, natural colors, and crystal-clear voiceovers across every export.",
    tag: "Quality",
  },
  {
    q: "Are my uploaded creatives private and secure?",
    a: "Yes. Your media is processed inside an isolated, encrypted cloud workspace used solely to render your requested variations and let you download the outputs. Files are automatically purged on a rolling schedule.",
    tag: "Privacy",
  },
  {
    q: "What does ProteusFlow change across each variation?",
    a: "Depending on your selected profile (Light, Balanced, Studio Pro, Dynamic, or Max Studio), ProteusFlow applies a unique combination of 3D LUT color grading, subtle lens and framing adjustments, frame-rate cadence tuning, broadcast audio EQ/phase mastering, brand logo overlays, custom cover frames, and clean export packaging.",
    tag: "Features",
  },
  {
    q: "Which ad formats and social platforms does ProteusFlow support?",
    a: "ProteusFlow includes built-in export profiles for Meta (Facebook & Instagram Reels/Feed), TikTok, and YouTube Shorts—supporting both vertical/horizontal videos (MP4, MOV, WEBM, MKV) and static images (PNG, JPG, WEBP).",
    tag: "Platforms",
  },
  {
    q: "Can I generate multiple variations from a single upload?",
    a: "Yes. You can generate from 1 to 10 distinct variations per upload and download them all in a single ZIP archive, making it effortless to organize creative testing across multiple campaigns and ad sets.",
    tag: "Batching",
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
  const entries = content.list?.["faq.items"] ?? FAQS.map((_, i) => ({ id: String(i), from: i }));
  const text = content.text ?? {};
  return entries
    .filter((entry) => !hide[`faq.items.${entry.id}`] && FAQS[entry.from])
    .map((entry) => {
      const item = FAQS[entry.from];
      const key = `faq.items.${entry.id}`;
      return {
        q: (typeof text[`${key}.q`] === "string" ? text[`${key}.q`] : item.q).trim(),
        a: (typeof text[`${key}.a`] === "string" ? text[`${key}.a`] : item.a).trim(),
      };
    })
    .filter((f) => f.q && f.a);
}
