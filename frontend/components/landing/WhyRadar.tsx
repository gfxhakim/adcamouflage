"use client";

import { Copy, EyeOff, Repeat2 } from "lucide-react";

import { Headline, Reveal, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const WHY = [
  {
    icon: Copy,
    title: "Stop duplicate flags",
    body: "Ad platforms compare every upload with what they have already seen. A camouflaged copy reads as a brand-new file, so a creative that worked once can run again without being matched to the original.",
  },
  {
    icon: Repeat2,
    title: "Beat creative fatigue",
    body: "Skip paying for new edits every week. Spin a winning ad into fresh variants in minutes and keep testing across ad sets and campaigns.",
  },
  {
    icon: EyeOff,
    title: "Keep your files anonymous",
    body: "Device, editing app, project names and encoder tags are removed, so your files say nothing about how, where or by whom they were made.",
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
    </div>
  );
}

export function WhyRadar() {
  return (
    <section id="why" className="scroll-mt-24 bg-[#F4F5F7] py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
        <div>
          <SectionTag index="01">Why media buyers use it</SectionTag>
          <Headline
            text="Your best ad, | [without the] [duplicate tax.]"
            className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
          />
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

        <Reveal className="px-10 py-6 sm:px-12">
          <Radar />
          <p className="mt-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
            re-uploaded original
            <span className="mx-3 text-black/20">|</span>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
            camouflaged copy
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export default WhyRadar;
