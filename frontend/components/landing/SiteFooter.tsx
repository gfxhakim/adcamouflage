"use client";

import Link from "next/link";
import { useRef } from "react";

import BrandLogo from "@/components/BrandLogo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Create account", href: "/signup" },
    ],
  },
];

/** The giant wordmark lights up blue around the pointer ("move over the name"). */
function Wordmark() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="group relative select-none overflow-hidden"
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        ref.current?.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        ref.current?.style.setProperty("--my", `${e.clientY - rect.top}px`);
      }}
      aria-hidden
    >
      <p className="whitespace-nowrap text-center text-[12vw] font-semibold leading-[0.85] tracking-[-0.06em] text-white/[0.07] lg:text-[11vw] 2xl:text-[10rem]">
        AdCamouflage
      </p>
      <p
        className="pointer-events-none absolute inset-0 whitespace-nowrap text-center text-[12vw] font-semibold leading-[0.85] tracking-[-0.06em] text-meta-500 opacity-0 transition-opacity duration-300 group-hover:opacity-100 lg:text-[11vw] 2xl:text-[10rem]"
        style={{
          WebkitMaskImage: "radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), black, transparent 70%)",
          maskImage: "radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), black, transparent 70%)",
        }}
      >
        AdCamouflage
      </p>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-black pb-28 pt-16 text-white lg:pb-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Link href="/" className="inline-flex" aria-label="BluCloacking home">
              <BrandLogo onDark />
            </Link>
            <p className="mt-4 max-w-xs text-sm text-white/55">
              Turn one winning creative into fresh, unique files.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex rounded-full bg-meta-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-meta-600"
            >
              Get started
            </Link>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">{col.title}</p>
              <ul className="mt-4 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-white/75 transition hover:text-meta-300">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-14 text-right font-mono text-[10px] uppercase tracking-wider text-white/30">Move over the name</p>
        <div className="mt-2 border-t border-white/10 pt-6">
          <Wordmark />
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-6 font-mono text-[10px] uppercase tracking-wider text-white/35 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} AdCamouflage</p>
          <p className="normal-case tracking-normal">
            Use only on creatives you own or are licensed to distribute, and within the terms of the
            platforms you publish to.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
