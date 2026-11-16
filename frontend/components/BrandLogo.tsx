"use client";

/* eslint-disable @next/next/no-img-element -- small static brand PNGs; the image optimizer adds nothing here. */
import { useCms } from "@/components/cms/ContentProvider";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** Small grey line under the name, e.g. "Workspace" or "Admin panel". */
  caption?: string;
  /** Classes for the caption, to hide it on small screens. */
  captionClassName?: string;
  /** Use the white wordmark on dark backgrounds. */
  onDark?: boolean;
  /** Let the shield bob gently and send a shine across the shield and name. */
  animated?: boolean;
  className?: string;
}

const MARK = "/brand/blucloacking-mark.png";
const NAME = "ProteusFlow";

/** First word of a CamelCase name ("Proteus" in "ProteusFlow"), shown in blue. */
function wordHead(name: string): string {
  const m = name.match(/^(.+?[a-z])(?=[A-Z])/);
  return m ? m[1] : name;
}

/** The rest of the name after the blue part ("Flow"). */
function wordTail(name: string): string {
  return name.slice(wordHead(name).length);
}

/** A bright band that sweeps across whatever image `src` outlines. */
function Shine({ src }: { src: string }) {
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <span
      className="pointer-events-none absolute inset-0 animate-shine"
      style={{
        backgroundImage:
          "linear-gradient(100deg, transparent 40%, rgba(255,255,255,0.95) 50%, transparent 60%)",
        backgroundSize: "250% 100%",
        WebkitMask: mask,
        mask,
      }}
      aria-hidden
    />
  );
}

/** The ProteusFlow shield plus wordmark, used in every header and the footer. */
export function BrandLogo({
  caption,
  captionClassName,
  onDark = false,
  animated = false,
  className,
}: BrandLogoProps) {
  const cms = useCms();
  const mark = cms.media("brand.mark", { src: MARK, kind: "image", alt: "" }, "Logo shield").src || MARK;
  const rawName = cms.text("brand.name", NAME, "text", "Brand name");
  const name = /blucloack|blucloak|blu\s*-?editor|adcamouflage|camouflage/i.test(rawName) ? NAME : rawName;
  const showMark = !cms.hidden("brand.mark");
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative h-10 w-10 shrink-0",
          animated && "animate-logo-float drop-shadow-[0_0_10px_rgba(51,133,255,0.65)]",
        )}
      >
        {showMark ? <img src={mark} alt="" width={40} height={40} className="h-10 w-10 object-contain" {...cms.mark("brand.mark")} /> : null}
        {animated && showMark ? <Shine src={mark} /> : null}
      </span>
      <span className="min-w-0 leading-tight">
        <span
          className={cn(
            "block text-lg font-bold tracking-tight",
            onDark ? "text-white" : "text-black",
          )}
          {...cms.mark("brand.name")}
        >
          <span className="text-meta-500">{wordHead(name)}</span>
          <span>{wordTail(name)}</span>
        </span>
        {caption ? (
          <span className={cn("mt-0.5 block text-[11px]", onDark ? "text-white/55" : "text-ink-subtle", captionClassName)}>
            {caption}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** The full stacked logo (shield above the name) on its dark tile, for the login and sign-up pages. */
export function BrandLogoFull({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-40 w-40 flex-col items-center justify-center gap-2.5 rounded-3xl bg-[#050b1a] p-4 shadow-[0_18px_50px_-14px_rgba(8,102,255,0.55)] ring-1 ring-meta-500/30",
        className,
      )}
    >
      <img src={MARK} alt="ProteusFlow" width={76} height={76} className="h-16 w-16 object-contain drop-shadow-[0_0_14px_rgba(51,133,255,0.65)]" />
      <span className="text-xl font-bold tracking-tight text-white">
        <span className="text-meta-400">{wordHead(NAME)}</span>
        {wordTail(NAME)}
      </span>
    </div>
  );
}

export default BrandLogo;
