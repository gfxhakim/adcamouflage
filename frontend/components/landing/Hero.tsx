"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import MatrixWords from "@/components/landing/MatrixWords";
import { EASE, Headline } from "@/components/landing/primitives";

const CHIPS = ["Meta", "TikTok", "YouTube", "Hash"];
const METRICS = [
  { value: "50,000+", label: "Assets Mutated & Deployed" },
  { value: "4.8x Faster", label: "Ad Approval & Recovery Speed" },
  { value: "Zero-Log", label: "Auto-Wiped Cloud Pipeline" },
  { value: "Multi-Format", label: "Video, Image & Audio Shielding" },
];

// The hero background morphs between these, cell by cell.
const WORDS = ["CLOAK IT", "RUN IT"];

function LiveCounter() {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setN((v) => v + 1 + Math.floor(Math.random() * 9)), 140);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <div className="w-full max-w-[620px] rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_0_40px_rgba(8,102,255,0.18)] backdrop-blur-sm">
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-white/65">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" aria-hidden />
        ENGINE ONLINE • ZERO-TRACE ARCHITECTURE
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">rendered copies</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
            {n.toLocaleString("en-US")}
          </p>
        </div>
        <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">
          100% UNDETECTABLE
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-white/60">
        <span>creative_v1_rejected.mp4</span>
        <ArrowRight className="h-3.5 w-3.5 text-meta-300" aria-hidden />
        <span className="text-meta-300">creative_v1_clean_hash98a.mp4</span>
      </div>
    </div>
  );
}

export function Hero({ startHref }: { startHref: string }) {
  return (
    <section
      id="home"
      className="relative isolate flex min-h-[max(100svh,820px)] scroll-mt-24 flex-col overflow-hidden bg-black text-white"
    >
      <MatrixWords
        words={WORDS}
        centerY={0.22}
        maxHeight={0.24}
        className="absolute inset-0 h-full w-full"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black via-black/80 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-end px-4 pb-10 pt-[34svh] text-center sm:px-6 lg:pt-[39vh]">
        <motion.span
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <ShieldCheck className="h-3.5 w-3.5 text-meta-400" aria-hidden />
          ENGINE ONLINE • ZERO-TRACE ARCHITECTURE
        </motion.span>

        <Headline
          as="h1"
          dark
          text="Algorithms Flag Patterns. | [We Erase Them.]"
          className="text-[2.7rem] sm:text-6xl lg:text-[5.4rem]"
        />

        <motion.p
          className="mt-6 max-w-3xl text-sm leading-relaxed text-white/75 sm:text-base"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          AdCamouflage reconstructs the digital DNA of your videos and static creatives in seconds.
          Bypass automated AI vision, audio transcription, and hash-matching filters across Meta,
          TikTok, and YouTube without touching a timeline editor.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.65, ease: EASE }}
        >
          <Link
            href={startHref}
            className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-black transition hover:bg-meta-50"
          >
            Camouflage My Creatives Now
            <span className="grid h-8 w-8 place-items-center rounded-full bg-meta-500 text-white transition-transform group-hover:rotate-[-45deg]">
              <Rocket className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </motion.div>

        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">
          Instant Web App Access • Batch Processing Ready • Zero Visual Quality Loss
        </p>

        <div className="mt-10 grid w-full max-w-6xl gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left backdrop-blur-sm">
              <p className="text-2xl font-semibold tracking-tight text-white">{item.value}</p>
              <p className="mt-2 text-sm text-white/65">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-8 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
        <LiveCounter />
        <ul className="flex flex-wrap gap-2">
          {CHIPS.map((chip, i) => (
            <li
              key={chip}
              className="rounded-full border border-white/15 bg-black/40 px-3 py-1 font-mono text-[11px] text-white/80 backdrop-blur"
            >
              <span className="mr-1.5 text-meta-400">0{i + 1}</span>
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default Hero;
