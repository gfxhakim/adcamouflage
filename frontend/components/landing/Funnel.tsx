"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { EASE, Headline, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Upload",
    when: "Step 1",
    body: "Drop in a batch of videos or images. MP4, MOV, JPG and PNG all work.",
    value: "1",
    unit: "creative in",
  },
  {
    title: "Choose the strength",
    when: "Step 2",
    body: "Pick a preset and intensity, or switch the nine layers on and off yourself. Add your logo if you want.",
    value: "9",
    unit: "layers on",
  },
  {
    title: "Render",
    when: "Step 3",
    body: "Each copy is re-cut, re-timed, re-graded, re-encoded and scrubbed, with its own random values.",
    value: "10",
    unit: "unique copies",
  },
  {
    title: "Download and launch",
    when: "Step 4",
    body: "Grab each variant, or the whole batch as a zip with a report of exactly what changed.",
    value: "1",
    unit: "zip out",
  },
];

const CYCLE_MS = 2800;

export function Funnel() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-120px" });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [inView, reduce]);

  return (
    <section id="how-it-works" className="scroll-mt-24 bg-[#F4F5F7] py-20 sm:py-28">
      <div
        ref={ref}
        className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:px-8"
      >
        <div>
          <SectionTag index="04">How it works</SectionTag>
          <Headline text="Four steps. | [A few minutes.]" className="mt-5 text-4xl sm:text-5xl lg:text-6xl" />

          <ol className="mt-10 space-y-1">
            {STEPS.map((s, i) => {
              const on = i === step;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    className="relative w-full py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-full font-mono text-[10px] transition-colors",
                          on ? "bg-meta-500 text-white" : "text-ink-faint",
                        )}
                      >
                        0{i + 1}
                      </span>
                      <span
                        className={cn(
                          "text-xl font-semibold tracking-tight transition-colors sm:text-2xl",
                          on ? "text-black" : i < step ? "text-ink-subtle" : "text-black/25",
                        )}
                      >
                        {s.title}
                      </span>
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                        {s.when}
                      </span>
                    </span>
                    <AnimatePresence initial={false}>
                      {on ? (
                        <motion.p
                          className="overflow-hidden pl-9 text-sm leading-relaxed text-ink-muted"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.45, ease: EASE }}
                        >
                          <span className="block pt-2">{s.body}</span>
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                    <span className="absolute inset-x-0 bottom-0 h-px bg-black/10" />
                    {on ? (
                      <motion.span
                        key={`bar-${step}`}
                        className="absolute bottom-0 left-0 h-px bg-black"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: reduce ? 0 : CYCLE_MS / 1000, ease: "linear" }}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
            {STEPS.map((s, i) => {
              const filled = i <= step;
              const inset = i * 9;
              return (
                <div
                  key={s.title}
                  className="relative h-24 w-full sm:h-28"
                  style={{ clipPath: `polygon(${inset}% 0, ${100 - inset}% 0, ${100 - inset - 9}% 100%, ${inset + 9}% 100%)` }}
                >
                  <div className="absolute inset-0 bg-black/[0.07]" />
                  <motion.div
                    className={cn("absolute inset-0 origin-left", i === step ? "bg-meta-500" : "bg-meta-200")}
                    initial={false}
                    animate={{ scaleX: filled ? 1 : 0 }}
                    transition={{ duration: 0.8, ease: EASE }}
                  />
                  {/* Drifting particles: the files moving through */}
                  {Array.from({ length: 10 }, (_, d) => (
                    <span
                      key={d}
                      className={cn("absolute h-1 w-1 animate-drift rounded-full", filled ? "bg-white/80" : "bg-black/30")}
                      style={{ left: `${10 + ((d * 37) % 80)}%`, top: `${15 + ((d * 53) % 70)}%`, animationDelay: `${d * 0.35}s` }}
                      aria-hidden
                    />
                  ))}
                  <div className="relative flex h-full flex-col items-center justify-center">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono text-[10px]",
                        filled ? "bg-black text-white" : "bg-black/10 text-ink-subtle",
                      )}
                    >
                      0{i + 1} · {s.unit}
                    </span>
                    <span
                      className={cn(
                        "mt-1 text-3xl font-semibold tabular-nums tracking-[-0.04em] sm:text-4xl",
                        filled ? (i === step ? "text-white" : "text-meta-800") : "text-black/25",
                      )}
                    >
                      {filled ? s.value : "0"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
            An example batch · one creative, ten copies
          </p>
        </div>
      </div>
    </section>
  );
}

export default Funnel;
