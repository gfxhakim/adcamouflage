"use client";

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useCms } from "@/components/cms/ContentProvider";
import { TextRoll } from "@/components/ui/text-roll";

import { cn } from "@/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const;
const ROLL_TRANSITION = { ease: [0.22, 1, 0.36, 1] } as const;

/** Word-by-word delay, capped so long headlines on narrow screens don't sit half-shown. */
const stagger = (i: number) => Math.min(i, 8) * 0.05;

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
  style,
  ...rest
}: {
  text: string;
  as?: "h1" | "h2";
  dark?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-cms"?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const inView = useInView(ref, { once: false, amount: 0.25 });
  const reduce = useReducedMotion();
  const [replayKey, setReplayKey] = useState(0);
  const [triggerMode, setTriggerMode] = useState<"scroll" | "hover">("scroll");
  const [hasEntered, setHasEntered] = useState(Tag === "h1");
  const prevInView = useRef(false);
  const hoverEngagedRef = useRef(false);
  const rollingRef = useRef(false);
  const hoverLeaveTimerRef = useRef<number | null>(null);
  const rollResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (inView && !prevInView.current) {
      setHasEntered(true);
      setTriggerMode("scroll");
      setReplayKey((k) => k + 1);
    } else if (!inView && prevInView.current) {
      hoverEngagedRef.current = false;
      rollingRef.current = false;
      setTriggerMode("scroll");
    }
    prevInView.current = inView;
  }, [inView]);

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
      if (rollResetTimerRef.current !== null) window.clearTimeout(rollResetTimerRef.current);
    };
  }, []);

  const show = Boolean(inView || reduce || triggerMode === "hover");
  const pillVisible = hasEntered || show;

  const lines = text.split("|");
  let markedCount = 0;
  let hoverMaxEndSec = 0.5;
  for (const line of lines) {
    for (const part of line.trim().split(/(\[[^\]]+\])/).filter(Boolean)) {
      if (!part.startsWith("[")) continue;
      for (const w of part.replace(/[[\]]/g, "").trim().split(/\s+/)) {
        const idx = markedCount++;
        hoverMaxEndSec = Math.max(
          hoverMaxEndSec,
          idx * 0.045 + Math.max(0, w.length - 1) * 0.022 + 0.06 + 0.38,
        );
      }
    }
  }
  const hoverTotalMs = Math.ceil(hoverMaxEndSec * 1000) + 60;

  const handleMarkedEnter = () => {
    if (reduce) return;
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    if (hoverEngagedRef.current || rollingRef.current) return;
    hoverEngagedRef.current = true;
    rollingRef.current = true;
    setHasEntered(true);
    setTriggerMode("hover");
    setReplayKey((k) => k + 1);
    if (rollResetTimerRef.current !== null) {
      window.clearTimeout(rollResetTimerRef.current);
    }
    rollResetTimerRef.current = window.setTimeout(() => {
      rollingRef.current = false;
      rollResetTimerRef.current = null;
    }, hoverTotalMs);
  };

  const handleMarkedLeave = () => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current);
    }
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      hoverEngagedRef.current = false;
      hoverLeaveTimerRef.current = null;
    }, 80);
  };

  let word = 0;
  let markedWord = 0;

  return (
    <Tag
      {...rest}
      ref={ref}
      style={style}
      aria-label={text.replace(/[[\]|]/g, (c) => (c === "|" ? " " : ""))}
      className={cn(
        "font-sans font-semibold leading-[0.98] tracking-[-0.045em] [text-wrap:balance]",
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
                    const mIdx = marked ? markedWord++ : 0;
                    const isHoverRoll = triggerMode === "hover";
                    const baseDelay = isHoverRoll ? mIdx * 0.045 : 0.08 + stagger(i) * 0.85;
                    const charDelayStep = isHoverRoll ? 0.022 : 0.028;
                    const exitGap = isHoverRoll ? 0.06 : 0.08;
                    return (
                      <span
                        key={`${pi}-${w}-${i}`}
                        onMouseEnter={marked ? handleMarkedEnter : undefined}
                        onMouseLeave={marked ? handleMarkedLeave : undefined}
                        className={cn("relative mr-[0.26em] inline-block", marked && "cursor-default")}
                      >
                        {marked ? (
                          <motion.span
                            className="pointer-events-none absolute -inset-x-[0.07em] inset-y-[0.04em] z-0 origin-left rounded-[0.12em] bg-meta-500"
                            initial={{ scaleX: 0 }}
                            animate={pillVisible ? { scaleX: 1 } : {}}
                            transition={{ duration: 0.55, delay: 0.06 + stagger(i) * 0.7, ease: EASE }}
                          />
                        ) : null}
                        {marked ? (
                          <TextRoll
                            active={show}
                            replayKey={replayKey}
                            duration={isHoverRoll ? 0.38 : 0.42}
                            getEnterDelay={(ci) => baseDelay + ci * charDelayStep}
                            getExitDelay={(ci) => baseDelay + ci * charDelayStep + exitGap}
                            transition={ROLL_TRANSITION}
                            className="relative z-10 inline-block whitespace-nowrap text-white [isolation:isolate]"
                          >
                            {w}
                          </TextRoll>
                        ) : (
                          <motion.span
                            className="relative inline-block"
                            // The page's h1 is painted at once (only slides) so it doesn't hold back
                            // Largest Contentful Paint; other headlines still fade in on scroll.
                            initial={{ y: "0.5em", opacity: Tag === "h1" ? 1 : 0 }}
                            animate={pillVisible ? { y: 0, opacity: 1 } : {}}
                            transition={{ duration: 0.55, delay: stagger(i), ease: EASE }}
                          >
                            {w}
                          </motion.span>
                        )}
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
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.65, delay, ease: EASE }}
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

/** A Headline whose text, style and visibility come from Admin > Landing. */
export function CmsHeadline({ k, text, ...props }: { k: string; text: string; as?: "h1" | "h2"; dark?: boolean; className?: string }) {
  const cms = useCms();
  const value = cms.text(k, text, "headline", "Headline");
  if (cms.hidden(k)) return null;
  return <Headline {...props} text={value} style={cms.textStyle(k)} {...cms.mark(k)} />;
}
