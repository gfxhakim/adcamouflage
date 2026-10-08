"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface NavItem {
  name: string;
  /** An in-page anchor such as "#features"; the target element's id is the part after "#". */
  url: string;
  icon: React.ElementType;
}

interface GlassmorphismNavBarProps {
  items: NavItem[];
  /**
   * `header`: an inline pill for the middle of the site header (shown from lg up).
   * `dock`: a bar fixed to the bottom of the screen (shown below lg).
   * Render one of each; only one is ever visible.
   */
  variant?: "header" | "dock";
  className?: string;
  /** Pixels kept clear above a section after jumping to it (the sticky header). */
  offset?: number;
}

const SCROLL_MS = 900;

/** easeInOutCubic: slow start, quick middle, soft landing. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function sectionId(url: string) {
  return url.startsWith("#") ? url.slice(1) : url;
}

/**
 * A white glass pill that jumps between sections of a page.
 * Desktop: sits in the site header. Phone and tablet: docked at the bottom, icons with labels.
 * The active item follows the scroll position and slides between items.
 */
export function GlassmorphismNavBar({
  items,
  variant = "header",
  className,
  offset = 88,
}: GlassmorphismNavBarProps) {
  const docked = variant === "dock";
  const [activeTab, setActiveTab] = useState(items[0]?.name ?? "");
  const scrolling = useRef<number | null>(null);

  // Highlight whichever section the reader is currently in.
  useEffect(() => {
    const update = () => {
      if (scrolling.current !== null) return;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = items[0]?.name ?? "";
      for (const item of items) {
        const el = document.getElementById(sectionId(item.url));
        if (el && el.getBoundingClientRect().top - offset - 40 <= 0) current = item.name;
      }
      if (atBottom && items.length) current = items[items.length - 1].name;
      setActiveTab(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items, offset]);

  const goTo = useCallback(
    (item: NavItem) => {
      const el = document.getElementById(sectionId(item.url));
      if (!el) return;
      setActiveTab(item.name);

      const start = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // The first item is the top of the page; the rest land just under the header.
      const target =
        item === items[0]
          ? 0
          : Math.min(max, Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset));
      history.replaceState(null, "", item.url);

      if (scrolling.current !== null) cancelAnimationFrame(scrolling.current);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || Math.abs(target - start) < 2) {
        window.scrollTo(0, target);
        scrolling.current = null;
        return;
      }

      const began = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - began) / SCROLL_MS);
        window.scrollTo(0, start + (target - start) * ease(t));
        if (t < 1) {
          scrolling.current = requestAnimationFrame(step);
        } else {
          scrolling.current = null;
        }
      };
      scrolling.current = requestAnimationFrame(step);
    },
    [items, offset],
  );

  const bar = (
    <nav
      aria-label="Page sections"
      className={cn(
        "pointer-events-auto flex items-center rounded-full p-1",
        docked ? "w-full max-w-lg justify-between gap-0" : "justify-center gap-1",
        "border border-meta-500/15 bg-white/[0.88]",
        "shadow-[0_8px_28px_-10px_rgb(8_102_255_/_0.35),0_1px_2px_rgb(0_0_0_/_0.04)]",
        "transition-shadow duration-300",
        "hover:shadow-[0_0_0_1px_rgb(8_102_255_/_0.12),0_12px_40px_-8px_rgb(8_102_255_/_0.55),0_0_24px_-6px_rgb(8_102_255_/_0.45)]",
        !docked && className,
      )}
      style={{
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.name;

        return (
          <a
            key={item.name}
            href={item.url}
            onClick={(event) => {
              event.preventDefault();
              goTo(item);
            }}
            aria-current={isActive ? "location" : undefined}
            className={cn(
              "relative flex cursor-pointer items-center rounded-full font-semibold transition-colors duration-300",
              docked
                ? "min-w-0 flex-1 flex-col gap-0.5 px-0.5 py-1.5 text-[10px] tracking-tight sm:text-xs"
                : "px-3.5 py-1.5 text-sm xl:px-4",
              isActive ? "text-meta-600" : "text-ink-muted hover:text-meta-500",
            )}
          >
            {docked ? <Icon className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden /> : null}
            <span className="max-w-full truncate whitespace-nowrap">{item.name}</span>

            {isActive && (
              <motion.div
                layoutId={`lamp-${variant}`}
                className="absolute inset-0 -z-10 w-full rounded-full bg-meta-50"
                initial={false}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <div className="absolute -top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-t-full bg-meta-500">
                  <div className="absolute -left-2 -top-2 h-6 w-12 rounded-full bg-meta-500/20 blur-md" />
                  <div className="absolute -top-1 h-6 w-8 rounded-full bg-meta-500/20 blur-md" />
                  <div className="absolute left-2 top-0 h-4 w-4 rounded-full bg-meta-500/20 blur-sm" />
                </div>
              </motion.div>
            )}
          </a>
        );
      })}
    </nav>
  );

  if (!docked) return bar;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {bar}
    </div>
  );
}

export default GlassmorphismNavBar;
