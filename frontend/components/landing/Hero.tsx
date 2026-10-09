"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import MatrixWords from "@/components/landing/MatrixWords";
import { EASE, Headline } from "@/components/landing/primitives";

const CHIPS = ["Hash", "Pixels", "Timing", "Metadata"];

// The hero background morphs between these, cell by cell.
const WORDS = ["CLOAK IT", "RUN IT"];

/** Counts the hashes "re-rolled" since the visitor opened the page. */
function LiveCounter() {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setN((v) => v + 1 + Math.floor(Math.random() * 9)), 140);
    return () => window.clearInterval(id);
  }, [reduce]);
  return (
    <div>
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" aria-hidden />
        Preview · hashes re-rolled since you opened this page
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
        {n.toLocaleString("en-US")}
      </p>
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
      {/* Keeps the copy readable where it sits over the grid. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black via-black/80 to-transparent"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-end px-4 pb-12 pt-[40svh] text-center sm:px-6 lg:pt-[44vh]">
        <motion.span
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <ShieldCheck className="h-3.5 w-3.5 text-meta-400" aria-hidden />
          Built for media buyers who run at volume
        </motion.span>

        <Headline
          as="h1"
          dark
          text="One winning ad. | [Endless fresh copies.]"
          className="text-[2.7rem] sm:text-6xl lg:text-[5.4rem]"
        />

        <motion.p
          className="mt-6 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          Ad platforms fingerprint every file you upload. Reuse a creative across ad sets or
          accounts and it gets matched, flagged as a duplicate and throttled. AdCamouflage
          re-renders your video or image into copies that{" "}
          <strong className="font-semibold text-white">look identical to people</strong> but carry
          a new hash, new pixels, new timing and zero metadata, so every upload starts clean.
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
            Start camouflaging free
            <span className="grid h-8 w-8 place-items-center rounded-full bg-meta-500 text-white transition-transform group-hover:rotate-[-45deg]">
              <Rocket className="h-4 w-4" aria-hidden />
            </span>
          </Link>
          <Link
            href="/login"
            className="group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/[0.06] py-1.5 pl-5 pr-1.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/[0.12]"
          >
            I already have an account
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-transform group-hover:translate-x-0.5">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </motion.div>
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
        <p className="font-mono text-[11px] leading-relaxed text-white/60 md:text-right">
          Nine mutation layers
          <br />
          batch in, one zip out
        </p>
      </div>
    </section>
  );
}

export default Hero;
