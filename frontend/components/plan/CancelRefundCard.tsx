"use client";

import clsx from "clsx";
import { CheckCircle2, Loader2, PauseCircle, PlayCircle, RotateCcw, Undo2, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  cancelSubscription,
  fetchRefunds,
  requestRefund,
  resumeSubscription,
  withdrawRefund,
  type RefundOverview,
  type RefundableOrder,
  type Subscription,
} from "@/lib/auth";
import { formatDate, formatMoney, formatTokens } from "@/lib/format";

interface CancelRefundCardProps {
  sub: Subscription;
  planLabels: Record<string, string>;
  /** Reload the plan page after a cancel or resume. */
  onChanged: () => Promise<void> | void;
}

const REQUEST_TONE: Record<string, { text: string; tone: string }> = {
  pending: { text: "Refund requested", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  approved: { text: "Refund approved", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  rejected: { text: "Refund declined", tone: "!border-red-300 !bg-red-50 !text-red-700" },
};

function orderTitle(order: RefundableOrder, labels: Record<string, string>, currency: string) {
  const plan = labels[order.plan_id] ?? order.plan_id;
  return order.kind === "subscription" ? `${plan} plan` : `${formatMoney(order.amount, currency)} top-up`;
}

/**
 * Account settings: cancel the plan (it stays usable until the paid period
 * ends) and ask for a refund on any paid plan or top-up, with the crypto
 * wallet the money should go back to.
 */
export function CancelRefundCard({ sub, planLabels, onChanged }: CancelRefundCardProps) {
  const current = sub.subscription;
  const [data, setData] = useState<RefundOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // cancel
  const [confirming, setConfirming] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // refund form
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [network, setNetwork] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchRefunds());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your payments.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = data?.currency ?? sub.currency;
  const placeholder = useMemo(
    () => data?.networks.find((n) => n.id === network)?.placeholder ?? "Pick a coin and network first",
    [data, network],
  );

  const doCancel = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelSubscription(cancelReason.trim());
      setConfirming(false);
      setCancelReason("");
      await onChanged();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "That change did not go through.");
    } finally {
      setCancelBusy(false);
    }
  };

  const doResume = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await resumeSubscription();
      await onChanged();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "That change did not go through.");
    } finally {
      setCancelBusy(false);
    }
  };

  const openForm = (orderId: string) => {
    setOpenFor(orderId);
    setReason("");
    setDetails("");
    setNetwork("");
    setAddress("");
    setFormError(null);
    setDone(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!openFor) return;
    if (!reason) return setFormError("Pick a reason.");
    if (!network) return setFormError("Pick the coin and network to be refunded on.");
    if (!address.trim()) return setFormError("Enter a refund address.");
    setBusy(true);
    setFormError(null);
    try {
      await requestRefund({ order_id: openFor, reason, details: details.trim(), network, address: address.trim() });
      setOpenFor(null);
      setDone("Request sent. We emailed you a copy and will answer by email, usually within 2 business days.");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: number) => {
    setBusy(true);
    try {
      await withdrawRefund(id);
      setDone(null);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not withdraw the request.");
    } finally {
      setBusy(false);
    }
  };

  const ruleText = data
    ? data.rules.enabled
      ? `You can ask within ${data.rules.window_days} day${data.rules.window_days === 1 ? "" : "s"} of a payment` +
        (data.rules.max_used_percent >= 100
          ? "."
          : data.rules.max_used_percent === 0
            ? ", before any of its tokens are used."
            : `, while at most ${data.rules.max_used_percent}% of its tokens are used.`)
      : "Refunds are handled by support. Write to us in the support chat."
    : "";

  return (
    <div className="space-y-6">
      {/* Cancel plan ------------------------------------------------------- */}
      <div>
        <p className="label">Your plan</p>
        {current?.active ? (
          current.cancelled ? (
            <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-50/70 p-3 text-sm">
              <p className="font-medium text-black">
                {current.plan_label} is cancelled. You can keep using the app until {formatDate(current.period_end)}.
              </p>
              <p className="mt-1 text-xs text-ink-muted">Nothing renews after that. Resume to keep rolling tokens over.</p>
              <button type="button" className="btn-primary mt-3 !py-2 !text-xs" disabled={cancelBusy} onClick={() => void doResume()}>
                {cancelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PlayCircle className="h-3.5 w-3.5" aria-hidden />}
                Resume plan
              </button>
            </div>
          ) : confirming ? (
            <div className="mt-2 rounded-xl border border-black/10 bg-white p-3 text-sm">
              <p className="font-medium text-black">Cancel your {current.plan_label} plan?</p>
              <p className="mt-1 text-xs text-ink-muted">
                You keep full access and your tokens until {formatDate(current.period_end)}. After that it does not renew, and
                unused plan tokens do not roll over.
              </p>
              <label className="mt-3 block">
                <span className="label">Why are you leaving? (optional)</span>
                <input
                  className="field mt-1"
                  maxLength={500}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="It helps us improve"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost !py-2 !text-xs !text-red-700" disabled={cancelBusy} onClick={() => void doCancel()}>
                  {cancelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <PauseCircle className="h-3.5 w-3.5" aria-hidden />}
                  Yes, cancel plan
                </button>
                <button type="button" className="btn-ghost !py-2 !text-xs" disabled={cancelBusy} onClick={() => setConfirming(false)}>
                  Keep my plan
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-black">
                {current.plan_label} · renews {formatDate(current.period_end)}
              </p>
              <button type="button" className="btn-ghost !py-2 !text-xs" onClick={() => setConfirming(true)}>
                <PauseCircle className="h-3.5 w-3.5" aria-hidden /> Cancel plan
              </button>
            </div>
          )
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No active plan to cancel.</p>
        )}
        {cancelError ? <p className="mt-2 text-xs text-red-700">{cancelError}</p> : null}
      </div>

      {/* Refunds ------------------------------------------------------------ */}
      <div>
        <p className="label">Refunds</p>
        {ruleText ? <p className="mt-1 text-xs text-ink-muted">{ruleText}</p> : null}
        {loadError ? <p className="mt-2 text-xs text-red-700">{loadError}</p> : null}
        {done ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {done}
          </p>
        ) : null}
        {!data ? (
          <p className="py-4 text-center text-xs text-ink-faint">
            <Loader2 className="inline h-3.5 w-3.5 animate-spin" aria-hidden />
          </p>
        ) : data.orders.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-faint">No payments yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/[0.06]">
            {data.orders.map((order) => {
              const request = order.request;
              const chip = order.status === "refunded" ? REQUEST_TONE.approved : request ? REQUEST_TONE[request.status] : undefined;
              return (
                <li key={order.order_id} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-black">{orderTitle(order, planLabels, currency)}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatMoney(order.amount, currency)} · {formatDate(order.paid_at)} · {formatTokens(order.tokens_used)} of{" "}
                        {formatTokens(order.tokens)} tokens used
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {chip ? <span className={clsx("chip !text-[10px]", chip.tone)}>{chip.text}</span> : null}
                      {order.can_request && openFor !== order.order_id ? (
                        <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => openForm(order.order_id)}>
                          <Undo2 className="h-3.5 w-3.5" aria-hidden /> Request refund
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {request?.status === "pending" ? (
                    <div className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-ink-muted">
                      Sent {formatDate(request.created_at)} · {request.reason_label} · refund to {request.network_label}{" "}
                      <span className="break-all font-mono text-black">{request.address}</span>
                      <button
                        type="button"
                        className="ml-2 font-semibold text-meta-600 hover:underline"
                        disabled={busy}
                        onClick={() => void withdraw(request.id)}
                      >
                        Withdraw
                      </button>
                    </div>
                  ) : null}
                  {request?.status === "rejected" && request.admin_note ? (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{request.admin_note}</p>
                  ) : null}
                  {!order.can_request && !request && order.status === "paid" && order.why_not ? (
                    <p className="mt-1 text-[11px] text-ink-faint">{order.why_not}</p>
                  ) : null}

                  {openFor === order.order_id ? (
                    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-black/10 bg-white p-3">
                      <label className="block">
                        <span className="label">Reason</span>
                        <select className="field mt-1" value={reason} onChange={(e) => setReason(e.target.value)} required>
                          <option value="">Pick a reason</option>
                          {data.reasons.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="label">More details (optional)</span>
                        <textarea
                          className="field mt-1 min-h-[64px]"
                          maxLength={1000}
                          value={details}
                          onChange={(e) => setDetails(e.target.value)}
                        />
                      </label>
                      <div>
                        <span className="label flex items-center gap-1.5">
                          <Wallet className="h-3 w-3" aria-hidden /> Refund to
                        </span>
                        <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {data.networks.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => setNetwork(n.id)}
                              aria-pressed={network === n.id}
                              className={clsx(
                                "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                                network === n.id
                                  ? "border-meta-500 bg-meta-50 text-meta-700"
                                  : "border-black/10 text-black hover:border-meta-400",
                              )}
                            >
                              {n.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="block">
                        <span className="label">Refund address</span>
                        <input
                          className={clsx("field mt-1 font-mono", formError && !address.trim() ? "!border-red-400" : "")}
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder={placeholder}
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={120}
                          required
                        />
                        <span className="mt-1 block text-[11px] text-ink-faint">
                          Double-check it: crypto sent to a wrong address or network cannot be recovered.
                        </span>
                      </label>
                      {formError ? <p className="text-xs text-red-700">{formError}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" className="btn-primary !py-2 !text-xs" disabled={busy}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                          Send refund request
                        </button>
                        <button type="button" className="btn-ghost !py-2 !text-xs" disabled={busy} onClick={() => setOpenFor(null)}>
                          Never mind
                        </button>
                      </div>
                      <p className="text-[11px] text-ink-faint">
                        If it is approved, the tokens from this payment are taken off your account
                        {order.kind === "subscription" ? " and the plan it paid for ends" : ""}.
                      </p>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CancelRefundCard;
