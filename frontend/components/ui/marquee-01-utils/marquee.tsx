import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /** Scroll right instead of left. */
  reverse?: boolean;
  /** Stop while the pointer is over the row. */
  pauseOnHover?: boolean;
  /** How many copies of the children to lay end to end (enough to fill wide screens). */
  repeat?: number;
}

/**
 * An endless horizontal row. Speed and spacing come from the CSS variables
 * --duration and --gap, e.g. className="[--duration:40s] [--gap:1rem]".
 */
export function Marquee({ className, reverse = false, pauseOnHover = false, repeat = 4, children, ...props }: MarqueeProps) {
  return (
    <div {...props} className={cn("group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]", className)}>
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          className={cn(
            "flex shrink-0 animate-marquee-x flex-row justify-around [gap:var(--gap)] motion-reduce:[animation-play-state:paused]",
            reverse && "[animation-direction:reverse]",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

export default Marquee;
