"use client";

import { ArrowRight, Loader2, Lock, Mail, OctagonAlert, User } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";

import { signIn, signUp } from "@/lib/auth";
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

  const next = params.get("next");
  const destination = safeDestination(next);
  const otherPage = (mode === "signup" ? "/login" : "/signup") + (next ? `?next=${encodeURIComponent(next)}` : "");

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
        // The API set an httpOnly cookie; a full navigation lets the Next
        // middleware see it and route into the workspace.
        window.location.assign(!next && (await isAdmin()) ? "/admin" : destination);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
        setBusy(false);
      }
    },
    [busy, destination, displayName, email, mode, next, password],
  );

  return (
    <NeonCard padding="lg" radius="xl" className="w-full max-w-md">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-black">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {mode === "signup"
            ? "Your assets and outputs are visible only to you."
            : "Sign in to open your workspace."}
        </p>
      </div>

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

      <p className="mt-5 text-center text-xs leading-relaxed text-ink-subtle">
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <Link href={otherPage} className="font-semibold text-meta-600 hover:underline">
          {mode === "signup" ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </NeonCard>
  );
}

export default AuthPanel;
