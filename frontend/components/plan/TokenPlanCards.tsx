"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Check, Loader2, RefreshCw, ShoppingCart } from "lucide-react";

import NeonCard from "@/components/NeonCard";
import type { TokenSubscription } from "@/lib/auth";
import { formatMoney, formatTokens } from "@/lib/format";
import { rolloverCap, type TokenPlanCard } from "@/lib/types";

interface TokenPlanCardsProps {
  plans: TokenPlanCard[];
  current: TokenSubscription | null;
  currency: string;
  paymentsEnabled: boolean;
  /** The plan whose checkout is being created, if any. */
  busy: string | null;
  onBuy: (plan: TokenPlanCard) => void;
}

/** The plan the page highlights when the user has none yet. */
const POPULAR = "pro";

type Action = "subscribe" | "renew" | "upgrade" | "switch";

function actionFor(plan: TokenPlanCard, current: TokenSubscription | null, currentPlan: TokenPlanCard | undefined): Action {
  if (!current || !currentPlan) return "subscribe";
  if (plan.id === current.plan_id) return "renew";
  return plan.price >= currentPlan.price ? "upgrade" : "switch";
}

const ACTION_LABEL: Record<Action, string> = {
  subscribe: "Subscribe",
  renew: "Renew",
  upgrade: "Upgrade",
  switch: "Switch",
};

function rolloverLine(plan: TokenPlanCard): string {
  if (plan.rollover_months <= 0) return "Unused tokens reset each period";
  return `Roll over up to ${formatTokens(rolloverCap(plan))} tokens (${plan.rollover_months} ${plan.rollover_months === 1 ? "period" : "periods"})`;
}

/**
 * Starter, Pro and Max side by side. Buying any of them starts a fresh 30-day
 * period on BTCPay; the button says whether that is a first subscription, a
 * renewal, an upgrade or a switch down.
 */
export function TokenPlanCards({ plans, current, currency, paymentsEnabled, busy, onBuy }: TokenPlanCardsProps) {
  const currentPlan = current ? plans.find((p) => p.id === current.plan_id) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const action = actionFor(plan, current, currentPlan);
          const isCurrent = current?.plan_id === plan.id;
          const highlight = isCurrent || (!current && plan.id === POPULAR);
          const note =
            action === "switch"
              ? "Switching down starts a new period with no rolled-over tokens."
              : action === "upgrade" && plan.rollover_months > 0
                ? "Leftover subscription tokens carry over, up to the new cap."
                : plan.rollover_months === 0 && (action === "upgrade" || action === "renew")
                  ? "Starter does not roll tokens over: leftover subscription tokens expire."
                  : null;

          return (
            <NeonCard
              key={plan.id}
              glow={highlight}
              tone={highlight ? "default" : "muted"}
              interactive={!isCurrent}
              padding="md"
              radius="lg"
              className="h-full"
              innerClassName="flex h-full flex-col"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-black">{plan.label}</p>
                {isCurrent ? (
                  <span
                    className={clsx(
                      "chip !text-[10px]",
                      current && !current.active ? "!border-red-300 !bg-red-50 !text-red-700" : "!border-meta-500/40 !bg-meta-50 !text-meta-700",
                    )}
                  >
                    {current && !current.active ? "Ended" : "Current plan"}
                  </span>
                ) : !current && plan.id === POPULAR ? (
                  <span className="chip !border-meta-500/40 !bg-meta-50 !text-[10px] !text-meta-700">Most popular</span>
                ) : null}
              </div>

              <p className="mt-3 text-2xl font-bold tracking-tight text-black">
                {formatMoney(plan.price, currency)}
                <span className="text-xs font-medium text-ink-subtle"> / 30 days</span>
              </p>

              <ul className="mt-3 space-y-1.5 text-xs text-ink-muted">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  <span>
                    <span className="font-semibold text-black">{formatTokens(plan.tokens)}</span> tokens ={" "}
                    <span className="font-semibold text-black">{formatTokens(plan.generations)}</span> generations
                  </span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  {plan.tokens_per_generation} tokens per generation · {formatMoney(plan.price_per_generation, currency)} each
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  {rolloverLine(plan)}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-meta-500" aria-hidden />
                  Top-ups at {plan.topup_rate} tokens per {formatMoney(1, currency)}
                </li>
              </ul>

              <div className="mt-auto pt-4">
                {paymentsEnabled ? (
                  <button
                    type="button"
                    className={clsx("w-full !py-2 !text-xs", action === "switch" ? "btn-ghost" : "btn-primary")}
                    disabled={busy !== null}
                    aria-label={`${ACTION_LABEL[action]} ${plan.label} for ${formatMoney(plan.price, currency)}`}
                    onClick={() => onBuy(plan)}
                  >
                    {busy === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : action === "renew" ? (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    ) : action === "upgrade" ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    ) : action === "switch" ? (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {busy === plan.id ? "Opening checkout…" : ACTION_LABEL[action]}
                  </button>
                ) : (
                  <p className="rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-800">
                    Payments are being set up — contact support to get started.
                  </p>
                )}
                {note ? <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{note}</p> : null}
              </div>
            </NeonCard>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Every purchase starts a new 30-day period from today, and days left on the current one are added on. You pay
        once per period; nothing renews on its own.
      </p>
    </div>
  );
}

export default TokenPlanCards;
