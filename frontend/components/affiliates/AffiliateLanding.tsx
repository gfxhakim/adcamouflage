"use client";

import clsx from "clsx";
import {
  ArrowRight,
  BadgeCheck,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Coins,
  Link2,
  Megaphone,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import NeonCard from "@/components/NeonCard";
import SiteHeader from "@/components/SiteHeader";
import CursorRing from "@/components/landing/CursorRing";
import SiteFooter from "@/components/landing/SiteFooter";
import { Headline, PillArrow, Reveal } from "@/components/landing/primitives";
import { formatMoney } from "@/lib/format";
import type { PublicAffiliateProgram } from "@/lib/referrals";

function tierRangeLabel(tiers: { min: number; pct: number }[], index: number): string {
  const current = tiers[index];
  const next = tiers[index + 1];
  if (!next) return `${current.min}+ paying customers / mo`;
  if (current.min === 0) return `0–${next.min - 1} paying customers / mo`;
  return `${current.min}–${next.min - 1} paying customers / mo`;
}

function tierPctFor(tiers: { min: number; pct: number }[], customers: number): number {
  let pct = tiers[0]?.pct ?? 25;
  for (const tier of tiers) {
    if (customers >= tier.min) pct = tier.pct;
  }
  return pct;
}

export function AffiliateLanding({ program }: { program: PublicAffiliateProgram }) {
  const { partner, currency, link_days: linkDays, plans } = program;
  const tiers = useMemo(
    () =>
      partner.tiers.length
        ? partner.tiers
        : [
            { min: 0, pct: 25 },
            { min: 20, pct: 30 },
            { min: 50, pct: 35 },
          ],
    [partner.tiers],
  );
  const minRate = tiers[0]?.pct ?? 25;
  const maxRate = tiers[tiers.length - 1]?.pct ?? 35;

  const [customers, setCustomers] = useState(25);
  const [selectedPlanId, setSelectedPlanId] = useState(plans[1]?.id ?? plans[0]?.id ?? "pro");

  const activePlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? { id: "pro", label: "Pro", price: 89 },
    [plans, selectedPlanId],
  );
  const activePct = useMemo(() => tierPctFor(tiers, customers), [tiers, customers]);
  const monthlyEarnings = useMemo(
    () => (customers * activePlan.price * activePct) / 100,
    [activePct, activePlan.price, customers],
  );
  const annualEarnings = monthlyEarnings * 12;

  return (
    <>
      <SiteHeader />
      <CursorRing />

      <main className="overflow-x-clip">
        {/* Hero ------------------------------------------------------------ */}
        <section className="relative isolate overflow-hidden bg-black py-20 text-white sm:py-28">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute left-1/2 top-0 h-[440px] w-[760px] -translate-x-1/2 rounded-full bg-meta-500/25 blur-[140px]" />
            <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-[#00c6ff]/15 blur-[120px]" />
          </div>

          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-meta-200 backdrop-blur">
              <Megaphone className="h-3.5 w-3.5 text-meta-400" aria-hidden />
              ProteusFlow Partner Program · Recurring Revenue Share
            </span>

            <Headline
              as="h1"
              dark
              text={`Earn [${minRate}%–${maxRate}%] | [Recurring Revenue.]`}
              className="mt-6 text-4xl sm:text-6xl lg:text-[5.1rem]"
            />

            <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base">
              Promote ProteusFlow to media buyers, creative teams, agencies, and founders. Give your audience{" "}
              <span className="font-semibold text-white">{partner.discount_pct}% off</span> their first plan, and earn{" "}
              <span className="font-semibold text-white">
                {minRate}% to {maxRate}%
              </span>{" "}
              of every dollar they pay — subscriptions, monthly renewals, upgrades, and top-ups.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup?role=affiliate"
                className="group inline-flex items-center gap-3 rounded-full bg-meta-500 py-2 pl-6 pr-2 text-sm font-semibold text-white shadow-[0_14px_38px_-10px_rgba(8,102,255,0.85)] transition hover:bg-meta-600"
              >
                Join Affiliation Program
                <PillArrow dark />
              </Link>
              <Link
                href="/login?next=/affiliates/dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/10"
              >
                Partner Log in
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-3 text-left sm:grid-cols-4">
              {[
                { label: "Audience discount", value: `${partner.discount_pct}% off`, sub: "First subscription checkout" },
                { label: "Commission ladder", value: `${minRate}%–${maxRate}%`, sub: "Monthly revenue share" },
                { label: "Attribution window", value: `${linkDays} days`, sub: "Link & promo code cookie" },
                { label: "Minimum payout", value: formatMoney(partner.min_payout, currency), sub: `${partner.hold_days}-day clearance hold` },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 backdrop-blur"
                >
                  <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">{stat.label}</p>
                  <p className="mt-1 font-display text-3xl font-normal leading-none text-white">{stat.value}</p>
                  <p className="mt-1.5 text-[11px] text-white/60">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Commission Ladder + Interactive Estimator ---------------------- */}
        <section id="calculator" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta-600">
                Our affiliation strategy
              </p>
              <Headline text="Monthly [tier ladder] that scales with your audience." className="mt-3 text-3xl sm:text-5xl" />
              <p className="mt-4 text-sm leading-relaxed text-ink-muted sm:text-base">
                Every month is calculated independently based on how many paying customers your link or promo code
                brings in — unlocking higher revenue share across 100% of that month&apos;s collected revenue.
              </p>
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
              {/* Tiers */}
              <div className="space-y-3">
                {tiers.map((tier, idx) => {
                  const unlocked = activePct === tier.pct;
                  return (
                    <Reveal key={`${tier.min}-${tier.pct}`} delay={idx * 0.05}>
                      <div
                        className={clsx(
                          "flex items-center justify-between gap-4 rounded-2xl border p-5 transition-all",
                          unlocked
                            ? "border-meta-500/60 bg-meta-50/80 shadow-meta-sm"
                            : "border-black/10 bg-white",
                        )}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] uppercase tracking-wider text-meta-600">
                              Tier 0{idx + 1}
                            </span>
                            {unlocked ? (
                              <span className="chip !border-meta-500/40 !bg-white !text-[10px] !text-meta-700">
                                Current estimate
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-base font-semibold text-black">{tierRangeLabel(tiers, idx)}</p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            Applies to subscriptions, monthly renewals, plan upgrades, and token top-ups.
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-display text-5xl leading-none text-meta-600">{tier.pct}%</span>
                        </div>
                      </div>
                    </Reveal>
                  );
                })}

                <div className="rounded-2xl border border-black/10 bg-[#F4F5F7] p-5 text-xs leading-relaxed text-ink-muted">
                  <p className="font-semibold text-black">Dedicated Partner Account Only</p>
                  <p className="mt-1">
                    Partners who join from our affiliation page receive an affiliate-only account tailored strictly for
                    campaign tracking, statements, and payouts — separate from customer studio workspaces and admin tools.
                    Sign in anytime at{" "}
                    <Link href="/login" className="font-semibold text-meta-600 hover:underline">
                      /login
                    </Link>{" "}
                    with your signup email.
                  </p>
                </div>
              </div>

              {/* Calculator */}
              <NeonCard glow padding="lg" radius="xl" className="border-meta-500/30">
                <div className="flex items-center justify-between gap-3">
                  <p className="label flex items-center gap-1.5 text-meta-600">
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                    Recurring earnings estimator
                  </p>
                  <span className="chip !border-meta-500/30 !bg-meta-50 !text-[11px] !text-meta-700">
                    {activePct}% rev share
                  </span>
                </div>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor="aff-customers" className="text-sm font-medium text-black">
                      Active paying customers referred
                    </label>
                    <span className="font-display text-3xl text-black tabular-nums">{customers}</span>
                  </div>
                  <input
                    id="aff-customers"
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={customers}
                    onChange={(e) => setCustomers(Number(e.target.value))}
                    className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-meta-500"
                  />
                  <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    <span>1 customer</span>
                    <span>20+ (30%)</span>
                    <span>50+ (35%)</span>
                    <span>100</span>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="label mb-2">Average customer plan</p>
                  <div className="grid grid-cols-3 gap-2">
                    {plans.map((p) => {
                      const on = p.id === activePlan.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPlanId(p.id)}
                          aria-pressed={on}
                          className={clsx(
                            "rounded-xl border px-3 py-2.5 text-left transition",
                            on
                              ? "border-meta-500 bg-meta-50 text-meta-900"
                              : "border-black/10 bg-white text-ink-muted hover:border-black/25",
                          )}
                        >
                          <span className="block text-xs font-semibold text-black">{p.label}</span>
                          <span className="block font-mono text-[11px] tabular-nums">
                            {formatMoney(p.price, currency)}/mo
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 rounded-2xl bg-black p-5 text-white sm:grid-cols-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-white/55">
                      Estimated monthly income
                    </p>
                    <p className="mt-1 font-display text-4xl font-normal text-meta-300 sm:text-5xl tabular-nums">
                      {formatMoney(monthlyEarnings, currency)}
                    </p>
                  </div>
                  <div className="border-t border-white/10 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-white/55">
                      Estimated annual run rate
                    </p>
                    <p className="mt-1 font-display text-4xl font-normal text-white sm:text-5xl tabular-nums">
                      {formatMoney(annualEarnings, currency)}
                    </p>
                  </div>
                </div>

                <Link
                  href="/signup?role=affiliate"
                  className="btn-primary mt-5 flex w-full items-center justify-center gap-2 !py-3 text-sm"
                >
                  Join Affiliation Program &amp; Claim Your Code
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </NeonCard>
            </div>
          </div>
        </section>

        {/* How it works --------------------------------------------------- */}
        <section id="how-it-works" className="scroll-mt-24 border-y border-black/[0.07] bg-[#F4F5F7] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta-600">How it works</p>
              <Headline text="From [sign-up] to recurring monthly payouts." className="mt-3 text-3xl sm:text-5xl" />
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: "01",
                  icon: Users,
                  title: "Sign up & request your code",
                  body: `Create your affiliate account with email and request a custom promo code (e.g. YOURNAME) giving followers ${partner.discount_pct}% off their first subscription.`,
                },
                {
                  step: "02",
                  icon: Link2,
                  title: `${linkDays}-day cookie & coupon lock`,
                  body: `Share your ?ref= link or code. The last partner link clicked within ${linkDays} days or code applied before checkout wins attribution.`,
                },
                {
                  step: "03",
                  icon: Coins,
                  title: "Earn on every renewal & top-up",
                  body: `Your commission counts on initial subscription checkouts, renewals, upgrades, and token top-ups — calculated per monthly tier (${minRate}%–${maxRate}%).`,
                },
                {
                  step: "04",
                  icon: BadgeDollarSign,
                  title: "Clearance & monthly payouts",
                  body: `Commissions clear after a ${partner.hold_days}-day hold window and pay out monthly starting at ${formatMoney(partner.min_payout, currency)} to your saved payout wallet.`,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.step} className="rounded-2xl border border-black/[0.08] bg-white p-5">
                    <div className="flex items-center justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-meta-50 text-meta-600">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="font-mono text-xs text-ink-faint">{card.step}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-black">{card.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-ink-muted">{card.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Dashboard preview & rules -------------------------------------- */}
        <section className="bg-white py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta-600">Inside your portal</p>
              <Headline text="Everything tracked in one [Affiliate Dashboard.]" className="mt-3 text-3xl sm:text-4xl" />
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                No cluttered workspace menus. When you join through our affiliation program, your account opens
                directly into a fast Partner Dashboard built strictly for tracking performance and payouts:
              </p>
              <ul className="mt-6 space-y-3 text-sm text-black">
                {[
                  "Personal referral link (?ref=) and promo code copy controls",
                  "Real-time Clicks, Sign-ups, and Paying Customers funnel stats",
                  "Pending hold balance, Payable balance, and Paid out totals",
                  "Month-by-month revenue, active tier rate, and commission statements",
                  "Commission line-by-line ledger plus customizable payout wallet settings",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-meta-500" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-black/10 bg-[#F4F5F7] p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-meta-600" aria-hidden />
                <h2 className="text-base font-semibold text-black">Program rules &amp; quality standards</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                We review every partner application manually to keep attribution clean and payouts reliable for legitimate
                creators and marketers.
              </p>
              <ul className="mt-5 space-y-2.5 text-xs leading-relaxed text-ink-muted">
                {[
                  `Audience discount: ${partner.discount_pct}% off a referred customer's first subscription payment on covered plans.`,
                  `Monthly tier calculation: 0+ (${tiers[0]?.pct ?? 25}%), ${tiers[1]?.min ?? 20}+ (${tiers[1]?.pct ?? 30}%), ${tiers[2]?.min ?? 50}+ (${tiers[2]?.pct ?? 35}%) paying customers.`,
                  `Hold period: ${partner.hold_days} days after payment before commissions move from On hold to Ready to pay.`,
                  `Minimum monthly payout: ${formatMoney(partner.min_payout, currency)} sent manually to your configured method (USDT TRC-20, Wise, etc.).`,
                  "Refunded or disputed payments earn no commission and reverse pending/unpaid commission lines.",
                  "Prohibited: self-referrals (checked via device/IP/payer hashes), coupon-aggregator sites, brand-name search bidding, or misleading claims.",
                ].map((rule) => (
                  <li key={rule} className="flex items-start gap-2">
                    <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-meta-600" aria-hidden />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 text-xs text-ink-muted">
                <Clock3 className="h-4 w-4 shrink-0 text-meta-500" aria-hidden />
                <span>
                  Applications status:{" "}
                  <strong className="text-black">
                    {partner.enabled && partner.applications_open ? "Open now" : "Currently paused"}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA ----------------------------------------------------- */}
        <section className="relative isolate overflow-hidden bg-black py-20 text-white sm:py-24">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute left-1/2 top-1/2 h-[380px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-meta-500/25 blur-[130px]" />
          </div>
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-meta-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Partner Portal
            </span>
            <Headline
              dark
              text="Ready to launch your [partner link?]"
              className="mt-4 text-4xl sm:text-5xl lg:text-6xl"
            />
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/70">
              Sign up with your email to open your Partner Dashboard, request your custom code, and start earning up to{" "}
              {maxRate}% recurring revenue.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup?role=affiliate"
                className="group inline-flex items-center gap-3 rounded-full bg-meta-500 py-2 pl-6 pr-2 text-sm font-semibold text-white shadow-[0_14px_38px_-10px_rgba(8,102,255,0.85)] transition hover:bg-meta-600"
              >
                Join Affiliation Program
                <PillArrow dark />
              </Link>
              <Link
                href="/login?next=/affiliates/dashboard"
                className="rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10"
              >
                Partner Log in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

export default AffiliateLanding;
