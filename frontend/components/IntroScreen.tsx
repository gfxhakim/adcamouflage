"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import HeroText from "@/components/ui/hero-shutter-text";

/** How long the intro holds before the shutter opens (about 5 s in all). */
const SHOW_MS = 4100;
/** How long the shutter takes to open. */
const OPEN_MS = 900;
/** Horizontal blades the screen splits into when it opens. */
const BLADES = 6;

const EASE = [0.76, 0, 0.24, 1] as const;

type Phase = "playing" | "opening" | "done";

/**
 * Full-screen "LET'S RUN F*CKED ADS" intro, mounted once in the root layout.
 *
 * It plays when someone opens the site's link (or refreshes) on the landing
 * page, and nowhere else: not on the login, workspace or admin pages, not after
 * signing in or out, and not again while the visitor clicks around, because
 * the layout stays mounted across client navigations. After about 4 seconds the
 * screen splits into blades that slide away to either side.
 */
export function IntroScreen() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>(pathname === "/" ? "playing" : "done");

  useEffect(() => {
    if (phase === "done") return;
    const root = document.documentElement;
    // Set by INTRO_GATE_SCRIPT (lib/intro.ts) when this load was a hop inside the site.
    if (root.getAttribute("data-intro") === "off") {
      setPhase("done");
      return;
    }
    root.style.overflow = "hidden";
    const open = window.setTimeout(() => setPhase("opening"), SHOW_MS);
    const done = window.setTimeout(() => setPhase("done"), SHOW_MS + OPEN_MS);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(done);
      root.style.overflow = "";
    };
    // Only on the first mount: the layout keeps this mounted across pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "playing") document.documentElement.style.overflow = "";
  }, [phase]);

  if (phase === "done") return null;
  const opening = phase === "opening";

  return (
    <div
      className="intro-screen fixed inset-0 z-[100] overflow-hidden"
      style={{ pointerEvents: opening ? "none" : "auto" }}
      aria-hidden={opening}
    >
      {/* The white screen, cut into blades that part when the intro ends. */}
      {Array.from({ length: BLADES }, (_, index) => (
        <motion.div
          key={index}
          className="absolute inset-x-0 bg-white"
          style={{ top: `${(index * 100) / BLADES}%`, height: `${100 / BLADES + 0.5}%` }}
          initial={false}
          animate={{ x: opening ? (index % 2 ? "105%" : "-105%") : "0%" }}
          transition={{ duration: OPEN_MS / 1000 - 0.15, delay: opening ? index * 0.03 : 0, ease: EASE }}
        />
      ))}

      <motion.div
        className="relative flex h-full flex-col items-center justify-center px-4"
        initial={false}
        animate={opening ? { opacity: 0, scale: 1.06, filter: "blur(6px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.35, ease: "easeIn" }}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_45%,rgb(8_102_255_/_0.09),transparent_70%)]"
          aria-hidden
        />

        <HeroText
          lines={["LET'S RUN", "F*CKED ADS"]}
          lineClassNames={["text-black", "text-meta-500"]}
          className="relative"
        />

        <div className="relative mt-8 h-1 w-40 overflow-hidden rounded-full bg-meta-100 sm:mt-10 sm:w-56">
          <motion.div
            className="h-full origin-left rounded-full bg-meta-500"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: SHOW_MS / 1000 - 0.2, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </div>
  );
}

export default IntroScreen;
