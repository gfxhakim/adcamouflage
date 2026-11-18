"use client";

import { ArrowUpRight, KeyRound, LogOut, Megaphone, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import BrandLogo from "@/components/BrandLogo";
import NeonCard from "@/components/NeonCard";
import EmailChangeCard from "@/components/plan/EmailChangeCard";
import PasswordCard from "@/components/plan/PasswordCard";
import PartnerCard from "@/components/referrals/PartnerCard";
import { fetchMe, signOut, type UserProfile } from "@/lib/auth";
import { fetchMyReferrals, type MyReferrals } from "@/lib/referrals";

export default function AffiliateDashboardPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [data, setData] = useState<MyReferrals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await fetchMe();
      if (!profile) {
        await signOut().catch(() => undefined);
        window.location.assign("/login?next=/affiliates/dashboard");
        return;
      }
      if (profile.account_role !== "affiliate") {
        window.location.assign("/app/referrals");
        return;
      }
      setUser(profile);
      const referrals = await fetchMyReferrals();
      setData(referrals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your affiliate dashboard.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/affiliates");
    }
  };

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Standalone Affiliate Portal Header (no Workspace or Admin links) */}
      <header className="sticky top-0 z-30 border-b border-black/[0.07] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/affiliates" className="flex min-w-0 items-center gap-3" aria-label="ProteusFlow Affiliates">
            <BrandLogo caption="Affiliate Partner Portal" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/affiliates"
              className="hidden items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-meta-500/40 hover:text-black sm:inline-flex"
            >
              Program terms
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            {user ? (
              <span className="hidden items-center gap-1.5 rounded-full border border-meta-500/30 bg-meta-50 px-3 py-1 text-xs font-medium text-meta-800 md:inline-flex">
                <UserRound className="h-3.5 w-3.5 text-meta-600" aria-hidden />
                {user.email}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label flex items-center gap-1.5 text-meta-600">
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
              Partner dashboard
            </p>
            <h1 className="mt-1 font-display text-4xl font-normal leading-tight text-black sm:text-5xl">
              Affiliate Dashboard
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Follow subscribers from your promo code or link, track commissions, build campaign links, and request withdrawals from $100.
            </p>
          </div>
          <span className="chip !border-meta-500/30 !bg-meta-50 !text-meta-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Partner-only access
          </span>
        </section>

        {error ? (
          <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : null}

        {!user || !data ? (
          <div className="space-y-4" aria-busy="true">
            <div className="h-64 animate-pulse rounded-2xl bg-black/[0.04]" />
            <div className="h-44 animate-pulse rounded-2xl bg-black/[0.04]" />
          </div>
        ) : (
          <div className="space-y-6">
            {data.partner.enabled || data.partner.status ? (
              <PartnerCard
                partner={data.partner}
                currency="USD"
                defaultName={user.display_name ?? ""}
                defaultEmail={user.email ?? ""}
                onChanged={(partner) => setData({ ...data, partner })}
              />
            ) : (
              <NeonCard padding="lg" radius="xl">
                <p className="text-sm text-ink-muted">
                  The partner program is paused right now. Check back soon or contact support.
                </p>
              </NeonCard>
            )}

            <NeonCard padding="lg" radius="xl">
              <div className="mb-4 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-meta-500" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight text-black">Partner login &amp; security</h2>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <p className="label">Sign-in email</p>
                    <p className="mt-1 text-sm font-medium text-black">{user.email}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      Use this email anytime at{" "}
                      <Link href="/login" className="font-semibold text-meta-600 hover:underline">
                        /login
                      </Link>{" "}
                      to open your Affiliate Dashboard directly.
                    </p>
                  </div>
                  <EmailChangeCard socialOnly={Boolean(user.social_only)} onChanged={(updated) => setUser(updated)} />
                </div>
                <div>
                  <PasswordCard socialOnly={Boolean(user.social_only)} />
                </div>
              </div>
            </NeonCard>
          </div>
        )}
      </main>
    </div>
  );
}
