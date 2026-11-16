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

export function Faq() {
  const cms = useCms();
  const faqs = cms.list("faq.studioItems", FAQS, "Questions", FAQS.map((f) => f.q));
  const [open, setOpen] = useState(0);

  return (
    <CmsSection k="faq" label="FAQ" id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <CmsHeadline k="faq.studioHeadline" text="Frequently Asked Questions." className="text-4xl sm:text-5xl lg:text-6xl" />

          <CmsSection k="faq.card" label="Help card" as="div" className="mt-10 max-w-sm rounded-3xl bg-black p-6 text-white">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-meta-400" />
              <T k="faq.card.studioKicker">Ready to try it?</T>
            </p>
            <T k="faq.card.studioTitle" as="p" className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              Export your first branded video batch in minutes.
            </T>
            <T k="faq.card.studioBody" long as="p" className="mt-2 text-sm text-white/60">
              Create an account, drop in your master video or image, add your brand watermark and cover frame, and download your batch.
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
