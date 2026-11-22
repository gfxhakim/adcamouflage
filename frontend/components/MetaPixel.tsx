"use client";

import { Cookie, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CONSENT_EVENT, loadConfig, readConsent, rememberAdClick, startPixel, trackPage, writeConsent } from "@/lib/meta";

const LEGAL_PATHS = ["/privacy", "/terms", "/refund-policy"];

/**
 * Cookie consent modal + Meta Pixel page events. Shown only once Meta is set up
 * on the API (a Pixel id exists) and the visitor has not chosen yet. Reopening
 * via the footer's "Cookie settings" link works on any non-admin page. Legal
 * pages stay readable unblocked until the visitor clicks back or opens settings.
 */
export default function MetaPixel() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasChoice, setHasChoice] = useState(false);
  const tracked = !pathname.startsWith("/admin");
  const isLegalPage = LEGAL_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  useEffect(() => {
    setMounted(true);
  }, []);

  // Ask once Meta is set up and no choice was made (pause auto-open on legal docs so users can read Privacy Policy).
  useEffect(() => {
    if (!tracked) {
      setOpen(false);
      return;
    }
    const existing = readConsent();
    setHasChoice(existing !== null);

    let cancelled = false;
    void loadConfig().then((id) => {
      if (cancelled || !id) return;
      if (readConsent() === null && !isLegalPage) {
        setOpen(true);
      } else if (isLegalPage) {
        setOpen(false);
      }
    });

    const reopen = () => {
      setHasChoice(readConsent() !== null);
      setOpen(true);
    };
    window.addEventListener(CONSENT_EVENT, reopen);
    return () => {
      cancelled = true;
      window.removeEventListener(CONSENT_EVENT, reopen);
    };
  }, [tracked, isLegalPage]);

  // Keep an ad click id from the landing URL until tracking is allowed.
  useEffect(() => {
    rememberAdClick();
  }, [pathname]);

  // PageView on every page, ViewContent for the plan page and the landing pricing.
  useEffect(() => {
    if (!tracked) return;
    void trackPage("PageView");
    if (pathname === "/app/plan") void trackPage("ViewContent", "Plans");
    if (pathname !== "/") return;
    const pricing = document.getElementById("pricing");
    if (!pricing || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect();
          void trackPage("ViewContent", "Pricing");
        }
      },
      { threshold: 0.25 },
    );
    seen.observe(pricing);
    return () => seen.disconnect();
  }, [pathname, tracked]);

  const dismissIfAllowed = useCallback(() => {
    if (hasChoice || isLegalPage) setOpen(false);
  }, [hasChoice, isLegalPage]);

  // Lock page scroll while the centered blurred consent modal is open.
  useEffect(() => {
    if (!open || !tracked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissIfAllowed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, tracked, dismissIfAllowed]);

  if (!open || !tracked || !mounted) return null;

  const choose = (value: "granted" | "denied") => {
    writeConsent(value);
    setHasChoice(true);
    setOpen(false);
    if (value === "granted") {
      void startPixel().then(async (ok) => {
        if (!ok) return;
        await trackPage("PageView");
        if (pathname === "/app/plan") await trackPage("ViewContent", "Plans");
      });
    } else if (window.fbq) {
      window.fbq("consent", "revoke");
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-consent-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismissIfAllowed();
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-md sm:p-6"
    >
      <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-black/10 bg-white p-6 text-black shadow-[0_24px_80px_-16px_rgba(0,0,0,0.35)] ring-1 ring-black/5 sm:p-8">
        {hasChoice || isLegalPage ? (
          <button
            type="button"
            onClick={dismissIfAllowed}
            aria-label="Close cookie preferences"
            className="absolute right-4 top-4 rounded-xl p-2 text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-black"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-meta-50 text-meta-600 ring-1 ring-meta-500/20">
            <Cookie className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-meta-600">
              Privacy &amp; Cookie Settings
            </p>
            <h2 id="cookie-consent-title" className="text-lg font-semibold tracking-tight text-black sm:text-xl">
              Choose your cookie preferences
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          We use essential cookies to keep you signed in and protect your account. With your permission, we also use the{" "}
          <span className="font-medium text-black">Meta Pixel</span> and Conversions API to measure signups and
          improve our advertising performance.
        </p>

        <div className="mt-4 space-y-2.5 rounded-2xl border border-black/[0.08] bg-neutral-50/90 p-4 text-xs leading-relaxed">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-black">Essential cookies</p>
              <p className="mt-0.5 text-ink-muted">
                Required for sign-in sessions, referral discounts, checkout continuity, and saving this choice.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Active
            </span>
          </div>
          <div className="border-t border-black/[0.06] pt-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-black">Analytics &amp; Meta advertising</p>
                <p className="mt-0.5 text-ink-muted">
                  Optional measurement for page views, signups, and checkouts via Meta Pixel &amp; Conversions API.
                </p>
              </div>
              <span className="inline-flex shrink-0 rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                Optional
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3.5 text-xs text-ink-subtle">
          You can change or withdraw your consent anytime from <span className="font-medium text-black">Cookie settings</span>{" "}
          in the footer. Read more in our{" "}
          <Link href="/privacy#cookies" className="font-semibold text-meta-600 underline underline-offset-2 hover:text-meta-700">
            Privacy Policy
          </Link>
          .
        </p>

        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="btn-ghost w-full justify-center py-3 text-sm"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="btn-primary w-full justify-center py-3 text-sm"
          >
            Accept Cookies
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Opens the cookie modal again (footer link). */
export function openCookieSettings() {
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
