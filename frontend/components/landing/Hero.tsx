"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { EASE, Headline } from "@/components/landing/primitives";

const CHIPS = ["Hash", "Pixels", "Timing", "Metadata"];

const TAGS = [
  { text: "metadata: none", className: "left-[4%] top-[34%]" },
  { text: "new hash 3b1c9e…", className: "right-[5%] top-[22%]" },
  { text: "audio +39.8 cents", className: "left-[10%] bottom-[30%]" },
];

/**
 * A crowd of files seen from above. A blue ring drifts across it, and every
 * file the ring passes over turns blue: the copy it would render.
 */
function FileCrowd() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let frame = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type Dot = { x: number; y: number; vx: number; vy: number; r: number; lit: number };
    let dots: Dot[] = [];

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(220, (w * h) / 5200));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.8 + 1.4,
        lit: 0,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const ring = {
        x: w * (0.5 + 0.34 * Math.sin(t / 5200)),
        y: h * (0.52 + 0.28 * Math.sin(t / 3700 + 1)),
        r: Math.max(120, Math.min(w, h) * 0.32),
      };

      // The ring's soft glow and edge.
      const glow = ctx.createRadialGradient(ring.x, ring.y, ring.r * 0.6, ring.x, ring.y, ring.r * 1.15);
      glow.addColorStop(0, "rgba(8,102,255,0)");
      glow.addColorStop(0.75, "rgba(8,102,255,0.22)");
      glow.addColorStop(1, "rgba(8,102,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r * 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(51,133,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();

      for (const d of dots) {
        if (!reduce) {
          d.x += d.vx;
          d.y += d.vy;
          if (d.x < -10) d.x = w + 10;
          if (d.x > w + 10) d.x = -10;
          if (d.y < -10) d.y = h + 10;
          if (d.y > h + 10) d.y = -10;
        }
        const inside = Math.hypot(d.x - ring.x, d.y - ring.y) < ring.r;
        d.lit = inside ? Math.min(1, d.lit + 0.08) : Math.max(0, d.lit - 0.01);
        ctx.fillStyle =
          d.lit > 0.02 ? `rgba(${Math.round(255 - 247 * d.lit)},${Math.round(255 - 153 * d.lit)},255,${0.35 + 0.6 * d.lit})` : "rgba(255,255,255,0.28)";
        ctx.beginPath();
        // Each "file" is a tiny rounded tile.
        ctx.roundRect(d.x - d.r, d.y - d.r * 1.3, d.r * 2, d.r * 2.6, 1);
        ctx.fill();
      }
    };

    const loop = (t: number) => {
      draw(t);
      frame = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) draw(0);
    else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [reduce]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}

/** Counts the hashes "re-rolled" since the visitor opened the page. */
function LiveCounter() {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setN((v) => v + 1 + Math.floor(Math.random() * 9)), 140);
    return () => window.clearInterval(id);
  }, [reduce]);
  return (
    <div>
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-meta-400" aria-hidden />
        Preview · hashes re-rolled since you opened this page
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
        {n.toLocaleString("en-US")}
      </p>
    </div>
  );
}

export function Hero({ startHref }: { startHref: string }) {
  return (
    <section
      id="home"
      className="relative isolate flex min-h-[calc(100svh-4rem)] scroll-mt-24 flex-col overflow-hidden bg-black text-white"
    >
      <FileCrowd />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]"
        aria-hidden
      />

      {TAGS.map((tag, i) => (
        <motion.span
          key={tag.text}
          className={`absolute hidden items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] text-black shadow-lg md:inline-flex ${tag.className}`}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1, y: [0, -8, 0] }}
          transition={{
            opacity: { delay: 1 + i * 0.3, duration: 0.5 },
            scale: { delay: 1 + i * 0.3, duration: 0.5, ease: EASE },
            y: { duration: 5 + i, repeat: Infinity, ease: "easeInOut" },
          }}
          aria-hidden
        >
          <span className="h-1.5 w-1.5 rounded-full bg-meta-500" />
          {tag.text}
        </motion.span>
      ))}

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
        <motion.span
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <ShieldCheck className="h-3.5 w-3.5 text-meta-400" aria-hidden />
          Built for media buyers who run at volume
        </motion.span>

        <Headline
          as="h1"
          dark
          text="One winning ad. | [Endless fresh copies.]"
          className="text-[2.7rem] sm:text-6xl lg:text-[5.4rem]"
        />

        <motion.p
          className="mt-6 max-w-2xl text-sm leading-relaxed text-white/75 sm:text-base"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: EASE }}
        >
          Ad platforms fingerprint every file you upload. Reuse a creative across ad sets or
          accounts and it gets matched, flagged as a duplicate and throttled. AdCamouflage
          re-renders your video or image into copies that{" "}
          <strong className="font-semibold text-white">look identical to people</strong> but carry
          a new hash, new pixels, new timing and zero metadata, so every upload starts clean.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.65, ease: EASE }}
        >
          <Link
            href={startHref}
            className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-black transition hover:bg-meta-50"
          >
            Start camouflaging free
            <span className="grid h-8 w-8 place-items-center rounded-full bg-meta-500 text-white transition-transform group-hover:rotate-[-45deg]">
              <Rocket className="h-4 w-4" aria-hidden />
            </span>
          </Link>
          <Link
            href="/login"
            className="group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/[0.06] py-1.5 pl-5 pr-1.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/[0.12]"
          >
            I already have an account
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-transform group-hover:translate-x-0.5">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </motion.div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-8 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
        <LiveCounter />
        <ul className="flex flex-wrap gap-2">
          {CHIPS.map((chip, i) => (
            <li
              key={chip}
              className="rounded-full border border-white/15 bg-black/40 px-3 py-1 font-mono text-[11px] text-white/80 backdrop-blur"
            >
              <span className="mr-1.5 text-meta-400">0{i + 1}</span>
              {chip}
            </li>
          ))}
        </ul>
        <p className="font-mono text-[11px] leading-relaxed text-white/60 md:text-right">
          Nine mutation layers
          <br />
          batch in, one zip out
        </p>
      </div>
    </section>
  );
}

export default Hero;
