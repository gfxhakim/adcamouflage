"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import HeroText from "@/components/ui/hero-shutter-text";

const SEEN_KEY = "adcam-intro-seen";
const SHOW_MS = 4000;

// Runs while the HTML is still parsing, before the overlay paints, so visitors
// who already saw the intro in this tab (or who asked for less motion) never
// get a flash of it. globals.css hides .intro-screen under this attribute.
const SKIP_SCRIPT = `try{if(sessionStorage.getItem("${SEEN_KEY}")==="1"||matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.setAttribute("data-intro-seen","")}catch(e){}`;

/** Full-screen "LET'S RUN F*CKED ADS" intro for 4 seconds, once per browser tab, then a curtain lift. */
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
            className="intro-screen fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-white px-4"
            exit={{ y: "-100%" }}
            transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
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
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default IntroScreen;
