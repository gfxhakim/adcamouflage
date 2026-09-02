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
    ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
    : degraded
      ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
      : online
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
        : "border-white/10 bg-white/5 text-slate-300";

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/20 via-transparent to-fuchsia-500/20">
            <ShieldHalf className="h-5 w-5 text-cyan-300" aria-hidden />
            <span className="absolute inset-0 animate-pulse-glow rounded-xl shadow-neon-sm" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-slate-50">
              Ad<span className="text-gradient">Camouflage</span>
            </p>
            <p className="hidden text-[11px] text-slate-500 sm:block">
              Media mutation &amp; fingerprint stripping
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {health ? (
            <span className="chip hidden md:inline-flex" title="Render backend">
              <Waves className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden />
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
