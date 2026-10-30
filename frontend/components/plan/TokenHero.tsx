"use client";

import clsx from "clsx";
import { CalendarDays, Coins, Crown, Loader2, PauseCircle, PlayCircle, Snowflake, UserRound, Zap } from "lucide-react";
import { useState } from "react";

import NeonCard from "@/components/NeonCard";
import { cancelSubscription, resumeSubscription, type Subscription } from "@/lib/auth";
import { formatDate, formatMoney, formatTokens, plural } from "@/lib/format";

interface TokenHeroProps {
  sub: Subscription;
  /** Called after cancel / resume so the page re-reads the subscription. */
  onChanged: () => Promise<void> | void;
}

/** "Active", "Ends in 3 days", "Ended · renew within 5 days", "Cancelled" and their colours. */
export function subscriptionStatus(sub: Subscription): { text: string; tone: string } {
  const current = sub.subscription;
  if (!current) return { text: "No subscription", tone: "border-red-300 bg-red-50 text-red-700" };
  if (!current.active) {
    const graceLeft = current.grace_until
      ? Math.max(0, Math.ceil((new Date(current.grace_until).getTime() - Date.now()) / 86_400_000))
      : 0;
    return {
      text: current.in_grace && graceLeft > 0 ? `Ended · renew within ${plural(graceLeft, "day")}` : "Ended",
      tone: "border-red-300 bg-red-50 text-red-700",
    };
  }
  if (current.cancelled) {
    return { text: `Cancelled · ends ${formatDate(current.period_end)}`, tone: "border-amber-400/50 bg-amber-50 text-amber-700" };
  }
  if (current.days_left <= 5) {
    return { text: `Ends in ${plural(current.days_left, "day")}`, tone: "border-amber-400/50 bg-amber-50 text-amber-700" };
  }
  return { text: "Active", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" };
}

/**
 * The plan page's headline card for a token account: which plan, whether the
 * period is running, when it ends, and the token balance split by bucket.
 */
export function TokenHero({ sub, onChanged }: TokenHeroProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = sub.subscription;
  const balance = sub.balance;
  const status = subscriptionStatus(sub);
  const perGeneration = current?.tokens_per_generation ?? 0;
  const subShare = balance.usable_tokens > 0 ? Math.min(1, Math.max(0, balance.subscription_tokens) / balance.usable_tokens) : 0;

  const toggleCancel = async () => {
    if (!current?.active) return;
    if (!current.cancelled) {
      const ok = window.confirm(
        `Cancel your ${current.plan_label} subscription? You keep access and your tokens until ${formatDate(current.period_end)}. Unused subscription tokens will not roll over into a later period.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      if (current.cancelled) await resumeSubscription();
      else await cancelSubscription();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NeonCard glow padding="lg" radius="xl">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-meta-500/30 bg-gradient-to-br from-meta-50 to-meta-100 text-meta-600">
              <Crown className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="label">Current plan</p>
              <p className="text-2xl font-bold tracking-tight text-black sm:text-3xl">
                {current ? current.plan_label : "None yet"}
              </p>
            </div>
            <span className={clsx("chip ml-auto lg:ml-2", status.tone)}>{status.text}</span>
          </div>

          <p className="mt-5 text-3xl font-bold tracking-tight text-black">
            {current ? formatMoney(current.price, sub.currency) : "—"}
            {current ? <span className="text-sm font-medium text-ink-subtle"> / 30 days</span> : null}
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Period ends
              </dt>
              <dd className={clsx("font-medium", current && !current.active ? "text-red-700" : "text-black")}>
                {current?.period_end ? formatDate(current.period_end) : "—"}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <Zap className="h-3.5 w-3.5" aria-hidden /> Per generation
              </dt>
              <dd className="font-medium text-black">{perGeneration ? `${perGeneration} tokens` : "—"}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <UserRound className="h-3.5 w-3.5" aria-hidden /> Member since
              </dt>
              <dd className="font-medium text-black">{formatDate(sub.member_since)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <Coins className="h-3.5 w-3.5" aria-hidden /> Billing
              </dt>
              <dd className="font-medium text-black">Paid per 30-day period</dd>
            </div>
          </dl>

          {current?.active ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={clsx("!py-2 !text-xs", current.cancelled ? "btn-primary" : "btn-ghost")}
                disabled={busy}
                onClick={() => void toggleCancel()}
                aria-label={current.cancelled ? "Resume subscription" : "Cancel subscription"}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : current.cancelled ? (
                  <PlayCircle className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                )}
                {current.cancelled ? "Resume subscription" : "Cancel subscription"}
              </button>
              <span className="text-[11px] text-ink-faint">
                {current.cancelled
                  ? "Nothing more is charged. Resume to keep rolling tokens over."
                  : "Access continues until the period ends."}
              </span>
            </div>
          ) : null}
          {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
        </div>

        {/* Token balance ------------------------------------------------ */}
        <div className="rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white to-meta-50/60 p-5 sm:p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="label">Tokens you can use</p>
              <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-black">
                {formatTokens(balance.usable_tokens)}
              </p>
              <p className="text-xs text-ink-subtle">
                {perGeneration ? `${perGeneration} tokens per generation` : "subscription + top-up"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums text-meta-600">{formatTokens(balance.generations_left)}</p>
              <p className="text-xs text-ink-subtle">generations</p>
            </div>
          </div>

          <div
            className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-black/[0.06]"
            role="img"
            aria-label={`${formatTokens(balance.subscription_tokens)} subscription tokens and ${formatTokens(balance.topup_tokens)} top-up tokens`}
          >
            <div
              className="h-full bg-gradient-to-r from-meta-400 to-meta-600 transition-all duration-700"
              style={{ width: `${subShare * 100}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700"
              style={{ width: `${balance.usable_tokens > 0 ? (1 - subShare) * 100 : 0}%` }}
            />
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-white/80 px-3 py-2">
              <dt className="flex items-center gap-1.5 text-ink-subtle">
                <span className="h-2 w-2 rounded-full bg-meta-500" aria-hidden /> Subscription
              </dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-black">
                {formatTokens(Math.max(0, balance.subscription_tokens))}
              </dd>
            </div>
            <div className="rounded-xl bg-white/80 px-3 py-2">
              <dt className="flex items-center gap-1.5 text-ink-subtle">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> Top-up
              </dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-black">
                {formatTokens(Math.max(0, balance.topup_tokens))}
              </dd>
            </div>
          </dl>

          <p
            className={clsx(
              "mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed",
              balance.frozen_topup ? "bg-amber-50 text-amber-800" : "bg-white/80 text-ink-muted",
            )}
          >
            {balance.frozen_topup ? <Snowflake className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            {balance.frozen_topup
              ? `Your ${formatTokens(balance.topup_tokens)} top-up tokens are kept but on hold until you subscribe again.`
              : "Subscription tokens are spent first; top-up tokens never expire while you are subscribed."}
          </p>
        </div>
      </div>
    </NeonCard>
  );
}

export default TokenHero;
