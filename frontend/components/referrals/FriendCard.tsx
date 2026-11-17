"use client";

import clsx from "clsx";
import { BadgeCheck, CalendarDays, Coins, Gift, UserPlus } from "lucide-react";
import Link from "next/link";

import NeonCard from "@/components/NeonCard";
import CopyField from "@/components/referrals/CopyField";
import StatTile from "@/components/StatTile";
import { formatDate, formatTokens } from "@/lib/format";
import { referralLink, type FriendProgram } from "@/lib/referrals";

const STATUS: Record<string, { text: string; tone: string }> = {
  signed_up: { text: "Signed up", tone: "!border-black/10 !text-ink-subtle" },
  waiting: { text: "Reward on hold", tone: "!border-amber-400/50 !bg-amber-50 !text-amber-700" },
  rewarded: { text: "Rewarded", tone: "!border-emerald-300 !bg-emerald-50 !text-emerald-700" },
  capped: { text: "Over monthly limit", tone: "!border-black/10 !text-ink-faint" },
  blocked: { text: "Not eligible", tone: "!border-red-300 !bg-red-50 !text-red-700" },
  void: { text: "No reward", tone: "!border-black/10 !text-ink-faint" },
};

function planName(id: string, labels: Record<string, string>): string {
  return labels[id] ?? id.replace(/^\w/, (c) => c.toUpperCase());
}

/** The friend referral side: the subscriber's link and code, what they earn and who signed up. */
export function FriendCard({ friend, linkDays, planLabels }: { friend: FriendProgram; linkDays: number; planLabels: Record<string, string> }) {
  const plans = friend.plans.map((id) => planName(id, planLabels));
  const planText = plans.length > 1 ? `${plans.slice(0, -1).join(", ")} or ${plans[plans.length - 1]}` : plans[0] ?? "";
  const rewards = Object.entries(friend.reward_tokens).filter(([, tokens]) => tokens > 0);

  return (
    <NeonCard padding="lg" radius="xl">
      <div className="mb-1 flex items-center gap-2">
        <Gift className="h-4 w-4 text-meta-500" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-black">Invite friends, earn tokens</h2>
      </div>
      <p className="max-w-2xl text-sm text-ink-muted">
        Your friend gets {friend.discount_pct}% off their first {planText} payment. You get bonus tokens{" "}
        {friend.hold_days} days after they pay, up to {friend.monthly_cap} rewards a month.
      </p>

      {!friend.eligible || !friend.code ? (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink-muted">
          Your invite link unlocks with an active subscription.{" "}
          <Link href="/app/plan" className="font-semibold text-meta-600 hover:underline">
            See plans
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <CopyField label="Your invite link" value={referralLink(friend.code)} />
            <CopyField label="Or your coupon code" value={friend.code} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={UserPlus} label="Friends signed up" value={String(friend.stats.signups)} />
            <StatTile icon={BadgeCheck} label="Friends who paid" value={String(friend.stats.paying)} />
            <StatTile icon={CalendarDays} label="Rewards this month" value={`${friend.rewards_this_month} / ${friend.monthly_cap}`} />
            <StatTile icon={Coins} label="Reward tokens left" value={formatTokens(friend.tokens_left)} hint={`${formatTokens(friend.tokens_earned)} earned in total`} />
          </div>
        </>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="label mb-2">What you earn</p>
          <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/10 text-sm">
            {rewards.map(([plan, tokens]) => (
              <li key={plan} className="flex items-center justify-between px-3 py-2">
                <span className="text-ink-muted">Friend subscribes to {planName(plan, planLabels)}</span>
                <span className="font-semibold tabular-nums text-black">{formatTokens(tokens)} tokens</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-ink-subtle">
            <li>Reward tokens are used after your plan tokens and before paid top-ups.</li>
            <li>They do not expire while you stay subscribed, and are lost if you cancel.</li>
            <li>Only brand-new customers count, and a link works for {linkDays} days after the click.</li>
            <li>No reward for your own accounts, or if your friend is refunded.</li>
            <li>Please share it with people you know, not on coupon sites or in paid ads.</li>
          </ul>
        </div>

        <div>
          <p className="label mb-2">Your invites</p>
          {friend.friends.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-ink-faint">
              Nobody has signed up with your link yet.
            </p>
          ) : (
            <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/10 text-sm">
              {friend.friends.map((row, index) => {
                const status = STATUS[row.status] ?? STATUS.signed_up;
                return (
                  <li key={`${row.email}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-black">{row.email}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatDate(row.created_at)}
                        {row.status === "waiting" && row.reward_due_at
                          ? ` · ${formatTokens(row.reward_tokens)} tokens on ${formatDate(row.reward_due_at)}`
                          : row.status === "rewarded"
                            ? ` · ${formatTokens(row.reward_tokens)} tokens`
                            : ""}
                      </p>
                    </div>
                    <span className={clsx("chip shrink-0 !text-[10px]", status.tone)}>{status.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </NeonCard>
  );
}

export default FriendCard;
