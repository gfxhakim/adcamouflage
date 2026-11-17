"use client";

import { Gift, X } from "lucide-react";
import { useEffect, useState } from "react";

import { offerLine, recordClick, type ReferralOffer } from "@/lib/referrals";

const SEEN_KEY = "pf_ref_offer";

/**
 * Reads ?ref=CODE from a referral link, tells the server (which remembers it
 * in a cookie until sign-up) and shows the visitor what the code gives them.
 */
export default function RefCapture() {
  const [offer, setOffer] = useState<ReferralOffer | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("ref") ?? "").trim();
    if (!code) return;
    let cancelled = false;
    recordClick(code)
      .then((result) => {
        if (cancelled || !result.valid || !result.offer) return;
        try {
          if (window.sessionStorage.getItem(SEEN_KEY) === result.offer.code) return;
        } catch {
          /* private mode: just show it */
        }
        setOffer(result.offer);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!offer) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, offer.code);
    } catch {
      /* ignore */
    }
    setOffer(null);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4" role="status">
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-black shadow-xl">
        <Gift className="mt-0.5 h-4 w-4 shrink-0 text-meta-500" aria-hidden />
        <p className="min-w-0 flex-1 leading-relaxed">
          Code <span className="font-semibold">{offer.code}</span> is saved for you: {offerLine(offer)}. It applies by
          itself when you sign up.
        </p>
        <button type="button" className="shrink-0 rounded-md p-0.5 hover:bg-black/5" aria-label="Dismiss" onClick={dismiss}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
