"use client";

import { Loader2, TicketPercent } from "lucide-react";
import { useState, type FormEvent } from "react";

import { applyCode, offerLine, type ReferralOffer } from "@/lib/referrals";

interface CouponBoxProps {
  offer: ReferralOffer | null;
  planLabels: Record<string, string>;
  onApplied: (offer: ReferralOffer) => void;
}

/** A friend's or creator's code, typed before the first payment. One code per customer. */
export function CouponBox({ offer, planLabels, onApplied }: CouponBoxProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onApplied((await applyCode(code.trim())).offer);
      setCode("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code could not be applied.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm">
      {offer ? (
        <p className="flex flex-wrap items-center gap-2 text-black">
          <TicketPercent className="h-4 w-4 shrink-0 text-meta-500" aria-hidden />
          <span>
            Code <span className="font-semibold">{offer.code}</span> applied: {offerLine(offer, planLabels)}.
          </span>
          {!open ? (
            <button type="button" className="text-xs font-semibold text-meta-600 hover:underline" onClick={() => setOpen(true)}>
              Use another code
            </button>
          ) : null}
        </p>
      ) : !open ? (
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-meta-600 hover:underline"
          onClick={() => setOpen(true)}
        >
          <TicketPercent className="h-4 w-4" aria-hidden />
          Have a referral or creator code?
        </button>
      ) : null}
      {open ? (
        <form onSubmit={submit} className={offer ? "mt-3 flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
          <input
            className="field !w-auto min-w-0 flex-1 uppercase"
            placeholder="Enter code"
            value={code}
            maxLength={24}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
            aria-label="Referral or creator code"
          />
          <button type="submit" className="btn-primary !py-2 !text-xs" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Apply
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {offer || open ? (
        <p className="mt-2 text-[11px] text-ink-faint">One code per account, on the first subscription payment only.</p>
      ) : null}
    </div>
  );
}

export default CouponBox;
