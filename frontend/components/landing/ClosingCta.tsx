"use client";

import { motion } from "framer-motion";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";

import { CmsIcon, CmsLink, CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { CmsHeadline, PillArrow, Reveal, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

function LocalClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">{now ?? "--:--:--"}</span>;
}

function QueueBar() {
  const [done, setDone] = useState(3);
  useEffect(() => {
    const id = window.setInterval(() => setDone((d) => (d >= 10 ? 0 : d + 1)), 700);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="mt-4 flex gap-1" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i < done ? "bg-meta-500" : "bg-white/10")} />
      ))}
    </div>
  );
}

export function ClosingCta({ startHref }: { startHref: string }) {
  return (
    <CmsSection k="cta" label="Closing call to action" id="get-started" className="relative isolate scroll-mt-24 overflow-hidden bg-black py-24 text-white sm:py-32">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        {[1, 2, 3, 4].map((ring) => (
          <motion.span
            key={ring}
            className="absolute left-[30%] top-1/2 rounded-full border border-meta-500/25"
            style={{ width: ring * 340, height: ring * 340, marginLeft: (ring * -340) / 2, marginTop: (ring * -340) / 2 }}
            animate={{ scale: [1, 1.04, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 6, delay: ring * 0.6, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        <span className="absolute left-[30%] top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-meta-500/30 blur-[120px]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:px-8">
        <div>
          <SectionTag k="cta.tag" index="07" dark>
            Final CTA
          </SectionTag>
          <CmsHeadline
            k="cta.headline"
            dark
            text="Stop Letting Algorithms Dictate Your Scale."
            className="mt-5 text-4xl sm:text-6xl lg:text-7xl"
          />
          <T k="cta.lede" long as="p" className="mt-6 max-w-xl text-sm leading-relaxed text-white/65">
            Protect your winning creatives, isolate your ad accounts from hash-linking, and get rejected campaigns back into profit in seconds.
          </T>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CmsLink
              k="cta.primary"
              href={startHref}
              label="Camouflage Your First Ad Now"
              className="group inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white transition hover:bg-meta-600"
            >
              {(label) => (
                <>
                  <CmsIcon k="cta.primary.icon" fallback={Rocket} className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                  <PillArrow dark />
                </>
              )}
            </CmsLink>
            <CmsLink
              k="cta.secondary"
              href="/login"
              label="Log in"
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10"
            />
          </div>
          <T k="cta.footnote" as="p" className="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/40">
            Setup takes less than 60 seconds • Cancel anytime
          </T>
        </div>

        <Reveal>
          <CmsSlot k="cta.card" label="Queue card">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" />
              <T k="cta.card.kicker">Your workspace · private</T>
            </p>
            <T k="cta.card.title" as="p" className="mt-3 text-3xl font-semibold tracking-tight">Render queue</T>
            <QueueBar />
            <T k="cta.card.caption" as="p" className="mt-2 font-mono text-[10px] uppercase tracking-wider text-white/40">
              One creative in · ten fresh copies out
            </T>
            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[11px] uppercase tracking-wider text-white/50">
              <T k="cta.card.clock">Your time</T>
              <span className="text-2xl font-semibold tracking-tight text-white">
                <LocalClock />
              </span>
            </div>
          </div>
          </CmsSlot>
        </Reveal>
      </div>
    </CmsSection>
  );
}

export default ClosingCta;
