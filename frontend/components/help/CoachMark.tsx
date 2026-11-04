"use client";

import clsx from "clsx";
import { ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { T } from "@/components/cms/Cms";
import { HELP_TIPS, type HelpStepId } from "@/lib/helpContent";

interface CoachMarkProps {
  stepId: HelpStepId;
  stepNumber: number;
  totalSteps: number;
  active: boolean;
  onFinish: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function CoachMark({ stepId, stepNumber, totalSteps, active, onFinish }: CoachMarkProps) {
  const tips = HELP_TIPS[stepId] ?? [];
  const [tipIndex, setTipIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    setTipIndex(0);
  }, [stepId, active]);

  const currentTip = tips[tipIndex];

  const measure = useCallback(() => {
    if (!active || !currentTip) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${currentTip.anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }, [active, currentTip]);

  useEffect(() => {
    if (!active || !currentTip) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${currentTip.anchor}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const id = window.setTimeout(measure, 180);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, currentTip, measure]);

  if (!active || !currentTip) return null;

  const isLast = tipIndex >= tips.length - 1;
  const next = () => {
    if (isLast) onFinish();
    else setTipIndex((i) => i + 1);
  };
  const prev = () => {
    if (tipIndex > 0) setTipIndex((i) => i - 1);
  };

  // Position the 340px card below the target if there is room, otherwise above it.
  const cardWidth = 340;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;

  let cardLeft = Math.max(16, Math.min(viewportW - cardWidth - 16, (rect ? rect.left + rect.width / 2 : viewportW / 2) - cardWidth / 2));
  let placeAbove = false;
  let cardTop = rect ? rect.top + rect.height + 18 : viewportH / 2 - 90;

  if (rect && cardTop + 210 > viewportH && rect.top > 230) {
    placeAbove = true;
    cardTop = Math.max(16, rect.top - 205);
  }

  const arrowLeft = rect
    ? Math.max(24, Math.min(cardWidth - 32, rect.left + rect.width / 2 - cardLeft - 8))
    : cardWidth / 2 - 8;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={currentTip.title}>
      {/* Clickable backdrop that also dims everything around the target */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-2xl transition-all duration-200"
          style={{
            top: Math.max(4, rect.top - 6),
            left: Math.max(4, rect.left - 6),
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              "0 0 0 3px #0866ff, 0 0 0 10px rgba(8,102,255,0.25), 0 0 0 9999px rgba(2,4,8,0.68)",
          }}
          aria-hidden
        />
      ) : (
        <div className="fixed inset-0 bg-slate-950/65" onClick={onFinish} aria-hidden />
      )}

      {/* Invisible click catcher outside the card */}
      <div className="fixed inset-0" onClick={onFinish} aria-hidden />

      {/* Coach-mark card */}
      <div
        className="fixed z-10 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-4.5 text-[#0b0d12] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
        style={{ top: cardTop, left: cardLeft, padding: "18px" }}
      >
        {rect ? (
          <span
            className={clsx(
              "pointer-events-none absolute h-4 w-4 rotate-45 bg-white",
              placeAbove ? "-bottom-2" : "-top-2",
            )}
            style={{ left: arrowLeft }}
            aria-hidden
          />
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-meta-600">
            Step {stepNumber} of {totalSteps} · Tip {tipIndex + 1}/{tips.length}
          </span>
          <button
            type="button"
            onClick={onFinish}
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="Dismiss tips"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        <h3 className="mt-1.5 text-base font-bold tracking-[-0.01em] text-slate-950">
          <T k={`help.tip.${stepId}.${tipIndex}.title`} label={`Step ${stepNumber} tip ${tipIndex + 1} title`}>
            {currentTip.title}
          </T>
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
          <T k={`help.tip.${stepId}.${tipIndex}.body`} long label={`Step ${stepNumber} tip ${tipIndex + 1} body`}>
            {currentTip.body}
          </T>
        </p>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {tips.map((_, idx) => (
              <span
                key={idx}
                className={clsx(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  idx <= tipIndex ? "bg-meta-600" : "bg-slate-300",
                )}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {tipIndex > 0 ? (
              <button
                type="button"
                onClick={prev}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1.5 rounded-full bg-meta-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-meta-600"
            >
              {isLast ? "Got it" : "Next"}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CoachMark;
