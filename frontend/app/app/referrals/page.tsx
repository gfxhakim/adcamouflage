"use client";

import { useCallback, useEffect, useState } from "react";

import DeckRail from "@/components/DeckRail";
import Header from "@/components/Header";
import FriendCard from "@/components/referrals/FriendCard";
import PartnerCard from "@/components/referrals/PartnerCard";
import { fetchSubscription, type Subscription } from "@/lib/auth";
import { fetchMyReferrals, type MyReferrals } from "@/lib/referrals";
import { useRequireUser } from "@/lib/useRequireUser";

export default function ReferralsPage() {
  const user = useRequireUser();
  const [data, setData] = useState<MyReferrals | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [program, subscription] = await Promise.all([fetchMyReferrals(), fetchSubscription().catch(() => null)]);
      setData(program);
      setSub(subscription);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the program.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const planLabels = Object.fromEntries((sub?.token_plans ?? []).map((p) => [p.id, p.label]));
  const currency = sub?.currency || "USD";
  const nothingOn = data && !data.friend.enabled && !data.partner.enabled;

  return (
    <>
      <Header user={user} />
      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <DeckRail onDark={false} user={user} />
        <main className="relative min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label">Invite &amp; earn</p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black sm:text-5xl">Share ProteusFlow</h1>
            <p className="max-w-2xl text-sm text-ink-muted">
              Invite a friend and earn bonus tokens, or apply as a creator partner and earn a share of what your audience
              pays.
            </p>
          </section>

          {error ? <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          {!data ? (
            <div className="space-y-4" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="h-56 animate-pulse rounded-2xl bg-black/[0.04]" />
              ))}
            </div>
          ) : nothingOn ? (
            <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-ink-muted">
              The referral program is not open right now.
            </p>
          ) : (
            <div className="space-y-6">
              {data.friend.enabled ? <FriendCard friend={data.friend} linkDays={data.link_days} planLabels={planLabels} /> : null}
              {data.partner.enabled || data.partner.status ? (
                <PartnerCard partner={data.partner} currency={currency} onChanged={(partner) => setData({ ...data, partner })} />
              ) : null}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
