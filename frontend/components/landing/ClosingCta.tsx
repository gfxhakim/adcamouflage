"use client";

import { motion } from "framer-motion";
import { Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Headline, PillArrow, Reveal, SectionTag } from "@/components/landing/primitives";
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
    <section id="get-started" className="relative isolate scroll-mt-24 overflow-hidden bg-black py-24 text-white sm:py-32">
      {/* Concentric rings and a slow blue glow */}
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
          <SectionTag index="08" dark>
            Get started
          </SectionTag>
          <Headline
            dark
            text="Your next winner is already made. | [Make it new again.]"
            className="mt-5 text-4xl sm:text-6xl lg:text-7xl"
          />
          <p className="mt-6 max-w-md text-sm leading-relaxed text-white/65">
            Create an account in a minute and camouflage your first creative. Your assets and
            outputs are visible only to you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={startHref}
              className="group inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white transition hover:bg-meta-600"
            >
              <Rocket className="h-4 w-4" aria-hidden />
              Get started
              <PillArrow dark />
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/40">
            Free account to start · batch uploads · files auto-deleted after your retention window
          </p>
        </div>

        <Reveal>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" />
              Your workspace · private
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">Render queue</p>
            <QueueBar />
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-white/40">
              One creative in · ten fresh copies out
            </p>
            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[11px] uppercase tracking-wider text-white/50">
              <span>Your time</span>
              <span className="text-2xl font-semibold tracking-tight text-white">
                <LocalClock />
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default ClosingCta;
