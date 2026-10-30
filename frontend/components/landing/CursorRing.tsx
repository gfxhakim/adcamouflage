"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { useEffect, useState } from "react";

import { useCms } from "@/components/cms/ContentProvider";

/** A blue ring that trails the mouse on desktop and grows over links and buttons. */
export function CursorRing() {
  const cms = useCms();
  cms.register({ key: "cursorRing", type: "toggle", label: "Cursor ring that follows the mouse" });
  const off = cms.hidden("cursorRing");
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [hover, setHover] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 500, damping: 40, mass: 0.6 });

  useEffect(() => {
    if (off || reduce || !window.matchMedia("(pointer: fine)").matches) return;
    setEnabled(true);
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = e.target as Element | null;
      setHover(Boolean(t?.closest?.("a, button, [role=slider]")));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [off, reduce, x, y]);

  if (!enabled || off) return null;
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[60] rounded-full border-2 border-meta-500 mix-blend-normal"
      style={{ x: sx, y: sy, translateX: "-50%", translateY: "-50%" }}
      animate={{ width: hover ? 44 : 22, height: hover ? 44 : 22, backgroundColor: hover ? "rgba(8,102,255,0.15)" : "rgba(8,102,255,0)" }}
      transition={{ duration: 0.2 }}
      aria-hidden
    />
  );
}

export default CursorRing;
