"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import Header from "@/components/Header";
import NeonCard from "@/components/NeonCard";
import {
  fetchMe,
  fetchUsdtPayment,
  sendUsdtTxid,
  usdtQrUrl,
  type TxidCheck,
  type UsdtPayment,
  type UserProfile,
} from "@/lib/auth";
import { formatTokens } from "@/lib/format";

/** How often the page asks whether the payment arrived (the server checks the blockchain at most every 15 s). */
const POLL_MS = 8000;

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the value stays selectable */
    }
  };
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={clsx(
            "min-w-0 flex-1 select-all break-all font-mono text-black dark:text-slate-100",
            big ? "text-2xl font-semibold" : "text-sm",
          )}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-ink-muted hover:bg-meta-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-meta-500/10"
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function PayPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id ?? "";
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [payment, setPayment] = useState<UsdtPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState("");
  const [txidBusy, setTxidBusy] = useState(false);
  const [txidReply, setTxidReply] = useState<TxidCheck | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchUsdtPayment(orderId);
      setPayment(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this payment.");
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    void fetchMe().then((me) => {
      if (!me) router.replace(`/login?next=${encodeURIComponent(`/app/pay/${orderId}`)}`);
      else setUser(me);
    });
  }, [orderId, router]);

  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    const tick = async () => {
      const next = await load();
      if (stopped) return;
      if (!next || next.status === "pending") timer.current = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [orderId, load]);

  const submitTxid = async () => {
    setTxidBusy(true);
    setTxidReply(null);
    try {
      const reply = await sendUsdtTxid(orderId, txid.trim());
      setTxidReply(reply);
      if (reply.status !== "pending") void load();
    } catch (err) {
      setTxidReply({ result: "not_found", message: err instanceof Error ? err.message : "Could not check it.", status: "pending" });
    } finally {
      setTxidBusy(false);
    }
  };

  const paid = payment?.status === "paid";
  const closed = payment && payment.status !== "pending" && !paid;
  const expired = payment ? new Date(payment.expires_at).getTime() < Date.now() && payment.status === "pending" : false;
  const what = payment ? (payment.kind === "subscription" ? `${payment.plan_label} plan` : `Top-up on ${payment.plan_label}`) : "";

  return (
    <>
      <Header user={user} />
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6 sm:pt-10">
        <p className="label">Checkout</p>
        <h1 className="font-display text-4xl font-normal leading-tight text-black dark:text-slate-100">Pay with USDT</h1>

        {error && !payment ? (
          <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : !payment ? (
          <div className="grid place-items-center py-24 text-ink-faint">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        ) : paid ? (
          <NeonCard padding="lg" radius="xl" className="mt-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold text-black dark:text-slate-100">Payment received</h2>
            <p className="mt-1 text-sm text-ink-muted dark:text-slate-300">
              Your {what} is active: {formatTokens(payment.tokens)} tokens were added.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/app" className="btn-primary">
                Start rendering
              </Link>
              <Link href={`/app/plan?order=${payment.order_id}`} className="btn-ghost">
                See my plan
              </Link>
            </div>
          </NeonCard>
        ) : closed ? (
          <NeonCard padding="lg" radius="xl" className="mt-6">
            <p className="text-sm text-ink-muted dark:text-slate-300">
              This order is closed. <Link href="/app/plan" className="font-semibold text-meta-600 underline">Start a new checkout</Link>.
            </p>
          </NeonCard>
        ) : (
          <>
            <NeonCard padding="lg" radius="xl" className="mt-6">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-black dark:text-slate-100">{what}</p>
                <p className="text-sm text-ink-muted dark:text-slate-300">{formatTokens(payment.tokens)} tokens</p>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={usdtQrUrl(payment.order_id)}
                  alt="QR code of the USDT address"
                  width={168}
                  height={168}
                  className="mx-auto h-[168px] w-[168px] rounded-xl border border-black/10 bg-white p-1"
                />
                <div className="min-w-0 space-y-3">
                  <CopyRow label="Send exactly" value={`${payment.pay_amount} USDT`} big />
                  <CopyRow label={`To this address · ${payment.network}`} value={payment.address} />
                </div>
              </div>

              <div className="mt-4 flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <p>
                  Send <strong>exactly {payment.pay_amount} USDT</strong> on the <strong>TRON (TRC-20)</strong> network. The
                  cents identify your order, so a different amount can&apos;t be matched by itself. If your exchange takes a
                  fee, add it on top so {payment.pay_amount} arrives.
                </p>
              </div>

              <div
                className={clsx(
                  "mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
                  expired ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-meta-50 text-meta-700 dark:bg-meta-500/10 dark:text-meta-200",
                )}
              >
                {expired ? (
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                )}
                <span>
                  {expired
                    ? "This payment window has closed. If you already paid, give your transaction ID below; otherwise start a new checkout."
                    : "Waiting for your payment. This page updates by itself and activates your plan as soon as the transfer is confirmed (usually 1 to 3 minutes)."}
                </span>
              </div>
            </NeonCard>

            <NeonCard padding="lg" radius="xl" tone="muted" className="mt-4">
              <p className="text-sm font-semibold text-black dark:text-slate-100">Already paid and still waiting?</p>
              <p className="mt-0.5 text-xs text-ink-faint dark:text-slate-500">
                Paste the transaction ID (TxID / hash) from your wallet or exchange and we&apos;ll look it up.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={txid}
                  onChange={(e) => setTxid(e.target.value)}
                  placeholder="e.g. 7c1f…e9a2 (64 characters)"
                  spellCheck={false}
                  className="field min-w-0 flex-1 font-mono text-xs"
                  aria-label="Transaction ID"
                />
                <button
                  type="button"
                  onClick={() => void submitTxid()}
                  disabled={txidBusy || !/^(0x)?[0-9a-fA-F]{64}$/.test(txid.trim())}
                  className="btn-primary shrink-0 disabled:opacity-60"
                >
                  {txidBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Check"}
                </button>
              </div>
              {txidReply ? (
                <p
                  className={clsx(
                    "mt-2 text-xs",
                    txidReply.result === "paid" ? "text-emerald-700 dark:text-emerald-300" : "text-ink-muted dark:text-slate-300",
                  )}
                >
                  {txidReply.message}
                </p>
              ) : null}
            </NeonCard>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-faint dark:text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Checked on the TRON blockchain. Questions? Use Live Support.
            </p>
          </>
        )}
      </main>
    </>
  );
}
