"use client";

import { ArrowLeft, ArrowRight, KeyRound, Loader2, Lock, Mail, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { forgotPassword, resetPassword } from "@/lib/auth";
import { CodeField, ResendButton } from "./CodeInput";
import NeonCard from "./NeonCard";

/** Must match ADCAM_MIN_PASSWORD_LENGTH on the API. */
const MIN_PASSWORD_LENGTH = 10;

async function isAdmin(): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/admin/settings", { credentials: "same-origin", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Forgot password: email -> 6-digit code + new password -> signed in. */
export default function ForgotPanel() {
  const params = useSearchParams();
  const formId = useId();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const cleaned = email.trim();
    if (!cleaned.includes("@")) {
      setError("Enter the email of your account.");
      return;
    }
    setBusy(true);
    try {
      const result = await forgotPassword(cleaned);
      if (result.email_ready === false) {
        setError("Password reset by email is not available right now. Please contact support.");
        return;
      }
      setSentTo(cleaned.toLowerCase());
      setCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !sentTo) return;
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`);
      return;
    }
    setBusy(true);
    try {
      await resetPassword(sentTo, code, password);
      window.location.assign((await isAdmin()) ? "/admin" : "/app");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  const alert = error ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700"
    >
      <OctagonAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {error}
    </p>
  ) : null;

  return (
    <NeonCard glow padding="lg" radius="xl" className="w-full max-w-md">
      <div className="mb-6">
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-meta-50 text-meta-600">
          <KeyRound className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="font-display text-4xl font-normal leading-tight text-black">
          {sentTo ? "Choose a new password" : "Forgot your password?"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {sentTo ? (
            <>
              If <span className="break-all font-semibold text-black">{sentTo}</span> has an account, we just sent it a
              6-digit code. Enter it with your new password.
            </>
          ) : (
            "Enter your account email and we will send you a code to set a new password."
          )}
        </p>
      </div>

      {sentTo ? (
        <form onSubmit={reset} className="space-y-4" noValidate>
          <div>
            <label htmlFor={`${formId}-code`} className="label mb-1.5 block">
              Code
            </label>
            <CodeField id={`${formId}-code`} value={code} onChange={setCode} disabled={busy} />
          </div>
          <div>
            <label htmlFor={`${formId}-password`} className="label mb-1.5 flex items-center gap-1.5">
              <Lock className="h-3 w-3" aria-hidden />
              New password
            </label>
            <input
              id={`${formId}-password`}
              type="password"
              autoComplete="new-password"
              className="field"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          {alert}
          <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save password and log in
            {!busy ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResendButton
              onResend={async () => {
                setError(null);
                await forgotPassword(sentTo).catch(() => undefined);
              }}
            />
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-black"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              Use another email
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={send} className="space-y-4" noValidate>
          <div>
            <label htmlFor={`${formId}-email`} className="label mb-1.5 flex items-center gap-1.5">
              <Mail className="h-3 w-3" aria-hidden />
              Email
            </label>
            <input
              id={`${formId}-email`}
              type="email"
              autoComplete="email"
              className="field"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          {alert}
          <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Send code
            {!busy ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
          </button>
        </form>
      )}

      <p className="mt-6 border-t border-black/[0.07] pt-5 text-center text-xs text-ink-subtle">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-meta-600 hover:underline">
          Back to log in
        </Link>
      </p>
    </NeonCard>
  );
}
