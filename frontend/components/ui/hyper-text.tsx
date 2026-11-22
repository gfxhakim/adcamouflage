"use client";

import { AnimatePresence, motion, Variants, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

interface HyperTextProps {
  text: string;
  duration?: number;
  framerProps?: Variants;
  className?: string;
  style?: CSSProperties;
  animateOnLoad?: boolean;
  /** Resolve multi-word text sequentially word by word with a brief hold between words. */
  holdPerWord?: boolean;
}

const alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const getRandomInt = (max: number) => Math.floor(Math.random() * max);

/** Build inclusive character ranges [start, end] for each whitespace-delimited word. */
function wordRanges(chars: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== " " && start === -1) start = i;
    if ((chars[i] === " " || i === chars.length - 1) && start !== -1) {
      const end = chars[i] === " " ? i - 1 : i;
      ranges.push([start, end]);
      start = -1;
    }
  }
  return ranges;
}

/**
 * Map normalized progress [0..1] to the last solved character index (-1..N-1),
 * holding cleanly after each completed word before revealing the next word.
 */
function solvedCutoff(chars: string[], progress: number, holdPerWord: boolean): number {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const ranges = holdPerWord ? wordRanges(chars) : [];
  if (ranges.length <= 1) {
    return safeProgress * chars.length - 1;
  }

  const slot = 1 / ranges.length;
  const activeWord = Math.max(0, Math.min(ranges.length - 1, Math.floor(safeProgress / slot)));
  const local = (safeProgress - activeWord * slot) / slot;
  const resolveRatio = 0.62;
  const [start, end] = ranges[activeWord];
  const wordLen = end - start + 1;

  if (local >= resolveRatio) {
    return end;
  }
  const wordProgress = local / resolveRatio;
  return start + wordProgress * wordLen - 1;
}

export function HyperText({
  text,
  duration = 800,
  framerProps = {
    initial: { opacity: 0, y: -10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 3 },
  },
  className,
  style,
  animateOnLoad = true,
  holdPerWord = true,
}: HyperTextProps) {
  const reduceMotion = useReducedMotion();
  const [displayText, setDisplayText] = useState<string[]>(() => text.split(""));
  const [triggerCount, setTriggerCount] = useState(0);
  const isFirstRender = useRef(true);
  const hasExplicitFont = Boolean(style?.fontFamily) || /\bfont-(sans|serif|mono|display|palace)\b/.test(className ?? "");

  const triggerAnimation = () => {
    setTriggerCount((c) => c + 1);
  };

  useEffect(() => {
    const target = text.split("");

    if (reduceMotion) {
      setDisplayText(target);
      isFirstRender.current = false;
      return;
    }

    if (!animateOnLoad && isFirstRender.current) {
      isFirstRender.current = false;
      setDisplayText(target);
      return;
    }
    isFirstRender.current = false;

    let raf = 0;
    let start: number | null = null;
    const totalMs = Math.max(120, duration);

    const step = (now: number) => {
      if (start === null) start = now;
      const elapsed = Math.max(0, now - start);
      const progress = Math.min(1, elapsed / totalMs);
      const solved = solvedCutoff(target, progress, holdPerWord);

      if (progress >= 1) {
        setDisplayText(target);
        return;
      }

      setDisplayText(
        target.map((char, i) =>
          char === " "
            ? " "
            : i <= solved
              ? char
              : alphabets[getRandomInt(alphabets.length)],
        ),
      );
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [text, duration, triggerCount, animateOnLoad, holdPerWord, reduceMotion]);

  return (
    <div
      className="flex max-w-full cursor-default items-center justify-center overflow-visible whitespace-nowrap px-3 py-4 sm:px-6 sm:py-6"
      onMouseEnter={triggerAnimation}
      aria-label={text}
    >
      <AnimatePresence initial={false}>
        {displayText.map((letter, i) => (
          <motion.span
            key={i}
            aria-hidden
            style={style}
            className={cn(
              "inline-block",
              !hasExplicitFont && "font-mono",
              letter === " " ? "w-[0.42em]" : "",
              className,
            )}
            {...framerProps}
          >
            {letter === " " ? "\u00A0" : letter.toUpperCase()}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
