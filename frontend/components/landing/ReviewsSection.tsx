"use client";

import { useEffect, useState } from "react";

import { CmsSection, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { Reveal } from "@/components/landing/primitives";
import TestimonialMarquee from "@/components/ui/marquee-01";
import { DEFAULT_REVIEWS } from "@/lib/siteContent";

interface LiveActivity {
  active_now: number;
  subscribers: { plan: string; seconds_ago: number }[];
}

const REFRESH_MS = 60_000;

function ago(seconds: number): string {
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Real numbers from the API only; nothing is shown when there is nothing to report. */
function useLiveActivity(): LiveActivity | null {
  const [data, setData] = useState<LiveActivity | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch("/api/v1/live-activity", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as Partial<LiveActivity>;
        if (stopped) return;
        setData({
          active_now: typeof body.active_now === "number" ? body.active_now : 0,
          subscribers: Array.isArray(body.subscribers) ? body.subscribers.filter((s) => s && typeof s.plan === "string") : [],
        });
      } catch {
        /* leave the ticker as it was */
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);
  return data;
}

export function ReviewsSection() {
  const cms = useCms();
  const live = useLiveActivity();

  const sourceReviews = cms.content.reviews?.length ? cms.content.reviews : DEFAULT_REVIEWS;
  const reviews = sourceReviews.filter((r) => !r.hidden && r.name?.trim() && r.body?.trim());
  const subscribedText = cms.text("reviews.ticker.subscribed", "New {plan} subscriber · {ago}", "text", "Ticker: new subscriber ({plan}, {ago})");
  const activeText = cms.text("reviews.ticker.active", "{n} people batching right now", "text", "Ticker: people batching ({n})");
  const activeOneText = cms.text("reviews.ticker.activeOne", "1 person batching right now", "text", "Ticker: one person batching");
  const tickerHidden = cms.hidden("reviews.ticker");

  const ticker: string[] = [];
  if (live && !tickerHidden) {
    if (live.active_now > 0) ticker.push(live.active_now === 1 ? activeOneText : fill(activeText, { n: live.active_now }));
    for (const s of live.subscribers) ticker.push(fill(subscribedText, { plan: s.plan, ago: ago(s.seconds_ago) }));
  }

  if (!reviews.length && !cms.preview) return null;

  return (
    <CmsSection k="reviews" label="Reviews" id="reviews" className="scroll-mt-24 overflow-hidden bg-meta-500 py-20 text-white sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
          <div>
            <T k="reviews.headline" as="h2" className="text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              Built for media buyers who ship new creatives every week.
            </T>
          </div>
          <T k="reviews.lede" long as="p" className="text-sm leading-relaxed text-white/80">
            Upload one finished video and get every size and version you need, rendered and ready to download. Here is what people using it say.
          </T>
        </div>
      </div>

      <Reveal className="mt-12">
        {reviews.length ? (
          <TestimonialMarquee reviews={reviews} />
        ) : (
          <div className="mx-auto max-w-3xl rounded-2xl border border-dashed border-white/40 px-6 py-10 text-center text-sm text-white/80">
            No reviews yet. Add them in Admin &gt; Landing page &gt; Reviews. Visitors don&apos;t see this section until there is at least one.
          </div>
        )}
      </Reveal>

      {ticker.length ? (
        <div className="mt-12 flex overflow-hidden border-y border-white/20 py-3" aria-label="Live activity">
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy > 0 || undefined} className="flex shrink-0 animate-marquee gap-10 pr-10 motion-reduce:[animation-play-state:paused]">
              {/* Repeat a short list so the line is always full. */}
              {Array.from({ length: Math.max(1, Math.ceil(6 / ticker.length)) }).flatMap((_, r) =>
                ticker.map((line, i) => (
                  <span key={`${r}-${i}`} className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-white/85">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    {line}
                  </span>
                )),
              )}
            </div>
          ))}
        </div>
      ) : cms.preview && !tickerHidden ? (
        <p className="mx-auto mt-10 max-w-7xl px-4 font-mono text-[11px] uppercase tracking-wider text-white/60 sm:px-6 lg:px-8">
          Live activity line: shows here when someone subscribes or is rendering. Nothing right now.
        </p>
      ) : null}
    </CmsSection>
  );
}

export default ReviewsSection;
