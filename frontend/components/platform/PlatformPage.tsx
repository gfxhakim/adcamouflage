"use client";

import Header from "@/components/Header";
import DeckRail from "@/components/DeckRail";
import ThemeDock from "@/components/ThemeDock";
import PlatformStudio from "@/components/platform/PlatformStudio";
import { useRequireUser } from "@/lib/useRequireUser";
import type { PlatformConfig } from "@/lib/platforms";
import { useDeckTheme } from "@/lib/deckTheme";

/** The workspace shell for one per-platform format studio. */
export default function PlatformPage({ platform }: { platform: PlatformConfig }) {
  const onDark = useDeckTheme() === "dark";
  const user = useRequireUser();
  const Icon = platform.icon;

  return (
    <div className="deck min-h-screen">
      <Header user={user} onDark={onDark} />

      <div className="mx-auto flex max-w-7xl gap-5 px-4 pb-40 pt-6 md:pb-24 sm:px-6 sm:pt-8 lg:px-8">
        <DeckRail onDark={onDark} />

        <main className="min-w-0 flex-1">
          <section className="mb-6 flex flex-col gap-1 sm:mb-8">
            <p className="label flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {platform.name} format studio
            </p>
            <h1 className="font-display text-4xl font-normal leading-tight text-black dark:text-slate-50 sm:text-5xl">
              Format for {platform.name}
            </h1>
            <p className="max-w-2xl text-sm text-ink-muted dark:text-slate-400">
              {platform.tagline} Pick the right frame, preview how your clip sits in it, and save a
              cover thumbnail. {platform.safeZonesNote}
            </p>
          </section>

          <PlatformStudio platform={platform} />
        </main>
      </div>
      <ThemeDock />
    </div>
  );
}
