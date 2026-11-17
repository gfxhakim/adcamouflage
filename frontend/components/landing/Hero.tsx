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
      className="relative isolate flex min-h-[max(100svh,820px)] scroll-mt-24 flex-col overflow-hidden bg-black text-white"
    >
      <CmsSlot k="hero.background" label="Background animation" className="absolute inset-0 h-full object-cover">
        <MatrixWords
          words={words.length ? words : WORDS}
          centerY={0.22}
          maxHeight={0.24}
          className="absolute inset-0 h-full w-full"
        />
      </CmsSlot>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black via-black/80 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-end px-4 pb-10 pt-[34svh] text-center sm:px-6 lg:pt-[39vh]">
        <motion.span
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <CmsIcon k="hero.badge.icon" fallback={ShieldCheck} className="h-3.5 w-3.5 text-meta-400" aria-hidden />
          <T k="hero.studioBadge">CLOUD VIDEO FORMATTER • BRAND OVERLAYS & BATCH EXPORT</T>
        </motion.span>

        <CmsHeadline
          k="hero.studioHeadline"
          as="h1"
          dark
          text="One Master Video. | [Formatted, Branded &] | [Exported in Minutes.]"
          className="text-[2.15rem] min-[400px]:text-[2.4rem] sm:text-6xl lg:text-[5.4rem]"
        />

        <T
          k="hero.studioLede"
          long
          as={motion.p}
          className="mt-6 max-w-3xl text-sm leading-relaxed text-white/75 sm:text-base"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          {"ProteusFlow is an online video and image production studio for marketing teams and creators. Format clips for Reels, TikTok, and YouTube Shorts, apply studio Rec.709 color grading and −14 LUFS audio leveling, burn in your brand logo and cover frame, and batch-export ready-to-publish files."}
        </T>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
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
