"use client";

import {
  ArrowDown,
  ArrowRight,
  Layers,
  Play,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";

import ScrollAutoVideo from "@/components/scale/ScrollAutoVideo";
import { cn } from "@/lib/utils";

type CaseStudyVariant = "16x9" | "9x16";

// Configurable via NEXT_PUBLIC_MAIN_SITE_URL when hosting /scale on a separate standalone domain.
const MAIN_SITE_URL = (process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://www.proteusflow.com").replace(/\/+$/, "");

const ROLES = [
  {
    icon: TrendingUp,
    role: "Media Buyers",
    hook: "Feed winning ad sets without delays.",
    copy: "Launch fresh creative iterations across Meta and TikTok fast instead of stalling spend on manual edits.",
  },
  {
    icon: ShieldCheck,
    role: "Brand Owners",
    hook: "Protect your highest-converting hooks.",
    copy: "Multiply winning creative angles while keeping every brand frame, product demo, and message razor-sharp.",
  },
  {
    icon: ShoppingBag,
    role: "Ecom Store Owners",
    hook: "Turn one product shoot into scale.",
    copy: "Adapt high-performing product videos across Reels, TikTok, and Shorts simultaneously with studio consistency.",
  },
  {
    icon: Scissors,
    role: "Video Editors",
    hook: "Zero repetitive timeline re-exports.",
    copy: "Drop your finished cut in once—keep 100% of your pacing, captions, and voiceover timing completely untouched.",
  },
  {
    icon: Layers,
    role: "Creative Strategists",
    hook: "Turn one winning concept into ten.",
    copy: "Multiply testing velocity across ad accounts from proven winners without re-shooting or rewriting scripts.",
  },
] as const;

const STUDIO_CHIPS = [
  "01 · Drop Creative Folder In",
  "02 · Dynamic Preset Pre-Selected (Green)",
  "03 · Download Campaign-Ready Batches",
] as const;

export function ScaleLanding() {
  const [variant, setVariant] = useState<CaseStudyVariant>("16x9");

  return (
    <div className="min-h-screen bg-white text-zinc-950 selection:bg-meta-500 selection:text-white">
      {/* Clean standalone top header (zero pricing links, keeps focus straight down funnel) */}
      <header className="relative z-30 border-b border-black/[0.07] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <a href={MAIN_SITE_URL} className="flex items-center gap-2.5" aria-label="ProteusFlow Home">
            {/* eslint-disable-next-line @next/next/no-img-element -- static standalone brand mark */}
            <img src="/brand/proteusflow-mark.png" alt="ProteusFlow" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-sans text-lg font-bold tracking-tight text-zinc-950">
              Proteus<span className="text-meta-500">Flow</span>
            </span>
          </a>

          <a
            href="#case-study"
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            <Play className="h-3 w-3 text-meta-500" aria-hidden />
            Watch Workflow Proof
          </a>
        </div>
      </header>

      <main>
        {/* 1. HERO TEXT HOOK -> DIRECTLY LEADS TO CASE STUDY VIDEO BELOW */}
        <section className="relative overflow-hidden border-b border-black/[0.06] bg-white pb-12 pt-10 sm:pb-16 sm:pt-16">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-[radial-gradient(ellipse_at_top,rgba(8,102,255,0.08),transparent_70%)]"
            aria-hidden
          />

          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <span className="inline-flex items-center rounded-full border border-meta-500/20 bg-meta-50 px-3.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-meta-600">
              For High-Velocity Ad Teams
            </span>

            <h1 className="mt-5 font-sans text-4xl font-bold leading-[1.06] tracking-[-0.04em] text-zinc-950 sm:text-6xl">
              Stop Re-Editing Winners.{" "}
              <span className="mt-1 inline-block rounded-xl bg-meta-500 px-3 py-0.5 text-white">Scale Every Angle</span>{" "}
              Across Meta &amp; TikTok.
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
              Upload one finished ad creative into ProteusFlow and generate fresh, platform-formatted variations in
              minutes—without losing your hooks, pacing, or voiceover impact.
            </p>

            <div className="mt-7 flex justify-center">
              <a
                href="#case-study"
                className="group inline-flex items-center gap-3 rounded-full bg-zinc-950 px-6 py-3.5 text-sm font-bold text-white shadow-lifted transition hover:bg-meta-500"
              >
                Watch Real Case Study Below
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-zinc-950 transition-transform group-hover:translate-y-0.5">
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </span>
              </a>
            </div>
          </div>
        </section>

        {/* 2. CASE STUDY VIDEOS (AUTOPLAY WHEN SCROLLED INTO VIEW) */}
        <section id="case-study" className="scroll-mt-6 border-b border-black/[0.06] bg-zinc-50 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  01 · Brand Workflow Case Study
                </p>
                <h2 className="mt-2 font-sans text-2xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-4xl">
                  See How One Master Folder Scales Across Feeds
                </h2>
              </div>

              <div
                className="inline-flex shrink-0 rounded-full border border-black/10 bg-white p-1 shadow-sm"
                role="tablist"
                aria-label="Case study video format"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === "16x9"}
                  onClick={() => setVariant("16x9")}
                  className={cn(
                    "rounded-full px-4 py-1.5 font-mono text-xs font-semibold transition",
                    variant === "16x9" ? "bg-meta-500 text-white" : "text-zinc-600 hover:text-zinc-950",
                  )}
                >
                  16:9 Case Study
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === "9x16"}
                  onClick={() => setVariant("9x16")}
                  className={cn(
                    "rounded-full px-4 py-1.5 font-mono text-xs font-semibold transition",
                    variant === "9x16" ? "bg-meta-500 text-white" : "text-zinc-600 hover:text-zinc-950",
                  )}
                >
                  9:16 Feed Format
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-black/10 bg-white p-2.5 shadow-lifted sm:p-3.5">
              {variant === "16x9" ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl">
                  <ScrollAutoVideo
                    key="case-16x9"
                    src="/media/case-study-16x9.mp4"
                    poster="/media/case-study-poster.jpg"
                  />
                </div>
              ) : (
                <div className="flex justify-center py-2">
                  <div className="relative aspect-[9/16] w-full max-w-[340px] overflow-hidden rounded-[26px] border border-black/15 shadow-card">
                    <ScrollAutoVideo key="case-9x16" src="/media/case-study-9x16.mp4" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 3. SHORT, AGGRESSIVE 5-ROLE CONVERSION SECTION */}
        <section id="who-its-for" className="border-b border-black/[0.06] bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-meta-600">
                02 · Built for Performance Teams
              </p>
              <h2 className="mt-2 font-sans text-2xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-4xl">
                Stop Leaving Winning Output Stuck in Editing Queues.
              </h2>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
              {ROLES.map(({ icon: Icon, role, hook, copy }, idx) => (
                <div
                  key={role}
                  className={cn(
                    "flex flex-col justify-between rounded-2xl border border-black/10 bg-zinc-50/80 p-5 transition hover:border-meta-500/40 hover:bg-white hover:shadow-card",
                    idx < 3 ? "lg:col-span-2" : "lg:col-span-3",
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-meta-600">
                        {role}
                      </span>
                      <span className="grid h-8 w-8 place-items-center rounded-lg border border-black/[0.08] bg-white text-emerald-600 shadow-sm">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold tracking-tight text-zinc-950">{hook}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. 60 FPS WORKSPACE TUTORIAL VIDEO (NO INTRO / NO OUTRO · AUTOPLAY ON SCROLL) */}
        <section id="tutorial" className="border-b border-black/[0.06] bg-zinc-50 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="text-center">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-meta-600">
                03 · 60 FPS Studio Walkthrough
              </p>
              <h2 className="mt-2 font-sans text-2xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-4xl">
                Inside the Workspace: Upload to Clean Batch
              </h2>
            </div>

            <div className="mt-6 rounded-3xl border border-black/10 bg-white p-2.5 shadow-lifted sm:p-3.5">
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl">
                <ScrollAutoVideo src="/media/workspace-tutorial.mp4" poster="/media/workspace-tutorial-poster.jpg" />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {STUDIO_CHIPS.map((label) => (
                <div
                  key={label}
                  className="rounded-xl border border-black/[0.08] bg-white px-4 py-3 text-center font-mono text-xs font-semibold text-zinc-800 shadow-sm"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. DIRECT CTA -> LEADS TO PRINCIPAL LANDING PAGE (NO PRICING / NO PLANS) */}
        <section className="bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <div className="rounded-3xl border border-meta-500/20 bg-gradient-to-b from-meta-50/60 to-white px-6 py-12 shadow-lifted sm:px-10">
              <span className="inline-flex items-center rounded-full border border-emerald-600/25 bg-emerald-50 px-3.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                Dynamic Preset · Pre-Selected &amp; Recommended
              </span>

              <h2 className="mt-5 font-sans text-3xl font-bold leading-[1.08] tracking-[-0.035em] text-zinc-950 sm:text-5xl">
                Scale Every Winning Concept Inside ProteusFlow.
              </h2>

              <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-zinc-600 sm:text-base">
                See the full studio workflow and unlock effortless multi-platform ad production in minutes.
              </p>

              <div className="mt-7 flex justify-center">
                <a
                  href={MAIN_SITE_URL}
                  className="group inline-flex items-center gap-3 whitespace-nowrap rounded-full bg-meta-500 py-3 pl-7 pr-3 text-base font-bold text-white shadow-meta transition hover:bg-meta-600"
                >
                  Continue to Super AI Agent
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-meta-600 transition-transform group-hover:translate-x-0.5">
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.07] bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-zinc-500 sm:flex-row sm:px-6">
          <span>© 2026 ProteusFlow. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <a href={MAIN_SITE_URL} className="transition hover:text-zinc-900">
              Super AI Agent
            </a>
            <a href={`${MAIN_SITE_URL}/privacy`} className="transition hover:text-zinc-900">
              Privacy Policy
            </a>
            <a href={`${MAIN_SITE_URL}/terms`} className="transition hover:text-zinc-900">
              Terms of Service
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default ScaleLanding;
