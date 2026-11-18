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

const BUTTON =
  "flex w-full items-center justify-center gap-3 rounded-xl border border-black/80 bg-white px-4 py-3 text-[15px] font-semibold text-black transition hover:bg-black/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/50";

/**
 * "Continue with Google" button, shown once the server has Google keys,
 * followed by an "or" divider. Renders nothing when it is not set up, so the email form looks exactly as before.
 */
export default function SocialButtons({
  next,
  mode,
  role,
  providers: initialProviders,
}: {
  next: string | null;
  mode: "signin" | "signup";
  role?: "customer" | "affiliate";
  providers?: AuthProviders | null;
}) {
  const [fetchedProviders, setFetchedProviders] = useState<AuthProviders | null>(null);
  const providers = initialProviders ?? fetchedProviders;

  useEffect(() => {
    if (initialProviders !== undefined) return;
    let cancelled = false;
    fetchProviders().then((p) => {
      if (!cancelled) setFetchedProviders(p);
    });
    return () => {
      cancelled = true;
    };
  }, [initialProviders]);

  if (!providers || !providers.google) return null;
  const verb = mode === "signup" ? "Sign up with" : "Continue with";
  const registrationClosed = mode === "signup" && providers.registration_open === false;

  return (
    <div className="mb-5">
      {registrationClosed ? (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          New account sign-ups are paused right now. Existing accounts can still log in.
        </p>
      ) : null}
      <div className="space-y-3">
        {providers.google ? (
          <a href={oauthStartUrl("google", next, role)} className={BUTTON}>
            <GoogleLogo />
            {verb} Google
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
