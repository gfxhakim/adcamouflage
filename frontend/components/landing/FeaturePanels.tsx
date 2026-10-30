"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Check, Minus, Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { CmsLink, CmsSection, CmsSlot, T } from "@/components/cms/Cms";
import { useCms, type CmsApi } from "@/components/cms/ContentProvider";
import { CmsHeadline, EASE, PillArrow, SectionTag } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

type Look = "gray" | "black" | "white" | "blue";

interface Panel {
  name: string;
  title: string;
  body: string;
  points: string[];
  stat: string;
  look: Look;
  visual: ReactNode;
}

const LOOKS: Record<Look, { panel: string; text: string; muted: string; tab: string }> = {
  gray: { panel: "bg-[#E9EBEF]", text: "text-black", muted: "text-ink-muted", tab: "bg-[#E9EBEF] text-black" },
  black: { panel: "bg-black", text: "text-white", muted: "text-white/65", tab: "bg-black text-white" },
  white: { panel: "bg-white border border-black/10", text: "text-black", muted: "text-ink-muted", tab: "bg-white text-black border border-black/10" },
  blue: { panel: "bg-meta-500", text: "text-white", muted: "text-white/80", tab: "bg-meta-500 text-white" },
};

function HashVisual() {
  return (
    <div className="w-full space-y-2 rounded-2xl bg-white p-4 font-mono text-[11px] text-black shadow-xl">
      <p className="text-ink-faint">sha256 · original</p>
      <p className="truncate text-ink-faint line-through decoration-rose-400">6fa82c49ec91d0b7a3…</p>
      <p className="pt-2 text-ink-faint">sha256 · copy #042</p>
      <p className="truncate font-semibold text-meta-600">3b1c9e07f4a2c8d655…</p>
      <div className="grid grid-cols-8 gap-1 pt-3">
        {Array.from({ length: 32 }, (_, i) => (
          <span
            key={i}
            className={cn("h-4 rounded-sm", i % 3 === 0 ? "bg-meta-500" : i % 5 === 0 ? "bg-meta-200" : "bg-black/[0.06]")}
          />
        ))}
      </div>
    </div>
  );
}

function FrameVisual() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-gradient-to-br from-meta-300 via-meta-500 to-black shadow-xl">
      <div className="absolute inset-[6%] rounded-lg border-2 border-dashed border-white/70" />
      <span className="absolute left-3 top-3 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-black">1280 × 720</span>
      <span className="absolute bottom-3 right-3 rounded-full bg-black px-2 py-0.5 font-mono text-[10px] text-white">→ 1274 × 708</span>
      <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
    </div>
  );
}

