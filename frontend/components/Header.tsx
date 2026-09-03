"use client";

import clsx from "clsx";
import { Activity, CircleAlert, Github, ShieldHalf, Waves } from "lucide-react";

import type { HealthReport } from "@/lib/types";

interface HeaderProps {
  health: HealthReport | null;
  healthError: string | null;
}

export function Header({ health, healthError }: HeaderProps) {
  const online = Boolean(health) && !healthError;
  const degraded = health?.status === "degraded";

  const statusLabel = healthError
    ? "Engine offline"
    : !health
      ? "Connecting…"
      : degraded
        ? "Engine degraded"
        : "Engine online";

  const statusTone = healthError
    ? "border-red-300 bg-red-50 text-red-700"
    : degraded
      ? "border-amber-400/40 bg-amber-50 text-amber-700"
      : online
        ? "border-meta-500/50 bg-meta-50 text-meta-700"
        : "border-black/10 bg-meta-50 text-ink-muted";

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-white/[0.85] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-meta-500/40 bg-gradient-to-br from-meta-100 via-transparent to-meta-200">
            <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
            <span className="absolute inset-0 animate-pulse-glow rounded-xl shadow-meta-sm" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-black">
              Ad<span className="text-gradient">Camouflage</span>
            </p>
            <p className="hidden text-[11px] text-black0 sm:block">
              Media mutation &amp; fingerprint stripping
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {health ? (
            <span className="chip hidden md:inline-flex" title="Render backend">
              <Waves className="h-3.5 w-3.5 text-meta-600" aria-hidden />
              {health.worker_mode} · {health.active_jobs} active
            </span>
          ) : null}

          <span className={clsx("chip", statusTone)}>
            {healthError ? (
              <CircleAlert className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Activity className={clsx("h-3.5 w-3.5", online && "animate-pulse-glow")} aria-hidden />
            )}
            {statusLabel}
          </span>

          <a
            href="https://github.com/gfxhakim/adcamouflage"
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost hidden !px-2.5 sm:inline-flex"
            aria-label="Open the project repository"
          >
            <Github className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>
    </header>
  );
}

export default Header;
