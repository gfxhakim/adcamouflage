import {
  ArrowRight,
  AudioLines,
  Check,
  Fingerprint,
  ImagePlus,
  Layers3,
  Rocket,
  ScanLine,
  ShieldCheck,
  ShieldHalf,
  Tags,
} from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import AuthPanel from "@/components/AuthPanel";
import NeonCard from "@/components/NeonCard";

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

export default function LandingPage() {
  return (
    <>
      <header className="border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-meta-500/30 bg-meta-50">
              <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-black">
                Ad<span className="text-gradient">Camouflage</span>
              </p>
              <p className="hidden text-[11px] text-ink-faint sm:block">
                Media mutation &amp; fingerprint stripping
              </p>
            </div>
          </div>
          <a href="#signin" className="btn-primary !px-4 !py-2 !text-sm">
            Sign in
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        {/* Hero + sign-in ------------------------------------------------ */}
        <section className="relative mb-16">
          <div
            className="pointer-events-none absolute -inset-x-10 -top-28 h-72 animate-float-slow rounded-full bg-meta-500/[0.07] blur-3xl"
            aria-hidden
          />
          <div className="relative grid items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div>
              <span className="chip mb-5 !border-meta-500/30 !bg-meta-50 !text-meta-700">
                <ShieldCheck className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                Your files stay on your infrastructure
              </span>

              <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-black sm:text-5xl lg:text-[3.4rem]">
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

              <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
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

            <div className="flex justify-center lg:justify-end">
              <Suspense
                fallback={
                  <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
                    <div className="h-[420px] animate-pulse rounded-lg bg-black/[0.03]" />
                  </NeonCard>
                }
              >
                <AuthPanel />
              </Suspense>
            </div>
          </div>
        </section>

        {/* Proof --------------------------------------------------------- */}
        <section className="mb-16 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <NeonCard padding="lg" radius="xl">
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
        <section className="mb-16">
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

        {/* Closing CTA --------------------------------------------------- */}
        <section className="mb-4">
          <NeonCard padding="lg" radius="xl">
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <h2 className="max-w-lg text-2xl font-bold tracking-tight text-black">
                Create an account and camouflage your first asset
              </h2>
              <p className="max-w-md text-sm text-ink-muted">
                It takes a minute. Your assets and outputs are visible only to your account.
              </p>
              <a href="#signin" className="btn-primary !px-6 !py-3 !text-base">
                <Rocket className="h-4 w-4" aria-hidden />
                Get started
              </a>
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
