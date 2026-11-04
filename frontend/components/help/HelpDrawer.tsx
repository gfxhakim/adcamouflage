"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Coins,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { MediaView, T } from "@/components/cms/Cms";
import { useCms } from "@/components/cms/ContentProvider";
import {
  HELP_GUIDE,
  HELP_PRACTICES,
  HELP_STEPS,
  HELP_TOKENS,
  HELP_TROUBLE,
  type HelpGuideSection,
  type HelpStepId,
} from "@/lib/helpContent";

type DrawerTab = "guide" | "practices" | "tokens" | "trouble";

interface HelpDrawerProps {
  open: boolean;
  currentStep: number;
  onClose: () => void;
  onJumpStep: (stepIndex: number) => void;
  onReplayTour: () => void;
}

function StepMediaSlot({ stepId, index }: { stepId: HelpStepId; index: number }) {
  const cms = useCms();
  const key = `help.guide.${stepId}.media`;
  const media = cms.media(
    key,
    { src: "", kind: "video", fit: "contain", radius: 12, autoplay: true, loop: true, muted: true, controls: false },
    `Guide step ${index + 1} GIF or video`,
  );

  if (cms.hidden(key)) return null;

  if (media.src) {
    return (
      <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/50" {...cms.mark(key)}>
        <MediaView value={media} className="max-h-48 w-full object-contain" />
      </div>
    );
  }

  if (!cms.preview) return null;

  return (
    <div
      {...cms.mark(key)}
      className="mt-3 flex h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-meta-500/35 bg-slate-950/60 px-3 text-[11px] text-meta-300"
    >
      <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
      <span>Step {index + 1} GIF / video slot (upload in Admin &gt; Workspace)</span>
    </div>
  );
}

