import clsx from "clsx";
import type { ElementType, HTMLAttributes, ReactNode } from "react";

export type NeonTone = "default" | "slow" | "success" | "danger" | "muted";

export interface NeonCardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Colour cycle for the rotating border. */
  tone?: NeonTone;
  /** Lift and brighten the bloom on hover. */
  interactive?: boolean;
  /** Padding on the inner glass surface. `none` lets children bleed to the edge. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Corner radius of both the border ring and the glass surface. */
  radius?: "md" | "lg" | "xl";
  /** Thickness of the neon ring. */
  borderWidth?: number;
  className?: string;
  innerClassName?: string;
  as?: ElementType;
}

const PADDING: Record<NonNullable<NeonCardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6 sm:p-8",
};

const RADIUS: Record<NonNullable<NeonCardProps["radius"]>, string> = {
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
};

/**
 * A glass panel wrapped in the app-wide rotating neon border.
 *
 * The rotation itself is driven by the `--neon-angle` custom property animated
 * once on `:root` (see globals.css). Because that property is registered as
 * inherited, every NeonCard reads the same angle on the same frame - so the
 * borders stay synchronised no matter when a card mounts.
 */
export function NeonCard({
  children,
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
}: NeonCardProps) {
  const Component = (as ?? "div") as ElementType;

  return (
    <Component
      {...rest}
      data-tone={tone === "default" ? undefined : tone}
      data-interactive={interactive ? "true" : undefined}
      className={clsx("neon-frame", RADIUS[radius], className)}
      style={
        borderWidth
          ? ({ ...style, "--border-width": `${borderWidth}px` } as React.CSSProperties)
          : style
      }
    >
      <div className={clsx("neon-inner", RADIUS[radius], PADDING[padding], innerClassName)}>
        {children}
      </div>
    </Component>
  );
}

export default NeonCard;
