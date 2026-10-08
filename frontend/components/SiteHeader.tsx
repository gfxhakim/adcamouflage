import { ArrowRight, LayoutDashboard, ShieldHalf } from "lucide-react";
import Link from "next/link";

interface SiteHeaderProps {
  /** A session cookie is present, so offer the workspace instead of sign-in. */
  signedIn?: boolean;
  /** Hide the sign-in buttons, e.g. on the login and sign-up pages. */
  minimal?: boolean;
}

/** The public header shared by the landing page and the auth pages. */
export function SiteHeader({ signedIn = false, minimal = false }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="AdCamouflage home">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-meta-500/30 bg-meta-50">
            <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-black">
              Ad<span className="text-gradient">Camouflage</span>
            </span>
            <span className="hidden text-[11px] text-ink-faint sm:block">
              Media mutation &amp; fingerprint stripping
            </span>
          </span>
        </Link>

        {minimal ? null : signedIn ? (
          <Link href="/app" className="btn-primary !px-4 !py-2">
            <LayoutDashboard className="h-4 w-4" aria-hidden />
            Open workspace
          </Link>
        ) : (
          <nav className="flex shrink-0 items-center gap-2">
            <Link href="/login" className="btn-ghost !px-3 !py-2 sm:!px-4">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary !px-3 !py-2 sm:!px-4">
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
