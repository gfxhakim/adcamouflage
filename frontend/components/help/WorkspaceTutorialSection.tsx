"use client";

import clsx from "clsx";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Film,
  Layers,
  PlayCircle,
  Sliders,
  Sparkles,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import NeonCard from "@/components/NeonCard";

interface Chapter {
  time: string;
  seconds: number;
  title: string;
  summary: string;
}

const CHAPTERS: Chapter[] = [
  {
    time: "00:00",
    seconds: 0,
    title: "Workspace Overview",
    summary: "Four-step pipeline bar (Load, Settings, Overlay, Render), token balance chip, and light/dark mode dock.",
  },
  {
    time: "00:12",
    seconds: 12,
    title: "01 · Load Master Creatives",
    summary: "Drag up to 25 MP4/MOV videos or JPG/PNG banners into the queue; each asset renders independently.",
  },
  {
    time: "00:21",
    seconds: 21,
    title: "02 · Platforms & Layer Profiles",
    summary: "Select Meta, TikTok, or YouTube Shorts presets, pick Dynamic / Balanced / Studio Pro, and tune intensity.",
  },
  {
    time: "00:49",
    seconds: 49,
    title: "03 · Brand Watermarks & Cover Frame",
    summary: "Position a transparent PNG logo overlay in any corner and scrub to pick your exact video thumbnail frame.",
  },
  {
    time: "01:15",
    seconds: 75,
    title: "04 · Render Queue & 1-Click ZIP Export",
    summary: "Review exact token cost, monitor live queue progress, inspect output reports, and download as a ZIP.",
  },
  {
    time: "01:47",
    seconds: 107,
    title: "History & Token Plans",
    summary: "Re-download past batches inside the 24-hour retention window or manage Starter / Pro / Max plans & top-ups.",
  },
];

const LAYER_PILLARS = [
  {
    icon: Layers,
    title: "Multi-Layer Frame Rebuilding",
    body: "Reconstructs visual composition, framing proportions, micro-contrast, and clean pixel structure across up to 23 processing layers so fatigued or rejected winners export as fresh studio assets.",
  },
  {
    icon: Sliders,
    title: "Studio Rec.709 Color & Clean Encoding",
    body: "Normalizes color profiles to broadcast Rec.709 and re-encodes fresh H.264 / H.265 containers matched to Meta Feed/Reels, TikTok, and YouTube Shorts technical specs.",
  },
  {
    icon: Volume2,
    title: "−14 LUFS Broadcast Audio Mastering",
    body: "Balances speech clarity and loudness at −14 LUFS true-peak safe levels with clean audio streams so clips play consistently across mobile feeds.",
  },
  {
    icon: Sparkles,
    title: "Dynamic vs. Studio Pro (Gen-4)",
    body: "Keep Dynamic selected (recommended) for full multi-layer visual & audio variation. Switch to Studio Pro (Gen-4 Precision) whenever your video has burned-in subtitles.",
  },
];

const TIPS = [
  "Generate 2–4 clean variations per winning creative so each ad set gets fresh delivery without exhausting spend.",
  "Each finished output file counts as one generation; check exact token cost inside Step 4 (Render) before starting.",
  "Always scrub the thumbnail picker to a crisp hook frame (0.5s–2.0s) so your feed cover grabs attention immediately.",
  "All rendered assets auto-purge after 24 hours for privacy — download your batch ZIP from Step 4 or History right away.",
];

export function WorkspaceTutorialSection({ compact = false }: { compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeChapter, setActiveChapter] = useState(0);

  const jumpTo = (index: number, seconds: number) => {
    setActiveChapter(index);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
  };

  return (
    <section id="tutorials" aria-labelledby="workspace-tutorials-heading" className="scroll-mt-24 space-y-5">
      <NeonCard padding="lg" radius="xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label flex items-center gap-1.5 text-meta-600 dark:text-meta-300">
              <PlayCircle className="h-3.5 w-3.5" aria-hidden />
              Tutorials
            </p>
            <h2
              id="workspace-tutorials-heading"
              className="mt-1 font-display text-2xl font-normal leading-tight text-black dark:text-slate-50 sm:text-3xl"
            >
              Workspace Walkthrough &amp; Layer Guide
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-muted dark:text-slate-400 sm:text-sm">
              Watch the direct 2-minute step-by-step workspace walkthrough — learn how to load assets, tune multi-layer
              settings, add brand overlays, and export batch variations.
            </p>
          </div>
          {compact ? (
            <Link
              href="/app/tutorials"
              className="btn-ghost shrink-0 gap-1.5 !px-3.5 !py-2 !text-xs"
            >
              Open full tutorials
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
          {/* Direct 60fps tutorial video (no intro / no outro) */}
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-black shadow-lg dark:border-white/10">
            <video
              ref={videoRef}
              src="/media/workspace-tutorial.mp4"
              poster="/media/workspace-tutorial-poster.jpg"
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/90 px-4 py-2.5 text-[11px] text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium text-white">
                <Film className="h-3.5 w-3.5 text-meta-400" aria-hidden />
                Full Workspace Tutorial · Voiced 60 FPS (02:06)
              </span>
              <span className="font-mono text-[10px] text-slate-400">Click any chapter to jump →</span>
            </div>
          </div>

          {/* Interactive chapter timeline */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-subtle dark:text-slate-400">
              <Clock className="h-3.5 w-3.5 text-meta-500" aria-hidden />
              Video Chapters
            </p>
            <div className="space-y-1.5">
              {CHAPTERS.map((ch, idx) => {
                const selected = activeChapter === idx;
                return (
                  <button
                    key={ch.time}
                    type="button"
                    onClick={() => jumpTo(idx, ch.seconds)}
                    className={clsx(
                      "w-full rounded-xl border px-3.5 py-2.5 text-left transition",
                      selected
                        ? "border-meta-500/60 bg-meta-500/10 text-black dark:bg-meta-500/15 dark:text-white"
                        : "border-black/[0.08] bg-white/70 text-ink-muted hover:border-meta-500/40 hover:bg-meta-50/60 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-meta-400/40 dark:hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-md bg-meta-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-meta-700 dark:text-meta-300">
                        {ch.time}
                      </span>
                      <span className="text-xs font-semibold text-black dark:text-white">{ch.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-muted dark:text-slate-400">
                      {ch.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </NeonCard>

      {/* Detailed explanation cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {LAYER_PILLARS.map(({ icon: Icon, title, body }) => (
          <NeonCard key={title} padding="md" radius="xl">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-meta-500/15 text-meta-600 dark:text-meta-300">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-black dark:text-white">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted dark:text-slate-400">{body}</p>
              </div>
            </div>
          </NeonCard>
        ))}
      </div>

      {!compact ? (
        <NeonCard padding="lg" radius="xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-black dark:text-white">
                Best-Practice Checklist Before Exporting
              </h3>
              <ul className="space-y-2 text-xs leading-relaxed text-ink-muted dark:text-slate-300">
                {TIPS.map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link href="/app" className="btn-primary shrink-0 !text-xs">
              Back to Workspace
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </NeonCard>
      ) : null}
    </section>
  );
}

export default WorkspaceTutorialSection;
