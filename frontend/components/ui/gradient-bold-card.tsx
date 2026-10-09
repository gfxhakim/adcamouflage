import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BlobTone = "default" | "slow" | "success" | "danger" | "muted";

export interface GradientBlobCardProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
  /**
   * Light the animated neon rim. Reserved for the one card that matters most on
   * a screen; every other card is a plain white card that glows blue on hover.
   */
  glow?: boolean;
  /** Colour and pace of the travelling blob. `danger` is the only non-blue tone. */
  tone?: BlobTone;
  /** Lift the card and brighten the rim on hover. */
  interactive?: boolean;
  /** Padding on the white surface. `none` lets children bleed to the edge. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Corner radius of the card. */
  radius?: "md" | "lg" | "xl";
  /** Width of the lit rim, in pixels. */
  borderWidth?: number;
  className?: string;
  innerClassName?: string;
  as?: ElementType;
}

const PADDING: Record<NonNullable<GradientBlobCardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6 lg:p-8",
};

const RADIUS: Record<NonNullable<GradientBlobCardProps["radius"]>, string> = {
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
};

/**
 * A white card. With `glow`, it gets a moving neon border.
 *
 * Adapted from the GradientBlobCard demo: a bold gradient blob, blurred, sits
 * behind a white surface inset by a few pixels, so only the rim shows it as the
 * blob travels corner to corner. The demo was a fixed 200 × 250 box; here the
 * card sizes to its content and the blob's path is expressed in percentages of
 * the card (see `.blob-track` in globals.css), so it traces the true edge of a
 * wide hero panel, a narrow stat tile or a phone-width column alike.
 */
export function GradientBlobCard({
  children,
  glow = false,
  tone = "default",
  interactive = false,
  padding = "md",
  radius = "lg",
  borderWidth,
  className,
  innerClassName,
  as,
  style,
  ...rest
}: GradientBlobCardProps) {
  const Component = (as ?? "div") as ElementType;

  const vars = {
    "--blob-radius": RADIUS[radius],
    ...(borderWidth ? { "--blob-border": `${borderWidth}px` } : {}),
  } as CSSProperties;

  if (!glow) {
    return (
      <Component
        {...rest}
        data-tone={tone === "default" ? undefined : tone}
        data-interactive={interactive ? "true" : undefined}
        className={cn("plain-card", className)}
        style={{ ...vars, ...style }}
      >
        <div className={cn("plain-surface", PADDING[padding], innerClassName)}>{children}</div>
      </Component>
    );
  }

  return (
    <Component
      {...rest}
      data-tone={tone === "default" ? undefined : tone}
      data-interactive={interactive ? "true" : undefined}
      className={cn("blob-card", className)}
      style={{ ...vars, ...style }}
    >
      {/* The leading blob and a softer trailing one half a lap behind it, so
          long edges are never left dark for long. */}
      <span className="blob-track" aria-hidden>
        <span className="blob-track-y">
          <span className="blob" />
        </span>
      </span>
      <span className="blob-track blob-track--trail" aria-hidden>
        <span className="blob-track-y">
          <span className="blob" />
        </span>
      </span>

      <div className={cn("blob-surface", PADDING[padding], innerClassName)}>{children}</div>
    </Component>
  );
}

export default GradientBlobCard;
