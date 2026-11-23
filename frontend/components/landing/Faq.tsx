"use client";

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";

import { CmsIcon, CmsLink, CmsSection, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, EASE, PillArrow } from "@/components/landing/primitives";
import { FAQS } from "@/components/landing/faqData";
import { cn } from "@/lib/utils";


export function Faq() {
  const cms = useCms();
  const faqs = cms.list("faq.studioItems", FAQS, "Questions", FAQS.map((f) => f.q));
  const [open, setOpen] = useState(0);

  return (
    <CmsSection k="faq" label="FAQ" id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <CmsHeadline k="faq.studioHeadline" text="Frequently Asked Questions." className="text-4xl sm:text-5xl lg:text-6xl" />

          <CmsSection k="faq.card" label="Help card" as="div" className="mt-10 max-w-sm rounded-3xl bg-black p-6 text-white">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-meta-400" />
              <T k="faq.card.studioKicker">Ready to try it?</T>
            </p>
            <T k="faq.card.studioTitle" as="p" className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              Fix your next rejected ad batch in minutes.
            </T>
            <T k="faq.card.studioBody" long as="p" className="mt-2 text-sm text-white/60">
              Create your account, activate a plan, drop in your flagged or aggressive video ads, and download clean scaling variations.
            </T>
            <CmsLink
              k="faq.card.cta"
              href="/signup"
              label="Open ProteusFlow Studio"
              className="group mt-5 inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white"
            >
              {(label) => (
                <>
                  {label}
                  <PillArrow dark />
                </>
              )}
            </CmsLink>
          </CmsSection>
        </div>

        <ul className="relative border-l border-black/10">
          {faqs.map(({ item, key, id }, i) => {
            const on = open === i;
            return (
              <li key={id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[5px] top-7 h-2.5 w-2.5 rounded-full border-2 transition-colors",
                    on ? "border-meta-500 bg-meta-500" : "border-black/20 bg-white",
                  )}
                  aria-hidden
                />
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl py-5 pl-5 pr-2 text-left transition-colors sm:gap-4 sm:pl-6 sm:pr-3",
                    on ? "bg-[#F4F5F7]" : "hover:bg-[#F4F5F7]/60",
                  )}
                  onClick={() => setOpen(on ? -1 : i)}
                  aria-expanded={on}
                  aria-controls={`faq-answer-${id}`}
                >
                  <span className="font-mono text-[11px] text-ink-faint">0{i + 1}</span>
                  <T k={`${key}.q`} className="min-w-0 flex-1 text-base font-semibold tracking-tight text-black sm:text-lg">{item.q}</T>
                  <T k={`${key}.tag`} className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-faint sm:inline">
                    {item.tag}
                  </T>
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300",
                      on ? "rotate-45 border-meta-500 bg-meta-500 text-white" : "border-black/15 text-black",
                    )}
                  >
                    <CmsIcon k="faq.toggle.icon" fallback={Plus} className="h-4 w-4" aria-hidden />
                  </span>
                </button>
                {/* Always in the page (collapsed when closed) so search engines and
                    screen-reader "find" see every answer, not only the open one. */}
                <motion.div
                  id={`faq-answer-${id}`}
                  className="overflow-hidden"
                  initial={false}
                  animate={on ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  aria-hidden={!on}
                >
                  <T k={`${key}.a`} long as="p" className="max-w-2xl pb-6 pl-12 pr-4 text-sm leading-relaxed text-ink-muted sm:pl-14 sm:pr-6">{item.a}</T>
                </motion.div>
              </li>
            );
          })}
        </ul>
      </div>
    </CmsSection>
  );
}

export default Faq;
