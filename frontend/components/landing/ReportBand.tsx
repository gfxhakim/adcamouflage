"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { CmsSection, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { EASE, Reveal, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

type Stat = { label: string; value: string; note: string };

const TABS: Record<string, Stat[]> = {
  Overview: [
    { label: "Copies rendered", value: "10", note: "from 1 creative" },
    { label: "New file hashes", value: "10/10", note: "every copy unique" },
    { label: "Provenance tags left", value: "0", note: "camera, editor, encoder" },
    { label: "Mutation layers", value: "9", note: "random per copy" },
  ],
  Video: [
    { label: "Resolution", value: "1274×708", note: "was 1280 × 720" },
    { label: "Frame rate", value: "23.976", note: "was 30 fps" },
    { label: "Re-graded", value: "Yes", note: "own values per copy" },
    { label: "Re-encoded", value: "Yes", note: "own values per copy" },
  ],
  Audio: [
    { label: "Pitch shift", value: "+39.8¢", note: "was 0 cents" },
    { label: "Shift range", value: "15–65¢", note: "up or down" },
    { label: "Voice matching", value: "New", note: "hears a new track" },
    { label: "Per copy", value: "Random", note: "own value each time" },
  ],
  Metadata: [
    { label: "Camera tags", value: "0", note: "removed" },
    { label: "Editor tags", value: "0", note: "removed" },
    { label: "Project names", value: "0", note: "removed" },
    { label: "Encoder tags", value: "0", note: "removed" },
  ],
};

const TICKER = [
  "copy #041 · new hash 9d02e1…",
  "copy #042 · metadata: none",
  "copy #043 · 25 fps",
  "copy #044 · audio −22.4 cents",
  "copy #045 · 1276 × 712",
  "batch ready · 10 files zipped",
];

function Spark({ seed }: { seed: number }) {
  const pts = Array.from({ length: 12 }, (_, i) => {
    const y = 34 - (i / 11) * 22 - Math.sin(i * 1.3 + seed) * 4;
    return `${(i / 11) * 120},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox="0 0 120 40" className="mt-4 h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,40 ${pts.join(" ")} 120,40`} fill="rgb(var(--meta-500-rgb, 8 102 255) / 0.2)" stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke="rgb(var(--meta-400-rgb, 51 133 255))" strokeWidth="1.5" />
    </svg>
  );
}

export function ReportBand() {
  const cms = useCms();
  const tabs = cms.list("report.tabs", Object.keys(TABS), "Report tabs", Object.keys(TABS));
  const [tab, setTab] = useState<string>("Overview");
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const stats = current ? cms.list(`${current.key}.stats`, TABS[current.item] ?? [], `${current.item} stats`) : [];
  const ticker = cms.list("report.ticker", TICKER, "Ticker lines", TICKER);

  return (
    <CmsSection k="report" label="Report band" id="report" className="scroll-mt-24 overflow-hidden bg-meta-500 py-20 text-white sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
          <div>
            <SectionTag k="report.tag" index="04" className="!bg-black/20 !text-white">
              INFRASTRUCTURE CAPABILITIES
            </SectionTag>
            <T k="report.headline" as="h2" className="mt-5 text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              Engineered for Media Buyers Who Live on Scale and Contingency.
            </T>
          </div>
          <T k="report.lede" long as="p" className="text-sm leading-relaxed text-white/80">
            Every tool required to keep your creatives live, isolated, and undetectable across ad networks.
          </T>
        </div>

        <Reveal className="mt-10">
          <div className="rounded-3xl bg-black p-5 shadow-2xl sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/70">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" />
                <T k="report.card.title">Render report · example batch</T>
                <T k="report.card.badge" className="rounded bg-meta-500 px-1.5 py-0.5 text-[9px] text-white">Sample</T>
              </span>
              <div className="flex max-w-full overflow-x-auto rounded-full bg-white/[0.08] p-1 [scrollbar-width:none]">
                {tabs.map(({ id, item: name, key }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "relative rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                      current?.id === id ? "text-white" : "text-white/50 hover:text-white/80",
                    )}
                  >
                    {current?.id === id ? (
                      <motion.span layoutId="report-tab" className="absolute inset-0 rounded-full bg-meta-500" transition={{ duration: 0.4, ease: EASE }} />
                    ) : null}
                    <T k={`${key}.label`} className="relative whitespace-nowrap">{name}</T>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {stats.map(({ item: stat, key, id }, i) => (
                  <motion.div
                    key={`${current?.id}-${id}`}
                    className="bg-black p-5"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, delay: i * 0.05, ease: EASE }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">
                      0{i + 1} · <T k={`${key}.label`}>{stat.label}</T>
                    </p>
                    <T k={`${key}.value`} as="p" className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{stat.value}</T>
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-meta-500/20 px-2 py-0.5 font-mono text-[10px] text-meta-300">
                      <span className="h-1 w-1 rounded-full bg-meta-400" />
                      <T k={`${key}.note`}>{stat.note}</T>
                    </span>
                    <Spark seed={i + (current?.item.length ?? 0)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>

      <div className="mt-8 flex overflow-hidden border-y border-white/20 py-3" aria-hidden>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 animate-marquee gap-10 pr-10">
            {ticker.map(({ item: t, key, id }) => (
              <span key={id} className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-white/85">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                <T k={`${key}.text`}>{t}</T>
              </span>
            ))}
          </div>
        ))}
      </div>
    </CmsSection>
  );
}

export default ReportBand;
