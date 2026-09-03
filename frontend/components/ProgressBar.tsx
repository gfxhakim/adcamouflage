import clsx from "clsx";

interface ProgressBarProps {
  /** 0 - 100. */
  value: number;
  /** Animate a sweeping highlight to signal live work. */
  active?: boolean;
  tone?: "neon" | "success" | "danger" | "muted";
  className?: string;
  label?: string;
}

const TONES: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  neon: "bg-gradient-to-r from-meta-400 via-meta-500 to-meta-700",
  success: "bg-gradient-to-r from-meta-400 to-meta-600",
  danger: "bg-gradient-to-r from-red-500 to-red-400",
  muted: "bg-ink-faint",
};

const GLOWS: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  neon: "0 0 14px rgb(34 211 238 / 0.75)",
  success: "0 0 14px rgb(52 211 153 / 0.7)",
  danger: "0 0 14px rgb(244 63 94 / 0.7)",
  muted: "none",
};

export function ProgressBar({
  value,
  active = false,
  tone = "neon",
  className,
  label,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div
      className={clsx("relative h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08]", className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Processing progress"}
    >
      <div
        className={clsx(
          "relative h-full rounded-full transition-[width] duration-500 ease-out",
          TONES[tone],
          active && "progress-shimmer overflow-hidden",
        )}
        style={{ width: `${clamped}%`, boxShadow: clamped > 0 ? GLOWS[tone] : undefined }}
      />
    </div>
  );
}

export default ProgressBar;
