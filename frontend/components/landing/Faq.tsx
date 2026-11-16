"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";

import { CmsIcon, CmsLink, CmsSection, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, EASE, PillArrow } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const FAQS = [
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

export function Faq() {
  const cms = useCms();
  const faqs = cms.list("faq.items", FAQS, "Questions", FAQS.map((f) => f.q));
  const [open, setOpen] = useState(0);

  return (
    <CmsSection k="faq" label="FAQ" id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <CmsHeadline k="faq.headline" text="Everything You Need to Know Before You Upload." className="text-4xl sm:text-5xl lg:text-6xl" />

          <CmsSection k="faq.card" label="Help card" as="div" className="mt-10 max-w-sm rounded-3xl bg-black p-6 text-white">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-meta-400" />
              <T k="faq.card.kicker">Ready to try it?</T>
            </p>
            <T k="faq.card.title" as="p" className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              Render your first creative batch in under a minute.
            </T>
            <T k="faq.card.body" long as="p" className="mt-2 text-sm text-white/60">
              Create an account, drop in your master video or image, and export studio-ready variations in seconds.
            </T>
            <CmsLink
              k="faq.card.cta"
              href="/login"
              label="Open ProteusFlow Studio"
              className="group mt-5 inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white"
            >
              {(label) => (
                <>
                  {label}
                  <PillArrow dark />
                </>
              )}
            </CmsLink>
          </CmsSection>
        </div>

        <ul className="relative border-l border-black/10">
          {faqs.map(({ item, key, id }, i) => {
            const on = open === i;
            return (
              <li key={id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[5px] top-7 h-2.5 w-2.5 rounded-full border-2 transition-colors",
                    on ? "border-meta-500 bg-meta-500" : "border-black/20 bg-white",
                  )}
                  aria-hidden
                />
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl py-5 pl-5 pr-2 text-left transition-colors sm:gap-4 sm:pl-6 sm:pr-3",
                    on ? "bg-[#F4F5F7]" : "hover:bg-[#F4F5F7]/60",
                  )}
                  onClick={() => setOpen(on ? -1 : i)}
                  aria-expanded={on}
                >
                  <span className="font-mono text-[11px] text-ink-faint">0{i + 1}</span>
                  <T k={`${key}.q`} className="min-w-0 flex-1 text-base font-semibold tracking-tight text-black sm:text-lg">{item.q}</T>
                  <T k={`${key}.tag`} className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-faint sm:inline">
                    {item.tag}
                  </T>
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300",
                      on ? "rotate-45 border-meta-500 bg-meta-500 text-white" : "border-black/15 text-black",
                    )}
                  >
                    <CmsIcon k="faq.toggle.icon" fallback={Plus} className="h-4 w-4" aria-hidden />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.div
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      <T k={`${key}.a`} long as="p" className="max-w-2xl pb-6 pl-12 pr-4 text-sm leading-relaxed text-ink-muted sm:pl-14 sm:pr-6">{item.a}</T>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </CmsSection>
  );
}

export default Faq;
