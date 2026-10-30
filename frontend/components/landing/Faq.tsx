"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";

import { CmsIcon, CmsLink, CmsSection, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, EASE, PillArrow, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "Is AdCamouflage a video editor like CapCut or Premiere?",
    a: "No. Video editors are built for humans to cut clips and add captions. AdCamouflage is an automated binary and structural sanitization engine. You upload your finished ad creative, and our engine alters its internal file fingerprint, pixel matrix, and audio frequencies so ad algorithms treat it as a brand-new, never-before-seen asset.",
    tag: "Engine",
  },
  {
    q: "Will mutating my video or image reduce its visual or audio quality?",
    a: "Not at all. Our mutation parameters operate at the sub-pixel and micro-frequency level. To your prospects watching the ad, the visual sharpness, colors, and voiceover clarity remain 100% identical to your original export.",
    tag: "Quality",
  },
  {
    q: "Are my winning creatives safe? Do you store my uploaded ads?",
    a: "Your creatives never stay on our servers. All files are processed inside an isolated, encrypted container and are automatically and permanently deleted immediately after processing. Nobody—including our team—can view or access your ads.",
    tag: "Privacy",
  },
  {
    q: "Why is simply removing metadata not enough anymore?",
    a: "Ad platforms stopped relying solely on basic file metadata years ago. Today, automated review bots generate perceptual hashes of your video frames and run AI speech-to-text on your audio track. If you only strip metadata, the algorithm still recognizes the visual and audio signature in seconds. AdCamouflage modifies all three layers: metadata, optical pixels, and audio frequencies.",
    tag: "Security",
  },
  {
    q: "Which ad platforms does AdCamouflage work for?",
    a: "Our presets are engineered specifically for Meta Ads (Facebook & Instagram), TikTok Ads, and Google/YouTube Ads—supporting both vertical short-form videos and static image formats.",
    tag: "Platforms",
  },
  {
    q: "Can I generate multiple unique copies from a single video?",
    a: "Yes. If you are launching the same winning creative across 5 or 10 contingency ad accounts, you can generate multiple distinct downloads from a single upload. Every file receives a completely independent hash and mutation pattern so accounts are never linked by creative footprint.",
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
          <SectionTag k="faq.tag" index="06">FREQUENTLY ASKED QUESTIONS</SectionTag>
          <CmsHeadline k="faq.headline" text="Everything You Need to Know Before You Upload." className="mt-5 text-4xl sm:text-5xl lg:text-6xl" />

          <CmsSection k="faq.card" label="Help card" as="div" className="mt-10 max-w-sm rounded-3xl bg-black p-6 text-white">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-meta-400" />
              <T k="faq.card.kicker">Still unsure?</T>
            </p>
            <T k="faq.card.title" as="p" className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              Camouflage your first creative in under a minute.
            </T>
            <T k="faq.card.body" long as="p" className="mt-2 text-sm text-white/60">
              Create an account, drop in a file, and process a clean variant before the next moderation loop hits.
            </T>
            <CmsLink
              k="faq.card.cta"
              href="/login"
              label="Test the Engine Now"
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
