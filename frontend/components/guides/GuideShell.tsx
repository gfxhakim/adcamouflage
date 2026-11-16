import Link from "next/link";
import type { ReactNode } from "react";

import SiteHeader from "@/components/SiteHeader";
import { SITE_NAME } from "@/lib/site";

/** Typography for guide bodies (rendered by components/guides/Markdown). */
export const GUIDE_BODY_CLASS =
  "space-y-5 text-[16px] leading-[1.75] text-neutral-700 " +
  "[&_a]:text-meta-600 [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_h2]:pt-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 " +
  "[&_h3]:pt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-neutral-900 " +
  "[&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-2 " +
  "[&_strong]:font-semibold [&_strong]:text-neutral-900 " +
  "[&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-meta-500 [&_blockquote]:pl-4 [&_blockquote]:italic";

/** Header, light page and a small footer shared by /guides and each guide. */
export default function GuideShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader minimal />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">{children}</main>
      <footer className="border-t border-black/10 py-8 text-sm text-neutral-500">
        <nav aria-label="Footer" className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-4 sm:px-6">
          <Link href="/" className="hover:text-neutral-900">{SITE_NAME} home</Link>
          <Link href="/guides" className="hover:text-neutral-900">Guides</Link>
          <Link href="/#pricing" className="hover:text-neutral-900">Pricing</Link>
          <Link href="/privacy" className="hover:text-neutral-900">Privacy</Link>
          <Link href="/terms" className="hover:text-neutral-900">Terms</Link>
        </nav>
      </footer>
    </>
  );
}

/** The call to action at the end of a guide: honest, one line, one button. */
export function GuideCta() {
  return (
    <aside className="mt-14 rounded-3xl bg-black p-7 text-white sm:p-9">
      <p className="text-2xl font-semibold tracking-tight">Make your next batch of ad creatives in minutes.</p>
      <p className="mt-2 text-sm text-white/65">
        {SITE_NAME} turns one finished video or image into up to ten polished, branded variations, rendered in the cloud.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/signup" className="rounded-full bg-meta-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-meta-400">
          Create an account
        </Link>
        <Link href="/#pricing" className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
          See pricing
        </Link>
      </div>
    </aside>
  );
}
