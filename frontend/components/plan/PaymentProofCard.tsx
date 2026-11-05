"use client";

import clsx from "clsx";
import { CheckCircle2, ImageUp, Loader2, Search, Send } from "lucide-react";
import { useEffect, useState } from "react";

import type { Order } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { checkPayment, fetchMyProofs, sendPaymentProof, type PaymentProof } from "@/lib/payments";

interface PaymentProofCardProps {
  orders: Order[];
  currency: string;
  planLabels: Record<string, string>;
  /** Called when a check finds the payment confirmed, so the page reloads the plan. */
  onActivated: () => void;
}

const PROOF_STATUS: Record<PaymentProof["status"], { text: string; tone: string }> = {
  pending: { text: "Being checked", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  matched: { text: "Payment confirmed", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  approved: { text: "Approved", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  rejected: { text: "Not accepted", tone: "!border-red-300 !bg-red-50 !text-red-700" },
};

/**
 * "I paid" panel: check a payment by its transaction id (instant when the
 * provider has confirmed it), or send the transaction id with a screenshot
 * for the team to approve when it has not.
 */
export default function PaymentProofCard({ orders, currency, planLabels, onActivated }: PaymentProofCardProps) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);

  const open = orders.filter((order) => order.status !== "paid");
  const [orderId, setOrderId] = useState("");
  const [txId, setTxId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);

  useEffect(() => {
    fetchMyProofs().then(setProofs).catch(() => setProofs([]));
  }, []);

  useEffect(() => {
    if (!orderId && open.length > 0) setOrderId(open[0].id);
  }, [open, orderId]);

  const runCheck = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    setCheck(null);
    try {
      const result = await checkPayment(code.trim());
      setCheck({ ok: result.paid, text: result.message });
      if (result.paid) onActivated();
    } catch (err) {
      setCheck({ ok: false, text: err instanceof Error ? err.message : "Could not check that payment." });
    } finally {
      setChecking(false);
    }
  };

  const sendProof = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderId || !txId.trim() || !file) return;
    setSending(true);
    setSendMsg(null);
    try {
      const proof = await sendPaymentProof(orderId, txId.trim(), file);
      setProofs((rows) => [proof, ...rows]);
      setTxId("");
      setFile(null);
      if (proof.status === "matched") {
        setSendMsg({ ok: true, text: "This payment is already confirmed. Your plan is active." });
        onActivated();
      } else {
        setSendMsg({
          ok: true,
          text: "Thanks! Your proof was sent. Your plan turns on as soon as the payment is confirmed.",
        });
      }
    } catch (err) {
      setSendMsg({ ok: false, text: err instanceof Error ? err.message : "Could not send the proof." });
    } finally {
      setSending(false);
    }
  };

  const orderLabel = (order: Order) =>
    `${order.kind === "subscription" ? `${planLabels[order.plan_id] ?? order.plan_id} period` : "Top-up"} · ${formatMoney(order.amount, currency)} · ${formatDate(order.created_at)}`;

  return (
    <div className="space-y-6">
      <form onSubmit={runCheck} className="space-y-2">
        <label className="block">
          <span className="label">Check my payment</span>
          <span className="mt-0.5 block text-xs text-ink-subtle">
            Paste the transaction id from your payment receipt, or your order id.
          </span>
          <div className="mt-2 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={160}
              placeholder="Transaction id"
              className="field min-w-0 flex-1"
              autoComplete="off"
            />
            <button type="submit" className="btn-ghost shrink-0" disabled={checking || !code.trim()}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              Check
            </button>
          </div>
        </label>
        {check ? (
          <p className={clsx("flex items-start gap-1.5 text-xs", check.ok ? "text-emerald-700" : "text-ink-muted")}>
            {check.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            {check.text}
          </p>
        ) : null}
      </form>

      {open.length > 0 ? (
        <form onSubmit={sendProof} className="space-y-3 border-t border-black/[0.06] pt-5">
          <div>
            <span className="label">I paid: send proof</span>
            <span className="mt-0.5 block text-xs text-ink-subtle">
              Paid but your plan is not on yet? Send the transaction id and a screenshot of the payment.
            </span>
          </div>
          <label className="block">
            <span className="text-xs text-ink-muted">Order</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="field mt-1">
              {open.map((order) => (
                <option key={order.id} value={order.id}>
                  {orderLabel(order)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Transaction id</span>
            <input
              value={txId}
              onChange={(e) => setTxId(e.target.value)}
              maxLength={160}
              className="field mt-1"
              autoComplete="off"
              required
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-black/15 px-3 py-3 text-xs text-ink-muted hover:border-meta-400">
            <ImageUp className="h-4 w-4 text-meta-500" aria-hidden />
            <span className="truncate">{file ? file.name : "Choose screenshot (PNG, JPG or WEBP, up to 10 MB)"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" className="btn-primary w-full" disabled={sending || !orderId || !txId.trim() || !file}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Send proof
          </button>
          {sendMsg ? (
            <p className={clsx("text-xs", sendMsg.ok ? "text-emerald-700" : "text-red-700")}>{sendMsg.text}</p>
          ) : null}
        </form>
      ) : null}

      {proofs.length > 0 ? (
        <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
          {proofs.slice(0, 5).map((proof) => {
            const tone = PROOF_STATUS[proof.status] ?? PROOF_STATUS.pending;
            return (
              <li key={proof.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-black">Proof · {proof.transaction_id}</p>
                  <p className="text-ink-subtle">
                    {formatDate(proof.created_at)}
                    {proof.admin_note ? ` · ${proof.admin_note}` : ""}
                  </p>
                </div>
                <span className={clsx("chip shrink-0 !text-[10px]", tone.tone)}>{tone.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
