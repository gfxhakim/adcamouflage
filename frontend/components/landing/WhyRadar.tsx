"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { Check, Gauge, Layers, Sparkles, Upload } from "lucide-react";

import { Headline, Reveal, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const WHY = [
  {
    icon: Layers,
    title: "One upload. Ten unique winners.",
    body: "No Premiere, no CapCut, no re-render. Every copy gets its own fingerprint.",
  },
  {
    icon: Gauge,
    title: "Back in the auction in seconds.",
    body: "Relaunch before the algorithm forgets you. Momentum keeps compounding.",
  },
  {
    icon: Sparkles,
    title: "Zero pixel loss.",
    body: "Your audience sees the exact creative that converted. Only the bots see something new.",
  },
];

/** What the engine does to each file, shown ticking off one by one. */
const STEPS = ["Scrub metadata", "Rewrite file hash", "Shift frames & pixels", "Pitch-shift audio", "Re-encode clean"];

/** Output files that fan out of the engine. */
const OUTPUTS = ["winner_v1_a.mp4", "winner_v1_b.mp4", "winner_v1_c.mp4"];

/** Source GIF asset used inside the source-video card. */
const SOURCE_GIF = "/landing/source.gif";

// One full loop of the animation, in seconds.
const CYCLE = 7;

/** Fade an element in at `start` and out at the end of the cycle (fractions of CYCLE). */
function phase(start: number, reduce: boolean) {
  if (reduce) return { initial: { opacity: 1 }, animate: { opacity: 1 } };
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: [0, 0, 1, 1, 0], y: [6, 6, 0, 0, 0] },
    transition: {
      duration: CYCLE,
      times: [0, start, start + 0.04, 0.95, 1],
      repeat: Infinity,
      ease: "linear" as const,
    },
  };
}

function Connector({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full justify-center", className)} aria-hidden>
      <span className="pipeline-dash block h-12 w-0.5 rounded-full" />
    </div>
  );
}

function SourceVideoCard() {
  const reduce = useReducedMotion() ?? false;
  const [imageBroken, setImageBroken] = useState(false);

  return (
    <motion.div {...phase(0.02, reduce)} className="w-full">
      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_32px_rgba(15,23,42,0.08)] sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Upload className="h-4 w-4 text-ink-faint" aria-hidden />
          <span className="truncate font-mono text-[11px] text-black sm:text-[12px]">source_video.mp4</span>
        </div>

        <div className="relative overflow-hidden rounded-[22px] border border-slate-900/10 bg-[#0b0f14] shadow-[inset_0_0_30px_rgba(0,0,0,0.9)]">
          {imageBroken ? (
            <div className="aspect-[4/5] w-full bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.24),transparent_20%),linear-gradient(135deg,#090d12_0%,#171d2a_55%,#090d12_100%)]" />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={SOURCE_GIF}
                alt="Source video frame"
                className="aspect-[4/5] h-auto w-full object-cover"
                loading="eager"
                onError={() => setImageBroken(true)}
                draggable={false}
              />
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Pipeline() {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="relative mx-auto w-full max-w-[480px] overflow-x-hidden">
      <style>{`
        .pipeline-dash {
          background-image: linear-gradient(to bottom, #0866FF 50%, transparent 50%);
          background-size: 100% 12px;
          animation: pipeline-flow 0.9s linear infinite;
        }
        @keyframes pipeline-flow {
          to { background-position: 0 12px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pipeline-dash { animation: none; }
        }
      `}</style>

      <div className="flex w-full flex-col items-stretch gap-3">
        <SourceVideoCard />

        <Connector className="my-1" />

        <motion.div {...phase(0.14, reduce)} className="w-full">
          <div className="rounded-[28px] bg-black p-5 text-white shadow-[0_0_40px_rgba(8,102,255,0.25)] sm:p-6">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/65 sm:text-[11px]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-meta-400" aria-hidden />
              Render engine
            </p>
            <ul className="mt-5 space-y-3 sm:space-y-3.5">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step}
                  {...phase(0.22 + i * 0.07, reduce)}
                  className="flex items-center gap-3 text-[12px] text-white/85 sm:text-[13px]"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-meta-500 sm:h-6 sm:w-6">
                    <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  {step}
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>

        <Connector className="my-1" />

        <div className="w-full space-y-2.5">
          {OUTPUTS.map((name, i) => (
            <motion.div
              key={name}
              {...phase(0.62 + i * 0.08, reduce)}
              className="flex items-center justify-between gap-3 rounded-[20px] border border-meta-500/30 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] sm:px-4.5"
            >
              <span className="truncate font-mono text-[11px] text-black sm:text-[12px]">{name}</span>
              <span className="shrink-0 rounded-full bg-meta-500 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white">
                Ready
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WhyRadar() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-[#F4F5F7] py-12 sm:py-16 lg:py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-10 overflow-x-hidden px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8 lg:px-8">
        <div className="min-w-0">
          <SectionTag index="01">THE SCALING BOTTLENECK</SectionTag>
          <Headline
            text="Your Winner Got Flagged. | [Relaunch It in Seconds.]"
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
            Platforms don&apos;t ban your idea. They ban your file. AdCamouflage rewrites the
            fingerprint so the bots see a brand-new asset and your audience sees the same creative
            that was already printing.
          </p>
          <ul className="mt-10 divide-y divide-black/10 border-y border-black/10">
            {WHY.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.08}>
                <li className="group flex gap-4 py-5">
                  <span className="pt-1 font-mono text-[11px] text-ink-faint">0{i + 1}</span>
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-black">
                      <Icon className="h-4 w-4 text-meta-500" aria-hidden />
                      {title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal className="flex justify-center lg:justify-end">
          <Pipeline />
        </Reveal>
      </div>
    </section>
  );
}

export default WhyRadar;
