"use client";

import { useReducedMotion } from "framer-motion";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { useEffect, useRef } from "react";

const CHARS = "01アイウエオカキクケコサシスセソタチツテト<>/\\*+#=$%";
const HOLD_MS = 2600;
const MORPH_MS = 1300;
const FRAME_MS = 1000 / 30;

const pick = () => CHARS[Math.floor(Math.random() * CHARS.length)];

interface MatrixWordsProps {
  words: string[];
  /** Vertical centre of the word, as a share of the screen height. */
  centerY?: number;
  /** Tallest the word may be, as a share of the screen height. */
  maxHeight?: number;
  className?: string;
}

/**
 * A full-bleed grid of flickering characters. The cells inside the current
 * word light up blue, hold, then morph cell by cell into the next word, and
 * the words loop.
 */
export function MatrixWords({ words, centerY = 0.3, maxHeight = 0.32, className }: MatrixWordsProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let cell = 14;
    let cols = 0;
    let rows = 0;
    let masks: Uint8Array[] = [];
    let glyph: string[] = [];
    let delay = new Float32Array(0);
    let noise = new Float32Array(0);
    let raf = 0;
    let last = 0;
    let start = performance.now();
    let visible = true;
    let ready = false;

    const buildMask = (word: string) => {
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const o = off.getContext("2d");
      const mask = new Uint8Array(cols * rows);
      if (!o) return mask;
      const family = GeistSans.style.fontFamily;
      // Narrow screens stack the words so the letters stay big enough to read.
      const lines = cols < 70 ? word.split(" ") : [word];
      const viewRows = Math.min(rows, window.innerHeight / cell);
      const lineGap = 0.96;
      let size = (viewRows * maxHeight) / (lines.length * lineGap);
      o.font = `800 ${size}px ${family}`;
      const widest = Math.max(...lines.map((l) => o.measureText(l).width));
      if (widest > cols * 0.9) size *= (cols * 0.9) / widest;
      o.font = `800 ${size}px ${family}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.fillStyle = "#fff";
      const mid = viewRows * centerY;
      lines.forEach((line, n) => {
        o.fillText(line, cols / 2, mid + (n - (lines.length - 1) / 2) * size * lineGap);
      });
      const data = o.getImageData(0, 0, cols, rows).data;
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 110 ? 1 : 0;
      return mask;
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = w < 640 ? 9 : w < 1024 ? 11 : 13;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      masks = words.map(buildMask);
      glyph = Array.from({ length: cols * rows }, pick);
      delay = new Float32Array(cols * rows);
      noise = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          // Sweep left to right with some scatter.
          delay[i] = (x / cols) * 0.6 + Math.random() * 0.4;
          noise[i] = Math.random();
        }
    };

    const draw = (now: number) => {
      if (!ready) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `600 ${Math.round(cell * 0.92)}px ${GeistMono.style.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const t = reduce ? 0 : Math.max(0, now - start);
      const cycle = HOLD_MS + MORPH_MS;
      const step = Math.floor(t / cycle);
      const phase = t - step * cycle;
      const from = masks[step % masks.length];
      const to = masks[(step + 1) % masks.length];
      const morph = phase > HOLD_MS ? (phase - HOLD_MS) / MORPH_MS : -1;
      // The very first word assembles from nothing.
      const intro = step === 0 && !reduce ? Math.min(1, t / 1400) : 1;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const cx = x * cell + cell / 2;
          const cy = y * cell + cell / 2;

          let on = from[i] === 1 && intro >= delay[i];
          let flash = false;
          if (morph >= 0) {
            const local = (morph - delay[i] * 0.7) / 0.3;
            if (local >= 1) on = to[i] === 1;
            else if (local > 0 && from[i] !== to[i]) flash = true;
          }

          if (!reduce && Math.random() < (on || flash ? 0.06 : 0.008)) glyph[i] = pick();

          if (flash) {
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.fillText(glyph[i], cx, cy);
          } else if (on) {
            ctx.fillStyle = "rgba(8,102,255,0.22)";
            ctx.fillRect(cx - cell / 2 + 0.5, cy - cell / 2 + 0.5, cell - 1, cell - 1);
            ctx.fillStyle = noise[i] > 0.9 ? "#cce0ff" : noise[i] > 0.45 ? "#3385ff" : "#0866ff";
            ctx.fillText(glyph[i], cx, cy);
          } else if (noise[i] > 0.93) {
            // Sparse dim characters in the background.
            ctx.fillStyle = `rgba(51,133,255,${0.12 + 0.18 * Math.abs(Math.sin(t / 900 + noise[i] * 40))})`;
            ctx.fillText(glyph[i], cx, cy);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.09)";
            ctx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
          }
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    const onResize = () => {
      resize();
      draw(performance.now());
    };

    document.fonts.ready.then(() => {
      resize();
      ready = true;
      start = performance.now();
      if (reduce) draw(0);
      else raf = requestAnimationFrame(loop);
    });
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [words, centerY, maxHeight, reduce]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

export default MatrixWords;
