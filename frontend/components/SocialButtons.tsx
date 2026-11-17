"use client";

import { useEffect, useState } from "react";

import { fetchProviders, oauthStartUrl, type AuthProviders } from "@/lib/auth";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden fill="currentColor">
      <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.37-3.69zM14.1 5.84c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z" />
    </svg>
  );
}

const BUTTON =
  "flex w-full items-center justify-center gap-3 rounded-xl border border-black/80 bg-white px-4 py-3 text-[15px] font-semibold text-black transition hover:bg-black/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/50";

/**
 * "Continue with Google / Apple" buttons, shown only for the providers the
 * server has keys for, followed by an "or" divider. Renders nothing when
 * neither is set up, so the email form looks exactly as before.
 */
export default function SocialButtons({ next, mode }: { next: string | null; mode: "signin" | "signup" }) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviders().then((p) => {
      if (!cancelled) setProviders(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!providers || (!providers.google && !providers.apple)) return null;
  const verb = mode === "signup" ? "Sign up with" : "Continue with";

  return (
    <div className="mb-5">
      <div className="space-y-3">
        {providers.google ? (
          <a href={oauthStartUrl("google", next)} className={BUTTON}>
            <GoogleLogo />
            {verb} Google
          </a>
        ) : null}
        {providers.apple ? (
          <a href={oauthStartUrl("apple", next)} className={BUTTON}>
            <AppleLogo />
            {verb} Apple
          </a>
        ) : null}
      </div>
      <div className="mt-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        <span className="h-px flex-1 bg-black/[0.08]" />
        or with email
        <span className="h-px flex-1 bg-black/[0.08]" />
      </div>
    </div>
  );
}
