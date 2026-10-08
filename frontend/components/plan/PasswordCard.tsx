"use client";

import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { changePassword } from "@/lib/auth";

/** Change the account password; the API signs out every other session. */
export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
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
      <label className="block">
        <span className="label">New password</span>
        <input
          type="password"
          autoComplete="new-password"
          className="field mt-1"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn-ghost w-full" disabled={saving || !current || !next}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
        Change password
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Password changed. Other devices were signed out.
        </p>
      ) : null}
    </form>
  );
}

export default PasswordCard;
