import {
  ArrowRight,
  AudioLines,
  Check,
  Copy,
  EyeOff,
  Fingerprint,
  ImagePlus,
  Layers3,
  LockKeyhole,
  Repeat2,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import LandingNav from "@/components/LandingNav";
import NeonCard from "@/components/NeonCard";
import PricingSection, { type PublicPlan } from "@/components/PricingSection";
import RenderProof from "@/components/RenderProof";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "AdCamouflage — One winning ad, endless fresh copies",
  description:
    "Turn one winning creative into fresh, unique files. Each copy looks the same to people but carries a new fingerprint, new timing and zero metadata, so reused ads stop being matched as duplicates.",
};

const BENEFITS = [
  { icon: Fingerprint, text: "A new file hash and pixel signature on every copy" },
  { icon: Tags, text: "Camera, editor and encoder metadata wiped clean" },
  { icon: AudioLines, text: "Audio re-pitched, so voice matching hears a new track" },
  { icon: Layers3, text: "Nine mutation layers, batch in, one zip out" },
];

const WHY = [
  {
    icon: Copy,
    title: "Stop duplicate flags",
    body: "Ad platforms compare every upload with what they have already seen. A camouflaged copy reads as a brand-new file, so a creative that worked once can run again without being matched to the original.",
  },
  {
    icon: Repeat2,
    title: "Beat creative fatigue",
    body: "Skip paying for new edits every week. Spin a winning ad into fresh variants in minutes and keep testing across ad sets and campaigns.",
  },
  {
    icon: EyeOff,
    title: "Keep your files anonymous",
    body: "Device, editing app, project names and encoder tags are removed, so your files say nothing about how, where or by whom they were made.",
  },
];

const PIPELINE = [
  {
    icon: Upload,
    title: "Upload",
    body: "Drop in a batch of videos or images. MP4, MOV, JPG and PNG all work.",
  },
  {
    icon: SlidersHorizontal,
    title: "Choose the strength",
    body: "Pick a preset and intensity, or switch the nine layers on and off yourself. Add your logo if you want.",
  },
  {
    icon: Fingerprint,
    title: "Render",
    body: "Each copy is re-cut, re-timed, re-graded, re-encoded and scrubbed, with its own random values.",
  },
  {
    icon: Rocket,
    title: "Download and launch",
    body: "Grab each variant, or the whole batch as a zip with a report of exactly what changed.",
  },
];

// Shown only if the API cannot be reached; normally the admin panel's plans are used.
const FALLBACK_PLANS: PublicPlan[] = [
  { id: "free", label: "Free", monthly_quota: 10, price: 0 },
  { id: "starter", label: "Starter", monthly_quota: 100, price: 19 },
  { id: "pro", label: "Pro", monthly_quota: 500, price: 49 },
  { id: "unlimited", label: "Unlimited", monthly_quota: null, price: 99 },
];

