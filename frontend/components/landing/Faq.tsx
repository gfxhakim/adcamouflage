"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EASE, Headline, PillArrow, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "What exactly changes in each copy?",
    a: "Each copy gets a new file hash and pixel signature, is micro-cropped and resampled, re-timed to a new frame rate, re-graded, re-encoded, has its audio re-pitched, and has camera, editor and encoder metadata wiped clean.",
    tag: "Engine",
  },
  {
    q: "Will my viewers notice a difference?",
    a: "No. The copies look identical to people. The changes are in the file itself, which is what platforms compare.",
    tag: "Engine",
  },
  {
    q: "Which files can I upload?",
    a: "Videos and images. MP4, MOV, JPG and PNG all work, and you can upload a whole batch at once and download it back as one zip.",
    tag: "Files",
  },
  {
    q: "Does it guarantee my ads get approved?",
    a: "No. AdCamouflage changes your files, not the rules. Ad review still applies, so use it only on creatives you own or are licensed to distribute, and within the terms of the platforms you publish to.",
    tag: "Policy",
  },
  {
    q: "How are files counted on my plan?",
    a: "Every uploaded file and every extra variant counts as one file. Usage resets on the 1st of each month, and every plan has every feature.",
    tag: "Pricing",
  },
  {
    q: "Who can see my uploads?",
    a: "Only you. Batches, outputs and download links live in your private workspace, and everything is deleted automatically when your retention window ends.",
    tag: "Privacy",
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionTag index="07">FAQ</SectionTag>
          <Headline text="Questions, | [answered.]" className="mt-5 text-4xl sm:text-5xl lg:text-6xl" />

          <div className="mt-10 max-w-sm rounded-3xl bg-black p-6 text-white">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-meta-400" />
              Still unsure?
            </p>
            <p className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              Camouflage your first creative for free.
            </p>
            <p className="mt-2 text-sm text-white/60">
              Create an account in a minute. Your assets and outputs are visible only to you.
            </p>
            <Link
              href="/login"
              className="group mt-5 inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white"
            >
              Get started
              <PillArrow dark />
            </Link>
          </div>
        </div>

        <ul className="relative border-l border-black/10">
          {FAQS.map((item, i) => {
            const on = open === i;
            return (
              <li key={item.q} className="relative">
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
                    "flex w-full items-center gap-4 rounded-2xl py-5 pl-6 pr-3 text-left transition-colors",
                    on ? "bg-[#F4F5F7]" : "hover:bg-[#F4F5F7]/60",
                  )}
                  onClick={() => setOpen(on ? -1 : i)}
                  aria-expanded={on}
                >
                  <span className="font-mono text-[11px] text-ink-faint">0{i + 1}</span>
                  <span className="flex-1 text-base font-semibold tracking-tight text-black sm:text-lg">{item.q}</span>
                  <span className="hidden font-mono text-[10px] uppercase tracking-wider text-ink-faint sm:inline">
                    {item.tag}
                  </span>
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300",
                      on ? "rotate-45 border-meta-500 bg-meta-500 text-white" : "border-black/15 text-black",
                    )}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.div
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      <p className="max-w-2xl pb-6 pl-14 pr-6 text-sm leading-relaxed text-ink-muted">{item.a}</p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default Faq;
