"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import NeonCard from "@/components/NeonCard";
import { cn } from "@/lib/utils";

/** How long each simulated render stays on screen. */
const CYCLE_MS = 3200;

// The same "shutter" as the intro (components/ui/hero-shutter-text.tsx): each
// character is cut into three strips that fly in from alternating sides and
// lock together.
const SLICES = [
  { clip: "inset(-20% 0 66% 0)", from: "-120%" },
  { clip: "inset(33% 0 33% 0)", from: "120%" },
  { clip: "inset(66% 0 -20% 0)", from: "-120%" },
];
const EASE = [0.22, 1, 0.36, 1] as const;

type Row = { label: string; before: string; next: (render: number) => string };

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const hex = (n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

const ROWS: Row[] = [
  {
    label: "Platform status",
    before: "Rejected · Limited",
    next: () => pick(["Approved · Delivering", "Active · Meta Reels", "Active · TikTok Ads", "Active · Shorts", "Learning · Scaling"]),
  },
  {
    label: "Visual & framing",
    before: "Flagged frame hash",
    next: () => pick(["Rebuilt Micro-Geometry", "Clean Edge Structure", "Fresh Motion Timing", "1080 × 1920 Studio Cut"]),
  },
  {
    label: "Color profile",
    before: "Unleveled source",
    next: () => pick(["Rec.709 Studio LUT", "Warm Commercial Grade", "Crisp Daylight Balance", "Clean Neutral Contrast"]),
  },
  {
    label: "Audio stream",
    before: "Flagged audio track",
    next: () => pick(["−14 LUFS Clean Master", "Rebuilt Phase + EQ", "Fresh Voice Clarity", "Policy-Safe Loudness"]),
  },
  {
    label: "Export container",
    before: "Old file metadata",
    next: () => pick(["Clean MP4 + Cover Frame", "Fresh Bitrate + Logo", "Clean Container + Poster"]),
  },
];

// What the server renders and what shows first, so hydration matches.
const FIRST = [
  "Approved · Delivering",
  "Rebuilt Micro-Geometry",
  "Rec.709 Studio LUT",
  "−14 LUFS Clean Master",
  "Clean MP4 + Cover Frame",
];

/** One value assembling itself letter by letter, intro style. */
function ShutterValue({ text, delay }: { text: string; delay: number }) {
  return (
    <motion.span
      className="inline-flex whitespace-pre"
      aria-hidden
      exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
    >
      {Array.from(text).map((char, i) => {
        const start = delay + i * 0.025;
        return (
          <span key={i} className="relative inline-block">
            <motion.span
              className="relative z-10 inline-block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.01, delay: start + 0.55 }}
            >
              {char}
            </motion.span>
            {SLICES.map((slice, s) => (
              <motion.span
                key={s}
                className="absolute inset-0"
                style={{ clipPath: slice.clip, WebkitClipPath: slice.clip }}
                initial={{ x: slice.from, opacity: 0 }}
                animate={{ x: "0%", opacity: [0, 1, 1, 0] }}
                transition={{
                  x: { duration: 0.5, delay: start + s * 0.04, ease: EASE },
                  opacity: { duration: 0.6, delay: start + s * 0.04, times: [0, 0.1, 0.9, 1] },
                }}
              >
                {char}
              </motion.span>
            ))}
          </span>
        );
      })}
    </motion.span>
  );
}

/**
 * The landing hero's "What changes on every render" card. The blue values
 * keep re-rolling, one simulated render after another, and each new value
 * flies in with the intro's shutter.
 */
export function RenderProof({ dark = false }: { dark?: boolean } = {}) {
  const reduceMotion = useReducedMotion();
  const [render, setRender] = useState(1);
  const [values, setValues] = useState(FIRST);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setRender((n) => n + 1);
      setValues(ROWS.map((row, i) => row.next(i)));
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <NeonCard
      glow
      padding="lg"
      radius="xl"
      className="w-full lg:max-w-md lg:justify-self-end"
      // `dark`: a black card with light text (the surface reads --surface).
      style={dark ? ({ "--surface": "0 0 0" } as CSSProperties) : undefined}
      innerClassName={dark ? "text-white [outline-color:rgb(255_255_255/0.08)]" : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("label", dark && "!text-white/60")}>AI Creative Rebuild Preview</p>
        <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums", dark ? "text-meta-400" : "text-meta-600")}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
          batch #{String(render).padStart(3, "0")}
        </span>
      </div>

      <div className={cn("mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold", dark ? "border-white/10 bg-white/[0.04]" : "border-black/10 bg-black/[0.03]")}>
        <span className="inline-flex items-center gap-1.5 text-red-400">
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
          Before: Rejected
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-meta-400" aria-hidden />
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
          After: Delivering
        </span>
      </div>

      <dl className="mt-4 space-y-3.5">
        {ROWS.map(({ label, before }, i) => (
          <div key={label}>
            <dt className={cn("text-xs font-medium", dark ? "text-white/60" : "text-ink-subtle")}>{label}</dt>
            <dd className="mt-1 flex items-center gap-2 font-mono text-[13px]">
              <span className={cn("truncate line-through decoration-red-400/70", dark ? "text-white/45" : "text-ink-faint")}>
                {before}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
              <span className={cn("relative min-w-0 overflow-hidden font-semibold", dark ? "text-meta-300" : "text-meta-700")}>
                <span className="sr-only">{values[i]}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <ShutterValue key={`${render}-${i}`} text={values[i]} delay={i * 0.08} />
                </AnimatePresence>
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className={cn("mt-5 border-t pt-4 text-[11px] leading-relaxed", dark ? "border-white/10 text-white/50" : "border-black/10 text-ink-faint")}>
        Illustrative layer preview. Preserves your winning hook, fast cuts, and captions while rebuilding visual,
        audio, and container layers for clean delivery.
      </p>
    </NeonCard>
  );
}

export default RenderProof;
