"use client";

import clsx from "clsx";
import { CheckCircle2, Copy, CreditCard, ImageUp, Loader2, ScanSearch, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  paymentProofUrl,
  uploadPaymentProof,
  verifyTransaction,
  type Order,
  type VerifyResult,
} from "@/lib/auth";
import { formatMoney, formatTokens } from "@/lib/format";
import { paymentProviderName } from "@/lib/types";

interface CheckoutPanelProps {
  order: Order;
  planLabel: string;
  currency: string;
  /** True while the page is waiting for the provider to confirm this order. */
  waiting?: boolean;
  onClose: () => void;
  /** The order changed (screenshot uploaded, or found paid). */
  onChanged: (order: Order) => void;
  /** The payment is confirmed: the plan is on. */
  onActivated: (order: Order) => void;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * The checkout: the order's transaction ID, the pay button, the payment
 * screenshot upload and the "check my payment" button, in that order.
 */
export default function CheckoutPanel({
  order,
  planLabel,
  currency,
  waiting = false,
  onClose,
  onChanged,
  onActivated,
}: CheckoutPanelProps) {
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [proofVersion, setProofVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const paid = order.status === "paid";
  const what = order.kind === "subscription" ? `${planLabel} plan` : `${formatMoney(order.amount, currency)} top-up`;
  const providerName = paymentProviderName(order.provider) || "the payment page";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = useCallback(async () => {
    if (!order.ref_code) return;
    try {
      await navigator.clipboard.writeText(order.ref_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the code is selectable as text anyway */
    }
  }, [order.ref_code]);

  const pick = (picked: File | null) => {
    setUploadError(null);
    if (!picked) return setFile(null);
    if (!ACCEPT.split(",").includes(picked.type)) {
      setUploadError("Use a PNG, JPG or WEBP screenshot.");
      return setFile(null);
    }
    if (picked.size > MAX_BYTES) {
      setUploadError("The screenshot must be 8 MB or smaller.");
      return setFile(null);
    }
    setFile(picked);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const updated = await uploadPaymentProof(order.id, file, note);
      setFile(null);
      setNote("");
      if (fileInput.current) fileInput.current.value = "";
      setProofVersion((v) => v + 1);
      onChanged(updated);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload the screenshot.");
    } finally {
      setUploading(false);
    }
  };

  const verify = async () => {
    if (!order.ref_code) return;
    setChecking(true);
    setCheckError(null);
    try {
      const result = await verifyTransaction(order.ref_code);
      setCheck(result);
      if (result.order) onChanged(result.order);
      if ((result.outcome === "activated" || result.outcome === "already_used") && result.order) {
        onActivated(result.order);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not check the payment.");
    } finally {
      setChecking(false);
    }
  };

  const checkTone =
    check?.outcome === "activated" || check?.outcome === "already_used"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : check?.outcome === "not_found" || check?.outcome === "rejected" || check?.outcome === "not_paid"
        ? "border-red-300 bg-red-50 text-red-800"
        : "border-meta-500/30 bg-meta-50 text-meta-900";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <button type="button" aria-label="Close checkout" className="absolute inset-0 cursor-default" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-black/10 bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="label">Checkout</p>
            <h2 id="checkout-title" className="font-display text-3xl leading-tight text-black">
              {what}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {formatMoney(order.amount, currency)} · {formatTokens(order.tokens)} tokens
            </p>
          </div>
          <button type="button" className="rounded-lg p-1.5 hover:bg-black/5" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Transaction ID ------------------------------------------------- */}
        <div className="mb-5 rounded-2xl border border-meta-500/25 bg-meta-50/60 p-4">
          <p className="text-xs font-medium text-meta-900">Your transaction ID</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate font-mono text-xl font-semibold tracking-wider text-black sm:text-2xl">
              {order.ref_code ?? "—"}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!order.ref_code}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-meta-500/30 bg-white px-3 py-1.5 text-xs font-semibold text-meta-700 hover:bg-meta-50"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Keep this ID. After paying, paste it to the support bot or press &ldquo;Check my payment&rdquo; below.
          </p>
        </div>

        {paid ? (
          <p className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Paid. This order is active on your account.
          </p>
        ) : (
          <ol className="space-y-4">
            {/* 1. Pay -------------------------------------------------------- */}
            <li className="rounded-2xl border border-black/10 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black text-[11px] text-white">1</span>
                Pay
              </p>
              {waiting ? (
                <p className="mb-3 flex items-center gap-2 text-xs text-meta-800">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for {providerName} to confirm your
                  payment…
                </p>
              ) : null}
              {order.checkout_url && order.status === "pending" ? (
                <a href={order.checkout_url} className="btn-primary inline-flex w-full items-center justify-center gap-2">
                  <CreditCard className="h-4 w-4" aria-hidden />
                  Pay {formatMoney(order.amount, currency)} with {providerName}
                </a>
              ) : (
                <p className="text-xs text-ink-muted">This order is closed for payment. Start a new checkout from the plans.</p>
              )}
            </li>

            {/* 2. Screenshot -------------------------------------------------- */}
            <li className="rounded-2xl border border-black/10 p-4">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-black">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black text-[11px] text-white">2</span>
                Upload your payment screenshot
              </p>
              <p className="mb-3 text-xs text-ink-muted">
                Only needed if your plan isn&rsquo;t on a few minutes after paying. Our team checks it and turns the plan on.
              </p>

              {order.has_proof ? (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-black/10 bg-black/[0.02] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${paymentProofUrl(order.id)}?v=${proofVersion}`}
                    alt="Your payment screenshot"
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                  <p className="min-w-0 text-xs leading-relaxed">
                    {order.review_status === "rejected" ? (
                      <span className="text-red-700">
                        Our team couldn&rsquo;t match this screenshot to a payment
                        {order.review_note ? ` (${order.review_note})` : ""}. Upload a clearer one.
                      </span>
                    ) : order.review_status === "approved" ? (
                      <span className="text-emerald-700">Approved.</span>
                    ) : (
                      <span className="text-meta-900">Received. Our team is checking it.</span>
                    )}
                  </p>
                </div>
              ) : null}

              <label
                className={clsx(
                  "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-xs transition-colors",
                  file ? "border-meta-500/50 bg-meta-50/50" : "border-black/15 hover:border-meta-500/50",
                )}
              >
                <ImageUp className="h-5 w-5 shrink-0 text-meta-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {file ? file.name : order.has_proof ? "Replace the screenshot (PNG, JPG, WEBP)" : "Choose a screenshot (PNG, JPG, WEBP, up to 8 MB)"}
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(event) => pick(event.target.files?.[0] ?? null)}
                />
              </label>
              {file ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Note (optional): wallet, time of payment…"
                    className="field min-w-0 flex-1 !py-2 !text-xs"
                  />
                  <button type="button" onClick={() => void upload()} disabled={uploading} className="btn-primary !py-2 !text-xs">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    Send screenshot
                  </button>
                </div>
              ) : null}
              {uploadError ? <p className="mt-2 text-xs text-red-700">{uploadError}</p> : null}
            </li>

            {/* 3. Check ------------------------------------------------------- */}
            <li className="rounded-2xl border border-black/10 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-black">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-black text-[11px] text-white">3</span>
                Check my payment
              </p>
              <button
                type="button"
                onClick={() => void verify()}
                disabled={checking || !order.ref_code}
                className="btn-ghost inline-flex w-full items-center justify-center gap-2"
              >
                {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ScanSearch className="h-4 w-4" aria-hidden />}
                I paid, check {order.ref_code ?? "my payment"}
              </button>
              {check ? (
                <p role="status" className={clsx("mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed", checkTone)}>
                  {check.message}
                </p>
              ) : null}
              {checkError ? <p className="mt-2 text-xs text-red-700">{checkError}</p> : null}
            </li>
          </ol>
        )}

        <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Your plan turns on by itself the moment {providerName} confirms the payment. A screenshot is checked by our team
          before anything is activated.
        </p>
      </section>
    </div>
  );
}
