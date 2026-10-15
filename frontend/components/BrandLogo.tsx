/* eslint-disable @next/next/no-img-element -- small static brand PNGs; the image optimizer adds nothing here. */
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

/** The BluCloacking shield plus wordmark, used in every header and the footer. */
export function BrandLogo({
  caption,
  captionClassName,
  onDark = false,
  animated = false,
  className,
}: BrandLogoProps) {
  const wordmark = onDark ? "/brand/blucloacking-wordmark-light.png" : "/brand/blucloacking-wordmark.png";
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative h-10 w-10 shrink-0",
          animated && "animate-logo-float drop-shadow-[0_0_10px_rgba(51,133,255,0.65)]",
        )}
      >
        <img src={MARK} alt="" width={40} height={40} className="h-10 w-10" />
        {animated ? <Shine src={MARK} /> : null}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="relative block w-fit">
          <img src={wordmark} alt="BluCloacking" width={120} height={20} className="block h-5 w-auto" />
          {animated ? <Shine src={wordmark} /> : null}
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

/** The full stacked logo (shield above the name), for the login and sign-up pages. */
export function BrandLogoFull({ className }: { className?: string }) {
  return (
    <img
      src="/brand/blucloacking-logo.png"
      alt="BluCloacking"
      width={600}
      height={565}
      className={cn("h-auto w-40", className)}
    />
  );
}

export default BrandLogo;
