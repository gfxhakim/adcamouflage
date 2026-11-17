"use client";

import { Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

/** A 6-digit code field (paste and SMS/email autofill friendly). */
export function CodeField({
  id,
  value,
  onChange,
  disabled,
  autoFocus = true,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      autoFocus={autoFocus}
      className="field text-center font-mono !text-2xl !tracking-[0.5em]"
      placeholder="••••••"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      disabled={disabled}
    />
  );
}

/** "Send a new code" with a one-minute wait between sends. */
export function ResendButton({ onResend, startCooling = true }: { onResend: () => Promise<void>; startCooling?: boolean }) {
  const [wait, setWait] = useState(startCooling ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-meta-600 hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline"
      disabled={wait > 0 || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onResend();
          setSent(true);
          setWait(60);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RotateCw className="h-3 w-3" aria-hidden />}
      {wait > 0 ? `${sent ? "New code sent. " : ""}Send a new code in ${wait}s` : "Send a new code"}
    </button>
  );
}
