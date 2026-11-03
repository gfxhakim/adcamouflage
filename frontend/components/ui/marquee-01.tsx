/* eslint-disable @next/next/no-img-element -- admin-supplied avatars from any origin. */
import { Card, CardContent } from "@/components/ui/card";
import { Marquee } from "@/components/ui/marquee-01-utils/marquee";
import { cn } from "@/lib/utils";

export interface Review {
  id: string;
  name: string;
  handle?: string;
  body: string;
  avatar?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Only pictures we uploaded or plain https links are shown. */
function safeSrc(src?: string): string | undefined {
  return src && /^(\/|https:\/\/)/.test(src) ? src : undefined;
}

export function ReviewCard({ name, handle, body, avatar }: Review) {
  const src = safeSrc(avatar);
  return (
    <Card className="relative h-full w-72 overflow-hidden rounded-2xl border-black/5 bg-white p-4 text-black shadow-none">
      <CardContent className="flex flex-col gap-2.5 p-0">
        <div className="flex flex-row items-center gap-2.5">
          {src ? (
            <img className="h-9 w-9 shrink-0 rounded-full object-cover" width={36} height={36} alt="" src={src} loading="lazy" />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-meta-500 text-xs font-semibold text-white" aria-hidden>
              {initials(name)}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-semibold text-black">{name}</p>
            {handle ? <p className="truncate text-xs font-medium text-black/50">{handle}</p> : null}
          </div>
        </div>
        <p className="line-clamp-3 text-sm leading-relaxed text-black/80">{body}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Two rows of review cards drifting in opposite directions, pausing on hover,
 * with soft faded edges. A short list runs as a single row.
 */
export default function TestimonialMarquee({ reviews, duration = 40, className }: { reviews: Review[]; duration?: number; className?: string }) {
  if (!reviews.length) return null;
  const twoRows = reviews.length >= 4;
  const half = Math.ceil(reviews.length / 2);
  const rows = twoRows ? [reviews.slice(0, half), reviews.slice(half)] : [reviews];
  const style = { "--duration": `${duration}s` } as React.CSSProperties;

  return (
    <div
      className={cn(
        "relative flex w-full flex-col items-center justify-center overflow-hidden",
        // Faded edges that work over any section colour.
        "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        className,
      )}
    >
      {rows.map((row, i) => (
        <Marquee key={i} reverse={i === 1} pauseOnHover className="w-full" style={style}>
          {row.map((review) => (
            <ReviewCard key={review.id} {...review} />
          ))}
        </Marquee>
      ))}
    </div>
  );
}
