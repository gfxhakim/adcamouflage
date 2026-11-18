"use client";

import clsx from "clsx";
import { Facebook, Lock, Music2, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { UpgradeHint } from "@/components/OptionsPanel";
import type { PlanFeatureId } from "@/lib/plan-features";
import type { PlatformId } from "@/lib/types";

export type { PlatformId };

const PLATFORMS: { id: PlatformId; label: string; icon: LucideIcon }[] = [
  { id: "meta", label: "Meta", icon: Facebook },
  { id: "tiktok", label: "TikTok", icon: Music2 },
  { id: "youtube", label: "YouTube", icon: Youtube },
];

const STORAGE_KEY = "adcam.platform";

function readSaved(): PlatformId | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return PLATFORMS.some((p) => p.id === saved) ? (saved as PlatformId) : null;
  } catch {
    return null;
  }
}

/**
 * Which platform this batch is for — Meta, TikTok or YouTube.
 * Starter only allows Meta exports; TikTok and YouTube unlock on Pro & Max.
 */
export function PlatformPicker({
  value,
  onChange,
  disabled = false,
  lockedFeatures = [],
  upgradeHref = "/app/plan",
}: {
  value?: PlatformId;
  onChange?: (platform: PlatformId) => void;
  disabled?: boolean;
  lockedFeatures?: PlanFeatureId[];
  upgradeHref?: string;
}) {
  const [localPlatform, setLocalPlatform] = useState<PlatformId>("meta");
  const multiPlatformLocked = lockedFeatures.includes("multi_platform");

  useEffect(() => {
    const saved = readSaved();
    const initial = multiPlatformLocked ? "meta" : (saved ?? "meta");
    setLocalPlatform(initial);
    onChange?.(initial);
    // Sync stored preference once when lock state loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiPlatformLocked]);

  const activePlatform: PlatformId = multiPlatformLocked ? "meta" : (value ?? localPlatform);

  const choose = (id: PlatformId) => {
    if (multiPlatformLocked && id !== "meta") return;
    setLocalPlatform(id);
    onChange?.(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="label">Platform</p>
        {multiPlatformLocked ? <UpgradeHint href={upgradeHref} /> : null}
      </div>
      <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Platform">
        {PLATFORMS.map(({ id, label, icon: Icon }) => {
          const active = activePlatform === id;
          const optionLocked = multiPlatformLocked && id !== "meta";
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || optionLocked}
              title={
                optionLocked
                  ? "Starter plan only supports Meta. Upgrade to Pro or Max to unlock TikTok & YouTube."
                  : undefined
              }
              onClick={() => choose(id)}
              className={clsx(
                "flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-all duration-200 sm:flex-row sm:gap-2 sm:px-3 sm:py-3 sm:text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500/60",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-meta-500/60 bg-gradient-to-br from-meta-100 to-meta-50 text-meta-700 shadow-meta-sm dark:border-meta-500/50 dark:from-meta-500/20 dark:to-meta-500/10 dark:text-meta-100"
                  : "border-black/10 bg-black/[0.02] text-ink-muted hover:border-black/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/15",
              )}
            >
              {optionLocked ? (
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      {multiPlatformLocked ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          Starter plan supports Meta only. Upgrade to Pro or Max for TikTok and YouTube.
        </p>
      ) : null}
    </section>
  );
}

export default PlatformPicker;
