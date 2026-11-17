import type { SiteContent } from "@/lib/siteContent";

/**
 * The landing page FAQ as shipped. Kept outside the (client) Faq component so
 * the server can also turn it into FAQPage structured data for Google.
 */
export const FAQS = [
  {
    q: "What does ProteusFlow do and how does it fit into my editing workflow?",
    a: "ProteusFlow is a browser-based batch production studio that sits right after your main edit. Once you finish cutting a video or designing an image in Premiere, CapCut, or Figma, upload it to ProteusFlow to format it for Reels, TikTok, and YouTube Shorts, apply consistent Rec.709 color grading and broadcast audio leveling (−14 LUFS), burn in your brand watermark and cover frame, and export your full batch in minutes.",
    tag: "Workflow",
  },
  {
    q: "Does exporting through ProteusFlow preserve my original video and audio quality?",
    a: "Yes. Every export is rendered using broadcast-grade H.264/H.265 encoding that preserves crisp on-screen captions, accurate product colors, natural skin tones, and clean −14 LUFS stereo audio across every file in your batch.",
    tag: "Quality",
  },
  {
    q: "How do the Brand Logo Overlay and Cover Frame tools work?",
    a: "In Step 03 of the studio, you can upload a transparent PNG or WebP watermark, drag it anywhere on the live video preview, and set its size, opacity, and fade-in/out timing. You can also scrub to any frame in your video—or upload a custom cover image—to embed as the thumbnail.",
    tag: "Branding",
  },
  {
    q: "Which file formats and social platforms are supported?",
    a: "ProteusFlow accepts MP4, MOV, WEBM, and MKV videos as well as PNG, JPG, and WEBP images (up to 500 MB per file). Built-in presets format your exports for Instagram Reels & Feed, TikTok, YouTube Shorts, Snapchat, and Google video/display placements.",
    tag: "Formats",
  },
  {
    q: "How many files can I batch-process at once?",
    a: "You can drop up to 20 videos or images into a single batch and generate up to 10 formatted exports per upload, then download individual files or grab the entire batch in one organized ZIP archive.",
    tag: "Batching",
  },
  {
    q: "How do plans, render tokens, and team seats work?",
    a: "Each plan gives you a 30-day allowance of studio render tokens with no long-term contracts. Unused tokens roll over on Pro and Max plans when you renew on time, any failed or canceled render is automatically refunded to your balance, and the Max plan includes up to 5 team seats.",
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
