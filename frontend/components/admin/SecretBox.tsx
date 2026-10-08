"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Shows a one-time value (a temporary password) with a copy button. */
export function SecretBox({ value, note }: { value: string; note: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* The value stays selectable on screen. */
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-black">
          {value}
        </code>
        <button type="button" className="btn-ghost !p-2" onClick={copy} aria-label="Copy">
          {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-emerald-800">{note}</p>
    </div>
  );
}

export default SecretBox;
