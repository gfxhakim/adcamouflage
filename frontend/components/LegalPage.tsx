import Link from "next/link";
import type { ReactNode } from "react";

import SiteHeader from "@/components/SiteHeader";

/** Plain, readable layout for the privacy policy and terms. */
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader minimal />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-neutral-500">Last updated {updated}</p>
        <div className="legal mt-10 space-y-6 text-[15px] leading-relaxed text-neutral-700 [&_a]:text-meta-600 [&_a]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-neutral-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
          {children}
        </div>
        <p className="mt-16 text-sm">
          <Link href="/" className="text-meta-600 underline">
            Back to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
