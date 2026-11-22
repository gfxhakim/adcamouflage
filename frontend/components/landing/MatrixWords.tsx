"use client";

import { useReducedMotion } from "framer-motion";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { useEffect, useRef } from "react";

const CHARS = "01アイウエオカキクケコサシスセソタチツテト<>/*+#=$%";
const HOLD_MS = 2300;
const MORPH_MS = 900;
const INTRO_MS = 1050;

const pickIndex = () => Math.floor(Math.random() * CHARS.length);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

interface MatrixWordsProps {
  words?: string[];
  /** Vertical centre of the focal matrix band, as a share of the hero height. */
  centerY?: number;
  /** Tallest the word block may be, as a share of the hero height. */
  maxHeight?: number;
  className?: string;
}

/**
 * Full-bleed high-FPS dot-matrix grid canvas. Renders subtle twinkling Matrix
 * symbols across the hero background (and morphs pixel-masked words when `words` is non-empty).
 */
export function MatrixWords({ words = [], centerY = 0.21, maxHeight = 0.23, className }: MatrixWordsProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  const wordsKey = words.join("\n");

  useEffect(() => {
    const activeWords = wordsKey ? wordsKey.split("\n") : [];
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;

    let cell = 8;
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let viewW = 0;
    let viewH = 0;

    let masks: Uint8Array[] = [];
    let activeCells = new Int32Array(0);
    let ambientCells = new Int32Array(0);
    let glyphIdx = new Uint8Array(0);
    let nextFlip = new Float32Array(0);
    let delay = new Float32Array(0);
    let noise = new Float32Array(0);

    const bgCanvas = document.createElement("canvas");
    const atlas = document.createElement("canvas");
    let tilePx = 12;

    let raf = 0;
    let start = performance.now();
    let visible = true;
    let ready = false;

    const buildAtlas = () => {
      tilePx = Math.max(8, Math.round(cell * dpr));
      const palettes = ["#ffffff", "#e0f2fe", "#38bdf8", "rgba(59, 130, 246, 0.78)"];
      atlas.width = CHARS.length * tilePx;
      atlas.height = palettes.length * tilePx;
      const a = atlas.getContext("2d");
      if (!a) return;
      a.clearRect(0, 0, atlas.width, atlas.height);
      const fontSize = Math.max(6, Math.round(tilePx * 0.84));
      a.font = `700 ${fontSize}px ${GeistMono.style.fontFamily}`;
      a.textAlign = "center";
      a.textBaseline = "middle";
      for (let p = 0; p < palettes.length; p++) {
        a.fillStyle = palettes[p];
        for (let g = 0; g < CHARS.length; g++) {
          a.fillText(CHARS[g], g * tilePx + tilePx * 0.5, p * tilePx + tilePx * 0.53);
        }
      }
    };

    const buildBgLayer = () => {
      bgCanvas.width = Math.max(1, Math.round(viewW * dpr));
      bgCanvas.height = Math.max(1, Math.round(viewH * dpr));
      const b = bgCanvas.getContext("2d", { alpha: false });
      if (!b) return;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = "#000000";
      b.fillRect(0, 0, viewW, viewH);
      b.fillStyle = masks.length === 0 ? "rgba(56, 189, 248, 0.16)" : "rgba(255, 255, 255, 0.085)";
      const dot = cell <= 6 ? 1.3 : 1.6;
      const half = dot * 0.5;
      for (let y = 0; y < rows; y++) {
        const cy = y * cell + cell * 0.5 - half;
        for (let x = 0; x < cols; x++) {
          b.fillRect(x * cell + cell * 0.5 - half, cy, dot, dot);
        }
      }
    };

    const measureSpacedWidth = (o: CanvasRenderingContext2D, line: string, size: number) => {
      const charGap = size * 0.22;
      const spaceGap = size * 0.44;
      const chars = Array.from(line);
      let total = 0;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        total += ch === " " ? spaceGap : o.measureText(ch).width;
        if (i < chars.length - 1 && ch !== " " && chars[i + 1] !== " ") {
          total += charGap;
        }
      }
      return total;
    };

    const drawSpacedLine = (o: CanvasRenderingContext2D, line: string, cx: number, cy: number, size: number) => {
      const charGap = size * 0.22;
      const spaceGap = size * 0.44;
      const chars = Array.from(line);
      const total = measureSpacedWidth(o, line, size);
      let cursor = cx - total * 0.5;
      o.textAlign = "left";
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === " ") {
          cursor += spaceGap;
          continue;
        }
        const cw = o.measureText(ch).width;
        o.fillText(ch, cursor, cy);
        cursor += cw + (i < chars.length - 1 && chars[i + 1] !== " " ? charGap : 0);
      }
    };

    const buildMask = (word: string) => {
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const o = off.getContext("2d");
      const mask = new Uint8Array(cols * rows);
      if (!o) return mask;

      const family = `${GeistSans.style.fontFamily}, ui-sans-serif, system-ui, sans-serif`;
      const tokens = word.trim().split(/\s+/).filter(Boolean);
      // Stack words on narrow screens so every letter stays wide, spaced, and bold.
      const lines = cols < 96 && tokens.length > 1 ? tokens : [tokens.join(" ")];
      const viewRows = Math.min(rows, viewH / cell);
      const lineGap = lines.length > 1 ? 1.24 : 1.0;

      let size = (viewRows * maxHeight) / (lines.length * lineGap);
      o.font = `900 ${size}px ${family}`;
      const maxWidth = cols * 0.88;
      const widest = Math.max(1, ...lines.map((l) => measureSpacedWidth(o, l, size)));
      if (widest > maxWidth) size *= maxWidth / widest;
      size = Math.max(9, size);

      o.font = `900 ${size}px ${family}`;
      o.textBaseline = "middle";
      o.fillStyle = "#ffffff";

      const blockHeight = lines.length * size * lineGap;
      const headerClearanceRows = (viewW < 640 ? 68 : 74) / cell + size * 0.52;
      const mid = Math.max(headerClearanceRows + Math.max(0, (lines.length - 1) * 0.5 * size * lineGap), viewRows * centerY);

      lines.forEach((line, idx) => {
        const ly = mid + (idx - (lines.length - 1) * 0.5) * size * lineGap;
        if (ly + size * 0.45 < rows) {
          drawSpacedLine(o, line, cols * 0.5, ly, size);
        }
      });

      const data = o.getImageData(0, 0, cols, rows).data;
      // Threshold tuned slightly below 50% so 900-weight stems stay bold and connected without merging across char gaps.
      for (let i = 0; i < mask.length; i++) {
        mask[i] = data[i * 4 + 3] > 90 ? 1 : 0;
      }
      // Keep blockHeight read cleanly so lint has zero unused bindings if trimmed later.
      void blockHeight;
      return mask;
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      viewW = w;
      viewH = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cell = w < 520 ? 5 : w < 900 ? 7 : w < 1360 ? 8 : 9;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);

      buildAtlas();
      const total = cols * rows;
      masks = activeWords.map(buildMask);
      buildBgLayer();
      glyphIdx = new Uint8Array(total);
      nextFlip = new Float32Array(total);
      delay = new Float32Array(total);
      noise = new Float32Array(total);

      const active: number[] = [];
      const ambient: number[] = [];
      const anyMask = new Uint8Array(total);
      for (let m = 0; m < masks.length; m++) {
        const mask = masks[m];
        for (let i = 0; i < total; i++) {
          if (mask[i] === 1) anyMask[i] = 1;
        }
      }

      const ambientThreshold = masks.length === 0 ? 0.855 : 0.982;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          glyphIdx[i] = pickIndex();
          noise[i] = Math.random();
          nextFlip[i] = Math.random() * 1400;
          delay[i] = (x / cols) * 0.62 + (y / rows) * 0.14 + Math.random() * 0.24;
          if (anyMask[i] === 1) {
            active.push(i);
          } else if (noise[i] > ambientThreshold) {
            ambient.push(i);
          }
        }
      }

      activeCells = Int32Array.from(active);
      ambientCells = Int32Array.from(ambient);
    };

    const draw = (now: number) => {
      if (!ready || !viewW || !viewH) return;

      ctx.globalAlpha = 1;
      ctx.drawImage(bgCanvas, 0, 0, viewW, viewH);

      const t = reduce ? INTRO_MS : Math.max(0, now - start);
      const isAmbientField = masks.length === 0;
      const ambInset = cell <= 6 ? 0.25 : 0.45;
      const ambPlate = cell - ambInset * 2;

      // Shimmering Matrix characters across the hero canvas.
      for (let a = 0; a < ambientCells.length; a++) {
        const i = ambientCells[a];
        if (!reduce && now >= nextFlip[i]) {
          glyphIdx[i] = pickIndex();
          nextFlip[i] = now + (isAmbientField ? 220 + Math.random() * 880 : 450 + Math.random() * 1600);
        }
        const col = i % cols;
        const row = (i / cols) | 0;
        const px = col * cell;
        const py = row * cell;
        if (isAmbientField) {
          const wave = 0.5 + 0.5 * Math.sin(t * 0.0028 - row * 0.34 + col * 0.11 + noise[i] * 24);
          if (wave > 0.72) {
            ctx.globalAlpha = (wave - 0.72) * 1.4;
            ctx.fillStyle = noise[i] > 0.95 ? "rgba(56, 189, 248, 0.34)" : "rgba(8, 102, 255, 0.36)";
            ctx.fillRect(px + ambInset, py + ambInset, ambPlate, ambPlate);
          }
          ctx.globalAlpha = 0.28 + 0.7 * wave;
          const pRow = wave > 0.88 && noise[i] > 0.94 ? 0 : wave > 0.68 ? 1 : noise[i] > 0.91 ? 2 : 3;
          ctx.drawImage(atlas, glyphIdx[i] * tilePx, pRow * tilePx, tilePx, tilePx, px, py, cell, cell);
        } else {
          const pulse = Math.abs(Math.sin(t * 0.0016 + noise[i] * 50));
          ctx.globalAlpha = 0.28 + 0.48 * pulse;
          ctx.drawImage(atlas, glyphIdx[i] * tilePx, 3 * tilePx, tilePx, tilePx, px, py, cell, cell);
        }
      }

      if (masks.length === 0) {
        ctx.globalAlpha = 1;
        return;
      }

      const cycle = HOLD_MS + MORPH_MS;
      const step = Math.floor(t / cycle);
      const phase = t - step * cycle;
      const from = masks[step % masks.length];
      const to = masks[(step + 1) % masks.length];
      const morph = phase > HOLD_MS ? (phase - HOLD_MS) / MORPH_MS : -1;
      const introProgress = step === 0 && !reduce ? Math.min(1, t / INTRO_MS) : 1;

      const inset = cell <= 6 ? 0.25 : 0.45;
      const plateSize = cell - inset * 2;

      // Active & morphing letter cells drawn with crisp luminous plates + GPU atlas glyphs.
      for (let k = 0; k < activeCells.length; k++) {
        const i = activeCells[k];
        const f = from[i];
        const target = to[i];

        let level = f;
        let morphEdge = 0;

        if (introProgress < 1) {
          const local = (introProgress - delay[i] * 0.65) / 0.35;
          if (local <= 0) {
            level = 0;
          } else if (local >= 1) {
            level = f;
          } else {
            level = f * easeOutCubic(local);
            if (f === 1) morphEdge = Math.sin(local * Math.PI);
          }
        } else if (morph >= 0) {
          if (f !== target) {
            const local = (morph - delay[i] * 0.65) / 0.35;
            if (local <= 0) {
              level = f;
            } else if (local >= 1) {
              level = target;
            } else {
              const eased = easeOutCubic(local);
              level = f === 1 ? 1 - eased : eased;
              morphEdge = Math.sin(local * Math.PI);
            }
          }
        }

        if (level <= 0.04 && morphEdge <= 0.05) continue;

        if (!reduce && (morphEdge > 0.25 || now >= nextFlip[i])) {
          glyphIdx[i] = pickIndex();
          nextFlip[i] = now + (morphEdge > 0.25 ? 45 + Math.random() * 55 : 240 + Math.random() * 680);
        }

        const col = i % cols;
        const row = (i / cols) | 0;
        const px = col * cell;
        const py = row * cell;

        if (morphEdge > 0.35) {
          ctx.globalAlpha = Math.min(1, 0.35 + morphEdge * 0.65);
          ctx.fillStyle = "rgba(147, 197, 253, 0.82)";
          ctx.fillRect(px + inset, py + inset, plateSize, plateSize);
          ctx.globalAlpha = 1;
          ctx.drawImage(atlas, glyphIdx[i] * tilePx, 0, tilePx, tilePx, px, py, cell, cell);
        } else {
          ctx.globalAlpha = Math.min(1, level);
          // Bold vibrant Meta-blue cell plate makes every letter silhouette razor sharp.
          ctx.fillStyle = noise[i] > 0.72 ? "rgba(37, 128, 255, 0.88)" : "rgba(8, 102, 255, 0.76)";
          ctx.fillRect(px + inset, py + inset, plateSize, plateSize);
          const paletteRow = noise[i] > 0.72 ? 0 : noise[i] > 0.32 ? 1 : 2;
          ctx.drawImage(atlas, glyphIdx[i] * tilePx, paletteRow * tilePx, tilePx, tilePx, px, py, cell, cell);
        }
      }

      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
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
  }, [wordsKey, centerY, maxHeight, reduce]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

export default MatrixWords;
