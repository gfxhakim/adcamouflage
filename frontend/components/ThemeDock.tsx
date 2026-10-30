"use client";

import clsx from "clsx";
import { Moon, Sun, type LucideIcon } from "lucide-react";

import { useCms } from "@/components/cms/ContentProvider";
import { setDeckTheme, useDeckTheme, type DeckTheme } from "@/lib/deckTheme";

const OPTIONS: { theme: DeckTheme; label: string; icon: LucideIcon }[] = [
  { theme: "dark", label: "Black background", icon: Moon },
  { theme: "light", label: "White background", icon: Sun },
];

/**
 * Icons-only black / white background switch, docked at the bottom centre of
 * the workspace pages. On phones it sits just above the floating nav pill.
 */
export function ThemeDock() {
  const theme = useDeckTheme();
  const cms = useCms();
  cms.register({ key: "themeToggle", type: "toggle", label: "Black / white background switch" });
  if (cms.hidden("themeToggle")) return null;

  return (
    <div
      role="group"
      aria-label="Background color"
      className="fixed bottom-[5.75rem] left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-black/10 bg-white/90 p-1 shadow-lifted backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80 dark:shadow-none md:bottom-5"
    >
      {OPTIONS.map(({ theme: value, label, icon: Icon }) => {
        const current = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setDeckTheme(value)}
            aria-pressed={current}
            aria-label={label}
            title={label}
            className={clsx(
              "grid h-9 w-11 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-meta-500",
              current
                ? "bg-meta-500 text-white shadow-[0_0_16px_-4px_rgb(8_102_255/0.8)]"
                : "text-ink-muted hover:bg-meta-50 hover:text-meta-700 dark:text-slate-400 dark:hover:bg-meta-500/15 dark:hover:text-meta-100",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export default ThemeDock;
