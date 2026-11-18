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
  Lock,
  Receipt,
  ShieldCheck,
  Sparkles,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import WorkspaceShell from "@/components/WorkspaceShell";
import NeonCard from "@/components/NeonCard";
import BillingAlerts from "@/components/plan/BillingAlerts";
import CancelRefundCard from "@/components/plan/CancelRefundCard";
import CouponBox from "@/components/plan/CouponBox";
import LegacyHero from "@/components/plan/LegacyHero";
import MonthlyBars from "@/components/plan/MonthlyBars";
import OrderHistory from "@/components/plan/OrderHistory";
import EmailChangeCard from "@/components/plan/EmailChangeCard";
import PasswordCard from "@/components/plan/PasswordCard";
import PlanOptions from "@/components/plan/PlanOptions";
import TokenHero from "@/components/plan/TokenHero";
import TokenPlanCards from "@/components/plan/TokenPlanCards";
import TopupPicker from "@/components/plan/TopupPicker";
import TeamCard from "@/components/plan/TeamCard";
import TrustPanel from "@/components/plan/TrustPanel";
import WhopCheckout from "@/components/plan/WhopCheckout";
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
import { formatDate, formatMoney, formatTokens, timeAgo } from "@/lib/format";
import { trackCheckout, trackPurchase } from "@/lib/meta";
import { dispatchVisitorOffer, fetchVisitorOffer, subscribeVisitorOffer, type ReferralOffer } from "@/lib/referrals";
import type { TokenPlanCard } from "@/lib/types";

/** How often we check order status while checkout is open or validating. */
const ORDER_POLL_MS = 3000;
const VALIDATING_POLL_MS = 1500;
const ORDER_POLL_LIMIT_MS = 120_000;

interface Toast {
  tone: "success" | "info" | "error";
  text: string;
}

type CheckoutModalStage = "checkout" | "validating" | "thank_you" | "error";

interface ActiveCheckout {
  orderId: string;
  whopPlan: string;
  whopCheckoutConfig?: string | null;
  label: string;
  amount: number;
  originalAmount?: number | null;
  discount?: number;
  promoCode?: string | null;
  whopPromoToPrefill?: string | null;
  whopMetadata?: Record<string, string>;
  tokens: number;
  returnUrl: string;
}

