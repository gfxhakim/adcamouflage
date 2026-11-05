"use client";

import { ImagePlus } from "lucide-react";

import { CmsSection, CmsSlot, MediaView, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";
import type { MediaValue } from "@/lib/siteContent";

const PROOF_BULLETS = [
  "Disrupts automated OCR and computer-vision scanners from reading on-screen hooks and aggressive visual elements without blurring the creative.",
  "Micro-modulates background frequencies and vocal harmonics to throw off speech-to-text bots while keeping voiceovers crystal clear.",
  "Generates multiple unique variants in one upload for multi-account scale.",
];

const DEFAULT_SHOWCASE: MediaValue = {
  src: "",
  kind: "image",
  fit: "contain",
  align: "center",
  scale: 100,
  radius: 24,
  frame: "none",
  shadow: "xl",
};

/**
 * Customizable image or video showcase controlled from Admin > Landing.
 * Automatically inherits any image previously uploaded to `proof.after.image`
 * or `proof.before.image` so existing uploads appear cleanly without overlays.
 */
function ShowcaseMedia() {
  const cms = useCms();
  const legacy = cms.content.media?.["proof.after.image"]?.src
    ? cms.content.media["proof.after.image"]
    : cms.content.media?.["proof.before.image"]?.src
      ? cms.content.media["proof.before.image"]
      : undefined;

  const fallback: MediaValue = {
    ...DEFAULT_SHOWCASE,
    ...(legacy ? { src: legacy.src, kind: legacy.kind, alt: legacy.alt } : {}),
  };

  const media = cms.media("proof.media", fallback, "Showcase media (image or video)");

  if (cms.hidden("proof.media")) return null;

  if (media.src) {
    return (
      <div className="w-full" {...cms.mark("proof.media")}>
        <MediaView
          value={{
            fit: "contain",
            align: "center",
            radius: 24,
            scale: 100,
            ...media,
          }}
          className="h-auto w-full max-w-full"
          mark={cms.mark("proof.media")}
        />
      </div>
    );
  }

  if (!cms.preview) return null;

  return (
    <div
      {...cms.mark("proof.media")}
      className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/25 bg-white/[0.03] px-6 py-14 text-center text-white/70 transition hover:border-meta-400/60 hover:bg-white/[0.05]"
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-meta-500/20 text-meta-400">
        <ImagePlus className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-white">Add a Showcase Image or Video</p>
      <p className="max-w-md text-xs leading-relaxed text-white/55">
        Click here (with &ldquo;Click to edit&rdquo; enabled) or open <b>Content &gt; Deep evasion &amp; media showcase &gt; Showcase media</b> in the Admin Panel to upload an image or video and customize its size, aspect ratio, fit, frame, and playback.
      </p>
    </div>
  );
}

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.bullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Deep evasion & media showcase" id="proof" className="scroll-mt-24 bg-black py-20 text-white sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <CmsHeadline k="proof.headline" dark text="Built for the Buyer. | [Invisible to the Bot.]" className="text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.lede" long as="p" className="text-sm leading-relaxed text-white/65">
            Basic metadata cleaners stopped working years ago. Modern ad networks scan pixel structures and transcribe audio tracks in real time. AdCamouflage neutralizes both.
          </T>
        </div>

        <Reveal className="mt-10">
          <ShowcaseMedia />
        </Reveal>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.kicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">platform protection</T>
            <T k="proof.subhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Optical pattern breaking and audio transcription shielding built in.
            </T>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-white/75">
              {bullets.map(({ item, key, id }) => (
                <li key={id}>
                  • <T k={`${key}.text`}>{item}</T>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <CmsSlot k="proof.report" label="Report card">
              <RenderProof />
            </CmsSlot>
          </Reveal>
        </div>
      </div>
    </CmsSection>
  );
}

export default BeforeAfter;