async function loadPlans(): Promise<{ plans: PublicPlan[]; currency: string }> {
  // Server-side, so talk to the API service directly rather than through the /api rewrite.
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${origin}/api/v1/plans`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const data = (await response.json()) as { plans?: PublicPlan[]; currency?: string };
      if (data.plans?.length) return { plans: data.plans, currency: data.currency || "USD" };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { plans: FALLBACK_PLANS, currency: "USD" };
}

export default async function LandingPage() {
  // Everyone sees the visitor version of this page, and every start button
  // opens the login page, which also offers to create an account.
  const startHref = "/login";
  const pricing = await loadPlans();

  return (
    <>
      <SiteHeader nav={<LandingNav variant="header" />} />
      <LandingNav variant="dock" />

      <main className="mx-auto max-w-7xl overflow-x-clip px-4 pb-28 pt-8 sm:px-6 sm:pt-10 lg:px-8 lg:pb-20">
        {/* Hero -------------------------------------------------------------- */}
        <section id="home" className="relative mb-20 scroll-mt-24">
          <div
            className="pointer-events-none absolute -inset-x-10 -top-28 h-72 animate-float-slow rounded-full bg-meta-500/[0.07] blur-3xl"
            aria-hidden
          />
          <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
            <div>
              <span className="chip mb-6 !border-meta-500/30 !bg-meta-50 !text-meta-700">
                <ShieldCheck className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                Built for media buyers who run at volume
              </span>

              <h1 className="max-w-2xl font-display text-[2.9rem] font-normal leading-[0.98] tracking-[-0.015em] text-black sm:text-6xl lg:text-[4.6rem]">
                One winning ad.
                <br />
                <em className="italic text-meta-500">Endless fresh copies.</em>
              </h1>

              <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
                Ad platforms fingerprint every file you upload. Reuse a creative across ad sets or
                accounts and it gets matched, flagged as a duplicate and throttled. AdCamouflage
                re-renders your video or image into copies that{" "}
                <strong className="font-semibold text-black">look identical to people</strong> but
                carry a new hash, new pixels, new timing and zero metadata, so every upload starts
                clean.
              </p>

              <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {BENEFITS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                      <Icon className="h-3 w-3" aria-hidden />
                    </span>
                    <span className="text-sm leading-snug text-ink-muted">{text}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={startHref} className="btn-primary !px-6 !py-3 !text-base">
                  <Rocket className="h-4 w-4" aria-hidden />
                  Start camouflaging free
                </Link>
                <Link href="/login" className="btn-ghost !px-5 !py-3">
                  I already have an account
                </Link>
              </div>

              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Free account to start
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Batch uploads
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Files auto-deleted after your retention window
                </span>
              </p>
            </div>

            <RenderProof />
          </div>
        </section>

        {/* Why --------------------------------------------------------------- */}
        <section id="why" className="mb-20 scroll-mt-24">
          <p className="label">Why media buyers use it</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-normal leading-[1.05] tracking-[-0.01em] text-black sm:text-5xl">
            Your best ad, <em className="italic text-meta-500">without the duplicate tax.</em>
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {WHY.map(({ icon: Icon, title, body }) => (
              <NeonCard key={title} interactive padding="lg" radius="xl">
                <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-xl border border-black/10 bg-meta-50 text-meta-500">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="font-display text-2xl font-normal leading-tight text-black">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
              </NeonCard>
            ))}
          </div>
        </section>

        {/* Workspace + overlay ------------------------------------------- */}
        <section id="features" className="mb-20 grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <NeonCard padding="lg" radius="xl">
            <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-xl border border-black/10 bg-meta-50 text-meta-500">
              <LockKeyhole className="h-5 w-5" aria-hidden />
            </span>
            <p className="label">Your own workspace</p>
            <h2 className="mt-3 font-display text-3xl font-normal leading-tight text-black">
              Every upload stays in your account
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Sign in to a private workspace where you load assets, set the strength, add an
              overlay and watch the render queue. Batches, outputs and download links are visible
              only to you, and everything is deleted automatically when your retention window ends.
            </p>
            <Link href="/signup" className="btn-primary mt-5 !px-5">
              Create your account
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </NeonCard>

          <NeonCard padding="lg" radius="xl">
            <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-xl border border-black/10 bg-meta-50 text-meta-500">
              <ImagePlus className="h-5 w-5" aria-hidden />
            </span>
            <p className="label">Put your brand on it</p>
            <h2 className="mt-3 font-display text-3xl font-normal leading-tight text-black">
              Add your logo exactly where and when you want
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-ink-muted">
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">01</span>
                <span>
                  <strong className="font-semibold text-black">Every frame</strong>: a watermark
                  across the whole clip.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">02</span>
                <span>
                  <strong className="font-semibold text-black">Intro only</strong>: show it for the
                  first few seconds, then let the creative breathe.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">03</span>
                <span>
                  <strong className="font-semibold text-black">Exact frames</strong>: pick the
                  frames, and the engine keeps them accurate even after the frame rate changes.
                </span>
              </li>
            </ul>
            <p className="mt-5 border-t border-black/10 pt-4 text-[11px] leading-relaxed text-ink-faint">
              Nine anchor positions or exact coordinates, size as a share of the frame, and
              adjustable opacity. Transparent PNGs keep their transparency.
            </p>
          </NeonCard>
        </section>

        {/* Pipeline ------------------------------------------------------ */}
        <section id="how-it-works" className="mb-20 scroll-mt-24">
          <p className="label">How it works</p>
          <h2 className="mb-8 mt-3 font-display text-4xl font-normal leading-[1.05] text-black sm:text-5xl">
            Four steps. <em className="italic text-meta-500">A few minutes.</em>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(({ icon: Icon, title, body }, index) => (
              <NeonCard key={title} interactive padding="md" radius="lg">
                <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-lg border border-black/10 bg-meta-50 text-meta-500">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-black">
                  <span className="mr-1.5 font-mono text-[11px] text-ink-faint">0{index + 1}</span>
                  {title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{body}</p>
              </NeonCard>
            ))}
          </div>
        </section>

        {/* Pricing ------------------------------------------------------- */}
        <section id="pricing" className="mb-20 scroll-mt-24">
          <PricingSection plans={pricing.plans} currency={pricing.currency} ctaHref={startHref} />
        </section>

        {/* Closing CTA --------------------------------------------------- */}
        <section id="get-started" className="mb-4 scroll-mt-24">
          <NeonCard padding="lg" radius="xl">
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <h2 className="max-w-xl font-display text-4xl font-normal leading-[1.05] text-black sm:text-5xl">
                Your next winner is already made.{" "}
                <em className="italic text-meta-500">Make it new again.</em>
              </h2>
              <p className="max-w-md text-sm text-ink-muted">
                Create an account in a minute and camouflage your first creative. Your assets and
                outputs are visible only to you.
              </p>
              <Link href={startHref} className="btn-primary !px-6 !py-3 !text-base">
                <Rocket className="h-4 w-4" aria-hidden />
                Get started
              </Link>
            </div>
          </NeonCard>
        </section>

        <footer className="mt-12 border-t border-black/[0.07] pt-6">
          <div className="flex flex-col items-start justify-between gap-3 text-[11px] text-ink-faint sm:flex-row sm:items-center">
            <p>AdCamouflage · FastAPI · Celery · FFmpeg · OpenCV</p>
            <p>
              Use only on creatives you own or are licensed to distribute, and within the terms of
              the platforms you publish to.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
