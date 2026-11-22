"use client";

import {
  motion,
  useReducedMotion,
  type Target,
  type TargetAndTransition,
  type Transition,
  type VariantLabels,
} from "framer-motion";

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

export function TextRoll({
  children,
  duration = 0.45,
  getEnterDelay = (i) => i * 0.035,
  getExitDelay = (i) => i * 0.035 + 0.12,
  className,
  transition = { ease: [0.22, 1, 0.36, 1] },
  active = true,
  replayKey = 0,
  variants,
  onAnimationComplete,
}: TextRollProps) {
  const reduceMotion = useReducedMotion();

  const defaultVariants = {
    enter: {
      initial: { rotateX: 0, opacity: 1 },
      animate: { rotateX: 95, opacity: 0 },
    },
    exit: {
      initial: { rotateX: -95, opacity: 0 },
      animate: { rotateX: 0, opacity: 1 },
    },
  } as const;

  if (reduceMotion) {
    return <span className={cn("inline-block", className)}>{children}</span>;
  }

  const letters = children.split("");

  return (
    <span key={replayKey} className={cn("inline-block", className)}>
      {letters.map((letter, i) => {
        const glyph = letter === " " ? "\u00A0" : letter;
        return (
          <span
            key={i}
            className="relative inline-block [perspective:1200px] [transform-style:preserve-3d] [width:auto]"
            aria-hidden="true"
          >
            <motion.span
              className="absolute left-0 top-0 inline-block [backface-visibility:hidden] [transform-origin:50%_20%]"
              initial={variants?.enter?.initial ?? defaultVariants.enter.initial}
              animate={
                active
                  ? (variants?.enter?.animate ?? defaultVariants.enter.animate)
                  : (variants?.enter?.initial ?? defaultVariants.enter.initial)
              }
              transition={{
                ...transition,
                duration,
                delay: active ? getEnterDelay(i) : 0,
              }}
            >
              {glyph}
            </motion.span>
            <motion.span
              className="absolute left-0 top-0 inline-block [backface-visibility:hidden] [transform-origin:50%_80%]"
              initial={variants?.exit?.initial ?? defaultVariants.exit.initial}
              animate={
                active
                  ? (variants?.exit?.animate ?? defaultVariants.exit.animate)
                  : (variants?.exit?.initial ?? defaultVariants.exit.initial)
              }
              transition={{
                ...transition,
                duration,
                delay: active ? getExitDelay(i) : 0,
              }}
              onAnimationComplete={
                active && letters.length === i + 1 ? onAnimationComplete : undefined
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
