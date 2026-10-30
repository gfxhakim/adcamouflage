"use client";

import clsx from "clsx";
import {
  CalendarDays,
  CheckCircle2,
  Coins,
  Crown,
  FileStack,
  History,
  Layers3,
  LineChart,
  Loader2,
  Receipt,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import Header from "@/components/Header";
import DeckRail from "@/components/DeckRail";
import NeonCard from "@/components/NeonCard";
import BillingAlerts from "@/components/plan/BillingAlerts";
import LegacyHero from "@/components/plan/LegacyHero";
import MonthlyBars from "@/components/plan/MonthlyBars";
import OrderHistory from "@/components/plan/OrderHistory";
import PasswordCard from "@/components/plan/PasswordCard";
import PlanOptions from "@/components/plan/PlanOptions";
import TokenHero from "@/components/plan/TokenHero";
import TokenPlanCards from "@/components/plan/TokenPlanCards";
import TopupPicker from "@/components/plan/TopupPicker";
import TrustPanel from "@/components/plan/TrustPanel";
import SeriesChart from "@/components/SeriesChart";
import StatTile from "@/components/StatTile";
import {
  fetchMe,
  fetchMyBatches,
  fetchOrder,
  fetchOrders,
  fetchSubscription,
  signOut,
  startCheckout,
  type BatchSummary,
  type Order,
  type OrderKind,
  type PaymentProviderId,
  type Subscription,
  type UserProfile,
} from "@/lib/auth";
import { formatDate, formatTokens, timeAgo } from "@/lib/format";
import type { TokenPlanCard } from "@/lib/types";

/** After the payment provider sends the browser back, ask about the order this often, for this long. */
const ORDER_POLL_MS = 3000;
const ORDER_POLL_LIMIT_MS = 120_000;

interface Toast {
  tone: "success" | "info" | "error";
  text: string;
}

function presetName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function PlanPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** The plan id or "topup" whose checkout is being created. */
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [waitingOrder, setWaitingOrder] = useState<string | null>(null);
  /** The payment method the user picked; the first one the server offers until then. */
  const [pickedProvider, setPickedProvider] = useState<PaymentProviderId | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Plan labels for the settlement toast, which runs outside the render.
  const labelsRef = useRef<Record<string, string>>({});
  /**
   * What the payment provider's return link said, read once. The query is
   * dropped as soon as it is read, and in development React's StrictMode runs
   * the effect below twice, so the second run takes it from here instead of
   * finding an empty query and leaving the "waiting" state without a poll.
   */
  const returned = useRef<{ orderId: string | null; backedOut: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, subscription, history, orderList] = await Promise.all([
        fetchMe(),
        fetchSubscription(),
        fetchMyBatches(),
        fetchOrders().catch(() => [] as Order[]),
      ]);
      // Same recovery as the workspace: a cookie the API rejects is cleared first.
      if (!profile || !subscription) {
        await signOut().catch(() => undefined);
        window.location.assign("/");
        return;
      }
      setUser(profile);
      setSub(subscription);
      setBatches(history.slice(0, 8));
      setOrders(orderList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your plan.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- back from the payment provider: wait for the order to settle ---------
  useEffect(() => {
    if (returned.current === null) {
      const params = new URLSearchParams(window.location.search);
      returned.current = { orderId: params.get("order"), backedOut: params.get("cancelled") === "1" };
      if (returned.current.orderId || returned.current.backedOut) {
        // Drop the query so a reload does not start another wait.
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    const { orderId, backedOut } = returned.current;
    if (!orderId && !backedOut) return;
    if (backedOut || !orderId) {
      // The provider's "fail" link: the customer backed out, so there is nothing to poll.
      setToast({ tone: "error", text: "Payment cancelled — nothing was charged." });
      return;
    }
    setWaitingOrder(orderId);
    setToast({ tone: "info", text: "Waiting for your payment to be confirmed…" });

    let cancelled = false;
    const startedAt = Date.now();

    const check = async () => {
      if (cancelled) return;
      try {
        const order = await fetchOrder(orderId);
        if (cancelled) return;
        if (order.status === "paid") {
          setWaitingOrder(null);
          setToast({
            tone: "success",
            text:
              order.kind === "subscription"
                ? `Payment received. Your ${labelsRef.current[order.plan_id] ?? order.plan_id} period is active and ${formatTokens(order.tokens)} tokens were added.`
                : `Payment received. ${formatTokens(order.tokens)} top-up tokens were added.`,
          });
          await load();
          return;
        }
        if (order.status === "expired" || order.status === "invalid") {
          setWaitingOrder(null);
          setToast({
            tone: "error",
            text:
              order.status === "expired"
                ? "The invoice expired before it was paid. Nothing was charged; start again when you are ready."
                : "This payment was marked as invalid. If you did pay, contact support with the order id.",
          });
          await load();
          return;
        }
      } catch {
        /* A failed poll is retried on the next tick. */
      }
      if (Date.now() - startedAt >= ORDER_POLL_LIMIT_MS) {
        setWaitingOrder(null);
        setToast({
          tone: "info",
          text: "Still waiting for the network to confirm your payment. It will show here as soon as it does; you can leave this page.",
        });
        await load();
        return;
      }
      pollTimer.current = setTimeout(() => void check(), ORDER_POLL_MS);
    };

    void check();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [load]);

  // --- payment method ------------------------------------------------------
  const providers = sub?.payment_providers ?? [];
  const provider = providers.find((p) => p.id === pickedProvider)?.id ?? providers[0]?.id;

  // --- checkout ------------------------------------------------------------
  const buy = useCallback(
    async (kind: OrderKind, choice: { plan_id?: string; amount?: number }, key: string) => {
      setCheckoutBusy(key);
      setToast(null);
      try {
        const checkout = await startCheckout(kind, choice, provider);
        window.location.assign(checkout.checkout_url);
      } catch (err) {
        setToast({ tone: "error", text: err instanceof Error ? err.message : "Could not start the checkout." });
        setCheckoutBusy(null);
      }
    },
    [provider],
  );

  const buyPlan = useCallback((plan: TokenPlanCard) => void buy("subscription", { plan_id: plan.id }, plan.id), [buy]);
  const buyTopup = useCallback((amount: number) => void buy("topup", { amount }, "topup"), [buy]);

  // --- derived -------------------------------------------------------------
  const quota = sub?.monthly_quota ?? null;
  const isTokens = sub?.billing_mode === "tokens";
  const planLabels = Object.fromEntries((sub?.token_plans ?? []).map((p) => [p.id, p.label]));
  labelsRef.current = planLabels;

  return (
    <>
      <Header user={user} />

      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <DeckRail onDark={false} user={user} />

        <main className="relative min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label">My plan</p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black sm:text-5xl">Plan &amp; tokens</h1>
            <p className="max-w-2xl text-sm text-ink-muted">
              Everything about your subscription in one place: what you pay, the tokens you have, what each
              generation costs, and when the period ends.
            </p>
          </section>

          {error ? (
            <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          ) : null}

          {toast ? (
            <div
              role={toast.tone === "error" ? "alert" : "status"}
              className={clsx(
                "mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed",
                toast.tone === "success"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : toast.tone === "error"
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-meta-500/30 bg-meta-50 text-meta-900",
              )}
            >
              {waitingOrder ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-meta-600" aria-hidden />
              ) : toast.tone === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1">{toast.text}</span>
              {!waitingOrder ? (
                <button type="button" className="shrink-0 rounded-md p-0.5 hover:bg-black/5" aria-label="Dismiss" onClick={() => setToast(null)}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}

          {!sub ? (
            <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-2xl bg-black/[0.04]" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <BillingAlerts alerts={sub.alerts} />

              {/* Hero ------------------------------------------------------- */}
              {isTokens ? <TokenHero sub={sub} onChanged={load} /> : <LegacyHero sub={sub} />}

              {/* Plans ------------------------------------------------------ */}
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Crown className="h-4 w-4 text-meta-500" aria-hidden />
                  <h2 className="text-sm font-semibold tracking-tight text-black">
                    {isTokens ? "Plans" : "Token plans"}
                  </h2>
                  {!isTokens ? (
                    <span className="chip ml-auto !text-[10px]">Subscribing moves your account to token billing</span>
                  ) : null}
                </div>
                {providers.length > 1 ? (
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-medium text-ink-muted">Pay with</span>
                    <div className="flex gap-1 rounded-xl border border-black/10 bg-white p-1" role="group" aria-label="Payment method">
                      {providers.map((option) => {
                        const selected = option.id === provider;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            disabled={checkoutBusy !== null}
                            onClick={() => setPickedProvider(option.id)}
                            className={clsx(
                              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/70 disabled:cursor-not-allowed disabled:opacity-50",
                              selected ? "bg-meta-500 text-white" : "text-ink-muted hover:bg-meta-50 hover:text-meta-700",
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-[11px] text-ink-faint">Applies to plans and top-ups.</span>
                  </div>
                ) : null}
                <TokenPlanCards
                  plans={sub.token_plans}
                  current={isTokens ? sub.subscription : null}
                  currency={sub.currency}
                  paymentsEnabled={sub.payments_enabled}
                  busy={checkoutBusy}
                  onBuy={buyPlan}
                />
              </section>

              {/* Top-ups ---------------------------------------------------- */}
              {isTokens ? (
                <NeonCard padding="lg" radius="xl">
                  <div className="mb-4 flex items-center gap-2">
                    <Coins className="h-4 w-4 text-meta-500" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">Top up tokens</h2>
                    {sub.subscription ? (
                      <span className="chip ml-auto !text-[10px]">{sub.subscription.plan_label} rate</span>
                    ) : null}
                  </div>
                  <TopupPicker
                    topups={sub.topups}
                    current={sub.subscription}
                    currency={sub.currency}
                    paymentsEnabled={sub.payments_enabled}
                    busy={checkoutBusy === "topup"}
                    onBuy={buyTopup}
                  />
                </NeonCard>
              ) : null}

              {/* Totals ----------------------------------------------------- */}
              <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatTile
                  icon={FileStack}
                  label="All-time files"
                  value={sub.files_total.toLocaleString()}
                  hint={`since ${formatDate(sub.member_since)}`}
                />
                <StatTile
                  icon={Layers3}
                  label="Batches run"
                  value={sub.batches_total.toLocaleString()}
                  hint={
                    sub.batches_total
                      ? `${(sub.files_total / sub.batches_total).toFixed(1)} files per batch`
                      : "none yet"
                  }
                  tone="slow"
                  accent="text-meta-600"
                />
                <StatTile
                  icon={Sparkles}
                  label="Favourite preset"
                  value={sub.favourite_preset ? presetName(sub.favourite_preset) : "—"}
                  hint="most used"
                  accent="text-meta-600"
                />
                <StatTile
                  icon={ShieldCheck}
                  label="Auto-delete"
                  value={`${sub.retention_hours} h`}
                  hint="files never kept longer"
                  tone="success"
                  accent="text-meta-600"
                />
              </section>

              {/* Analytics -------------------------------------------------- */}
              <section className="grid gap-6 lg:grid-cols-2">
                <NeonCard padding="lg" radius="xl">
                  <div className="mb-4 flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-meta-500" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">Files per day</h2>
                    <span className="chip ml-auto !text-[10px]">last 30 days</span>
                  </div>
                  <SeriesChart points={sub.daily} unit="files" height={140} />
                </NeonCard>

                <NeonCard tone="slow" padding="lg" radius="xl">
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-meta-600" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">Monthly usage</h2>
                    <span className="chip ml-auto !text-[10px]">
                      {isTokens || quota === null ? "6 months" : `line = ${quota} limit`}
                    </span>
                  </div>
                  <MonthlyBars months={sub.monthly} quota={isTokens ? null : quota} />
                </NeonCard>
              </section>

              {/* Older plans, for accounts our team still manages by hand ---- */}
              {!isTokens ? (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <History className="h-4 w-4 text-meta-500" aria-hidden />
                    <h2 className="text-sm font-semibold tracking-tight text-black">Older plans (handled by our team)</h2>
                  </div>
                  <PlanOptions
                    plans={sub.plans}
                    currentId={sub.plan.id}
                    expired={sub.plan_expired}
                    currency={sub.currency}
                    pending={sub.pending_request}
                    onRequested={(request) => setSub({ ...sub, pending_request: request })}
                  />
                </section>
              ) : null}

              {/* Orders, trust, account and history -------------------------- */}
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
                <div className="space-y-6">
                  <NeonCard padding="lg" radius="xl">
                    <div className="mb-4 flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-meta-500" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black">Orders</h2>
                    </div>
                    <OrderHistory orders={orders} currency={sub.currency} planLabels={planLabels} />
                  </NeonCard>

                  <NeonCard padding="lg" radius="xl">
                    <div className="mb-5 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-meta-500" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black">How we look after your work</h2>
                    </div>
                    <TrustPanel retentionHours={sub.retention_hours} />
                  </NeonCard>
                </div>

                <div className="space-y-6">
                  <NeonCard padding="lg" radius="xl">
                    <div className="mb-4 flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-meta-500" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black">Account</h2>
                    </div>
                    <p className="mb-4 truncate text-sm text-ink-muted">
                      Signed in as <span className="font-medium text-black">{user?.email}</span>
                    </p>
                    <PasswordCard />
                  </NeonCard>

                  <NeonCard tone="slow" padding="lg" radius="xl">
                    <div className="mb-4 flex items-center gap-2">
                      <History className="h-4 w-4 text-meta-600" aria-hidden />
                      <h2 className="text-sm font-semibold tracking-tight text-black">Recent batches</h2>
                    </div>
                    {batches.length === 0 ? (
                      <p className="py-4 text-center text-xs text-ink-faint">
                        No batches yet.{" "}
                        <Link href="/app" className="font-medium text-meta-600 hover:underline">
                          Start one in the workspace
                        </Link>
                        .
                      </p>
                    ) : (
                      <ul className="divide-y divide-black/[0.06]">
                        {batches.map((batch) => (
                          <li key={batch.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                            <span className="min-w-0">
                              <span className="font-medium text-black">
                                {batch.asset_count} file{batch.asset_count === 1 ? "" : "s"}
                              </span>
                              <span className="text-ink-subtle"> · {presetName(batch.preset)}</span>
                            </span>
                            <span className="shrink-0 text-xs text-ink-faint">{timeAgo(batch.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </NeonCard>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
