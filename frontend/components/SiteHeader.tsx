import { ArrowRight, ShieldHalf } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  /** Hide the sign-in buttons, e.g. on the login and sign-up pages. */
  minimal?: boolean;
  /** Section links for the middle of the header (the landing page's nav pill). */
  nav?: ReactNode;
}

/** The public header shared by the landing page and the auth pages. */
export function SiteHeader({ minimal = false, nav }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl">
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8",
          // Logo | nav | buttons, with the nav centred on the page.
          nav && "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        )}
      >
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 justify-self-start"
          aria-label="AdCamouflage home"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-meta-500/30 bg-meta-50">
            <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-black">
              Ad<span className="text-gradient">Camouflage</span>
            </span>
            <span
              className={cn(
                "hidden text-[11px] text-ink-faint sm:block",
                // Make room for the nav on smaller laptops.
                nav && "lg:hidden xl:block",
              )}
            >
              Media mutation &amp; fingerprint stripping
            </span>
          </span>
        </Link>

        {nav}

        {minimal ? null : (
          // Both open the login page, which also offers to create an account.
          <nav className="flex shrink-0 items-center gap-2 justify-self-end">
            <Link href="/login" className="btn-ghost !px-3 !py-2 sm:!px-4">
              Log in
            </Link>
            <Link href="/login" className="btn-primary !px-3 !py-2 sm:!px-4">
              Get started
              <ArrowRight className="hidden h-3.5 w-3.5 sm:block" aria-hidden />
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

export default SiteHeader;
