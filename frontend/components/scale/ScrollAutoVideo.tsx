"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface ScrollAutoVideoProps {
  src: string;
  poster?: string;
  className?: string;
}

/**
 * Plays automatically muted as soon as 45% of the player scrolls into view
 * (matching browser autoplay policies across iOS, Chrome, Safari, and desktop)
 * and exposes an instant unmute pill right on the canvas.
 */
export function ScrollAutoVideo({ src, poster, className }: ScrollAutoVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
            void el.play().catch(() => undefined);
          } else {
            el.pause();
          }
        }
      },
      { threshold: [0, 0.4] },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    const nextMuted = !el.muted;
    el.muted = nextMuted;
    setMuted(nextMuted);
    if (!nextMuted && el.paused) {
      void el.play().catch(() => undefined);
    }
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-zinc-950", className)}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={muted}
        controls
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
      />

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className={cn(
          "absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold shadow-sm backdrop-blur-md transition",
          muted
            ? "border-white/25 bg-black/75 text-white hover:bg-black"
            : "border-emerald-400/50 bg-emerald-600/90 text-white hover:bg-emerald-600",
        )}
      >
        {muted ? (
          <>
            <VolumeX className="h-3.5 w-3.5" aria-hidden />
            Tap for Sound
          </>
        ) : (
          <>
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
            Sound On
          </>
        )}
      </button>
    </div>
  );
}

export default ScrollAutoVideo;
