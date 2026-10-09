import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import BrandLogo from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  /** Hide the sign-in buttons, e.g. on the login and sign-up pages. */
  minimal?: boolean;
  /** Section links for the middle of the header (the landing page's nav pill). */
  nav?: ReactNode;
  /**
   * The landing page's header: no bar, just glass pills floating over the
   * page (logo, section nav, buttons), with a shining, gently moving logo.
   */
  floating?: boolean;
}

/** The public header shared by the landing page and the auth pages. */
export function SiteHeader({ minimal = false, nav, floating = false }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "top-0 z-40",
        floating
          ? "pointer-events-none fixed inset-x-0"
          : "sticky border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8",
          // Logo | nav | buttons, with the nav centred on the page.
          nav && "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex min-w-0 items-center gap-3 justify-self-start",
            floating && "glass-shine pointer-events-auto rounded-full py-1.5 pl-2 pr-4",
          )}
          aria-label="BluCloacking home"
        >
          <BrandLogo
            onDark={floating}
            animated={floating}
            caption={floating ? undefined : "Media mutation & fingerprint stripping"}
            captionClassName={cn(
              "hidden sm:block",
              // Make room for the nav on smaller laptops.
              nav && "lg:hidden xl:block",
            )}
          />
        </Link>

        {nav}

        {minimal ? null : (
          // Both open the login page, which also offers to create an account.
          <nav className="pointer-events-auto flex shrink-0 items-center gap-2 justify-self-end">
            <Link
              href="/login"
              className={
                floating
                  ? "glass-shine rounded-full px-4 py-2 text-sm font-semibold"
                  : "btn-ghost !px-3 !py-2 sm:!px-4"
              }
            >
              Log in
            </Link>
            <Link
              href="/login"
              className={
                floating
                  ? "glass-shine-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                  : "btn-primary !px-3 !py-2 sm:!px-4"
              }
            >
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
