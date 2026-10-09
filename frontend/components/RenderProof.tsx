"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import NeonCard from "@/components/NeonCard";

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
  { label: "File hash", before: "6fa82c49ec91…", next: () => `${hex(10)}…` },
  {
    label: "Resolution",
    before: "1280 × 720",
    next: () => pick(["1274 × 708", "1276 × 712", "1272 × 716", "1278 × 706", "1270 × 710"]),
  },
  {
    label: "Frame rate",
    before: "30 fps",
    next: () => pick(["23.976 fps", "29.97 fps", "25 fps", "24 fps", "59.94 fps"]),
  },
  { label: "Metadata tags", before: "camera, editor, title", next: () => "none" },
  {
    label: "Audio pitch",
    before: "0 cents",
    next: () => {
      const cents = (Math.random() * 50 + 15) * (Math.random() < 0.5 ? -1 : 1);
      return `${cents > 0 ? "+" : "−"}${Math.abs(cents).toFixed(1)} cents`;
    },
  },
];

// What the server renders and what shows first, so hydration matches.
const FIRST = ["358da85223…", "1274 × 708", "23.976 fps", "none", "+39.8 cents"];

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
export function RenderProof() {
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
    <NeonCard glow padding="lg" radius="xl" className="w-full lg:max-w-md lg:justify-self-end">
      <div className="flex items-center justify-between gap-3">
        <p className="label">What changes on every render</p>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-meta-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-500" aria-hidden />
          copy #{String(render).padStart(3, "0")}
        </span>
      </div>

      <dl className="mt-4 space-y-3.5">
        {ROWS.map(({ label, before }, i) => (
          <div key={label}>
            <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
            <dd className="mt-1 flex items-center gap-2 font-mono text-[13px]">
              <span className="truncate text-ink-faint line-through decoration-red-400/70">
                {before}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
              <span className="relative min-w-0 overflow-hidden font-semibold text-meta-700">
                <span className="sr-only">{values[i]}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <ShutterValue key={`${render}-${i}`} text={values[i]} delay={i * 0.08} />
                </AnimatePresence>
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 border-t border-black/10 pt-4 text-[11px] leading-relaxed text-ink-faint">
        A live preview: every copy you render gets its own new values. Each job ships with a report
        of hashes before and after, the changes applied, and how many provenance tags remain.
      </p>
    </NeonCard>
  );
}

export default RenderProof;
