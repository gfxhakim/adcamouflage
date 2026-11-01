"use client";

import clsx from "clsx";
import { Facebook, Music2, Youtube, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export type PlatformId = "meta" | "tiktok" | "youtube";

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
 * Which platform this batch is for — Meta, TikTok or YouTube. A plain choice
 * shown at the top of the Settings step; it has no options of its own. The
 * last pick is remembered in this browser.
 */
export function PlatformPicker({ disabled = false }: { disabled?: boolean }) {
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  useEffect(() => {
    setPlatform(readSaved());
  }, []);

  const choose = (id: PlatformId) => {
    setPlatform(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  return (
    <section>
      <p className="label mb-3">Platform</p>
      <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Platform">
        {PLATFORMS.map(({ id, label, icon: Icon }) => {
          const active = platform === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
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
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default PlatformPicker;
