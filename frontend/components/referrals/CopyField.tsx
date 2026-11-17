"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A read-only value with a Copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the field is selectable, so it can still be copied by hand */
    }
  };

  return (
    <div className="min-w-0">
      <p className="label mb-1">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <input className="field min-w-0 flex-1 font-mono !text-xs" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button type="button" className="btn-ghost shrink-0 !py-2 !text-xs" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default CopyField;
