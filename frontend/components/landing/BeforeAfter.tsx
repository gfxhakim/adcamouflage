"use client";

import { CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";

const PROOF_BULLETS = [
  "Rebuild aggressive, limited, or policy-flagged Meta, TikTok, and YouTube video ads layer by layer — fresh visual composition, Rec.709 color profile, −14 LUFS broadcast audio, and clean container metadata.",
  "Keep your winning hook, fast direct-response cuts, burned-in captions, and brand overlays razor-sharp so platforms approve the creative and it converts higher.",
  "Launch up to 5 fresh variations per batch in the cloud, recover stuck ad accounts fast, and download clean exports ready to scale.",
];

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.studioBullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Creative studio & media showcase" id="proof" className="scroll-mt-24 bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <CmsHeadline k="proof.studioHeadline" text="Why Winning Ads Get Rejected. | [How ProteusFlow Fixes Them.]" className="text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.studioLede" long as="p" className="text-sm leading-relaxed text-black/65">
            Ad platforms flag aggressive winners across visual frames, motion, audio signatures, and container metadata. ProteusFlow uses multi-layer AI creative rebuilding so rejected ads pass review, regain delivery, and print higher ROAS.
          </T>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.studioKicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">ai rejected-ad engine</T>
            <T k="proof.studioSubhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              AI layer reconstruction engineered for aggressive Meta, TikTok &amp; YouTube video ads.
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
