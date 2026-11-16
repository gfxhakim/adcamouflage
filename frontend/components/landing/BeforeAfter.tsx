"use client";

import { CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";

const PROOF_BULLETS = [
  "Preserves crisp typography, product details, and natural skin tones across every rendered variation.",
  "Applies studio-grade EQ, subtle spatial ambiance, and vocal clarity mastering so voiceovers sound clear on every device.",
  "Generates up to 10 independent variations in a single upload for rapid creative testing and multi-campaign workflows.",
];

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.bullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Creative studio & media showcase" id="proof" className="scroll-mt-24 bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <CmsHeadline k="proof.headline" text="Built for Creative Teams. | [Engineered for Quality.]" className="text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.lede" long as="p" className="text-sm leading-relaxed text-black/65">
            Manual re-editing takes hours per variation. BluEditor combines color science, subtle framing polish, and audio mastering into a single cloud workflow.
          </T>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.kicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">studio quality</T>
            <T k="proof.subhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Visual grading, framing refinement, and audio mastering built in.
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
