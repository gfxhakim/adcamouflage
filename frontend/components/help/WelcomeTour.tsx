"use client";

import clsx from "clsx";
import { ArrowRight, Check, Layers, Play, Settings, Upload, X, Zap } from "lucide-react";

import { MediaView, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import { HELP_STEPS, type HelpStepId } from "@/lib/helpContent";

const STEP_ICONS: Record<HelpStepId, typeof Upload> = {
  upload: Upload,
  configure: Settings,
  overlay: Layers,
  run: Zap,
};

const PROMISES = [
  "Your file looks identical to people",
  "Every copy gets a brand-new fingerprint",
  "1 output file = 1 generation (token cost shown before render)",
];

interface WelcomeTourProps {
  open: boolean;
  activeStep: number;
  onStartTour: () => void;
  onSkip: () => void;
  onJumpStep?: (stepIndex: number) => void;
}

export function WelcomeTour({ open, activeStep, onStartTour, onSkip, onJumpStep }: WelcomeTourProps) {
  const cms = useCms();
  const walkMedia = cms.media(
    "help.tour.media",
    { src: "", kind: "video", fit: "contain", radius: 14, autoplay: true, loop: true, muted: true, controls: true },
    "Welcome tour walkthrough video or GIF",
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-tour-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm transition-opacity"
        onClick={onSkip}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative z-10 grid w-full max-w-[880px] overflow-hidden rounded-[28px] border border-meta-500/35 bg-[#0b0e15] text-slate-100 shadow-[0_40px_120px_rgba(0,0,0,0.75),0_0_0_1px_rgba(8,102,255,0.15)] lg:grid-cols-2">
        <button
          type="button"
          onClick={onSkip}
          className="absolute right-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          title="Close tour"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        {/* Left column — 4 steps & optional walkthrough video */}
        <div className="flex flex-col justify-between bg-[radial-gradient(circle_at_30%_20%,rgba(8,102,255,0.48),transparent_58%),linear-gradient(160deg,#0a1a3d,#04060b)] p-6 sm:p-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta-300">
              <T k="help.tour.leftKicker" label="Tour left kicker">
                Your first ad · 60 seconds
              </T>
            </p>

            <div className="mt-6 space-y-2.5">
              {HELP_STEPS.map((s, idx) => {
                const Icon = STEP_ICONS[s.id];
                const isCurrent = idx === activeStep;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onJumpStep?.(idx)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-[13px] transition",
                      isCurrent
                        ? "border-meta-400/50 bg-meta-500/25 text-white shadow-[0_0_24px_-6px_rgba(8,102,255,0.6)]"
                        : "border-white/10 bg-white/[0.05] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]",
                    )}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-meta-500/35 text-meta-200">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 font-medium">
                      {idx + 1} ·{" "}
                      <T k={`help.tour.step.${s.id}.line`} label={`Tour step ${idx + 1} line`}>
                        {s.line}
                      </T>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-meta-300">
                      <T k={`help.tour.step.${s.id}.time`} label={`Tour step ${idx + 1} time`}>
                        {s.time}
                      </T>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Walkthrough video or placeholder slot */}
          {!cms.hidden("help.tour.media") ? (
            <div className="mt-5" {...cms.mark("help.tour.media")}>
              {walkMedia.src ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/50">
                  <MediaView value={walkMedia} className="max-h-44 w-full object-contain" />
                </div>
              ) : (
                <div className="flex h-20 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-4 text-xs text-meta-300">
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                  <span>
                    <T k="help.tour.videoLabel" label="Tour video caption">
                      60-second workspace walkthrough (customizable in Admin &gt; Workspace)
                    </T>
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Right column — Welcome message & promises */}
        <div className="flex flex-col justify-between p-6 sm:p-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta-300">
              <T k="help.tour.kicker" label="Tour welcome kicker">
                Welcome to BluCloaking
              </T>
            </p>
            <h2
              id="welcome-tour-title"
              className="mt-2.5 text-2xl font-bold leading-[1.08] tracking-[-0.03em] text-white sm:text-3xl"
            >
              <T k="help.tour.title" label="Tour headline">
                One winning ad in. Fresh, unique copies out.
              </T>
            </h2>
            <p className="mt-3.5 text-sm leading-relaxed text-slate-400">
              <T k="help.tour.body" long label="Tour intro paragraph">
                Here&apos;s how the workspace works. Four short steps — we&apos;ll highlight each control the first time you use it.
              </T>
            </p>

            <ul className="mt-5 space-y-2.5 text-[13px] text-slate-200">
              {PROMISES.map((promise, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-meta-500 text-white">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                  </span>
                  <T k={`help.tour.promise.${i}`} label={`Tour promise ${i + 1}`}>
                    {promise}
                  </T>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 flex items-center gap-2 pt-4">
            <div className="flex items-center gap-1.5" aria-hidden>
              {HELP_STEPS.map((s, idx) => (
                <span
                  key={s.id}
                  className={clsx(
                    "h-2 rounded-full transition-all",
                    idx === activeStep ? "w-6 bg-meta-500" : "w-2 bg-white/20",
                  )}
                />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="text-xs font-medium text-slate-400 transition hover:text-slate-200"
              >
                <T k="help.tour.skip" label="Skip tour button">
                  Skip tour
                </T>
              </button>
              <button
                type="button"
                onClick={onStartTour}
                className="inline-flex items-center gap-2 rounded-full bg-meta-500 px-4 py-2 text-xs font-semibold text-white shadow-[0_0_24px_-4px_rgba(8,102,255,0.8)] transition hover:bg-meta-600"
              >
                <T k="help.tour.start" label="Start tour button">
                  Start tour
                </T>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeTour;
