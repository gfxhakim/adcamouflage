"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";

import BrandLogo from "@/components/BrandLogo";
import { EASE } from "@/components/landing/primitives";

const NAME = "BluCloacking";

const COLUMNS = [
  {
    title: "Main pages",
    links: [
      { label: "Home", href: "#home" },
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Account & help",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Create account", href: "/signup" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

/**
 * The giant name across the top of the footer, filled with a moving
 * Meta-blue gradient. A brighter glint follows the pointer over it.
 */
function Wordmark() {
  const ref = useRef<HTMLDivElement>(null);
  const size = "text-[15.5vw] lg:text-[14.2vw] 2xl:text-[13rem]";
  return (
    <motion.div
      ref={ref}
      className="group relative select-none"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 1, ease: EASE }}
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        ref.current?.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        ref.current?.style.setProperty("--my", `${e.clientY - rect.top}px`);
      }}
      aria-hidden
    >
      <p
        className={`animate-shine whitespace-nowrap bg-clip-text text-center font-semibold leading-[0.9] tracking-[-0.065em] text-transparent ${size}`}
        style={{
          backgroundImage:
            "linear-gradient(100deg, #001433 0%, #003d99 18%, #0866ff 34%, #66a3ff 46%, #e7f0ff 50%, #66a3ff 54%, #0866ff 66%, #003d99 82%, #001433 100%)",
          backgroundSize: "250% 100%",
        }}
      >
        {NAME}
      </p>
      <p
        className={`pointer-events-none absolute inset-0 whitespace-nowrap text-center font-semibold leading-[0.9] tracking-[-0.065em] text-white opacity-0 transition-opacity duration-300 group-hover:opacity-90 ${size}`}
        style={{
          WebkitMaskImage: "radial-gradient(180px circle at var(--mx, 50%) var(--my, 50%), black, transparent 70%)",
          maskImage: "radial-gradient(180px circle at var(--mx, 50%) var(--my, 50%), black, transparent 70%)",
        }}
      >
        {NAME}
      </p>
    </motion.div>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-black pb-28 text-white lg:pb-10">
      {/* Blue glow rising from the bottom edge */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -bottom-1/3 left-1/2 h-[70%] w-[120%] -translate-x-1/2 rounded-[50%] bg-meta-500/35 blur-[120px]" />
        <div className="absolute -bottom-1/2 left-1/2 h-[60%] w-[60%] -translate-x-1/2 animate-pulse-glow rounded-[50%] bg-[#00c6ff]/20 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <Wordmark />

        <div className="mt-12 h-px w-full bg-gradient-to-r from-transparent via-meta-500/70 to-transparent" />

        <div className="mt-12 grid grid-cols-2 gap-10 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-flex" aria-label="BluCloacking home">
              <BrandLogo onDark />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
              Turn one winning creative into fresh, unique files.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center rounded-full bg-gradient-to-r from-meta-600 via-meta-500 to-meta-400 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(8,102,255,0.9)] transition hover:brightness-110"
            >
              Get started
            </Link>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-semibold text-white">{col.title}</p>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-white/60 transition hover:text-meta-300">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {NAME}. All rights reserved.</p>
          <p className="max-w-xl sm:text-right">
            Use only on creatives you own or are licensed to distribute, and within the terms of the
            platforms you publish to.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
