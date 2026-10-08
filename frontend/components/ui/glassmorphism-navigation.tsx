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
  className?: string;
  /** Pixels kept clear above a section on desktop, where this bar sits under the header. */
  offset?: number;
  /** Pixels kept clear on phones, where the bar is docked at the bottom. */
  mobileOffset?: number;
}

const SCROLL_MS = 900;

/** easeInOutCubic: slow start, quick middle, soft landing. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const clearance = (desktop: number, phone: number) =>
  window.matchMedia("(min-width: 768px)").matches ? desktop : phone;

function sectionId(url: string) {
  return url.startsWith("#") ? url.slice(1) : url;
}

/**
 * A floating white glass pill that jumps between sections of a page.
 * Desktop: centred under the site header. Phone: docked at the bottom, icons with labels.
 * The active item follows the scroll position and slides between items.
 */
export function GlassmorphismNavBar({
  items,
  className,
  offset = 140,
  mobileOffset = 80,
}: GlassmorphismNavBarProps) {
  const [activeTab, setActiveTab] = useState(items[0]?.name ?? "");
  const scrolling = useRef<number | null>(null);

  // Highlight whichever section the reader is currently in.
  useEffect(() => {
    const update = () => {
      if (scrolling.current !== null) return;
      const clear = clearance(offset, mobileOffset);
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = items[0]?.name ?? "";
      for (const item of items) {
        const el = document.getElementById(sectionId(item.url));
        if (el && el.getBoundingClientRect().top - clear - 40 <= 0) current = item.name;
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
  }, [items, offset, mobileOffset]);

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
          : Math.min(
              max,
              Math.max(
                0,
                el.getBoundingClientRect().top + window.scrollY - clearance(offset, mobileOffset),
              ),
            );
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
    [items, offset, mobileOffset],
  );

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 pb-[env(safe-area-inset-bottom)]",
        "md:bottom-auto md:top-[76px] md:px-0 md:pb-0",
        "pointer-events-none",
        className,
      )}
    >
      <nav
        aria-label="Page sections"
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-center justify-between gap-1 rounded-full p-1",
          "md:w-auto md:max-w-none md:justify-center",
          "border border-meta-500/15 bg-white/[0.88]",
          "shadow-[0_8px_28px_-10px_rgb(8_102_255_/_0.35),0_1px_2px_rgb(0_0_0_/_0.04)]",
          "transition-shadow duration-300",
          "hover:shadow-[0_0_0_1px_rgb(8_102_255_/_0.12),0_12px_40px_-8px_rgb(8_102_255_/_0.55),0_0_24px_-6px_rgb(8_102_255_/_0.45)]",
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
                "relative flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-semibold transition-colors duration-300",
                "md:flex-none md:flex-row md:px-5 md:py-2 md:text-sm",
                isActive ? "text-meta-600" : "text-ink-muted hover:text-meta-500",
              )}
            >
              <Icon className="h-[18px] w-[18px] md:hidden" strokeWidth={2.4} aria-hidden />
              <span className="whitespace-nowrap">{item.name}</span>

              {isActive && (
                <motion.div
                  layoutId="lamp"
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
    </div>
  );
}

export default GlassmorphismNavBar;