function presetName(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function PlanPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [offer, setOffer] = useState<ReferralOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** The plan id or "topup" whose checkout is being created. */
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [activeCheckout, setActiveCheckout] = useState<ActiveCheckout | null>(null);
  const [checkoutStage, setCheckoutStage] = useState<CheckoutModalStage>("checkout");
  const [settledOrder, setSettledOrder] = useState<Order | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  /** The payment method the user picked; the first one the server offers until then. */
  const [pickedProvider, setPickedProvider] = useState<PaymentProviderId | null>(null);
  // Plan labels for the settlement toast, which runs outside the render.
  const labelsRef = useRef<Record<string, string>>({});
  // The site currency for Meta events, read inside callbacks.
  const currencyRef = useRef("USD");
  /**
   * What the payment provider's return link said, read once. The query is
   * dropped as soon as it is read, and in development React's StrictMode runs
   * the effect below twice, so the second run takes it from here instead of
   * finding an empty query and leaving the "waiting" state without a poll.
   */
  const returned = useRef<{ orderId: string | null; backedOut: boolean; paymentReturned: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await fetchMe();
      if (!profile) {
        await signOut().catch(() => undefined);
        window.location.assign("/");
        return;
      }
      if (profile.account_role === "affiliate") {
        window.location.assign("/affiliates/dashboard");
        return;
      }
      const [subscription, history, orderList, visitor] = await Promise.all([
        fetchSubscription(),
        fetchMyBatches(),
        fetchOrders().catch(() => [] as Order[]),
        fetchVisitorOffer().catch(() => ({ offer: null })),
      ]);
      // Same recovery as the workspace: a cookie the API rejects is cleared first.
      if (!subscription) {
        await signOut().catch(() => undefined);
        window.location.assign("/");
        return;
      }
      setUser(profile);
      setSub(subscription);
      setBatches(history.slice(0, 8));
      setOrders(orderList);
      setOffer(visitor.offer ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your plan.");
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeVisitorOffer(setOffer);
  }, [load]);

  const paidToastText = useCallback((order: Order) => {
    return order.kind === "subscription"
      ? `Payment received. Your ${labelsRef.current[order.plan_id] ?? order.plan_id} period is active and ${formatTokens(order.tokens)} tokens were added.`
      : `Payment received. ${formatTokens(order.tokens)} top-up tokens were added.`;
  }, []);

  // --- back from off-site 3DS / redirect: open the in-page validating popup ---
  useEffect(() => {
    if (returned.current === null) {
      const params = new URLSearchParams(window.location.search);
      const statusParam = params.get("status")?.toLowerCase() ?? null;
      const backedOut =
        params.get("cancelled") === "1" || statusParam === "canceled" || statusParam === "cancelled" || statusParam === "failed";
      const paymentReturned =
        !backedOut && (statusParam === "success" || statusParam === "succeeded" || params.has("payment_id"));
      returned.current = {
        orderId: params.get("order"),
        backedOut,
        paymentReturned,
      };
      if (returned.current.orderId || backedOut || paymentReturned || statusParam) {
        // Drop the query so a reload does not start another wait.
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    const { orderId, backedOut, paymentReturned } = returned.current;
    if (!orderId && !backedOut && !paymentReturned) return;
    if (backedOut) {
      setToast({ tone: "error", text: "Payment cancelled — nothing was charged." });
      return;
    }
    if (orderId) {
      setSettledOrder(null);
      setCheckoutNotice(null);
      setCheckoutStage("validating");
      setActiveCheckout({
        orderId,
        whopPlan: "",
        whopCheckoutConfig: null,
        label: "Your subscription",
        amount: 0,
        tokens: 0,
        returnUrl: `${window.location.origin}/app/plan?order=${encodeURIComponent(orderId)}`,
      });
      return;
    }
    // Whop Dashboard redirect appended ?payment_id=...&status=success without ?order=: resolve latest order.
    let cancelled = false;
    void fetchOrders()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        const latest = list[0];
        setSettledOrder(null);
        setCheckoutNotice(null);
        setCheckoutStage("validating");
        setActiveCheckout({
          orderId: latest.id,
          whopPlan: "",
          whopCheckoutConfig: null,
          label: latest.kind === "topup" ? "Token top-up" : `${labelsRef.current[latest.plan_id] ?? latest.plan_id} period`,
          amount: latest.amount,
          tokens: latest.tokens,
          returnUrl: `${window.location.origin}/app/plan?order=${encodeURIComponent(latest.id)}`,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // --- poll active checkout / validating popup until Whop webhook settles ---
  useEffect(() => {
    if (!activeCheckout) return;
    if (checkoutStage !== "checkout" && checkoutStage !== "validating") return;

    const orderId = activeCheckout.orderId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const validating = checkoutStage === "validating";
    const intervalMs = validating ? VALIDATING_POLL_MS : ORDER_POLL_MS;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const order = await fetchOrder(orderId);
        if (cancelled) return;
        if (order.status === "paid") {
          void trackPurchase(order.id, order.amount, currencyRef.current, order.plan_id);
          await load();
          if (cancelled) return;
          setSettledOrder(order);
          setCheckoutNotice(null);
          setCheckoutStage("thank_you");
          setToast({ tone: "success", text: paidToastText(order) });
          return;
        }
        if (order.status === "expired" || order.status === "invalid") {
          setCheckoutNotice(
            order.status === "expired"
              ? "The checkout expired before payment completed. Nothing was charged; you can start again anytime."
              : "This payment was marked as invalid. If you were charged, contact support with order " + order.id + ".",
          );
          setCheckoutStage("error");
          await load();
          return;
        }
      } catch {
        /* Retry on next tick. */
      }
      if (validating && Date.now() - startedAt >= ORDER_POLL_LIMIT_MS) {
        setCheckoutNotice(
          "Payment confirmation is taking a little longer than usual. Your plan and tokens will activate automatically as soon as Whop finishes settling.",
        );
        setCheckoutStage("error");
        await load();
        return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), intervalMs);
    };

    if (validating) {
      void poll();
    } else {
      timer = setTimeout(() => void poll(), intervalMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeCheckout, checkoutStage, load, paidToastText]);

  // Close checkout dialog on Escape (unless currently validating payment or on thank-you summary).
  useEffect(() => {
    if (!activeCheckout || checkoutStage === "validating") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveCheckout(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCheckout, checkoutStage]);

  // --- payment method ------------------------------------------------------
  const providers = sub?.payment_providers ?? [];
  const provider = providers.find((p) => p.id === pickedProvider)?.id ?? providers[0]?.id;

  // --- checkout ------------------------------------------------------------
  const buy = useCallback(
    async (kind: OrderKind, choice: { plan_id?: string; amount?: number; coupon?: string | null }, key: string) => {
      setCheckoutBusy(key);
      setToast(null);
      try {
        const checkout = await startCheckout(kind, choice, provider);
        await Promise.race([
          trackCheckout(checkout.order_id, checkout.amount, currencyRef.current, choice.plan_id ?? "topup", checkout.provider),
          new Promise((r) => setTimeout(r, 800)),
        ]);
        const label =
          kind === "subscription"
            ? `${labelsRef.current[choice.plan_id ?? ""] ?? choice.plan_id ?? "Plan"} period`
            : `${formatMoney(checkout.amount, currencyRef.current)} top-up`;
        const returnUrl = `${window.location.origin}/app/plan?order=${encodeURIComponent(checkout.order_id)}`;
        if (checkout.whop_plan) {
          setSettledOrder(null);
          setCheckoutNotice(null);
          setCheckoutStage("checkout");
          setActiveCheckout({
            orderId: checkout.order_id,
            whopPlan: checkout.whop_plan,
            whopCheckoutConfig: checkout.whop_checkout_config,
            label,
            amount: checkout.amount,
            originalAmount: checkout.original_amount,
            discount: checkout.discount,
            promoCode: checkout.promo_code,
            whopPromoToPrefill: checkout.whop_promo_to_prefill,
            whopMetadata: checkout.whop_metadata,
            tokens: checkout.tokens,
            returnUrl,
          });
          setCheckoutBusy(null);
          return;
        }
        if (checkout.checkout_url) {
          window.location.assign(checkout.checkout_url);
          return;
        }
        throw new Error("Checkout could not be opened.");
      } catch (err) {
        setToast({ tone: "error", text: err instanceof Error ? err.message : "Could not start the checkout." });
        setCheckoutBusy(null);
      }
    },
    [provider],
  );

  const buyPlan = useCallback(
    (plan: TokenPlanCard) =>
      void buy("subscription", { plan_id: plan.id, ...(offer?.code ? { coupon: offer.code } : {}) }, plan.id),
    [buy, offer?.code],
  );
  const buyTopup = useCallback((amount: number) => void buy("topup", { amount }, "topup"), [buy]);
  const resumeOrder = useCallback(
    (order: Order) => {
      if (order.kind === "subscription") {
        void buy("subscription", { plan_id: order.plan_id }, order.plan_id);
      } else {
        void buy("topup", { amount: order.amount }, "topup");
      }
    },
    [buy],
  );
  const handleCheckoutComplete = useCallback(() => {
    // UI state only — Whop embed unmounts immediately and polling waits for the webhook settlement.
    setCheckoutStage((prev) => (prev === "thank_you" ? prev : "validating"));
  }, []);

  // --- derived -------------------------------------------------------------
  const quota = sub?.monthly_quota ?? null;
  const isTokens = sub?.billing_mode === "tokens";
  const planLabels = Object.fromEntries((sub?.token_plans ?? []).map((p) => [p.id, p.label]));
  labelsRef.current = planLabels;
  currencyRef.current = sub?.currency || "USD";

  return (
    <WorkspaceShell user={user}>
      <div className="mx-auto flex w-full max-w-7xl gap-5 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
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
              {toast.tone === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1">{toast.text}</span>
              <button type="button" className="shrink-0 rounded-md p-0.5 hover:bg-black/5" aria-label="Dismiss" onClick={() => setToast(null)}>
                <X className="h-4 w-4" aria-hidden />
              </button>
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
                {!sub.subscription && (offer !== null || !orders.some((o) => o.status === "paid" && o.amount > 0)) ? (
                  <CouponBox
                    offer={offer}
                    planLabels={planLabels}
                    onApplied={(next) => {
                      setOffer(next);
                      dispatchVisitorOffer(next);
                      void load();
                    }}
                  />
                ) : null}
                <TokenPlanCards
                  plans={sub.token_plans}
                  current={isTokens ? sub.subscription : null}
                  currency={sub.currency}
                  paymentsEnabled={sub.payments_enabled}
                  busy={checkoutBusy}
                  onBuy={buyPlan}
                  offer={offer}
                />
              </section>

              {/* Team seats (multi-user plans, or a member of one) ------------ */}
              {sub.team && sub.team.role !== "none" ? (
                <TeamCard
                  team={sub.team}
                  onChanged={(team) => {
                    setSub({ ...sub, team });
                    void load();
                  }}
                />
              ) : null}

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
                    <OrderHistory orders={orders} currency={sub.currency} planLabels={planLabels} onResume={resumeOrder} />
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
                    <p className="mb-2 truncate text-sm text-ink-muted">
                      Signed in as <span className="font-medium text-black">{user?.email}</span>
                    </p>
                    <div className="mb-4">
                      <EmailChangeCard socialOnly={user?.social_only} onChanged={setUser} />
                    </div>
                    <PasswordCard socialOnly={user?.social_only} />
                  </NeonCard>

                  {isTokens ? (
                    <div id="cancel-refund" className="scroll-mt-24">
                      <NeonCard padding="lg" radius="xl">
                        <div className="mb-4 flex items-center gap-2">
                          <Undo2 className="h-4 w-4 text-meta-500" aria-hidden />
                          <h2 className="text-sm font-semibold tracking-tight text-black">Cancel plan &amp; refunds</h2>
                        </div>
                        <CancelRefundCard sub={sub} planLabels={planLabels} onChanged={load} />
                      </NeonCard>
                    </div>
                  ) : null}

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

      {activeCheckout ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="whop-checkout-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && checkoutStage !== "validating") setActiveCheckout(null);
          }}
        >
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 shadow-2xl sm:p-6">
            {checkoutStage === "checkout" ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-black/[0.06] pb-3.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                      <Lock className="h-3 w-3 text-meta-500" aria-hidden /> Secure Whop checkout
                    </p>
                    <h2 id="whop-checkout-title" className="mt-1 truncate text-base font-semibold text-black">
                      {activeCheckout.label} · {formatMoney(activeCheckout.amount, currencyRef.current)}
                    </h2>
                    {activeCheckout.promoCode && activeCheckout.discount && activeCheckout.discount > 0 ? (
                      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
                        Code {activeCheckout.promoCode} applied · saved{" "}
                        {formatMoney(activeCheckout.discount, currencyRef.current)}
                        {activeCheckout.originalAmount
                          ? ` off ${formatMoney(activeCheckout.originalAmount, currencyRef.current)}`
                          : ""}
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-muted">
                      Includes {formatTokens(activeCheckout.tokens)} tokens · instant activation after payment
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close checkout"
                    onClick={() => setActiveCheckout(null)}
                    className="rounded-lg p-1.5 text-ink-muted transition hover:bg-black/5 hover:text-black"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <WhopCheckout
                  planId={activeCheckout.whopPlan}
                  checkoutConfigId={activeCheckout.whopCheckoutConfig}
                  buyerEmail={user?.email}
                  orderId={activeCheckout.orderId}
                  returnUrl={activeCheckout.returnUrl}
                  promoCode={activeCheckout.whopPromoToPrefill ?? undefined}
                  metadata={activeCheckout.whopMetadata}
                  onComplete={handleCheckoutComplete}
                />
              </>
            ) : checkoutStage === "validating" ? (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-meta-500/30 bg-meta-50 text-meta-600">
                  <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
                </span>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-meta-600">
                  Please stay on this page
                </p>
                <h2 id="whop-checkout-title" className="mt-1 font-display text-3xl font-normal text-black">
                  Validating payment…
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
                  Thank you for joining ProteusFlow. We are confirming your payment with Whop and activating your plan and tokens right now.
                </p>
                {activeCheckout.tokens > 0 ? (
                  <div className="mx-auto mt-5 flex max-w-sm items-center justify-between rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-left text-xs">
                    <div>
                      <p className="font-semibold text-black">{activeCheckout.label}</p>
                      <p className="text-ink-subtle">Order {activeCheckout.orderId.slice(0, 12)}</p>
                    </div>
                    <span className="rounded-full bg-meta-50 px-2.5 py-1 font-mono font-semibold text-meta-700">
                      +{formatTokens(activeCheckout.tokens)} tokens
                    </span>
                  </div>
                ) : null}
              </div>
            ) : checkoutStage === "thank_you" ? (
              <div className="py-5 text-center">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setActiveCheckout(null)}
                  className="absolute right-4 top-4 rounded-lg p-1.5 text-ink-muted transition hover:bg-black/5 hover:text-black"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-300 bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-8 w-8" aria-hidden />
                </span>
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  Payment validated
                </p>
                <h2 id="whop-checkout-title" className="mt-2 font-display text-3xl font-normal text-black sm:text-4xl">
                  {settledOrder?.kind === "topup" ? "Tokens added to your account!" : "Thank you for joining us!"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
                  {settledOrder?.kind === "topup"
                    ? `Your top-up payment is confirmed and ${formatTokens(settledOrder.tokens)} tokens have been credited to your profile.`
                    : `Your ${planLabels[settledOrder?.plan_id ?? ""] ?? sub?.subscription?.plan_label ?? "ProteusFlow"} plan is now active and ${formatTokens(settledOrder?.tokens ?? activeCheckout.tokens)} tokens are ready on your profile.`}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3 text-left">
                  <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3.5">
                    <p className="label flex items-center gap-1">
                      <Crown className="h-3 w-3 text-meta-500" aria-hidden /> Active plan
                    </p>
                    <p className="mt-1 text-base font-bold text-black">
                      {sub?.subscription?.plan_label ?? planLabels[settledOrder?.plan_id ?? ""] ?? "Active"}
                    </p>
                    <p className="text-[11px] font-medium text-emerald-700">Activated &amp; ready</p>
                  </div>
                  <div className="rounded-xl border border-meta-500/25 bg-meta-50/70 p-3.5">
                    <p className="label flex items-center gap-1 text-meta-700">
                      <Coins className="h-3 w-3 text-meta-600" aria-hidden /> Profile tokens
                    </p>
                    <p className="mt-1 text-base font-bold tabular-nums text-black">
                      {formatTokens(sub?.balance.usable_tokens ?? user?.tokens_usable ?? settledOrder?.tokens ?? activeCheckout.tokens)}
                    </p>
                    <p className="text-[11px] text-meta-800">Visible in your sidebar &amp; plan</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
                  <Link href="/app" className="btn-primary !py-2.5 !text-sm" onClick={() => setActiveCheckout(null)}>
                    Go to Workspace
                  </Link>
                  <button
                    type="button"
                    onClick={() => setActiveCheckout(null)}
                    className="btn-ghost !py-2.5 !text-sm"
                  >
                    Stay on My Plan
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-5 text-center">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setActiveCheckout(null)}
                  className="absolute right-4 top-4 rounded-lg p-1.5 text-ink-muted transition hover:bg-black/5 hover:text-black"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <p className="label text-amber-700">Payment status</p>
                <h2 id="whop-checkout-title" className="mt-1 font-display text-2xl font-normal text-black">
                  Could not confirm right away
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
                  {checkoutNotice ?? "Nothing was charged if you cancelled checkout."}
                </p>
                <button type="button" onClick={() => setActiveCheckout(null)} className="btn-primary mt-5 !py-2 !text-sm">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}
