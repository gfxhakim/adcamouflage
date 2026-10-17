"use client";

<<<<<<< HEAD
import { motion, useReducedMotion } from "framer-motion";
import { Check, Gauge, Layers, Sparkles, Upload } from "lucide-react";
=======
import { Copy, EyeOff, Repeat2 } from "lucide-react";
>>>>>>> faa4550 (Update landing page UI and project app edits)

import { Headline, Reveal, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const WHY = [
  {
<<<<<<< HEAD
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
=======
    icon: Copy,
    title: "Stop duplicate flags",
    body: "A winning asset gets re-used, then matched, flagged, and throttled by platform fingerprinting. AdCamouflage gives every variant a clean, independent identity before it reaches the network.",
  },
  {
    icon: Repeat2,
    title: "Recover momentum faster",
    body: "You do not lose hours to Premiere or CapCut churn. The engine creates fresh files in seconds so your scaling loops keep moving instead of stalling on rejection.",
  },
  {
    icon: EyeOff,
    title: "Keep your files invisible",
    body: "Metadata, hashes, audio patterns, and visual signatures are scrubbed so your creatives are structurally new and harder for automated moderation and spy systems to link together.",
  },
];

/** Blips on the radar: angle in degrees (0 = top, clockwise) and distance 0-1. */
const BLIPS = [
  { name: "winner_v1.mp4", angle: 32, dist: 0.62, matched: true },
  { name: "copy_001.mp4", angle: 78, dist: 0.38, matched: false },
  { name: "copy_002.mp4", angle: 128, dist: 0.74, matched: false },
  { name: "winner_v1.mp4", angle: 176, dist: 0.5, matched: true },
  { name: "copy_003.mp4", angle: 222, dist: 0.8, matched: false },
  { name: "copy_004.jpg", angle: 268, dist: 0.46, matched: false },
  { name: "copy_005.mp4", angle: 318, dist: 0.66, matched: false },
];

const SWEEP_S = 6;

function Radar() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      {/* Rings and crosshair */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full text-black/15" aria-hidden>
        {[96, 72, 48, 24].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="0.4" />
        ))}
        <line x1="100" y1="2" x2="100" y2="198" stroke="currentColor" strokeWidth="0.3" />
        <line x1="2" y1="100" x2="198" y2="100" stroke="currentColor" strokeWidth="0.3" />
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i * 5 * Math.PI) / 180;
          const long = i % 6 === 0;
          return (
            <line
              key={i}
              x1={100 + Math.sin(a) * 96}
              y1={100 - Math.cos(a) * 96}
              x2={100 + Math.sin(a) * (long ? 90 : 93)}
              y2={100 - Math.cos(a) * (long ? 90 : 93)}
              stroke="currentColor"
              strokeWidth="0.4"
            />
          );
        })}
      </svg>
      {["000°", "090°", "180°", "270°"].map((label, i) => (
        <span
          key={label}
          className={cn(
            "absolute font-mono text-[9px] text-ink-faint",
            i === 0 && "left-1/2 top-0 -translate-x-1/2 -translate-y-full",
            i === 1 && "right-0 top-1/2 -translate-y-1/2 translate-x-full pl-1",
            i === 2 && "bottom-0 left-1/2 -translate-x-1/2 translate-y-full",
            i === 3 && "left-0 top-1/2 -translate-x-full -translate-y-1/2 pr-1",
          )}
          aria-hidden
        >
          {label}
        </span>
      ))}

      {/* The sweep */}
      <div
        className="absolute inset-[2%] animate-[spin_6s_linear_infinite] rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(8,102,255,0) 0deg, rgba(8,102,255,0) 300deg, rgba(8,102,255,0.28) 355deg, rgba(8,102,255,0.6) 360deg)",
        }}
        aria-hidden
      />

      {/* Blips light up as the sweep passes them */}
      {BLIPS.map((blip, i) => {
        const a = (blip.angle * Math.PI) / 180;
        const x = 50 + Math.sin(a) * blip.dist * 48;
        const y = 50 - Math.cos(a) * blip.dist * 48;
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-hidden
          >
            <span
              className={cn(
                "absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full",
                blip.matched ? "bg-rose-500" : "bg-meta-500",
              )}
            />
            <span
              className={cn(
                "absolute -left-4 -top-4 h-8 w-8 animate-radar-ping rounded-full",
                blip.matched ? "bg-rose-500/30" : "bg-meta-500/30",
              )}
              style={{ animationDelay: `${(blip.angle / 360) * SWEEP_S}s` }}
            />
            <span
              className={cn(
                "absolute top-[-9px] whitespace-nowrap",
                x > 58 ? "right-3" : "left-3",
                " rounded-full px-2 py-0.5 font-mono text-[9px] sm:text-[10px]",
                blip.matched ? "bg-rose-500 text-white" : "bg-white text-black shadow",
              )}
            >
              {blip.name} · {blip.matched ? "matched" : "new file"}
            </span>
          </div>
        );
      })}

      <div className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black shadow-lg">
        <span className="h-3 w-3 rounded-full bg-meta-500" />
      </div>
>>>>>>> faa4550 (Update landing page UI and project app edits)
    </div>
  );
}

export function WhyRadar() {
  return (
<<<<<<< HEAD
    <section id="how-it-works" className="scroll-mt-24 bg-[#F4F5F7] py-20 sm:py-28">
=======
    <section id="why" className="scroll-mt-24 bg-[#F4F5F7] py-20 sm:py-28">
>>>>>>> faa4550 (Update landing page UI and project app edits)
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
        <div>
          <SectionTag index="01">THE SCALING BOTTLENECK</SectionTag>
          <Headline
<<<<<<< HEAD
            text="Your Winner Got Flagged. | [Relaunch It in Seconds.]"
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
            Platforms don&apos;t ban your idea. They ban your file. AdCamouflage rewrites the
            fingerprint so the bots see a brand-new asset and your audience sees the same creative
            that was already printing.
=======
            text="When a Winning Creative Gets Flagged, | [You Don't Just Lose an Ad — You Lose Your Algorithm Momentum.]"
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-ink-muted">
            Every media buyer knows the trap: you find a winning angle, start scaling budget, and
            automated moderation bots flag the file hash or ban the ad account. Opening Premiere or
            CapCut to manually flip frames, pitch-shift audio, and re-render every variation kills your speed.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted">
            <strong className="font-semibold text-black">AdCamouflage automates the entire evasion workflow directly in your browser.</strong>
>>>>>>> faa4550 (Update landing page UI and project app edits)
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

<<<<<<< HEAD
        <Reveal className="px-2 py-6 sm:px-6">
          <Pipeline />
=======
        <Reveal className="px-10 py-6 sm:px-12">
          <Radar />
          <p className="mt-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
            flagged original
            <span className="mx-3 text-black/20">|</span>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
            camouflaged copy
          </p>
>>>>>>> faa4550 (Update landing page UI and project app edits)
        </Reveal>
      </div>
    </section>
  );
}

export default WhyRadar;
