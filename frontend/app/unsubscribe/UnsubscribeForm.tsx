"use client";

import { Loader2, MailX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type State = { email: string; unsubscribed: boolean };

async function call(path: string, token: string, method: "GET" | "POST"): Promise<State> {
  const response = await fetch(`${API_BASE}/api/v1/emails/${path}?t=${encodeURIComponent(token)}`, {
    method,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 404 ? "This link is not valid." : "Something went wrong. Try again.");
  return (await response.json()) as State;
}

/**
 * Asks before unsubscribing, rather than doing it on page load, so a mail
 * scanner that opens every link cannot unsubscribe someone by accident.
 */
export default function UnsubscribeForm() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This link is not valid.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    call("unsubscribe", token, "GET").then(setState).catch((err: Error) => setError(err.message));
  }, [token]);

  const change = async (path: "unsubscribe" | "resubscribe") => {
    setBusy(true);
    try {
      setState(await call(path, token, "POST"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm">
      <MailX className="mx-auto h-8 w-8 text-meta-500" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-neutral-900">Email preferences</h1>
      {error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : !state ? (
        <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-neutral-400" aria-hidden />
      ) : state.unsubscribed ? (
        <>
          <p className="mt-3 text-sm text-neutral-600">
            <b>{state.email}</b> will no longer get our update emails. You will still get emails about your account,
            like payment confirmations and plan reminders.
          </p>
          <button type="button" className="btn-ghost mt-6 !text-sm" disabled={busy} onClick={() => void change("resubscribe")}>
            Changed your mind? Subscribe again
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-neutral-600">
            Stop update emails to <b>{state.email}</b>? Emails about your account, like payment confirmations and plan
            reminders, will still arrive.
          </p>
          <button type="button" className="btn-primary mt-6 !text-sm" disabled={busy} onClick={() => void change("unsubscribe")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Unsubscribe
          </button>
        </>
      )}
      <p className="mt-8 text-sm">
        <Link href="/" className="text-meta-600 underline">
          Back to the home page
        </Link>
      </p>
    </div>
  );
}
