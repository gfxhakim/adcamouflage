"use client";

import { motion } from "framer-motion";
import { Rocket, ShieldCheck } from "lucide-react";

import { CmsIcon, CmsLink, CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import MatrixWords from "@/components/landing/MatrixWords";
import { CmsHeadline, EASE } from "@/components/landing/primitives";

// The hero background morphs between these, cell by cell.
const WORDS = ["EDIT IT", "SCALE IT", "SHIP IT"];

export function Hero({ startHref }: { startHref: string }) {
  const cms = useCms();
  const words = cms
    .text("hero.matrixWords", WORDS.join(", "), "text", "Background words (comma separated)")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  return (
    <CmsSection
      k="hero"
      label="Hero"
      id="home"
      className="relative isolate flex min-h-[100svh] scroll-mt-24 flex-col overflow-hidden bg-black text-white"
    >
      <CmsSlot k="hero.background" label="Background animation" className="absolute inset-0 h-full object-cover">
        <MatrixWords
          words={words.length ? words : WORDS}
          centerY={0.205}
          maxHeight={0.21}
          className="absolute inset-0 h-full w-full"
        />
      </CmsSlot>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black via-black/82 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-end px-4 pb-6 pt-[clamp(14rem,32svh,19.5rem)] text-center sm:px-6 sm:pb-8 lg:pt-[clamp(15.5rem,33svh,21rem)]">
        <motion.span
          className="mb-4 inline-flex max-w-[92vw] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.08] px-3.5 py-1.5 text-[10px] font-semibold leading-snug tracking-[0.04em] text-white/85 backdrop-blur sm:mb-5 sm:max-w-none sm:rounded-full sm:py-1 sm:text-[11px]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <CmsIcon k="hero.badge.icon" fallback={ShieldCheck} className="h-3.5 w-3.5 shrink-0 text-meta-400" aria-hidden />
          <T k="hero.studioBadge">CLOUD VIDEO FORMATTER • BRAND OVERLAYS & BATCH EXPORT</T>
        </motion.span>

        <CmsHeadline
          k="hero.studioHeadline"
          as="h1"
          dark
          text="One Master Video. | [Formatted, Branded &] | [Exported in Minutes.]"
          className="font-bold leading-[1.08] tracking-[-0.015em] text-[1.95rem] min-[400px]:text-[2.25rem] sm:text-5xl md:text-6xl lg:text-[4.5rem] xl:text-[5rem]"
        />

        <T
          k="hero.studioLede"
          long
          as={motion.p}
          className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-white/75 sm:mt-5 sm:text-base"
          // Visible from the first paint (it is the page's largest text, so a
          // fade-in from 0 would delay Largest Contentful Paint); it only slides.
          initial={{ opacity: 1, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          {"ProteusFlow is an online video and image production studio for marketing teams and creators. Format clips for Reels, TikTok, and YouTube Shorts, apply studio Rec.709 color grading and −14 LUFS audio leveling, burn in your brand logo and cover frame, and batch-export ready-to-publish files."}
        </T>

        <motion.div
          className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-7"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.65, ease: EASE }}
        >
          <CmsLink
            k="hero.studioCta"
            href={startHref}
            label="Open ProteusFlow Studio"
            className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-black transition hover:bg-meta-50"
          >
            {(label) => (
              <>
                {label}
                <span className="grid h-8 w-8 place-items-center rounded-full bg-meta-500 text-white transition-transform group-hover:rotate-[-45deg]">
                  <CmsIcon k="hero.cta.icon" fallback={Rocket} className="h-4 w-4" aria-hidden />
                </span>
              </>
            )}
          </CmsLink>
        </motion.div>

        <T k="hero.studioFootnote" as="p" className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">
          Browser-Based Studio • Multi-Format Batch Export • Broadcast-Grade H.264 / H.265 Quality
        </T>
      </div>
    </CmsSection>
  );
}

export default Hero;
