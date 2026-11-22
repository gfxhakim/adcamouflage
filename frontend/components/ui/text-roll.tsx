"use client";

import {
  motion,
  useReducedMotion,
  type Target,
  type TargetAndTransition,
  type Transition,
  type VariantLabels,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type TextRollProps = {
  children: string;
  duration?: number;
  getEnterDelay?: (index: number) => number;
  getExitDelay?: (index: number) => number;
  className?: string;
  transition?: Transition;
  /** Trigger state so scroll-triggered headlines roll cleanly when in view. */
  active?: boolean;
  /** Incrementing key resets and replays the roll cleanly on re-entry. */
  replayKey?: number;
  /** Allow standalone hover replay when moving pointer onto the text. */
  triggerOnHover?: boolean;
  variants?: {
    enter: {
      initial: Target | VariantLabels | boolean;
      animate: TargetAndTransition | VariantLabels;
    };
    exit: {
      initial: Target | VariantLabels | boolean;
      animate: TargetAndTransition | VariantLabels;
    };
  };
  onAnimationComplete?: () => void;
};

const DEFAULT_EASE = [0.22, 1, 0.36, 1] as const;
const DEFAULT_TRANSITION: Transition = { ease: DEFAULT_EASE };
const ENTER_OPACITY_TIMES = [0, 0.72, 1];
const EXIT_OPACITY_TIMES = [0, 0.28, 1];

export function TextRoll({
  children,
  duration = 0.45,
  getEnterDelay = (i) => i * 0.035,
  getExitDelay = (i) => i * 0.035 + 0.08,
  className,
  transition = DEFAULT_TRANSITION,
  active = true,
  replayKey = 0,
  triggerOnHover = false,
  variants,
  onAnimationComplete,
}: TextRollProps) {
  const reduceMotion = useReducedMotion();
  const [hoverKey, setHoverKey] = useState(0);
  const hoveredRef = useRef(false);
  const rollingRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const enterInitial: Target | VariantLabels | boolean = { rotateX: 0, opacity: 1 };
  const enterAnimate: TargetAndTransition | VariantLabels = {
    rotateX: 90,
    opacity: [1, 1, 0],
  };
  const exitInitial: Target | VariantLabels | boolean = { rotateX: -90, opacity: 0 };
  const exitAnimate: TargetAndTransition | VariantLabels = {
    rotateX: 0,
    opacity: [0, 1, 1],
  };

  if (reduceMotion) {
    return <span className={cn("inline-block", className)}>{children}</span>;
  }

  const letters = children.split("");
  const lastIndex = Math.max(0, letters.length - 1);
  const rollTotalMs = Math.ceil((Math.max(getEnterDelay(lastIndex), getExitDelay(lastIndex)) + duration) * 1000) + 60;

  const handleMouseEnter = triggerOnHover
    ? () => {
        if (hoveredRef.current || rollingRef.current) return;
        hoveredRef.current = true;
        rollingRef.current = true;
        setHoverKey((k) => k + 1);
        if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(() => {
          rollingRef.current = false;
        }, rollTotalMs);
      }
    : undefined;

  const handleMouseLeave = triggerOnHover
    ? () => {
        hoveredRef.current = false;
      }
    : undefined;

  const effectiveKey = replayKey + hoverKey;
  const isActive = active || hoverKey > 0;

  return (
    <span
      key={effectiveKey}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn("relative z-10 inline-block [isolation:isolate]", triggerOnHover && "cursor-default", className)}
    >
      {letters.map((letter, i) => {
        const glyph = letter === " " ? "\u00A0" : letter;
        const enterDelay = isActive ? getEnterDelay(i) : 0;
        const exitDelay = isActive ? getExitDelay(i) : 0;
        return (
          <span
            key={i}
            className="relative inline-block [perspective:1200px] [transform-style:preserve-3d] [width:auto]"
            aria-hidden="true"
          >
            <motion.span
              className="absolute left-0 top-0 inline-block [backface-visibility:hidden] [transform-origin:50%_25%]"
              initial={variants?.enter?.initial ?? enterInitial}
              animate={
                isActive
                  ? (variants?.enter?.animate ?? enterAnimate)
                  : (variants?.enter?.initial ?? enterInitial)
              }
              transition={
                variants?.enter
                  ? { ...transition, duration, delay: enterDelay }
                  : {
                      ...transition,
                      duration,
                      delay: enterDelay,
                      opacity: { duration, delay: enterDelay, times: ENTER_OPACITY_TIMES, ease: "linear" },
                    }
              }
            >
              {glyph}
            </motion.span>
            <motion.span
              className="absolute left-0 top-0 inline-block [backface-visibility:hidden] [transform-origin:50%_75%]"
              initial={variants?.exit?.initial ?? exitInitial}
              animate={
                isActive
                  ? (variants?.exit?.animate ?? exitAnimate)
                  : (variants?.exit?.initial ?? exitInitial)
              }
              transition={
                variants?.exit
                  ? { ...transition, duration, delay: exitDelay }
                  : {
                      ...transition,
                      duration,
                      delay: exitDelay,
                      opacity: { duration, delay: exitDelay, times: EXIT_OPACITY_TIMES, ease: "linear" },
                    }
              }
              onAnimationComplete={
                isActive && letters.length === i + 1 ? onAnimationComplete : undefined
              }
            >
              {glyph}
            </motion.span>
            <span className="invisible inline-block">{glyph}</span>
          </span>
        );
      })}
      <span className="sr-only">{children}</span>
    </span>
  );
}
