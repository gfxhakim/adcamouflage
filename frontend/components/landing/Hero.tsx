"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Rocket, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CmsIcon, CmsLink, CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import MatrixWords from "@/components/landing/MatrixWords";
import { CmsHeadline, EASE } from "@/components/landing/primitives";
import { HyperText } from "@/components/ui/hyper-text";

// The hero headline transforms smoothly through these core actions in order.
const WORDS = ["SCALE IT", "EDIT IT", "RUN IT"];
const EMPTY_WORDS: string[] = [];
const WORD_INTERVAL_MS = 4000;

export function Hero({ startHref }: { startHref: string }) {
  const cms = useCms();
  const reduceMotion = useReducedMotion();
  const rawWords = cms.text("hero.matrixWords", WORDS.join(", "), "text", "Transforming hero words (comma separated)");
  const wordList = useMemo(() => {
    const parsed = rawWords
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    return parsed.length ? parsed : WORDS;
  }, [rawWords]);

  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    setWordIndex(0);
    if (reduceMotion || wordList.length <= 1) return;
    const timer = window.setInterval(() => {
      setWordIndex((prev) => (prev + 1) % wordList.length);
    }, WORD_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [wordList, reduceMotion]);

  const activeWord = wordList[wordIndex % wordList.length] ?? WORDS[0];

  return (
    <CmsSection
      k="hero"
      label="Hero"
      id="home"
      className="relative isolate flex min-h-[100svh] scroll-mt-24 flex-col overflow-hidden bg-black text-white"
    >
      {/* Authentic live animated Matrix grid background + shining cyan/blue spotlight */}
      <CmsSlot k="hero.background" label="Background animation" className="absolute inset-0 h-full object-cover">
        <MatrixWords words={EMPTY_WORDS} centerY={0.22} className="absolute inset-0 h-full w-full" />
      </CmsSlot>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[58%] bg-[radial-gradient(ellipse_75%_65%_at_50%_22%,rgba(8,102,255,0.34),transparent_74%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] bg-gradient-to-t from-black via-black/75 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-3 pb-5 pt-16 text-center sm:px-6 sm:pb-7 sm:pt-20">
        <div aria-live="off" className="mb-2 flex w-full justify-center sm:mb-4">
          <HyperText
            text={activeWord}
            duration={1150}
            holdPerWord
            style={{ fontFamily: "var(--font-palace), Georgia, serif" }}
            className="font-palace text-[clamp(2.65rem,10.6vw,9rem)] font-bold leading-none tracking-[0.04em] text-[#f4f8ff] [text-shadow:0_0_22px_rgba(8,102,255,1),0_0_52px_rgba(56,189,248,0.82)]"
          />
        </div>

        <motion.span
          className="mb-3 inline-flex max-w-[92vw] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.08] px-3.5 py-1.5 text-[10px] font-semibold leading-snug tracking-[0.04em] text-white/85 backdrop-blur sm:mb-4 sm:max-w-none sm:rounded-full sm:py-1 sm:text-[11px]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <CmsIcon k="hero.badge.icon" fallback={ShieldCheck} className="h-3.5 w-3.5 shrink-0 text-meta-400" aria-hidden />
          <T k="hero.studioBadge">AI LAYER ENGINE • MULTI-PLATFORM AD RECOVERY & BATCH SCALE</T>
        </motion.span>

        <CmsHeadline
          k="hero.studioHeadline"
          as="h1"
          dark
          text="Fix Rejected Ads. | [Rebuilt to Deliver] | [& Scale Everywhere.]"
          className="font-bold leading-[1.08] tracking-[-0.015em] text-[1.75rem] min-[400px]:text-[1.95rem] sm:text-5xl lg:text-[3.75rem] xl:text-[4.25rem]"
        />

        <T
          k="hero.studioLede"
          long
          as={motion.p}
          className="mt-3.5 max-w-3xl text-[13px] leading-relaxed text-white/80 sm:mt-4 sm:text-[15px]"
          // Visible from the first paint (it is the page's largest text, so a
          // fade-in from 0 would delay Largest Contentful Paint); it only slides.
          initial={{ opacity: 1, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          {"ProteusFlow is your AI creative layer agent built for performance marketers. Take winning creatives that got rejected or stopped delivering and rebuild them layer by layer—re-mastering visual frames, Rec.709 color, −14 LUFS audio, clean encoding, and brand overlays—so every platform accepts them, unlocks delivery, and scales profitably again."}
        </T>

        <motion.div
          className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:mt-6"
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
