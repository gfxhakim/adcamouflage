"use client";

import { motion } from "framer-motion";
import { Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";

import MatrixWords from "@/components/landing/MatrixWords";
import { EASE, Headline } from "@/components/landing/primitives";

// The hero background morphs between these, cell by cell.
const WORDS = ["CLOAK IT", "RUN IT"];

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
      </div>
    </section>
  );
}

export default Hero;
