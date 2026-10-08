"use client";

import { ArrowRight, Loader2, Lock, Mail, OctagonAlert, User } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

import { fetchMe, signIn, signUp, type UserProfile } from "@/lib/auth";
import NeonCard from "./NeonCard";

type Mode = "signin" | "signup";

/** Must match ADCAM_MIN_PASSWORD_LENGTH on the API. */
const MIN_PASSWORD_LENGTH = 10;

/** Only same-site paths, so a crafted ?next= cannot send someone off-site. */
function safeDestination(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

/**
 * Admins land in the admin panel instead of the workspace. The admin API
 * answers everyone else with a 404, so this tells a customer nothing.
 */
async function isAdmin(): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/admin/settings", { credentials: "same-origin", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export function AuthPanel({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const formId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Someone already signed in on this browser, offered a way straight in. */
  const [current, setCurrent] = useState<UserProfile | null>(null);

  const next = params.get("next");
  const destination = safeDestination(next);
  const otherPage = (mode === "signup" ? "/login" : "/signup") + (next ? `?next=${encodeURIComponent(next)}` : "");

  useEffect(() => {
    if (mode !== "signin") return;
    let cancelled = false;
    fetchMe()
      .then((profile) => {
        if (!cancelled) setCurrent(profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // The API set an httpOnly cookie; a full navigation lets the Next middleware
  // see it. Admins go to the admin panel, everyone else to the workspace.
  const enter = useCallback(async () => {
    window.location.assign(!next && (await isAdmin()) ? "/admin" : destination);
  }, [destination, next]);

  const continueSignedIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await enter();
  }, [busy, enter]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;

      setError(null);

      if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
        return;
      }

      setBusy(true);
      try {
        if (mode === "signup") {
          await signUp(email.trim(), password, displayName.trim());
        } else {
          await signIn(email.trim(), password);
        }
        await enter();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
        setBusy(false);
      }
    },
    [busy, displayName, email, enter, mode, password],
  );

  return (
    <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-black">
          {mode === "signup" ? "Create your account" : "Log in"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {mode === "signup"
            ? "Your assets and outputs are visible only to you."
            : "Sign in to your account, or create a new one below."}
        </p>
      </div>

      {current ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-meta-500/20 bg-meta-50 px-4 py-3">
          <p className="min-w-0 text-[13px] leading-snug text-ink-muted">
            You&apos;re signed in as{" "}
            <span className="break-all font-semibold text-black">{current.email}</span>
          </p>
          <button type="button" onClick={continueSignedIn} className="btn-primary !px-4 !py-2" disabled={busy}>
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === "signup" ? (
          <div>
            <label htmlFor={`${formId}-name`} className="label mb-1.5 flex items-center gap-1.5">
              <User className="h-3 w-3" aria-hidden />
              Name <span className="normal-case tracking-normal text-ink-faint">(optional)</span>
            </label>
            <input
              id={`${formId}-name`}
              type="text"
              autoComplete="name"
              className="field"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={busy}
              maxLength={120}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor={`${formId}-email`} className="label mb-1.5 flex items-center gap-1.5">
            <Mail className="h-3 w-3" aria-hidden />
            Email
          </label>
          <input
            id={`${formId}-email`}
            type="email"
            required
            autoComplete="email"
            className="field"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label htmlFor={`${formId}-password`} className="label mb-1.5 flex items-center gap-1.5">
            <Lock className="h-3 w-3" aria-hidden />
            Password
          </label>
          <input
            id={`${formId}-password`}
            type="password"
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="field"
            placeholder={mode === "signup" ? `At least ${MIN_PASSWORD_LENGTH} characters` : "••••••••••"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          {mode === "signup" ? (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              {password.length === 0
                ? `${MIN_PASSWORD_LENGTH} characters minimum.`
                : password.length < MIN_PASSWORD_LENGTH
                  ? `${MIN_PASSWORD_LENGTH - password.length} more to go.`
                  : "Long enough."}
            </p>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700"
          >
            <OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {mode === "signup" ? "Creating your account…" : "Signing in…"}
            </>
          ) : (
            <>
              {mode === "signup" ? "Create account" : "Sign in"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
      </form>

      {mode === "signup" ? (
        <p className="mt-5 text-center text-xs leading-relaxed text-ink-subtle">
          Already have an account?{" "}
          <Link href={otherPage} className="font-semibold text-meta-600 hover:underline">
            Sign in
          </Link>
        </p>
      ) : (
        // Every start button on the landing page opens this page, so new
        // visitors need an obvious way to the sign-up form.
        <div className="mt-6 border-t border-black/[0.07] pt-5 text-center">
          <p className="mb-3 text-xs text-ink-subtle">New here?</p>
          <Link href={otherPage} className="btn-ghost w-full !py-3">
            <User className="h-4 w-4" aria-hidden />
            Create a new account
          </Link>
        </div>
      )}
    </NeonCard>
  );
}

export default AuthPanel;
