"use client";

import { motion } from "framer-motion";
import { ChevronsLeftRight } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal, SectionTag } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";

const PROOF_BULLETS = [
  "Disrupts automated OCR and computer-vision scanners from reading on-screen hooks and aggressive visual elements without blurring the creative.",
  "Micro-modulates background frequencies and vocal harmonics to throw off speech-to-text bots while keeping voiceovers crystal clear.",
  "Generates multiple unique variants in one upload for multi-account scale.",
];

/** A stand-in ad creative, drawn in CSS so both halves are pixel-identical. */
function MockCreative() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#0b1220] via-[#10213f] to-black">
      <div className="absolute -right-10 top-1/2 h-[120%] w-[55%] -translate-y-1/2 rounded-full bg-meta-500/40 blur-3xl" />
      <div className="absolute right-[12%] top-1/2 h-[46%] aspect-square -translate-y-1/2 rounded-full bg-gradient-to-br from-white to-meta-200 shadow-2xl" />
      <div className="absolute right-[19%] top-1/2 h-[22%] aspect-square -translate-y-1/2 rounded-2xl bg-black/80" />
      <div className="absolute left-[6%] top-[18%] max-w-[46%] text-white">
        <T k="proof.mock.kicker" as="p" className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 sm:text-xs">Sponsored</T>
        <T k="proof.mock.title" as="p" className="mt-2 whitespace-pre-line text-2xl font-semibold leading-[0.95] tracking-[-0.04em] sm:text-4xl lg:text-5xl">
          {"The drop\neveryone\u2019s\ntalking about"}
        </T>
        <T k="proof.mock.button" className="mt-4 inline-block rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black">Shop now</T>
      </div>
    </div>
  );
}

function Slider() {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const move = useCallback((clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  return (
    <div
      ref={box}
      className="relative aspect-[4/5] w-full cursor-ew-resize select-none overflow-hidden rounded-3xl sm:aspect-[16/9]"
      onPointerDown={(e) => {
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging && move(e.clientX)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      role="slider"
      aria-label="Compare the original with a camouflaged copy"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(4, p - 4));
        if (e.key === "ArrowRight") setPos((p) => Math.min(96, p + 4));
      }}
    >
      {/* After: the copy */}
      <CmsSlot k="proof.after.image" label="After picture" className="absolute inset-0 h-full object-cover">
        <MockCreative />
      </CmsSlot>
      <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-1/2 w-full" aria-hidden>
        <path d="M0 110 C80 105 120 90 170 80 S260 40 300 38 S370 10 400 6" fill="none" stroke="#3385ff" strokeWidth="2.5" />
        <path d="M0 110 C80 105 120 90 170 80 S260 40 300 38 S370 10 400 6 L400 120 L0 120Z" fill="url(#ba-fill)" />
        <defs>
          <linearGradient id="ba-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#0866ff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#0866ff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute bottom-4 right-4 text-right sm:bottom-6 sm:right-6">
        <T k="proof.after.label" className="rounded-full bg-meta-500 px-2.5 py-1 font-mono text-[10px] text-white">After · copy #042</T>
        <T k="proof.after.value" as="p" className="mt-2 text-5xl font-semibold leading-none tracking-[-0.05em] text-meta-400 sm:text-7xl lg:text-8xl">
          0 tags
        </T>
        <T k="proof.after.caption" as="p" className="mt-1 font-mono text-[10px] text-white/60 sm:text-[11px]">3b1c9e07… · 1274 × 708 · 23.976 fps</T>
      </div>

      {/* Before: the original, clipped to the left of the handle */}
      <div className="absolute inset-0 grayscale" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <CmsSlot k="proof.before.image" label="Before picture" className="absolute inset-0 h-full object-cover">
          <MockCreative />
        </CmsSlot>
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6">
          <T k="proof.before.label" className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] text-black">Before · original</T>
          <T
            k="proof.before.value"
            as="p"
            className="mt-2 text-5xl font-semibold leading-none tracking-[-0.05em] text-transparent sm:text-7xl lg:text-8xl"
            style={{ WebkitTextStroke: "1.5px rgba(255,255,255,0.8)" }}
          >
            14 tags
          </T>
          <T k="proof.before.caption" as="p" className="mt-1 font-mono text-[10px] text-white/60 sm:text-[11px]">6fa82c49… · 1280 × 720 · 30 fps</T>
        </div>
      </div>

      {/* Handle */}
      <div className="absolute inset-y-0 w-0.5 bg-meta-400" style={{ left: `${pos}%` }} aria-hidden>
        <motion.div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-meta-500 px-3 py-2 text-white shadow-[0_0_0_6px_rgba(8,102,255,0.25)]"
          animate={dragging ? { scale: 1.08 } : { scale: [1, 1.06, 1] }}
          transition={dragging ? { duration: 0.2 } : { duration: 2, repeat: Infinity }}
        >
          <ChevronsLeftRight className="h-4 w-4" />
          <T k="proof.drag" className="font-mono text-[10px]">Drag</T>
        </motion.div>
      </div>
    </div>
  );
}

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.bullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Before / after" id="proof" className="scroll-mt-24 bg-black py-20 text-white sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <SectionTag k="proof.tag" index="03" dark>
              DEEP EVASION LAYER
            </SectionTag>
            <CmsHeadline k="proof.headline" dark text="Built for the Buyer. | [Invisible to the Bot.]" className="mt-5 text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.lede" long as="p" className="text-sm leading-relaxed text-white/65">
            Basic metadata cleaners stopped working years ago. Modern ad networks scan pixel structures and transcribe audio tracks in real time. AdCamouflage neutralizes both.
          </T>
        </div>

        <Reveal className="mt-10">
          <Slider />
        </Reveal>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.kicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">platform protection</T>
            <T k="proof.subhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Optical pattern breaking and audio transcription shielding built in.
            </T>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-white/75">
              {bullets.map(({ item, key, id }) => (
                <li key={id}>
                  • <T k={`${key}.text`}>{item}</T>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <CmsSlot k="proof.report" label="Report card">
              <RenderProof />
            </CmsSlot>
          </Reveal>
        </div>
      </div>
    </CmsSection>
  );
}

export default BeforeAfter;
