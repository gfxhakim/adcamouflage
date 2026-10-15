"use client";

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** The "(01) Why" pill that opens every landing section. */
export function SectionTag({
  index,
  children,
  dark = false,
  className,
}: {
  index: string;
  children: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] tracking-wide",
        dark ? "bg-white/[0.08] text-white/70" : "bg-black/[0.05] text-ink-muted",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-meta-500" aria-hidden />({index}) {children}
    </span>
  );
}

/**
 * A big landing headline. Wrap words in [brackets] to set them on a blue
 * marker that sweeps in from the left once the heading scrolls into view.
 * A "|" starts a new line.
 */
export function Headline({
  text,
  as: Tag = "h2",
  dark = false,
  className,
}: {
  text: string;
  as?: "h1" | "h2";
  dark?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const show = inView || reduce;

  let word = 0;
  const lines = text.split("|");

  return (
    <Tag
      ref={ref}
      aria-label={text.replace(/[[\]|]/g, (c) => (c === "|" ? " " : ""))}
      className={cn(
        "font-sans font-semibold leading-[0.98] tracking-[-0.045em]",
        dark ? "text-white" : "text-black",
        className,
      )}
    >
      {lines.map((line, li) => (
        <span key={li} className="block" aria-hidden>
          {line
            .trim()
            .split(/(\[[^\]]+\])/)
            .filter(Boolean)
            .map((part, pi) => {
              const marked = part.startsWith("[");
              const words = part.replace(/[[\]]/g, "").trim().split(/\s+/);
              return (
                <Fragment key={pi}>
                  {words.map((w) => {
                    const i = word++;
                    return (
                      <span key={`${pi}-${w}-${i}`} className="relative mr-[0.22em] inline-block">
                        {marked ? (
                          <motion.span
                            className="absolute -inset-x-[0.08em] inset-y-[0.04em] origin-left rounded-[0.12em] bg-meta-500"
                            initial={{ scaleX: 0 }}
                            animate={show ? { scaleX: 1 } : {}}
                            transition={{ duration: 0.7, delay: 0.25 + i * 0.06, ease: EASE }}
                          />
                        ) : null}
                        <motion.span
                          className={cn("relative inline-block", marked && "text-white")}
                          initial={{ y: "0.5em", opacity: 0 }}
                          animate={show ? { y: 0, opacity: 1 } : {}}
                          transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}
                        >
                          {w}
                        </motion.span>
                      </span>
                    );
                  })}
                </Fragment>
              );
            })}
        </span>
      ))}
    </Tag>
  );
}

/** Fades and lifts its children in when they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A number that rolls up to `value` the first time it is seen. */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.6,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration, ease: EASE, onUpdate: setShown });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {shown.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/** Round "Explore"-style button with an arrow bubble on the right. */
export function PillArrow({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={cn(
        "grid h-7 w-7 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-45",
        dark ? "bg-white text-black" : "bg-black text-white",
      )}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 11 11 5M6 5h5v5" />
      </svg>
    </span>
  );
}
