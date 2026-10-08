"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ShieldHalf } from "lucide-react";
import { useEffect, useState } from "react";

import HeroText from "@/components/ui/hero-shutter-text";

const SEEN_KEY = "adcam-intro-seen";
const SHOW_MS = 2900;

// Runs while the HTML is still parsing, before the overlay paints, so visitors
// who already saw the intro in this tab (or who asked for less motion) never
// get a flash of it. globals.css hides .intro-screen under this attribute.
const SKIP_SCRIPT = `try{if(sessionStorage.getItem("${SEEN_KEY}")==="1"||matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.setAttribute("data-intro-seen","")}catch(e){}`;

/** Full-screen "LET'S RUN F*CKED ADS" intro, once per browser tab, then a curtain lift. */
export function IntroScreen() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (document.documentElement.hasAttribute("data-intro-seen")) {
      setShow(false);
      return;
    }
    const root = document.documentElement;
    root.style.overflow = "hidden";
    const timer = window.setTimeout(() => setShow(false), SHOW_MS);
    return () => {
      window.clearTimeout(timer);
      root.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (show) return;
    document.documentElement.style.overflow = "";
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private mode: the intro simply plays again next time.
    }
  }, [show]);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      <AnimatePresence>
        {show ? (
          <motion.div
            key="intro"
            className="intro-screen fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-white px-4"
            exit={{ y: "-100%" }}
            transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
            onClick={() => setShow(false)}
            role="presentation"
          >
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_45%,rgb(8_102_255_/_0.09),transparent_70%)]"
              aria-hidden
            />

            <motion.div
              className="absolute inset-x-0 top-6 flex items-center justify-center gap-2 sm:top-8"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-meta-500/30 bg-meta-50">
                <ShieldHalf className="h-4 w-4 text-meta-500" aria-hidden />
              </span>
              <span className="text-sm font-semibold tracking-tight text-black">
                Ad<span className="text-gradient">Camouflage</span>
              </span>
            </motion.div>

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

            <button
              type="button"
              className="absolute bottom-6 right-6 text-xs font-semibold uppercase tracking-[0.2em] text-ink-faint transition-colors hover:text-meta-500 sm:bottom-8 sm:right-8"
              onClick={() => setShow(false)}
            >
              Skip
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default IntroScreen;
