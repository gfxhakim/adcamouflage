"use client";

import { useCallback, useEffect, useState } from "react";

import WorkspaceShell from "@/components/WorkspaceShell";
import FriendCard from "@/components/referrals/FriendCard";
import { fetchMyReferrals, type MyReferrals } from "@/lib/referrals";
import { useRequireUser } from "@/lib/useRequireUser";

/** Invite friends: the customer's own link and code, and the tokens they earn per friend. */
export default function InvitePage() {
  const user = useRequireUser();
  const [data, setData] = useState<MyReferrals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchMyReferrals());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your invite link.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  return (
    <WorkspaceShell user={user}>
      <div className="mx-auto flex w-full max-w-7xl gap-5 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <main className="relative min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label">Invite friends</p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black sm:text-5xl">
              Share ProteusFlow, earn free tokens
            </h1>
            <p className="max-w-2xl text-sm text-ink-muted">
              Send your link or code to friends who make video content. You earn tokens when they sign up, and more when
              they pick a plan.
            </p>
          </section>

          {error ? <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          {!data ? (
            <div className="h-64 animate-pulse rounded-2xl bg-black/[0.04]" aria-busy="true" />
          ) : !data.friend.enabled ? (
            <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-ink-muted">
              Friend invites are not open right now.
            </p>
          ) : (
            <FriendCard friend={data.friend} linkDays={data.link_days} planLabels={{}} />
          )}
        </main>
      </div>
    </WorkspaceShell>
  );
}
