"use client";

import { AnimatePresence, motion, Variants, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface HyperTextProps {
  text: string;
  duration?: number;
  framerProps?: Variants;
  className?: string;
  animateOnLoad?: boolean;
}

const alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const getRandomInt = (max: number) => Math.floor(Math.random() * max);

export function HyperText({
  text,
  duration = 800,
  framerProps = {
    initial: { opacity: 0, y: -10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 3 },
  },
  className,
  animateOnLoad = true,
}: HyperTextProps) {
  const reduceMotion = useReducedMotion();
  const [displayText, setDisplayText] = useState<string[]>(() => text.split(""));
  const [triggerCount, setTriggerCount] = useState(0);
  const isFirstRender = useRef(true);

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
    const start = performance.now();
    const totalMs = Math.max(120, duration);

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / totalMs);
      const solved = progress * target.length;

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
  }, [text, duration, triggerCount, animateOnLoad, reduceMotion]);

  return (
    <div
      className="flex max-w-full cursor-default items-center justify-center overflow-hidden whitespace-nowrap px-6 py-3"
      onMouseEnter={triggerAnimation}
      aria-label={text}
    >
      <AnimatePresence initial={false}>
        {displayText.map((letter, i) => (
          <motion.span
            key={i}
            aria-hidden
            className={cn(
              "inline-block font-mono",
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
