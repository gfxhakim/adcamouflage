import {
  ArrowRight,
  AudioLines,
  Check,
  Fingerprint,
  ImagePlus,
  Layers3,
  Rocket,
  ScanLine,
  LockKeyhole,
  ShieldCheck,
  Tags,
} from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import LandingNav from "@/components/LandingNav";
import NeonCard from "@/components/NeonCard";
import PricingSection, { type PublicPlan } from "@/components/PricingSection";
import SiteHeader from "@/components/SiteHeader";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "adcam_session";

export const metadata: Metadata = {
  title: "AdCamouflage — One master, unlimited unique creatives",
  description:
    "Turn one master creative into unlimited distinct files. Re-cut, re-timed, re-graded and re-encoded, with every trace of your camera, editor and encoder stripped.",
};

const BENEFITS = [
  { icon: Fingerprint, text: "A different file hash on every copy, so duplicate detection misses" },
  { icon: Tags, text: "EXIF, camera, editor and encoder signatures fully erased" },
  { icon: AudioLines, text: "Audio pitch-shifted to desync speech-to-text bots" },
  { icon: ImagePlus, text: "Brand overlay on every frame, an intro, or exact frame ranges" },
];

const PROOF = [
  { label: "File hash", before: "6fa82c49ec91…", after: "358da85223…" },
  { label: "Resolution", before: "1280 × 720", after: "1274 × 708" },
  { label: "Frame rate", before: "30 fps", after: "23.976 fps" },
  { label: "Metadata tags", before: "camera, editor, title", after: "none" },
  { label: "Audio pitch", before: "0 cents", after: "+39.8 cents" },
];

