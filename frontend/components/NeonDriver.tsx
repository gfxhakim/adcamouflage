"use client";

import { useEffect } from "react";

/** How long one full rotation takes, in milliseconds. Matches globals.css. */
const PERIOD_MS = 6000;
const SLOW_PERIOD_MS = 14000;
const REDUCED_PERIOD_MS = 30000;
const REDUCED_SLOW_PERIOD_MS = 60000;

/** Frames to wait before deciding the CSS animation is not running. */
const PROBE_DELAY_MS = 250;

/**
 * Guarantees the neon borders actually rotate.
 *
 * The rotation is normally driven entirely by CSS: `--neon-angle` is a
 * registered custom property animated once on `:root`, and every card inherits
 * it, which is what keeps the borders synchronised. That fails silently in two
 * situations, and both produce a completely static border:
 *
 *  - `@property` is unsupported (Firefox < 128, Safari < 16.4). An unregistered
 *    custom property is just a text token, so CSS cannot interpolate it.
 *  - Some environments refuse to run the keyframes at all.
 *
 * This component reads the computed angle twice. If it has not advanced, it
 * takes over with requestAnimationFrame, writing the angle to the same `:root`
 * element so inheritance - and therefore synchronisation - still holds.
 *
 * It renders nothing.
 */
export function NeonDriver() {
  useEffect(() => {
    const root = document.documentElement;
    const readAngle = () =>
      getComputedStyle(root).getPropertyValue("--neon-angle").trim();

    let frame = 0;
    let probe = 0;

    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );

    const startFallback = () => {
      const reduced = prefersReducedMotion?.matches ?? false;
      const period = reduced ? REDUCED_PERIOD_MS : PERIOD_MS;
      const slowPeriod = reduced ? REDUCED_SLOW_PERIOD_MS : SLOW_PERIOD_MS;
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = now - start;
        const angle = ((elapsed % period) / period) * 360;
        const slowAngle = ((elapsed % slowPeriod) / slowPeriod) * 360;
        root.style.setProperty("--neon-angle", `${angle.toFixed(2)}deg`);
        root.style.setProperty("--neon-angle-slow", `${slowAngle.toFixed(2)}deg`);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const before = readAngle();
    probe = window.setTimeout(() => {
      const after = readAngle();
      // A running CSS animation reports a different interpolated angle here.
      // Anything else - unchanged, or empty because the property is not
      // registered - means nothing is driving it.
      if (after !== "" && after !== before) return;
      startFallback();
    }, PROBE_DELAY_MS);

    return () => {
      window.clearTimeout(probe);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}

export default NeonDriver;