function TimingVisual() {
  return (
    <div className="w-full rounded-2xl bg-white p-4 shadow-xl">
      <div className="flex items-end gap-1.5">
        {[30, 24, 25, 29.97, 23.976, 59.94].map((fps, i) => (
          <div key={fps} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn("w-full rounded-md", i === 4 ? "bg-meta-500" : "bg-black/10")}
              style={{ height: `${30 + fps * 1.4}px` }}
            />
            <span className="font-mono text-[9px] text-ink-faint">{fps}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-ink-subtle">frame rate · 30 fps → 23.976 fps</p>
    </div>
  );
}

function AudioVisual() {
  return (
    <div className="w-full rounded-2xl bg-black p-4 shadow-xl">
      <div className="flex h-24 items-center gap-[3px]">
        {Array.from({ length: 48 }, (_, i) => (
          <span
            key={i}
            className="flex-1 animate-eq rounded-full bg-meta-400"
            style={{ height: `${20 + Math.abs(Math.sin(i * 0.7)) * 70}%`, animationDelay: `${(i % 12) * 0.08}s` }}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-white/60">audio pitch · 0 → +39.8 cents</p>
    </div>
  );
}

function MetaVisual() {
  const tags = ["camera: iPhone 15 Pro", "editor: CapCut", "title: final_v3", "encoder: Lavf60"];
  return (
    <div className="w-full space-y-2 rounded-2xl bg-white p-4 shadow-xl">
      {tags.map((tag) => (
        <div key={tag} className="flex items-center justify-between rounded-lg bg-black/[0.04] px-3 py-2 font-mono text-[11px]">
          <span className="text-ink-faint line-through decoration-rose-400">{tag}</span>
          <span className="text-meta-600">removed</span>
        </div>
      ))}
      <p className="pt-1 font-mono text-[10px] text-ink-subtle">provenance tags left · 0</p>
    </div>
  );
}

function OverlayVisual() {
  return (
    <div className="relative aspect-[4/5] w-full max-w-[220px] overflow-hidden rounded-2xl bg-gradient-to-b from-[#E9EBEF] to-white shadow-xl">
      <div className="absolute inset-x-4 top-4 h-1/2 rounded-xl bg-gradient-to-br from-meta-200 to-meta-500" />
      <span className="absolute right-6 top-6 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-black shadow">YOUR LOGO</span>
      <div className="absolute inset-x-4 bottom-12 h-2 rounded bg-black/10" />
      <div className="absolute bottom-6 left-4 h-2 w-1/2 rounded bg-black/10" />
      <span className="absolute bottom-3 right-3 font-mono text-[9px] text-ink-faint">frames 0–90</span>
    </div>
  );
}

const PANELS: Panel[] = [
  {
    name: "PROBE",
    title: "See exactly what got you flagged.",
    body: "We find every fingerprint the ad bots use to recognize your file. Before they do.",
    points: ["Hash that matched", "Hidden metadata", "Audio & visual signatures"],
    stat: "FLAGGED → MAPPED",
    look: "gray",
    visual: <HashVisual />,
  },
  {
    name: "MUTATE",
    title: "Same ad to humans. New file to AI.",
    body: "Invisible pixel, frame and audio shifts. Your creative looks identical, the model sees a stranger.",
    points: ["Zero visible change", "Beats AI vision & transcription", "Stealth or Aggressive mode"],
    stat: "100% UNDETECTABLE",
    look: "black",
    visual: <FrameVisual />,
  },
  {
    name: "SCRUB",
    title: "Every download is a fresh fingerprint.",
    body: "Editing traces, timestamps and tracking tags gone. Each export is a brand-new file ready to scale.",
    points: ["No CapCut / Premiere traces", "Unique hash every export", "Ready to upload in seconds"],
    stat: "CLEAN → SCALE",
    look: "blue",
    visual: <MetaVisual />,
  },
];

/** A panel with the admin's text and look applied. */
interface ShownPanel extends Panel {
  id: string;
  key: string;
}

function resolvePanels(cms: CmsApi): ShownPanel[] {
  return cms.list("features.panels", PANELS, "Panels", PANELS.map((p) => p.name)).map(({ item, key, id }) => {
    const look = cms.text(`${key}.look`, item.look, "text", "Look: gray, black, white or blue") as Look;
    return {
      ...item,
      id,
      key,
      name: cms.text(`${key}.name`, item.name, "text", "Tab name"),
      look: LOOKS[look] ? look : item.look,
    };
  });
}

function PanelBody({ panel, index }: { panel: ShownPanel; index: number }) {
  const cms = useCms();
  const look = LOOKS[panel.look];
  const points = cms.list(`${panel.key}.points`, panel.points, "Points", panel.points);
  return (
    <div className="grid h-full gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
      <div className="flex items-center justify-center">
        <CmsSlot k={`${panel.key}.visual`} label="Visual" className="max-h-[320px] rounded-2xl">
          {panel.visual}
        </CmsSlot>
      </div>
      <div className={cn("flex flex-col", look.text)}>
        <span className="font-mono text-[11px] opacity-60">0{index + 1} · {panel.name}</span>
        <T k={`${panel.key}.title`} as="h3" className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl lg:text-4xl">{panel.title}</T>
        <T k={`${panel.key}.body`} long as="p" className={cn("mt-3 text-sm leading-relaxed", look.muted)}>{panel.body}</T>
        <T k="features.pointsTitle" as="p" className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] opacity-60">What changes</T>
        <ul className="mt-2 space-y-1.5">
          {points.map(({ item: p, key, id }) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className={cn("grid h-4 w-4 place-items-center rounded-full", panel.look === "blue" ? "bg-white text-meta-600" : "bg-meta-500 text-white")}>
                <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
              </span>
              <T k={`${key}.text`}>{p}</T>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <T k={`${panel.key}.stat`} className={cn("rounded-full px-2.5 py-1 font-mono text-[11px]", panel.look === "blue" ? "bg-black text-white" : "bg-meta-500 text-white")}>
            {panel.stat}
          </T>
          <CmsLink
            k="features.cta"
            href="/login"
            label="Camouflage my ad"
            className={cn(
              "group inline-flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-sm font-semibold",
              panel.look === "black" || panel.look === "blue" ? "bg-white text-black" : "bg-black text-white",
            )}
          >
            {(label) => (
              <>
                {label}
                <PillArrow dark={!(panel.look === "black" || panel.look === "blue")} />
              </>
            )}
          </CmsLink>
        </div>
      </div>
    </div>
  );
}

export function FeaturePanels() {
  const cms = useCms();
  const PANELS = resolvePanels(cms);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setActive(Math.min(PANELS.length - 1, Math.max(0, Math.floor(v * PANELS.length))));
  });

  const jump = (i: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (span * (i + 0.5)) / PANELS.length, behavior: "smooth" });
  };

  return (
    <CmsSection k="features" label="Features" id="features" className="scroll-mt-24 bg-[#F4F5F7] pt-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
          <div>
            <SectionTag k="features.tag" index="02">THE SANITIZATION PIPELINE</SectionTag>
            <CmsHeadline k="features.headline" text="Flagged In. | [Unstoppable Out.]" className="mt-5 text-4xl sm:text-5xl lg:text-6xl" />
          </div>
          <T k="features.lede" long as="p" className="text-sm leading-relaxed text-ink-muted">
            Three layers. One click. Your winning ad comes back with a fingerprint the platforms have never seen.
          </T>
        </div>
      </div>

      {/* Phones and tablets: stacked cards */}
      <div className="mx-auto mt-10 max-w-7xl space-y-4 px-4 pb-20 sm:px-6 lg:hidden">
        {PANELS.map((panel, i) => (
          <motion.div
            key={panel.id}
            className={cn("rounded-3xl p-5 sm:p-7", LOOKS[panel.look].panel)}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <PanelBody panel={panel} index={i} />
          </motion.div>
        ))}
      </div>

      {/* Desktop: panels switch as you scroll */}
      <div ref={track} className="relative hidden lg:block" style={{ height: `${PANELS.length * 75}vh` }}>
        <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col justify-center">
          <div className="mx-auto flex h-[min(560px,78vh)] w-full max-w-7xl gap-2 px-8">
            {PANELS.map((panel, i) => {
              const open = i === active;
              const look = LOOKS[panel.look];
              return (
                <motion.div
                  key={panel.id}
                  layout
                  transition={{ duration: 0.6, ease: EASE }}
                  className={cn(
                    "relative overflow-hidden rounded-3xl",
                    open ? cn("flex-1 p-8", look.panel) : cn("w-16 shrink-0 cursor-pointer", look.tab),
                  )}
                  onClick={open ? undefined : () => jump(i)}
                >
                  <span
                    className={cn(
                      "absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full font-mono text-[11px]",
                      open ? "bg-meta-500 text-white" : "bg-black/10",
                      open && panel.look === "blue" && "bg-black",
                    )}
                  >
                    0{i + 1}
                  </span>
                  {open ? (
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={panel.id}
                        className="h-full pl-10"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15, ease: EASE }}
                      >
                        <PanelBody panel={panel} index={i} />
                      </motion.div>
                    </AnimatePresence>
                  ) : (
                    <>
                      <span className="absolute bottom-16 left-1/2 origin-center -translate-x-1/2 -rotate-180 whitespace-nowrap text-lg font-semibold tracking-tight [writing-mode:vertical-rl]">
                        {panel.name}
                      </span>
                      <span className="absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-current/20 opacity-70">
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </>
                  )}
                  {open ? (
                    <span className="absolute bottom-3 left-3 grid h-8 w-8 place-items-center rounded-full bg-meta-500 text-white">
                      <Minus className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : null}
                </motion.div>
              );
            })}
          </div>
          <div className="mx-auto mt-5 flex w-full max-w-7xl items-center justify-between px-8">
            <div className="flex items-center gap-4">
              <div className="flex gap-1">
                {PANELS.map((p, i) => (
                  <span key={p.id} className={cn("h-0.5 w-8 rounded-full transition-colors", i <= active ? "bg-black" : "bg-black/15")} />
                ))}
              </div>
              <span className="rounded-full bg-meta-500 px-2 py-0.5 font-mono text-[11px] text-white">
                0{active + 1} / 0{PANELS.length}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-subtle">{PANELS[Math.min(active, PANELS.length - 1)]?.name}</span>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-meta-500" />
              <T k="features.scrollHint">Scroll to switch layers</T>
            </span>
          </div>
        </div>
      </div>
    </CmsSection>
  );
}

export default FeaturePanels;
