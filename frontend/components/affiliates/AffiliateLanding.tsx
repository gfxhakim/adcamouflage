"use client";

import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Link2,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";

import SiteHeader from "@/components/SiteHeader";
import CursorRing from "@/components/landing/CursorRing";
import SiteFooter from "@/components/landing/SiteFooter";
import { Headline, PillArrow } from "@/components/landing/primitives";
import type { PublicAffiliateProgram } from "@/lib/referrals";

export function AffiliateLanding({ program }: { program: PublicAffiliateProgram }) {
  const { partner } = program;

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
              ProteusFlow Partner Program
            </span>

            <Headline
              as="h1"
              dark
              text="Partner with [ProteusFlow.] | Grow your [creative audience.]"
              className="mt-6 text-4xl sm:text-6xl lg:text-[5.1rem]"
            />

            <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base">
              Promote ProteusFlow to media buyers, creative teams, agencies, and e-commerce founders. Apply with your
              channels and content overview — once approved by our team, you receive your personal affiliate link and
              Whop promo code directly in your Partner Dashboard.
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
          </div>
        </section>

        {/* How it works --------------------------------------------------- */}
        <section id="how-it-works" className="scroll-mt-24 border-y border-black/[0.07] bg-[#F4F5F7] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta-600">How it works</p>
              <Headline text="Simple review from [application] to activation." className="mt-3 text-3xl sm:text-5xl" />
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  step: "01",
                  icon: Users,
                  title: "Submit your application",
                  body: "Provide your full name, email address, social media links, and a description explaining your audience, content, and why you want to join.",
                },
                {
                  step: "02",
                  icon: BadgeCheck,
                  title: "Manual approval & Whop setup",
                  body: "Our team reviews your channels in the admin panel. Once approved, we prepare your dedicated promo code and affiliate link in Whop and publish them to your account.",
                },
                {
                  step: "03",
                  icon: Link2,
                  title: "Share with your audience",
                  body: "Give your audience your affiliate link and promo code. When they click to subscribe to a plan, they enter your promo code directly in the Whop checkout page.",
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.step} className="rounded-2xl border border-black/[0.08] bg-white p-6">
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
              <Headline text="Everything in one clean [Partner Dashboard.]" className="mt-3 text-3xl sm:text-4xl" />
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                When you join from the affiliation portal, your account opens straight into a dedicated Partner Dashboard
                without cluttered studio or admin menus:
              </p>
              <ul className="mt-6 space-y-3 text-sm text-black">
                {[
                  "Quick partner application with your full name, email, social profiles, and audience story",
                  "Real-time approval status right on your dashboard",
                  "Dedicated Whop affiliate link and promo code ready to copy once approved",
                  "Sign in anytime at /login with the email you registered with",
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
                <h2 className="text-base font-semibold text-black">Partner guidelines</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Every request is reviewed manually so creators and agencies can represent ProteusFlow with clarity.
              </p>
              <ul className="mt-5 space-y-2.5 text-xs leading-relaxed text-ink-muted">
                {[
                  "Include active links to your social media channels or communities so we can review your content fit.",
                  "Describe who your audience is and what your content focuses on.",
                  "Remind subscribers to enter your assigned promo code inside the Whop checkout page when subscribing.",
                  "Prohibited: self-referrals, coupon-aggregator spam, brand-name search bidding, or misleading claims.",
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
              text="Ready to launch your [partner partnership?]"
              className="mt-4 text-4xl sm:text-5xl lg:text-6xl"
            />
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/70">
              Sign up with your email to open your Partner Dashboard and submit your channels for approval.
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