const PIPELINE = [
  {
    icon: ScanLine,
    title: "Probe",
    body: "ffprobe reads the container, streams, frame rate and every tag the source carries.",
  },
  {
    icon: Layers3,
    title: "Mutate",
    body: "Micro-crop and resample, temporal noise, colour drift, staggered frame rate, pitch-shifted audio.",
  },
  {
    icon: Fingerprint,
    title: "Scrub",
    body: "EXIF, camera data, editor tags, the x264 SEI option dump and the MP4 compressorname all go.",
  },
  {
    icon: Rocket,
    title: "Ship",
    body: "Download each variant, or the whole batch as a zip with a mutation manifest.",
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
  const signedIn = Boolean(cookies().get(SESSION_COOKIE)?.value);
  const startHref = signedIn ? "/app" : "/signup";
  const pricing = await loadPlans();

  return (
    <>
      <SiteHeader signedIn={signedIn} nav={<LandingNav variant="header" />} />
      <LandingNav variant="dock" />

      <main className="mx-auto max-w-7xl overflow-x-clip px-4 pb-28 pt-8 sm:px-6 sm:pt-10 lg:px-8 lg:pb-20">
        {/* Hero -------------------------------------------------------------- */}
        <section id="home" className="relative mb-16 scroll-mt-24">
          <div
            className="pointer-events-none absolute -inset-x-10 -top-28 h-72 animate-float-slow rounded-full bg-meta-500/[0.07] blur-3xl"
            aria-hidden
          />
          <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
            <div>
              <span className="chip mb-5 !border-meta-500/30 !bg-meta-50 !text-meta-700">
                <ShieldCheck className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                Your files stay on your infrastructure
              </span>

              <h1 className="max-w-2xl text-[2.1rem] font-extrabold leading-[1.08] tracking-tight text-black sm:text-5xl lg:text-[3.4rem]">
                One master.
                <br />
                <span className="text-gradient">Unlimited unique creatives.</span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
                Drop in a video or image and get back copies that are{" "}
                <strong className="font-semibold text-black">byte-for-byte different files</strong> —
                re-cut, re-timed, re-graded, re-encoded, and stripped of every trace of your camera,
                editor and encoder. Identical to a viewer. Unrecognisable to a duplicate-detection
                system.
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
                  {signedIn ? "Open your workspace" : "Get started free"}
                </Link>
                {signedIn ? null : (
                  <Link href="/login" className="btn-ghost !px-5 !py-3">
                    I already have an account
                  </Link>
                )}
              </div>

              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Free to create an account
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Batch uploads
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                  Files auto-deleted on a retention timer
                </span>
              </p>
            </div>

            <NeonCard padding="lg" radius="xl" className="w-full lg:max-w-md lg:justify-self-end">
              <p className="label">What changes on every render</p>
              <dl className="mt-4 space-y-3.5">
                {PROOF.map(({ label, before, after }) => (
                  <div key={label}>
                    <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                    <dd className="mt-1 flex items-center gap-2 font-mono text-[13px]">
                      <span className="truncate text-ink-faint line-through decoration-red-400/70">
                        {before}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                      <span className="truncate font-semibold text-meta-700">{after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t border-black/10 pt-4 text-[11px] leading-relaxed text-ink-faint">
                Every job ships with a verifiable report — hashes before and after, which mutations
                were applied, and how many provenance tags remain.
              </p>
            </NeonCard>
          </div>
        </section>

        {/* Workspace + overlay ------------------------------------------- */}
        <section id="features" className="mb-16 grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <NeonCard padding="lg" radius="xl">
            <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-xl border border-black/10 bg-meta-50 text-meta-500">
              <LockKeyhole className="h-5 w-5" aria-hidden />
            </span>
            <p className="label">Your own workspace</p>
            <h2 className="mt-3 text-xl font-bold tracking-tight text-black">
              Every upload belongs to your account
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Sign in to a private workspace where you load assets, tune the camouflage, add an
              overlay and watch the render queue. Batches, outputs and download links are visible
              only to you, and everything is purged on a retention timer.
            </p>
            <Link href={startHref} className="btn-primary mt-5 !px-5">
              {signedIn ? "Open your workspace" : "Create your account"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </NeonCard>

          <NeonCard tone="slow" padding="lg" radius="xl">
            <p className="label">Put your brand on it</p>
            <h2 className="mt-3 text-xl font-bold tracking-tight text-black">
              Overlay an image, exactly where and when you want
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-ink-muted">
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">01</span>
                <span>
                  <strong className="font-semibold text-black">Every frame</strong> — a persistent
                  watermark across the whole clip.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">02</span>
                <span>
                  <strong className="font-semibold text-black">Intro only</strong> — show it for the
                  first few seconds, then let the creative breathe.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[11px] text-meta-500">03</span>
                <span>
                  <strong className="font-semibold text-black">Custom frame ranges</strong> — pick
                  exact frames; the engine converts them to timestamps so they stay accurate even
                  though the output frame rate changes.
                </span>
              </li>
            </ul>
            <p className="mt-5 border-t border-black/10 pt-4 text-[11px] leading-relaxed text-ink-faint">
              Nine anchor positions or absolute coordinates, width as a share of the frame, and
              adjustable opacity. Transparent PNGs keep their alpha.
            </p>
          </NeonCard>
        </section>

        {/* Pipeline ------------------------------------------------------ */}
        <section id="how-it-works" className="mb-16 scroll-mt-24">
          <h2 className="mb-5 text-sm font-semibold tracking-tight text-black">
            How a file moves through the engine
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(({ icon: Icon, title, body }, index) => (
              <NeonCard
                key={title}
                interactive
                padding="md"
                radius="lg"
                tone={index % 2 ? "slow" : "default"}
              >
                <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-lg border border-black/10 bg-meta-50 text-meta-500">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-black">
                  <span className="mr-1.5 font-mono text-[11px] text-ink-faint">0{index + 1}</span>
                  {title}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">{body}</p>
              </NeonCard>
            ))}
          </div>
        </section>

        {/* Pricing ------------------------------------------------------- */}
        <section id="pricing" className="mb-16 scroll-mt-24">
          <PricingSection plans={pricing.plans} currency={pricing.currency} ctaHref={startHref} />
        </section>

        {/* Closing CTA --------------------------------------------------- */}
        <section id="get-started" className="mb-4 scroll-mt-24">
          <NeonCard padding="lg" radius="xl">
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <h2 className="max-w-lg text-2xl font-bold tracking-tight text-black">
                Create an account and camouflage your first asset
              </h2>
              <p className="max-w-md text-sm text-ink-muted">
                It takes a minute. Your assets and outputs are visible only to your account.
              </p>
              <Link href={startHref} className="btn-primary !px-6 !py-3 !text-base">
                <Rocket className="h-4 w-4" aria-hidden />
                {signedIn ? "Open your workspace" : "Get started"}
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
