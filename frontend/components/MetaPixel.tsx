"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CONSENT_EVENT, loadConfig, readConsent, rememberAdClick, startPixel, trackPage, writeConsent } from "@/lib/meta";

/**
 * Cookie banner + Meta Pixel page events. Shown only once Meta is set up on
 * the API (a Pixel id exists) and the visitor has not chosen yet. The footer's
 * "Cookie settings" link opens it again. The admin panel is never tracked.
 */
export default function MetaPixel() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const tracked = !pathname.startsWith("/admin");

  // Ask once Meta is set up and no choice was made.
  useEffect(() => {
    if (!tracked) return;
    let cancelled = false;
    void loadConfig().then((id) => {
      if (!cancelled && id && readConsent() === null) setOpen(true);
    });
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_EVENT, reopen);
    return () => {
      cancelled = true;
      window.removeEventListener(CONSENT_EVENT, reopen);
    };
  }, [tracked]);

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

  if (!open || !tracked) return null;

  const choose = (value: "granted" | "denied") => {
    writeConsent(value);
    setOpen(false);
    if (value === "granted") {
      void startPixel().then(() => trackPage("PageView"));
    } else if (window.fbq) {
      window.fbq("consent", "revoke");
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-24 z-[90] mx-auto max-w-lg rounded-2xl border border-black/10 bg-white p-4 text-sm text-neutral-800 shadow-2xl sm:bottom-6 lg:bottom-6"
    >
      <p className="leading-relaxed">
        We use cookies to keep you signed in and, if you allow it, the Meta Pixel to measure our ads.{" "}
        <Link href="/privacy#cookies" className="font-medium text-meta-600 underline underline-offset-2">
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => choose("granted")}
          className="rounded-full bg-meta-600 px-4 py-2 text-xs font-semibold text-white hover:bg-meta-500"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => choose("denied")}
          className="rounded-full border border-black/15 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-black/5"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

/** Opens the cookie banner again (footer link). */
export function openCookieSettings() {
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
