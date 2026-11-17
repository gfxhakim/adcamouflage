"use client";

import { useCallback, useEffect, useState } from "react";

import WorkspaceShell from "@/components/WorkspaceShell";
import PartnerCard from "@/components/referrals/PartnerCard";
import { fetchMyReferrals, type MyReferrals } from "@/lib/referrals";
import { useRequireUser } from "@/lib/useRequireUser";

export default function ReferralsPage() {
  const user = useRequireUser();
  const [data, setData] = useState<MyReferrals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const program = await fetchMyReferrals();
      setData(program);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the affiliate program.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const partner = data?.partner;
  const approved = partner?.status === "approved" || partner?.status === "suspended";
  const nothingOn = data && !data.partner.enabled && !data.partner.status;

  return (
    <WorkspaceShell user={user}>
      <div className="mx-auto flex w-full max-w-7xl gap-5 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <main className="relative min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label">Affiliate program</p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black sm:text-5xl">
              {approved ? "Your Affiliate Portal" : "Join our Affiliate Program"}
            </h1>
            <p className="max-w-2xl text-sm text-ink-muted">
              {approved && partner
                ? "Share your affiliate link and promo code with your audience so they can enter it at Whop checkout when subscribing."
                : "Share your full name, email, social media profiles, and audience background. After review, we assign your promo code and affiliate link."}
            </p>
          </section>

          {error ? <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          {!data ? (
            <div className="space-y-4" aria-busy="true">
              <div className="h-64 animate-pulse rounded-2xl bg-black/[0.04]" />
            </div>
          ) : nothingOn ? (
            <p className="rounded-xl border border-black/10 bg-white px-4 py-6 text-center text-sm text-ink-muted">
              The affiliate program is not open right now.
            </p>
          ) : (
            <PartnerCard
              partner={data.partner}
              defaultName={user?.display_name ?? ""}
              defaultEmail={user?.email ?? ""}
              onChanged={(next) => setData({ ...data, partner: next })}
            />
          )}
        </main>
      </div>
    </WorkspaceShell>
  );
}
