"use client";

import { CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";

const PROOF_BULLETS = [
  "Format and export videos and images for 9:16 Reels, TikTok, YouTube Shorts, 4:5 Portrait, and 1:1 Square feeds while keeping captions razor-sharp.",
  "Burn in transparent PNG brand logos, adjust placement and fade timing on a live preview, and select custom frame-0 cover thumbnails.",
  "Apply studio Rec.709 color grading and −14 LUFS broadcast audio normalization across up to 20 files at once, then download everything as a single ZIP.",
];

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.studioBullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Creative studio & media showcase" id="proof" className="scroll-mt-24 bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <CmsHeadline k="proof.studioHeadline" text="Everything Your Video Workflow Needs. | [In One Cloud Studio.]" className="text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.studioLede" long as="p" className="text-sm leading-relaxed text-black/65">
            Stop repeating the same manual exports in your timeline editor. ProteusFlow combines social format presets, color grading, audio leveling, and brand watermarking into a single batch workflow.
          </T>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.studioKicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">studio workflow</T>
            <T k="proof.studioSubhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Social formatting, brand watermarks, color grading, and audio leveling built in.
            </T>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-black/75">
              {bullets.map(({ item, key, id }) => (
                <li key={id}>
                  • <T k={`${key}.text`}>{item}</T>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <CmsSlot k="proof.report" label="Report card">
              <RenderProof dark />
            </CmsSlot>
          </Reveal>
        </div>
      </div>
    </CmsSection>
  );
}

export default BeforeAfter;