function GuideAccordionItem({
  section,
  index,
  isOpen,
  onToggle,
}: {
  section: HelpGuideSection;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border transition-colors",
        isOpen ? "border-meta-500/45 bg-[#11151e]" : "border-white/10 bg-[#11151e]/80 hover:border-white/20",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-slate-100"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-meta-500/20 font-mono text-[11px] font-semibold text-meta-200">
          0{index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <T k={`help.guide.${section.id}.title`} label={`Guide step ${index + 1} title`}>
            {section.title}
          </T>
        </span>
        <span className="hidden font-mono text-[11px] text-slate-500 sm:inline">
          <T k={`help.guide.${section.id}.meta`} label={`Guide step ${index + 1} meta`}>
            {section.meta}
          </T>
        </span>
        <ChevronDown
          className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", isOpen ? "rotate-180" : "")}
          aria-hidden
        />
      </button>

      {isOpen ? (
        <div className="border-t border-white/[0.07] px-4 pb-4 pl-14 pt-3 text-xs leading-relaxed text-slate-300">
          <ol className="list-decimal space-y-1.5 pl-4">
            {section.points.map((pt, i) => (
              <li key={i}>
                <T k={`help.guide.${section.id}.pt.${i}`} long label={`Guide step ${index + 1} point ${i + 1}`}>
                  {pt}
                </T>
              </li>
            ))}
          </ol>

          <StepMediaSlot stepId={section.id} index={index} />

          {section.tip ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span>
                <T k={`help.guide.${section.id}.tip`} long label={`Guide step ${index + 1} tip`}>
                  {section.tip}
                </T>
              </span>
            </div>
          ) : null}

          {section.warning ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              <span>
                <T k={`help.guide.${section.id}.warning`} long label={`Guide step ${index + 1} warning`}>
                  {section.warning}
                </T>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HelpDrawer({ open, currentStep, onClose, onJumpStep, onReplayTour }: HelpDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("guide");
  const [query, setQuery] = useState("");
  const [openStep, setOpenStep] = useState<number>(currentStep);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    setOpenStep(currentStep);
  }, [currentStep, open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filteredGuide = q
    ? HELP_GUIDE.filter((sec) =>
        [sec.title, sec.meta, ...sec.points, sec.tip ?? "", sec.warning ?? ""].join(" ").toLowerCase().includes(q),
      )
    : HELP_GUIDE;

  const filteredPractices = q
    ? HELP_PRACTICES.filter((p) => p.toLowerCase().includes(q))
    : HELP_PRACTICES;

  const filteredTokens = q
    ? HELP_TOKENS.filter((t) => t.toLowerCase().includes(q))
    : HELP_TOKENS;

  const filteredTrouble = q
    ? HELP_TROUBLE.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(q))
    : HELP_TROUBLE;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="help-drawer-title">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer panel */}
      <aside className="relative z-10 flex h-full w-full max-w-[540px] flex-col border-l border-meta-500/30 bg-[#0a0d13] text-slate-100 shadow-[-40px_0_120px_rgba(0,0,0,0.65)]">
        {/* Header */}
        <div className="border-b border-white/10 px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta-300">
                <T k="help.drawer.kicker" label="Help drawer kicker">
                  Help center
                </T>
              </p>
              <h2 id="help-drawer-title" className="mt-1 text-xl font-bold tracking-[-0.02em] text-white">
                <T k="help.drawer.title" label="Help drawer title">
                  How to use the workspace
                </T>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 transition hover:bg-white/10 hover:text-white"
              title="Close help center"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-3.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search: "rejected ad", "tokens", "logo flash"…'
              className="w-full rounded-xl border border-white/10 bg-[#11151e] py-2.5 pl-10 pr-4 text-xs text-slate-100 placeholder:text-slate-500 focus:border-meta-500 focus:outline-none"
            />
          </div>

          {/* Tabs */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(
              [
                { id: "guide", label: "Guide" },
                { id: "practices", label: "Best practices" },
                { id: "tokens", label: "Tokens" },
                { id: "trouble", label: "Troubleshooting" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  tab === t.id ? "bg-meta-500 text-white" : "bg-white/[0.05] text-slate-400 hover:bg-white/10 hover:text-slate-200",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {tab === "guide" || q ? (
            <>
              {!q ? (
                <div className="rounded-2xl border border-meta-500/40 bg-gradient-to-br from-meta-500/25 to-meta-500/[0.04] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Zap className="h-3.5 w-3.5 text-meta-300" aria-hidden />
                    <T k="help.drawer.quickstart.title" label="Quick start title">
                      Quick start
                    </T>
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    <T k="help.drawer.quickstart.body" label="Quick start subtitle">
                      The whole flow in four steps. Click a step to jump straight to it.
                    </T>
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {HELP_STEPS.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          onJumpStep(idx);
                          setOpenStep(idx);
                        }}
                        className={clsx(
                          "rounded-xl border px-2.5 py-2 text-left text-xs transition",
                          currentStep === idx
                            ? "border-meta-400 bg-meta-500/30 text-white"
                            : "border-white/10 bg-black/35 text-slate-300 hover:border-meta-500/40 hover:text-white",
                        )}
                      >
                        <span className="block font-mono text-[10px] font-bold text-meta-300">0{idx + 1}</span>
                        <span className="mt-0.5 block truncate font-medium">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {filteredGuide.map((sec) => {
                const idx = HELP_GUIDE.findIndex((g) => g.id === sec.id);
                return (
                  <GuideAccordionItem
                    key={sec.id}
                    section={sec}
                    index={idx}
                    isOpen={Boolean(q) || openStep === idx}
                    onToggle={() => setOpenStep(openStep === idx ? -1 : idx)}
                  />
                );
              })}
            </>
          ) : null}

          {tab === "practices" || q ? (
            <div className="space-y-2.5 rounded-2xl border border-white/10 bg-[#11151e] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-meta-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Media Buyer Best Practices
              </p>
              <ul className="space-y-2.5 pt-1 text-xs leading-relaxed text-slate-300">
                {filteredPractices.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-meta-400" aria-hidden />
                    <T k={`help.practices.${i}`} long label={`Best practice ${i + 1}`}>
                      {item}
                    </T>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "tokens" || q ? (
            <div className="space-y-2.5 rounded-2xl border border-white/10 bg-[#11151e] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-meta-300">
                <Coins className="h-3.5 w-3.5" aria-hidden />
                How Tokens &amp; Generations Work
              </p>
              <ul className="space-y-2.5 pt-1 text-xs leading-relaxed text-slate-300">
                {filteredTokens.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-meta-400" aria-hidden />
                    <T k={`help.tokens.${i}`} long label={`Tokens rule ${i + 1}`}>
                      {item}
                    </T>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "trouble" || q ? (
            <div className="space-y-2.5">
              {filteredTrouble.map((item, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-[#11151e] p-4">
                  <p className="text-xs font-semibold text-white">
                    <T k={`help.trouble.${i}.q`} label={`Troubleshooting Q${i + 1}`}>
                      {item.q}
                    </T>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    <T k={`help.trouble.${i}.a`} long label={`Troubleshooting A${i + 1}`}>
                      {item.a}
                    </T>
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-3.5 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>Was this helpful?</span>
            <button
              type="button"
              onClick={() => setFeedback("up")}
              className={clsx(
                "rounded-lg p-1.5 transition",
                feedback === "up" ? "bg-emerald-500/20 text-emerald-300" : "hover:bg-white/10 hover:text-white",
              )}
              title="Helpful"
            >
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setFeedback("down")}
              className={clsx(
                "rounded-lg p-1.5 transition",
                feedback === "down" ? "bg-amber-500/20 text-amber-300" : "hover:bg-white/10 hover:text-white",
              )}
              title="Needs improvement"
            >
              <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <button
            type="button"
            onClick={onReplayTour}
            className="inline-flex items-center gap-1.5 font-medium text-meta-300 transition hover:text-meta-200"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            <T k="help.drawer.replay" label="Replay welcome tour button">
              Replay welcome tour
            </T>
          </button>
        </div>
      </aside>
    </div>
  );
}

export default HelpDrawer;
