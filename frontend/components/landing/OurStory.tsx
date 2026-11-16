"use client";

import { CmsSection, T } from "@/components/cms/Cms";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import { SITE_SLOGAN } from "@/lib/site";

/** The brand story: where the ProteusFlow name comes from and what we believe. */
export function OurStory() {
  return (
    <CmsSection k="story" label="Our story" id="our-story" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div>
          <T k="story.kicker" as="p" className="text-xs font-semibold uppercase tracking-[0.2em] text-meta-500">
            Our story
          </T>
          <CmsHeadline k="story.headline" text={SITE_SLOGAN} className="mt-4 text-4xl sm:text-5xl lg:text-6xl" />
        </div>
        <Reveal className="space-y-6 text-lg leading-relaxed text-ink-subtle sm:text-xl">
          <T k="story.body1" long as="p">
            In Greek mythology, Proteus represented the ultimate power to shift and adapt to any environment. At ProteusFlow, we bring that legendary agility into modern technology.
          </T>
          <T k="story.body2" long as="p" className="text-black">
            We believe software should adapt to your business, not the other way around. Our mission is to engineer intelligent solutions that evolve at your pace—combining seamless adaptation, true flexibility, and peak efficiency.
          </T>
        </Reveal>
      </div>
    </CmsSection>
  );
}

export default OurStory;
