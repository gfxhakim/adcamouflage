"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

interface HeroTextProps {
  /** One entry per line of big type. */
  lines?: string[];
  /** Extra classes per line, e.g. a colour for the second line. */
  lineClassNames?: string[];
  className?: string;
  /** Seconds before the first letter starts moving. */
  delay?: number;
}

// Each letter is cut into three horizontal strips that fly in from alternating
// sides and lock together: the "shutter".
// The strips overlap by a hair so no seam shows while they move, and the outer
// ones reach past the box so nothing above or below the letter is cut off.
const SLICES = [
  { clip: "inset(-20% 0 66% 0)", from: "-120%" },
  { clip: "inset(33% 0 33% 0)", from: "120%" },
  { clip: "inset(66% 0 -20% 0)", from: "-120%" },
];

const EASE = [0.22, 1, 0.36, 1] as const;

/** Full-width, sliced-letter headline that assembles itself on mount. */
export function HeroText({
  lines = ["IMMERSE"],
  lineClassNames = [],
  className,
  delay = 0.15,
}: HeroTextProps) {
  let order = 0;

  return (
    <h1
      className={cn(
        "select-none text-center font-black uppercase leading-[0.92] tracking-[-0.04em]",
        "text-[clamp(2.75rem,14vw,10.5rem)]",
        className,
      )}
      aria-label={lines.join(" ")}
    >
      {lines.map((line, lineIndex) => (
        <span
          key={`${line}-${lineIndex}`}
          className={cn("relative block whitespace-nowrap", lineClassNames[lineIndex])}
          aria-hidden
        >
          {Array.from(line).map((char, charIndex) => {
            const start = delay + order++ * 0.045;
            if (char === " ") {
              return <span key={charIndex} className="inline-block w-[0.28em]" />;
            }
            return (
              <span key={charIndex} className="relative inline-block">
                {/* Keeps the letter's width and baseline, then shows as one solid glyph once the strips land. */}
                <motion.span
                  className="relative z-10 inline-block"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.01, delay: start + 0.85 }}
                >
                  {char}
                </motion.span>
                {SLICES.map((slice, sliceIndex) => (
                  <motion.span
                    key={sliceIndex}
                    className="absolute inset-0"
                    style={{ clipPath: slice.clip, WebkitClipPath: slice.clip }}
                    initial={{ x: slice.from, opacity: 0 }}
                    animate={{ x: "0%", opacity: 1 }}
                    transition={{ duration: 0.7, delay: start + sliceIndex * 0.06, ease: EASE }}
                  >
                    {char}
                  </motion.span>
                ))}
              </span>
            );
          })}

          {/* A thin blue flash runs across the line as it locks. */}
          <motion.span
            className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] origin-left -translate-y-1/2 rounded-full bg-meta-500"
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: [0, 1, 1], opacity: [1, 1, 0] }}
            transition={{ duration: 0.9, delay: delay + lineIndex * 0.35 + 0.2, ease: EASE }}
          />
        </span>
      ))}
    </h1>
  );
}

export default HeroText;
