"use client";

import { ArrowLeft, ArrowRight, Loader2, Lock, Mail, MailCheck, OctagonAlert, User } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

import { ApiError } from "@/lib/api";
import { fetchMe, isPending, resendVerification, signIn, signUp, verifyEmail, type UserProfile } from "@/lib/auth";
import { trackRegistration } from "@/lib/meta";
import { CodeField, ResendButton } from "./CodeInput";
import NeonCard from "./NeonCard";
import SocialButtons from "./SocialButtons";

type Mode = "signin" | "signup";

/** Messages for ?oauth_error= after Google sends someone back. */
const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Try again, or use your email below.",
  expired: "That sign-in took too long or was opened in another browser. Please try again.",
  no_email: "We could not get a confirmed email from that account. Use another account or sign up with email.",
  disabled: "This account is turned off. Contact support if you think this is a mistake.",
  closed: "New accounts are closed right now.",
  unavailable: "That sign-in option is not available right now.",
  failed: "Sign-in did not work this time. Please try again, or use your email below.",
};

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
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("oauth_error");
    return code ? (OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed) : null;
  });
  /** Set once the server has emailed a sign-up code to this address. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
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
          const result = await signUp(email.trim(), password, displayName.trim());
          if (isPending(result)) {
            setPendingEmail(result.email);
            setCode("");
            setBusy(false);
            return;
          }
          // Same event id as the server's Conversions API copy, so Meta counts it once.
          await Promise.race([trackRegistration(result.id), new Promise((r) => setTimeout(r, 800))]);
        } else {
          await signIn(email.trim(), password);
        }
        await enter();
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 403 && mode === "signin") {
          // Signed up but never entered the code: the server sent a new one.
          setPendingEmail(email.trim().toLowerCase());
          setCode("");
          setBusy(false);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
        setBusy(false);
      }
    },
    [busy, displayName, email, enter, mode, password],
  );

  const confirm = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy || !pendingEmail) return;
      setError(null);
      if (code.length !== 6) {
        setError("Enter the 6-digit code from the email.");
        return;
      }
      setBusy(true);
      try {
        const profile = await verifyEmail(pendingEmail, code);
        await Promise.race([trackRegistration(profile.id), new Promise((r) => setTimeout(r, 800))]);
        await enter();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
        setBusy(false);
      }
    },
    [busy, code, enter, pendingEmail],
  );

  if (pendingEmail) {
    return (
      <NeonCard glow padding="lg" radius="xl" className="w-full max-w-md">
        <div className="mb-6">
          <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-meta-50 text-meta-600">
            <MailCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="font-display text-4xl font-normal leading-tight text-black">Check your email</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            We sent a 6-digit code to <span className="break-all font-semibold text-black">{pendingEmail}</span>. Enter it
            to open your account.
          </p>
        </div>
        <form onSubmit={confirm} className="space-y-4" noValidate>
          <div>
            <label htmlFor={`${formId}-code`} className="label mb-1.5 block">
              Code
            </label>
            <CodeField id={`${formId}-code`} value={code} onChange={setCode} disabled={busy} />
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
          <button type="submit" className="btn-primary w-full !py-3" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Confirm and continue
            {!busy ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
          </button>
        </form>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <ResendButton
            onResend={async () => {
              setError(null);
              await resendVerification(pendingEmail).catch(() => undefined);
            }}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-black"
            onClick={() => {
              setPendingEmail(null);
              setError(null);
              setBusy(false);
            }}
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Use another email
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
          No email after a minute? Check your spam or promotions folder.
        </p>
      </NeonCard>
    );
  }

  return (
    <NeonCard glow padding="lg" radius="xl" className="w-full max-w-md">
      <div className="mb-6">
        <h1 className="font-display text-4xl font-normal leading-tight text-black">
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

      <SocialButtons next={next} mode={mode} />

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
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor={`${formId}-password`} className="label flex items-center gap-1.5">
              <Lock className="h-3 w-3" aria-hidden />
              Password
            </label>
            {mode === "signin" ? (
              <Link
                href={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
                className="text-[11px] font-semibold text-meta-600 hover:underline"
              >
                Forgot password?
              </Link>
            ) : null}
          </div>
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
        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-subtle">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline">
            Privacy policy
          </Link>
          .
        </p>
      ) : null}

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
