"use client";

import { ArrowRight, Check, Layers, Rocket, ShieldCheck, UploadCloud, X } from "lucide-react";
import Link from "next/link";

import { CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { CmsHeadline, Reveal } from "@/components/landing/primitives";
import RenderProof from "@/components/RenderProof";

const PROOF_BULLETS = [
  "Rebuild aggressive, limited, or policy-flagged Meta, TikTok, and YouTube video ads layer by layer — fresh visual composition, Rec.709 color profile, −14 LUFS broadcast audio, and clean container metadata.",
  "Keep your winning hook, fast direct-response cuts, burned-in captions, and brand overlays razor-sharp so platforms approve the creative and it converts higher.",
  "Launch up to 5 fresh variations per batch in the cloud, recover stuck ad accounts fast, and download clean exports ready to scale.",
];

const PIPELINE_STEPS = [
  {
    num: "01",
    icon: UploadCloud,
    title: "Upload Rejected or Aggressive Ad",
    body: "Drop 1 to 5 video or image creatives directly into the studio—even creatives that were disapproved or lost delivery.",
  },
  {
    num: "02",
    icon: Layers,
    title: "23-Layer AI Reconstruction",
    body: "ProteusFlow rebuilds micro-visual structure, color grading, −14 LUFS audio, and container metadata without hurting your hook.",
  },
  {
    num: "03",
    icon: Rocket,
    title: "Re-Launch & Scale Profitability",
    body: "Download ready-to-run variations in minutes for Meta, TikTok & YouTube—with 100% auto-refund if any render fails.",
  },
];

const WITHOUT_ITEMS = [
  "Re-uploading disapproved videos triggers instant repeat rejections",
  "Winning ads stall in Limited Learning or zero-delivery throttling",
  "Hours wasted re-cutting winners from scratch in desktop editors",
  "Paying $48–$130/mo on legacy tools with low 10–20 output caps",
];

const WITH_ITEMS = [
  "Rebuilds visual, audio & container layers while keeping your winning hook",
  "Turns aggressive, strict-policy creatives into fresh, approvable exports",
  "Starts at just $37/mo · Pro delivers 50 outputs at $89/mo (2.5× more)",
  "Max adds 5 team seats + 120 outputs · 100% auto-refund on failed renders",
];

const FIT_FOR = [
  "Media buyers scaling aggressive direct-response offers on Meta, TikTok & YouTube",
  "E-commerce & lead-gen teams tired of losing winning hooks to automated ad flags",
  "Agencies needing fast, multi-seat creative variation output without manual editing",
];

const NOT_FIT_FOR = [
  "Advertisers looking to promote scams or non-delivered products",
  "Campaigns running without basic tracking, testing, or conversion feedback",
  "Accounts expecting clicks without reviewing offer and funnel conversion metrics",
];

export function BeforeAfter() {
  const cms = useCms();
  const bullets = cms.list("proof.studioBullets", PROOF_BULLETS, "Bullet points", PROOF_BULLETS);
  return (
    <CmsSection k="proof" label="Creative studio & media showcase" id="proof" className="scroll-mt-24 bg-white py-20 text-black sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <div>
            <CmsHeadline k="proof.studioHeadline" text="Why Winning Ads Get Rejected. | [How ProteusFlow Fixes Them.]" className="text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="proof.studioLede" long as="p" className="text-sm leading-relaxed text-black/65">
            Ad platforms flag aggressive winners across visual frames, motion, audio signatures, and container metadata. ProteusFlow uses multi-layer AI creative rebuilding so rejected ads pass review, regain delivery, and print higher ROAS.
          </T>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <Reveal>
            <T k="proof.studioKicker" as="p" className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">ai rejected-ad engine</T>
            <T k="proof.studioSubhead" as="h3" className="mt-3 max-w-lg text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              AI layer reconstruction engineered for aggressive Meta, TikTok &amp; YouTube video ads.
            </T>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-black/75">
              {bullets.map(({ item, key, id }) => (
                <li key={id}>
                  • <T k={`${key}.text`}>{item}</T>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/signup?next=%2Fapp%2Fplan%3Fplan%3Dpro%26welcome%3D1"
                className="inline-flex items-center gap-2 rounded-full bg-meta-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-8px_rgba(8,102,255,0.65)] transition hover:bg-meta-600"
              >
                Fix My Rejected Ads
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a
                href="#pricing"
                className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-black/[0.04]"
              >
                Compare plans from $37
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <CmsSlot k="proof.report" label="Report card">
              <RenderProof dark />
            </CmsSlot>
          </Reveal>
        </div>

        {/* 3-Step Pipeline (Drop Rejected -> AI Rebuild -> Scale) ---------- */}
        <Reveal className="mt-16 grid gap-4 md:grid-cols-3">
          {PIPELINE_STEPS.map(({ num, icon: Icon, title, body }) => (
            <div
              key={num}
              className="rounded-2xl border border-black/[0.08] bg-[#F7F9FC] p-6 transition hover:border-meta-500/40"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-meta-500 text-white shadow-[0_8px_20px_-6px_rgba(8,102,255,0.6)]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="font-mono text-xs font-semibold text-meta-600">STEP {num}</span>
              </div>
              <h4 className="mt-4 text-lg font-semibold tracking-tight text-black">{title}</h4>
              <p className="mt-1.5 text-sm leading-relaxed text-black/65">{body}</p>
            </div>
          ))}
        </Reveal>

        {/* Side-by-Side Comparison: Re-Uploading vs ProteusFlow ------------ */}
        <Reveal className="mt-16 rounded-3xl border border-black/10 bg-black p-6 text-white sm:p-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-meta-400">
                Two ways to handle flagged winners
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Stop Burning Winners vs. Scale With ProteusFlow AI
              </h3>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              100% token auto-refund if a render fails
            </span>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-red-300">
                Without ProteusFlow (Raw Re-Uploads)
              </p>
              <ul className="mt-4 space-y-3 text-sm text-white/80">
                {WITHOUT_ITEMS.map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500/20 text-red-300">
                      <X className="h-3 w-3" aria-hidden />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-meta-400/50 bg-gradient-to-br from-meta-500/20 via-meta-500/10 to-transparent p-6 shadow-[0_0_40px_-14px_rgba(8,102,255,0.65)]">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-meta-300">
                With ProteusFlow AI Engine
              </p>
              <ul className="mt-4 space-y-3 text-sm text-white">
                {WITH_ITEMS.map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Qualification block: Built for you / Not for you --------------- */}
          <div className="mt-6 grid gap-5 border-t border-white/10 pt-6 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Built for you if
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-white/75">
                {FIT_FOR.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
                Not designed for
              </p>
              <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-white/50">
                {NOT_FIT_FOR.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </CmsSection>
  );
}

export default BeforeAfter;
