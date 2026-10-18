"use client";

import clsx from "clsx";
import {
  Activity,
  CircleAlert,
  Gauge,
  User as UserIcon,
  Waves,
} from "lucide-react";
import Link from "next/link";

import BrandLogo from "@/components/BrandLogo";
import { type UserProfile } from "@/lib/auth";
import { usageText } from "@/lib/format";
import type { HealthReport } from "@/lib/types";

interface HeaderProps {
  /** Leave both out on pages that do not watch the render engine. */
  health?: HealthReport | null;
  healthError?: string | null;
  user?: UserProfile | null;
  /** Render for a dark surface (the Command Deck workspace shell). */
  onDark?: boolean;
}

export function Header({ health, healthError, user, onDark = false }: HeaderProps) {
  const showEngine = health !== undefined || healthError !== undefined;

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
    ? "border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
    : degraded
      ? "border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : online
        ? "border-meta-500/50 bg-meta-50 dark:bg-meta-500/10 text-meta-700 dark:text-meta-300"
        : "border-black/10 dark:border-white/10 bg-meta-50 dark:bg-meta-500/10 text-ink-muted dark:text-slate-300";

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] dark:border-white/10 bg-white/[0.85] dark:bg-slate-900/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="BluCloacking home">
          <BrandLogo caption="Workspace" captionClassName="hidden sm:block" onDark={onDark} />
        </Link>

        <div className="flex items-center gap-2">
          {health ? (
            <span className="chip hidden md:inline-flex" title="Render backend">
              <Waves className="h-3.5 w-3.5 text-meta-600 dark:text-meta-300" aria-hidden />
              {health.worker_mode} · {health.active_jobs} active
            </span>
          ) : null}

          {showEngine ? (
            <span className={clsx("chip whitespace-nowrap", statusTone)}>
              {healthError ? (
                <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Activity className={clsx("h-3.5 w-3.5", online && "animate-pulse-glow")} aria-hidden />
              )}
              {statusLabel}
            </span>
          ) : null}

          {user && (user.monthly_quota !== null || user.plan_expired) ? (
            <Link
              href="/app/plan"
              className={clsx(
                "chip hidden whitespace-nowrap transition-colors hover:border-meta-500/50 hover:text-meta-700 dark:hover:text-meta-300 sm:inline-flex",
                user.plan_expired ||
                  (user.monthly_quota !== null && user.used_this_month >= user.monthly_quota)
                  ? "border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
                  : "",
              )}
              title={`${user.plan_label} plan: files used this month`}
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {user.plan_expired ? "Plan expired" : `${usageText(user.used_this_month, user.monthly_quota)} files`}
            </Link>
          ) : null}


          {user ? (
            <span
              className="chip hidden max-w-[180px] truncate sm:inline-flex"
              title={user.email}
            >
              <UserIcon className="h-3.5 w-3.5 text-meta-500" aria-hidden />
              {user.display_name || user.email}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default Header;
