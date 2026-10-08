"use client";

import clsx from "clsx";
import {
  Activity,
  CircleAlert,
  Crown,
  Gauge,
  LayoutGrid,
  LogOut,
  ShieldHalf,
  User as UserIcon,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { signOut, type UserProfile } from "@/lib/auth";
import { usageText } from "@/lib/format";
import type { HealthReport } from "@/lib/types";

interface HeaderProps {
  /** Leave both out on pages that do not watch the render engine. */
  health?: HealthReport | null;
  healthError?: string | null;
  user?: UserProfile | null;
}

const NAV = [
  { href: "/app", label: "Workspace", icon: LayoutGrid },
  { href: "/app/plan", label: "My plan", icon: Crown },
];

export function Header({ health, healthError, user }: HeaderProps) {
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const showEngine = health !== undefined || healthError !== undefined;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // A full navigation lets the middleware see the cleared cookie.
      window.location.assign("/");
    }
  };

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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="AdCamouflage home">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-meta-500/40 bg-gradient-to-br from-meta-100 via-transparent to-meta-200">
            <ShieldHalf className="h-5 w-5 text-meta-500" aria-hidden />
            <span className="absolute inset-0 animate-pulse-glow rounded-xl shadow-meta-sm" aria-hidden />
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold tracking-tight text-black">
              Ad<span className="text-gradient">Camouflage</span>
            </p>
            <p className="text-[11px] text-ink-subtle">Workspace</p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {health ? (
            <span className="chip hidden md:inline-flex" title="Render backend">
              <Waves className="h-3.5 w-3.5 text-meta-600" aria-hidden />
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
                "chip hidden whitespace-nowrap transition-colors hover:border-meta-500/50 hover:text-meta-700 sm:inline-flex",
                user.plan_expired ||
                  (user.monthly_quota !== null && user.used_this_month >= user.monthly_quota)
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "",
              )}
              title={`${user.plan_label} plan: files used this month`}
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {user.plan_expired ? "Plan expired" : `${usageText(user.used_this_month, user.monthly_quota)} files`}
            </Link>
          ) : null}


          {user ? (
            <div className="flex items-center gap-2">
              <nav className="flex items-center gap-1" aria-label="Workspace">
                {NAV.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      title={label}
                      className={clsx(
                        "btn-ghost !px-2.5",
                        active && "!border-meta-500/50 !bg-meta-50 !text-meta-700",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      <span className="hidden md:inline">{label}</span>
                    </Link>
                  );
                })}
              </nav>
              <span
                className="chip hidden max-w-[180px] truncate lg:inline-flex"
                title={user.email}
              >
                <UserIcon className="h-3.5 w-3.5 text-meta-500" aria-hidden />
                {user.display_name || user.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="btn-ghost !px-2.5"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{signingOut ? "Signing out…" : "Sign out"}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default Header;
