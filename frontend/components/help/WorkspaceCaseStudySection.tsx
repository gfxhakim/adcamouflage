"use client";

import clsx from "clsx";
import { Film, Play } from "lucide-react";
import { useRef, useState } from "react";

import NeonCard from "@/components/NeonCard";

type CaseStudyVariant = "16x9" | "9x16";

/**
 * High-impact Case Study video showcase inside the workspace, highlighting
 * real media buyer workflow results with 16:9 and 9:16 format switching.
 */
export function WorkspaceCaseStudySection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [variant, setVariant] = useState<CaseStudyVariant>("16x9");
  const [started, setStarted] = useState(false);

  const switchVariant = (next: CaseStudyVariant) => {
    if (next === variant) return;
    setVariant(next);
    setStarted(false);
  };

  const handlePlay = () => {
    setStarted(true);
    void videoRef.current?.play().catch(() => undefined);
  };

  return (
    <section
      id="case-study"
      aria-labelledby="workspace-case-study-heading"
      className="scroll-mt-24"
    >
      <NeonCard padding="lg" radius="xl" glow>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" aria-hidden />
            FEATURED CASE STUDY · REAL MEDIA BUYER PROOF
          </span>

          <div
            className="inline-flex w-fit shrink-0 rounded-full border border-black/10 bg-black/[0.04] p-1 dark:border-white/15 dark:bg-white/[0.06]"
            role="tablist"
            aria-label="Case study video format"
          >
            <button
              type="button"
              role="tab"
              aria-selected={variant === "16x9"}
              onClick={() => switchVariant("16x9")}
              className={clsx(
                "rounded-full px-3.5 py-1 font-mono text-[11px] font-semibold transition",
                variant === "16x9"
                  ? "bg-meta-500 text-white shadow-sm"
                  : "text-ink-muted hover:text-black dark:text-slate-300 dark:hover:text-white",
              )}
            >
              16:9 Widescreen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={variant === "9x16"}
              onClick={() => switchVariant("9x16")}
              className={clsx(
                "rounded-full px-3.5 py-1 font-mono text-[11px] font-semibold transition",
                variant === "9x16"
                  ? "bg-meta-500 text-white shadow-sm"
                  : "text-ink-muted hover:text-black dark:text-slate-300 dark:hover:text-white",
              )}
            >
              9:16 Feed
            </button>
          </div>
        </div>

        <h2
          id="workspace-case-study-heading"
          className="mt-4 font-sans text-4xl font-black uppercase leading-[0.95] tracking-[-0.04em] text-black dark:text-white sm:text-6xl lg:text-7xl xl:text-[5.25rem]"
        >
          CASE STUDY FOR{" "}
          <span className="bg-gradient-to-r from-meta-600 via-blue-500 to-cyan-400 bg-clip-text text-transparent dark:from-meta-300 dark:via-blue-400 dark:to-cyan-300">
            PROTEUSFLOW AI
          </span>
        </h2>

        <p className="mt-3 max-w-5xl font-sans text-xl font-extrabold leading-[1.15] tracking-[-0.025em] text-black/85 dark:text-slate-100 sm:text-3xl lg:text-4xl">
          and why it&apos;s the most underrated AI agent for media buyers!
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-black/15 bg-black shadow-2xl dark:border-white/15">
          {variant === "16x9" ? (
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <video
                ref={videoRef}
                key="workspace-case-16x9"
                src="/media/case-study-16x9.mp4"
                poster="/media/case-study-poster.jpg"
                controls
                playsInline
                preload="metadata"
                onPlay={() => setStarted(true)}
                className="h-full w-full object-contain"
              />
              {!started ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                  <button
                    type="button"
                    onClick={handlePlay}
                    aria-label="Play case study video"
                    className="pointer-events-auto grid h-16 w-16 place-items-center rounded-full border border-white/30 bg-meta-500/95 text-white shadow-[0_12px_36px_rgba(8,102,255,0.65)] transition hover:scale-105 hover:bg-meta-500 sm:h-20 sm:w-20"
                  >
                    <Play className="ml-1 h-7 w-7 fill-white sm:h-8 sm:w-8" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex justify-center bg-zinc-950 px-4 py-5">
              <div className="relative aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-[26px] border border-white/15 bg-black shadow-2xl">
                <video
                  ref={videoRef}
                  key="workspace-case-9x16"
                  src="/media/case-study-9x16.mp4"
                  controls
                  playsInline
                  preload="metadata"
                  onPlay={() => setStarted(true)}
                  className="h-full w-full object-contain"
                />
                {!started ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                    <button
                      type="button"
                      onClick={handlePlay}
                      aria-label="Play case study video"
                      className="pointer-events-auto grid h-16 w-16 place-items-center rounded-full border border-white/30 bg-meta-500/95 text-white shadow-[0_12px_36px_rgba(8,102,255,0.65)] transition hover:scale-105 hover:bg-meta-500"
                    >
                      <Play className="ml-1 h-7 w-7 fill-white" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/95 px-4 py-2.5 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-medium text-white">
              <Film className="h-3.5 w-3.5 text-meta-400" aria-hidden />
              ProteusFlow AI Case Study · Real Workflow Proof
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {variant === "16x9" ? "16:9 Widescreen" : "9:16 Feed"}
            </span>
          </div>
        </div>
      </NeonCard>
    </section>
  );
}

export default WorkspaceCaseStudySection;
