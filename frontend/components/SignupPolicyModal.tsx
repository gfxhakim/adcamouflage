"use client";

import { ArrowRight, CheckCircle2, Coins, Layers, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface SignupPolicyModalProps {
  open: boolean;
  /** Whether clicking confirm will trigger Google OAuth vs email password registration, or just review/accept. */
  actionLabel: string;
  requireCheck?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function SignupPolicyModal({
  open,
  actionLabel,
  requireCheck = true,
  onClose,
  onConfirm,
}: SignupPolicyModalProps) {
  const [checked, setChecked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setChecked(false);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-policy-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.08] px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-meta-600">
              Before you create your account
            </p>
            <h3 id="signup-policy-title" className="mt-0.5 text-lg font-semibold tracking-tight text-black">
              How ProteusFlow works, Conditions &amp; Refund Policy
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close policy dialog"
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-black"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5 text-xs leading-relaxed text-ink-muted">
          <section className="rounded-xl border border-black/[0.08] bg-neutral-50/80 p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-black">
              <Layers className="h-4 w-4 text-meta-500" aria-hidden />
              How ProteusFlow works
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-neutral-700">
              <li>
                ProteusFlow uses its multi-layer AI engine to rebuild aggressive or rejected video ads across visual
                frames, Rec.709 color, −14 LUFS audio, clean metadata, and brand overlays so platforms accept them and
                they convert better.
              </li>
              <li>
                Every new account includes <b className="text-black">3 free generations</b> to test the studio right away
                — after that, activate a 30-day plan (Starter, Pro, or Max) to keep rendering at full volume.
              </li>
              <li>
                If any render fails on our servers, those tokens are automatically credited back to your account.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-black/[0.08] bg-neutral-50/80 p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-black">
              <ShieldCheck className="h-4 w-4 text-meta-500" aria-hidden />
              Account &amp; usage conditions
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-neutral-700">
              <li>
                Use only assets you own or have rights to edit, and ensure your campaigns follow Meta, TikTok, YouTube,
                and Google ad policies.
              </li>
              <li>
                Accounts and plan tokens are for authorized single-owner or plan team-seat usage (no resale or abuse).
              </li>
              <li>You can cancel renewal anytime from Account settings without losing remaining period access.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-meta-500/30 bg-meta-50/70 p-3.5">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-meta-700">
              <Coins className="h-4 w-4 text-meta-600" aria-hidden />
              Refund policy — remaining unused tokens only
            </h4>
            <p className="mt-1.5 text-neutral-800">
              Refunds apply <b>only for the remaining, unused tokens currently available in your account</b> from an
              eligible payment (<code className="rounded bg-white px-1 py-0.5 text-[11px]">Paid × Remaining Tokens ÷ Total Order Tokens</code>).
            </p>
            <p className="mt-1.5 text-neutral-700">
              Tokens already used for exports are non-refundable, and once 0 unused tokens remain, no refund is due.
              Submitting a refund request stops renewal and pauses your account immediately during review.
            </p>
          </section>

          <p className="text-[11px] text-ink-subtle">
            Full details:{" "}
            <Link href="/refund-policy" target="_blank" className="font-medium text-meta-600 underline">
              Refund Policy
            </Link>{" "}
            ·{" "}
            <Link href="/terms" target="_blank" className="font-medium text-meta-600 underline">
              Terms of Service
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-meta-600 underline">
              Privacy Policy
            </Link>
          </p>
        </div>

        <div className="shrink-0 border-t border-black/[0.08] bg-neutral-50/60 px-5 py-3.5 sm:px-6 sm:py-4">
          {requireCheck ? (
            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-black">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-meta-500"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                autoFocus
              />
              <span>
                I understand how ProteusFlow works, accept the Conditions, and agree that any refund applies{" "}
                <b>only to remaining unused tokens available in my account</b>.
              </span>
            </label>
          ) : null}

          <div className={requireCheck ? "mt-3.5 flex flex-wrap items-center justify-end gap-2 sm:mt-4" : "flex flex-wrap items-center justify-end gap-2"}>
            {requireCheck ? (
              <button type="button" className="btn-ghost !py-2 !text-xs" onClick={onClose}>
                Go back
              </button>
            ) : null}
            <button
              type="button"
              disabled={requireCheck && !checked}
              onClick={onConfirm}
              className="btn-primary !py-2.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
