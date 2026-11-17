"use client";

import { ArrowRight, Megaphone } from "lucide-react";
import Link from "next/link";

import { CmsLink, CmsSection, T } from "@/components/cms/Cms";
import { CmsHeadline, PillArrow, Reveal } from "@/components/landing/primitives";
import { formatMoney } from "@/lib/format";
import type { PublicAffiliateProgram } from "@/lib/referrals";

export function AffiliateSection({ program }: { program: PublicAffiliateProgram }) {
  const { partner, currency, link_days: linkDays } = program;
  const tiers = partner.tiers.length
    ? partner.tiers
    : [
        { min: 0, pct: 25 },
        { min: 20, pct: 30 },
        { min: 50, pct: 35 },
      ];
  const minRate = tiers[0]?.pct ?? 25;
  const maxRate = tiers[tiers.length - 1]?.pct ?? 35;

  if (!partner.enabled) return null;

  return (
    <CmsSection k="affiliates" label="Affiliate program" id="affiliates" className="scroll-mt-24 bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-3xl border border-black/10 bg-black p-8 text-white sm:p-12 lg:p-16">
            {/* Meta-blue glow matching our landing palette */}
            <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
              <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-meta-500/35 blur-[120px]" />
              <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-[#00c6ff]/20 blur-[110px]" />
            </div>

            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-meta-200">
                  <Megaphone className="h-3.5 w-3.5 text-meta-400" aria-hidden />
                  <T k="affiliates.kicker">Affiliate partner program</T>
                </p>

                <CmsHeadline
                  k="affiliates.headline"
                  dark
                  text={`Earn [${minRate}%–${maxRate}%] | Recurring Revenue.`}
                  className="mt-5 text-4xl sm:text-5xl lg:text-6xl"
                />

                <T k="affiliates.body" long as="p" className="mt-5 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
                  Share ProteusFlow with agencies, creators, and ad teams. Your audience gets 15% off their first plan
                  and you earn recurring revenue across subscriptions, renewals, upgrades, and top-ups — tracked in a
                  dedicated Affiliate Dashboard.
                </T>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <CmsLink
                    k="affiliates.joinCta"
                    href="/signup?role=affiliate"
                    label="Join Affiliation Program"
                    className="group inline-flex items-center gap-3 rounded-full bg-meta-500 py-1.5 pl-5 pr-1.5 text-sm font-semibold text-white shadow-[0_12px_32px_-8px_rgba(8,102,255,0.85)] transition hover:bg-meta-600"
                  >
                    {(label) => (
                      <>
                        {label}
                        <PillArrow dark />
                      </>
                    )}
                  </CmsLink>
                  <Link
                    href="/affiliates"
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/10"
                  >
                    See full strategy
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>

                <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/45">
                  Affiliate-only dashboard · {linkDays}-day attribution · {formatMoney(partner.min_payout, currency)} min
                  monthly payout
                </p>
              </div>

              <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/55">
                    Monthly commission tiers
                  </span>
                  <span className="rounded-full bg-meta-500/20 px-2.5 py-0.5 font-mono text-[10px] text-meta-200">
                    {partner.discount_pct}% audience code
                  </span>
                </div>

                {tiers.map((tier, idx) => {
                  const next = tiers[idx + 1];
                  const label = next
                    ? tier.min === 0
                      ? `0–${next.min - 1} customers/mo`
                      : `${tier.min}–${next.min - 1} customers/mo`
                    : `${tier.min}+ customers/mo`;
                  return (
                    <div
                      key={`${tier.min}-${tier.pct}`}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-black/50 px-4 py-3"
                    >
                      <span className="text-xs text-white/80">{label}</span>
                      <span className="font-display text-2xl font-normal text-meta-300 tabular-nums">
                        {tier.pct}%
                      </span>
                    </div>
                  );
                })}

                <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-white/60">
                  <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                    <span className="block text-[10px] uppercase text-white/40">Hold period</span>
                    <span className="text-white">{partner.hold_days} days</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                    <span className="block text-[10px] uppercase text-white/40">Min payout</span>
                    <span className="text-white">{formatMoney(partner.min_payout, currency)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </CmsSection>
  );
}

export default AffiliateSection;
