"use client";

import clsx from "clsx";
import { Coins, Gift, Loader2 } from "lucide-react";
import { useState } from "react";

import type { TokenSubscription, Topups } from "@/lib/auth";
import { formatMoney, formatTokens, plural } from "@/lib/format";

interface TopupPickerProps {
  topups: Topups;
  current: TokenSubscription | null;
  currency: string;
  paymentsEnabled: boolean;
  busy: boolean;
  onBuy: (amount: number) => void;
}

/**
 * The five top-up amounts priced at the current plan's rate, each with its
 * bonus. Only an active subscription can buy one, so the buttons wait for it.
 */
export function TopupPicker({ topups, current, currency, paymentsEnabled, busy, onBuy }: TopupPickerProps) {
  const options = topups.options;
  const [picked, setPicked] = useState<number>(options[1]?.amount ?? options[0]?.amount ?? 0);
  const active = Boolean(current?.active);
  const chosen = options.find((o) => o.amount === picked) ?? options[0];

  if (options.length === 0) {
    return (
      <p className="rounded-xl border border-black/[0.07] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-ink-muted">
        Top-ups are priced by plan. Subscribe to a plan first, and the amounts will show here with their bonus tokens.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Top-up amount">
        {options.map((option) => {
          const selected = option.amount === picked;
          return (
            <button
              key={option.amount}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!active || busy}
              onClick={() => setPicked(option.amount)}
              className={clsx(
                "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/70 disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-meta-500 bg-meta-50 shadow-[0_0_18px_-6px_rgb(8_102_255/0.5)]"
                  : "border-black/10 bg-white hover:border-meta-500/50",
              )}
            >
              <span className="text-base font-bold tabular-nums text-black">{formatMoney(option.amount, currency)}</span>
              <span className="text-[11px] tabular-nums text-ink-muted">{formatTokens(option.total)} tokens</span>
              {option.bonus > 0 ? (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <Gift className="h-3 w-3" aria-hidden /> +{formatTokens(option.bonus)} bonus
                </span>
              ) : (
                <span className="mt-1 text-[10px] text-ink-faint">no bonus</span>
              )}
            </button>
          );
        })}
      </div>

      {chosen ? (
        <div className="flex flex-col gap-3 rounded-xl border border-black/[0.07] bg-gradient-to-br from-white to-meta-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-ink-subtle">Base</dt>
              <dd className="font-semibold tabular-nums text-black">{formatTokens(chosen.tokens)}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Bonus</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">+{formatTokens(chosen.bonus)}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Total</dt>
              <dd className="font-semibold tabular-nums text-black">{formatTokens(chosen.total)} tokens</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">That is</dt>
              <dd className="font-semibold tabular-nums text-black">{plural(chosen.generations, "generation")}</dd>
            </div>
          </dl>
          {paymentsEnabled ? (
            <button
              type="button"
              className="btn-primary shrink-0 !py-2 !text-xs"
              disabled={!active || busy}
              onClick={() => onBuy(chosen.amount)}
              aria-label={`Buy ${formatTokens(chosen.total)} tokens for ${formatMoney(chosen.amount, currency)}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Coins className="h-3.5 w-3.5" aria-hidden />}
              Buy {formatTokens(chosen.total)} tokens for {formatMoney(chosen.amount, currency)}
            </button>
          ) : (
            <p className="text-[11px] text-amber-800">Payments are being set up — contact support.</p>
          )}
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        {active
          ? `Priced at ${current?.plan_label ?? "your plan"}'s rate. Top-up tokens are spent after subscription tokens and never expire while you are subscribed.`
          : "Top-ups need an active subscription. Renew first and the amounts unlock."}
      </p>
    </div>
  );
}

export default TopupPicker;
