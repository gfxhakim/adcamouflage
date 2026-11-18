"use client";

import { AtSign, CheckCircle2, Loader2, Send } from "lucide-react";
import { useState, type FormEvent } from "react";

import { CodeField } from "@/components/CodeInput";
import { confirmEmailChange, requestEmailChange, type UserProfile } from "@/lib/auth";
import { trustedEmailError } from "@/lib/authValidation";

/** Change the sign-in email: a code goes to the new address, and the old one gets a notice. */
export function EmailChangeCard({ socialOnly = false, onChanged }: { socialOnly?: boolean; onChanged?: (p: UserProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="text-xs font-semibold text-meta-600 hover:underline" onClick={() => setOpen(true)}>
        Change email
      </button>
    );
  }

  const start = async (event: FormEvent) => {
    event.preventDefault();
    const emailProblem = trustedEmailError(email.trim());
    if (emailProblem) {
      setError(emailProblem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { sent_to } = await requestEmailChange(email.trim(), password);
      setSentTo(sent_to);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const profile = await confirmEmailChange(code);
      setDone(profile.email);
      setSentTo(null);
      setEmail("");
      setPassword("");
      onChanged?.(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-black/[0.08] p-3">
      {sentTo ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-xs text-ink-muted">
            Enter the 6-digit code we sent to <span className="font-semibold text-black">{sentTo}</span>.
          </p>
          <CodeField id="email-code" value={code} onChange={setCode} disabled={busy} />
          <button type="submit" className="btn-ghost w-full" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Confirm new email
          </button>
        </form>
      ) : (
        <form onSubmit={start} className="space-y-3">
          <label className="block">
            <span className="label flex items-center gap-1.5">
              <AtSign className="h-3 w-3" aria-hidden /> New email
            </span>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@gmail.com"
              className="field mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {!socialOnly ? (
            <label className="block">
              <span className="label">Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                className="field mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          ) : null}
          <button type="submit" className="btn-ghost w-full" disabled={busy || !email.includes("@") || (!socialOnly && !password)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Send code to the new email
          </button>
        </form>
      )}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Your email is now {done}.
        </p>
      ) : null}
    </div>
  );
}

export default EmailChangeCard;
