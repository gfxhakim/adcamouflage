/* eslint-disable @next/next/no-img-element -- the loader tints a small static brand PNG via CSS mask; the optimizer cannot help. */
import { cn } from "@/lib/utils";

interface RenderLoaderProps {
  /** Shield edge length in px. Keep it small — this is an inline indicator. */
  size?: number;
  /** Short line shown next to the mark, e.g. "Cloaking…". Omit for mark only. */
  label?: string;
  className?: string;
}

const MARK = "/brand/blucloacking-mark.png";

/**
 * A compact, presentational loading indicator built from the BluCloacking
 * shield, recoloured in the app's Meta-blue. It is pure decoration shown while
 * a render runs — it does not drive or reflect any real job state on its own.
 *
 * The shield silhouette is painted twice through a CSS mask of the logo: a
 * steady blue base that breathes, and a brighter band that sweeps across it,
 * so the mark reads as actively "working". Honours reduced-motion (the global
 * rule freezes the sweep; the base simply holds its colour).
 */
export function RenderLoader({ size = 30, label, className }: RenderLoaderProps) {
  const mask = `url(${MARK}) center / contain no-repeat`;
  const box = { width: size, height: size } as const;
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="status"
      aria-live="polite"
    >
      <span className="relative shrink-0" style={box} aria-hidden>
        {/* Soft blue halo that pulses behind the shield. */}
        <span
          className="absolute -inset-1 animate-render-pulse rounded-full"
          style={{ background: "radial-gradient(circle, rgb(8 102 255 / 0.45), transparent 70%)" }}
        />
        {/* Steady blue shield. */}
        <span
          className="absolute inset-0 animate-render-pulse"
          style={{ WebkitMask: mask, mask, background: "var(--meta-500)" }}
        />
        {/* Brighter band sweeping across the shield. */}
        <span
          className="absolute inset-0 animate-render-scan"
          style={{
            WebkitMask: mask,
            mask,
            backgroundImage:
              "linear-gradient(115deg, transparent 38%, rgb(153 194 255 / 0.95) 50%, transparent 62%)",
            backgroundSize: "260% 100%",
          }}
        />
      </span>
      {label ? (
        <span className="text-xs font-semibold text-meta-600 dark:text-meta-300">{label}</span>
      ) : null}
    </span>
  );
}

export default RenderLoader;
