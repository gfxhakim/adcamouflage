"use client";

import { CheckCircle2, KeyRound, Loader2, Mail, Send } from "lucide-react";
import { useState, type FormEvent } from "react";

import { CodeField } from "@/components/CodeInput";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { changePassword, requestPasswordCode } from "@/lib/auth";
import { assessPassword, MIN_PASSWORD_LENGTH } from "@/lib/authValidation";

/**
 * Change the account password. The server emails a 6-digit code that must be
 * entered with the new password; every other device is signed out after.
 * Accounts made with Google have no password yet, so they only
 * need the code.
 */
export function PasswordCard({ socialOnly = false }: { socialOnly?: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  /** null = no code asked for yet; true = code sent; false = server has no email, no code needed. */
  const [codeStep, setCodeStep] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const askCode = async (event: FormEvent) => {
    event.preventDefault();
    const check = assessPassword(next);
    if (!check.valid && check.error) {
      setError(check.error);
      return;
    }
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const result = await requestPasswordCode();
      setCodeStep(result.required);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const check = assessPassword(next);
    if (!check.valid && check.error) {
      setError(check.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next, code);
      setCurrent("");
      setNext("");
      setCode("");
      setCodeStep(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  const ready = (socialOnly || current) && next;

  return (
    <form onSubmit={codeStep === null ? askCode : submit} className="space-y-3">
      {!socialOnly ? (
        <label className="block">
          <span className="label">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="field mt-1"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
      ) : (
        <p className="text-xs text-ink-muted">You log in with Google. Set a password to log in with your email too.</p>
      )}
      <label className="block">
        <span className="label">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          className="field mt-1"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <PasswordStrengthMeter password={next} />
      </label>
      {codeStep ? (
        <label className="block">
          <span className="label flex items-center gap-1.5">
            <Mail className="h-3 w-3" aria-hidden /> Code from your email
          </span>
          <div className="mt-1">
            <CodeField id="password-code" value={code} onChange={setCode} disabled={saving} />
          </div>
        </label>
      ) : null}
      <button
        type="submit"
        className="btn-ghost w-full"
        disabled={saving || !ready || (codeStep === true && code.length !== 6)}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : codeStep === null ? (
          <Send className="h-4 w-4" aria-hidden />
        ) : (
          <KeyRound className="h-4 w-4" aria-hidden />
        )}
        {codeStep === null ? "Email me a code" : socialOnly ? "Set password" : "Change password"}
      </button>
      {codeStep ? <p className="text-[11px] text-ink-faint">We sent a 6-digit code to your email. It works for 15 minutes.</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Password saved. Other devices were signed out.
        </p>
      ) : null}
    </form>
  );
}

export default PasswordCard;
