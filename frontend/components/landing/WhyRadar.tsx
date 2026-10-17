"use client";

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

/** What the engine does to each file, shown ticking off one by one. */
const STEPS = ["Scrub metadata", "Rewrite file hash", "Shift frames & pixels", "Pitch-shift audio", "Re-encode clean"];

/** Output files that fan out of the engine. */
const OUTPUTS = ["winner_v1_a.mp4", "winner_v1_b.mp4", "winner_v1_c.mp4"];

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
    <div className={cn("flex items-center justify-center md:px-1", className)} aria-hidden>
      <span className="pipeline-dash block h-10 w-0.5 rounded-full md:h-0.5 md:w-10" />
    </div>
  );
}

function Pipeline() {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <style>{`
        .pipeline-dash {
          background-image: linear-gradient(to right, #0866FF 50%, transparent 50%);
          background-size: 8px 100%;
          animation: pipeline-flow 0.8s linear infinite;
        }
        @media (max-width: 767px) {
          .pipeline-dash { background-image: linear-gradient(to bottom, #0866FF 50%, transparent 50%); background-size: 100% 8px; }
          @keyframes pipeline-flow { to { background-position: 0 8px; } }
        }
        @media (min-width: 768px) {
          @keyframes pipeline-flow { to { background-position: 8px 0; } }
        }
        @media (prefers-reduced-motion: reduce) { .pipeline-dash { animation: none; } }
      `}</style>

      <div className="flex flex-col items-stretch md:flex-row md:items-center">
        {/* 1. The flagged original */}
        <motion.div {...phase(0.02, reduce)} className="md:w-[30%]">
          <div className="rounded-2xl border border-rose-500/30 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Upload className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
              <span className="truncate font-mono text-[11px] text-black">winner_v1.mp4</span>
            </div>
            <div className="mt-3 aspect-video rounded-lg bg-[linear-gradient(135deg,#111_0%,#333_60%,#111_100%)]" />
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Flagged · hash matched
            </span>
          </div>
        </motion.div>

        <Connector />

        {/* 2. The engine */}
        <motion.div {...phase(0.14, reduce)} className="md:w-[36%]">
          <div className="rounded-2xl bg-black p-4 text-white shadow-[0_0_40px_rgba(8,102,255,0.25)]">
            <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-white/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" aria-hidden />
              AdCamouflage engine
            </p>
            <ul className="mt-3 space-y-1.5">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step}
                  {...phase(0.22 + i * 0.07, reduce)}
                  className="flex items-center gap-2 text-[11px] text-white/85"
                >
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-meta-500">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                  </span>
                  {step}
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>

        <Connector />

        {/* 3. Clean copies fan out */}
        <div className="space-y-2 md:w-[30%]">
          {OUTPUTS.map((name, i) => (
            <motion.div
              key={name}
              {...phase(0.62 + i * 0.08, reduce)}
              className="flex items-center justify-between gap-2 rounded-xl border border-meta-500/30 bg-white px-3 py-2 shadow-sm"
            >
              <span className="truncate font-mono text-[10px] text-black">{name}</span>
              <span className="shrink-0 rounded-full bg-meta-500 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white">
                Approved
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
        1 flagged file in
        <span className="mx-3 text-black/20">→</span>
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
        unlimited clean copies out
      </p>
    </div>
  );
}

export function WhyRadar() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-[#F4F5F7] py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
        <div>
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

        <Reveal className="px-2 py-6 sm:px-6">
          <Pipeline />
        </Reveal>
      </div>
    </section>
  );
}

export default WhyRadar;
