/* eslint-disable @next/next/no-img-element -- small static brand PNGs; the image optimizer adds nothing here. */
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** Small grey line under the name, e.g. "Workspace" or "Admin panel". */
  caption?: string;
  /** Classes for the caption, to hide it on small screens. */
  captionClassName?: string;
  /** Use the white wordmark on dark backgrounds. */
  onDark?: boolean;
  className?: string;
}

/** The BluCloacking shield plus wordmark, used in every header and the footer. */
export function BrandLogo({ caption, captionClassName, onDark = false, className }: BrandLogoProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <img src="/brand/blucloacking-mark.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
      <span className="min-w-0 leading-tight">
        <img
          src={onDark ? "/brand/blucloacking-wordmark-light.png" : "/brand/blucloacking-wordmark.png"}
          alt="BluCloacking"
          width={120}
          height={20}
          className="block h-5 w-auto"
        />
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
