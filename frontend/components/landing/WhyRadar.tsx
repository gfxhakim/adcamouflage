"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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

/** What the render engine does to each file, shown ticking off one by one. */
const STEPS = ["Reframe & crop", "Apply overlays", "Pick cover frame", "Tune quality", "Render variants"];

/** Output files that fan out of the engine. */
const OUTPUTS = ["your_video_a.mp4", "your_video_b.mp4", "your_video_c.mp4"];

/** Looping clip shown in the source card; drop a GIF at this path in /public. */
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

function Connector() {
  return (
    <div className="flex shrink-0 items-center justify-center px-0.5 sm:px-1.5" aria-hidden>
      <span className="pipeline-dash block h-0.5 w-3 rounded-full sm:w-8 lg:w-12" />
    </div>
  );
}

/** The source clip. A GIF loops forever on its own; falls back to a dark gradient if missing. */
function SourceClip() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative mt-2 aspect-[4/3] overflow-hidden rounded-lg bg-[linear-gradient(135deg,#111_0%,#333_60%,#111_100%)] sm:mt-3">
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={SOURCE_GIF}
          alt="Source video preview"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function Pipeline() {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="relative mx-auto w-full max-w-[1100px]">
      <style>{`
        .pipeline-dash {
          background-image: linear-gradient(to right, #0866FF 50%, transparent 50%);
          background-size: 8px 100%;
          animation: pipeline-flow 0.8s linear infinite;
        }
        @keyframes pipeline-flow { to { background-position: 8px 0; } }
        @media (prefers-reduced-motion: reduce) { .pipeline-dash { animation: none; } }
      `}</style>

      <div className="flex flex-row items-center">
        {/* 1. The source video (GIF plays in the dark frame) */}
        <motion.div {...phase(0.02, reduce)} className="min-w-0 flex-[1.15]">
          <div className="rounded-xl border border-black/10 bg-white p-1.5 shadow-sm sm:rounded-2xl sm:p-3 lg:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Upload className="hidden h-3.5 w-3.5 shrink-0 text-ink-faint sm:block" aria-hidden />
              <span className="truncate font-mono text-[8px] text-black sm:text-[11px] lg:text-[13px]">your_video.mp4</span>
            </div>
            <SourceClip />
            <span className="mt-2 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-black px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-wider text-white sm:mt-3 sm:gap-1.5 sm:px-2 sm:text-[9px] lg:text-[10px]">
              <span className="h-1 w-1 shrink-0 rounded-full bg-meta-400 sm:h-1.5 sm:w-1.5" />
              Source
            </span>
          </div>
        </motion.div>

        <Connector />

        {/* 2. The engine */}
        <motion.div {...phase(0.14, reduce)} className="min-w-0 flex-[1.2]">
          <div className="rounded-xl bg-black p-2 text-white shadow-[0_0_40px_rgba(8,102,255,0.25)] sm:rounded-2xl sm:p-5 lg:p-6">
            <p className="flex items-center gap-1.5 truncate font-mono text-[7px] uppercase tracking-[0.12em] text-white/60 sm:gap-2 sm:text-[10px] lg:text-[11px]">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-meta-400" aria-hidden />
              Render engine
            </p>
            <ul className="mt-2 space-y-1 sm:mt-4 sm:space-y-2.5">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step}
                  {...phase(0.22 + i * 0.07, reduce)}
                  className="flex items-center gap-1 text-[8px] leading-tight text-white/85 sm:gap-2 sm:text-[13px] lg:text-[15px]"
                >
                  <span className="grid h-2.5 w-2.5 shrink-0 place-items-center rounded-full bg-meta-500 sm:h-4 sm:w-4 lg:h-5 lg:w-5">
                    <Check className="h-2 w-2 sm:h-2.5 sm:w-2.5 lg:h-3 lg:w-3" strokeWidth={3} aria-hidden />
                  </span>
                  <span className="truncate">{step}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>

        <Connector />

        {/* 3. Finished variants fan out */}
        <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-3">
          {OUTPUTS.map((name, i) => (
            <motion.div
              key={name}
              {...phase(0.62 + i * 0.08, reduce)}
              className="flex items-center justify-between gap-1 rounded-lg border border-meta-500/30 bg-white px-1.5 py-1.5 shadow-sm sm:gap-2 sm:rounded-xl sm:px-3.5 sm:py-3 lg:px-4"
            >
              <span className="truncate font-mono text-[7px] text-black sm:text-[11px] lg:text-[13px]">{name}</span>
              <span className="shrink-0 rounded-full bg-meta-500 px-1 py-0.5 font-mono text-[6px] uppercase tracking-wider text-white sm:px-1.5 sm:text-[8px] lg:text-[9px]">
                Ready
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint sm:mt-8 md:text-[11px]">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-black" />
        1 video in
        <span className="mx-3 text-black/20">→</span>
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
        ready-to-post variants out
      </p>
    </div>
  );
}

export function WhyRadar() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-[#F4F5F7] py-12 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
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

        <Reveal className="mt-12 sm:mt-16">
          <Pipeline />
        </Reveal>
      </div>
    </section>
  );
}

export default WhyRadar;
