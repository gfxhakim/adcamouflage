/* eslint-disable @next/next/no-img-element -- small static brand PNG; the image optimizer adds nothing here. */
"use client";

import clsx from "clsx";
import {
  Clock,
  Crown,
  Facebook,
  LayoutGrid,
  LogOut,
  Music2,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useCms } from "@/components/cms/ContentProvider";
import { ICONS } from "@/components/cms/icons";
import { signOut, type UserProfile } from "@/lib/auth";
import { formatTokens } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The signed-in navigation for the workspace. Workspace, the three per-platform
 * format studios, History and My plan, then Sign out — a slim vertical icon
 * rail on desktop and a floating pill on phones, in our Meta-blue / white /
 * black palette.
 */
const ITEMS: NavItem[] = [
  { href: "/app", label: "Workspace", icon: LayoutGrid },
  { href: "/app/meta", label: "Meta", icon: Facebook },
  { href: "/app/tiktok", label: "TikTok", icon: Music2 },
  { href: "/app/youtube", label: "YouTube", icon: Youtube },
  { href: "/app/history", label: "History", icon: Clock },
  { href: "/app/plan", label: "My plan", icon: Crown },
];

/** The BluCloacking spy-shield mark, sitting at the top of the rail. */
const BRAND_MARK = "/brand/blucloacking-mark.png";

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface DeckRailProps {
  /** Light surfaces (the plan page) get the white pill; the deck gets the glass one. */
  onDark?: boolean;
  /** When given, token accounts get a small token count on the My plan item. */
  user?: UserProfile | null;
}

/** "1.2k" for the rail's tiny badge; full numbers stay in the tooltip. */
function compactTokens(value: number): string {
  if (value >= 10_000) return `${Math.floor(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function DeckRail({ onDark = true, user }: DeckRailProps) {
  const pathname = usePathname() ?? "";
  // Admin > Workspace can rename, re-icon, reorder or hide each item.
  const cms = useCms();
  const brandMark = cms.media("brand.mark", { src: BRAND_MARK, kind: "image", alt: "" }, "Logo shield").src || BRAND_MARK;
  const items = cms.list("rail.items", ITEMS, "Navigation items", ITEMS.map((i) => i.label)).map(({ item, key }) => {
    const icon = cms.iconName(`${key}.icon`, "");
    return { ...item, icon: (icon && ICONS[icon]) || item.icon };
  });
  const showSignOut = !cms.hidden("rail.signOut");
  cms.register({ key: "rail.signOut", type: "toggle", label: "Sign out button" });
  const [signingOut, setSigningOut] = useState(false);

  // The token chip: only for token accounts; red once there is nothing to spend.
  const tokens = user && user.billing_mode === "tokens" ? user.tokens_usable : null;
  const tokensLow = tokens !== null && (!user?.subscription_active || tokens <= 0);
  const tokenTip = tokens === null ? null : user?.subscription_active ? `${formatTokens(tokens)} tokens` : "No active subscription";

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

  // Shared visual tokens for the two surfaces.
  const shell = onDark
    ? "border-white/10 bg-slate-900/70"
    : "border-black/10 bg-white/85 shadow-lifted";
  const idle = onDark
    ? "text-slate-400 hover:text-meta-100 hover:bg-meta-500/15"
    : "text-ink-muted hover:text-meta-700 hover:bg-meta-50";
  const active = onDark
    ? "!border-meta-500/50 !bg-meta-500/20 !text-white shadow-[0_0_18px_-4px_rgb(8_102_255/0.7)]"
    : "!border-meta-500/50 !bg-meta-50 !text-meta-700 shadow-[0_0_18px_-6px_rgb(8_102_255/0.5)]";
  const tipTone = onDark
    ? "bg-slate-900 text-slate-100 ring-1 ring-white/10"
    : "bg-black text-white";

  const signOutIdle = onDark
    ? "text-rose-300/80 hover:text-rose-200 hover:bg-rose-500/15"
    : "text-rose-600 hover:text-rose-700 hover:bg-rose-50";

  return (
    <>
      {/* Desktop — slim vertical rail ------------------------------------ */}
      <nav
        className={clsx(
          "sticky top-[5.25rem] z-20 hidden h-fit shrink-0 flex-col gap-1.5 self-start rounded-2xl border p-2 backdrop-blur-xl md:flex",
          shell,
        )}
        aria-label="Workspace navigation"
      >
        <Link
          href="/app"
          title="BluCloacking"
          className="group relative mb-1 grid h-11 w-11 place-items-center rounded-xl transition hover:bg-meta-500/15"
        >
          <img
            src={brandMark}
            alt="BluCloacking"
            width={28}
            height={28}
            className="h-7 w-7 drop-shadow-[0_0_10px_rgba(51,133,255,0.5)]"
          />
          <span
            className={clsx(
              "pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-lg transition group-hover:opacity-100",
              tipTone,
            )}
            role="tooltip"
          >
            BluCloacking
          </span>
        </Link>

        <span className={clsx("mb-1 h-px", onDark ? "bg-white/10" : "bg-black/10")} aria-hidden />

        {items.map(({ href, label, icon: Icon }) => {
          const current = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              title={label}
              className={clsx(
                "group relative grid h-11 w-11 place-items-center rounded-xl border border-transparent transition",
                idle,
                current && active,
              )}
            >
              <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
              <span className="sr-only">{label}</span>
              {href === "/app/plan" && tokens !== null ? (
                <span
                  className={clsx(
                    "absolute -right-1 -top-1 rounded-full border px-1 font-mono text-[9px] leading-4 tabular-nums",
                    tokensLow
                      ? "border-red-400/50 bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-200"
                      : onDark
                        ? "border-meta-500/50 bg-slate-900 text-meta-200"
                        : "border-meta-500/40 bg-white text-meta-700",
                  )}
                  aria-hidden
                >
                  {compactTokens(tokens)}
                </span>
              ) : null}
              <span
                className={clsx(
                  "pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-lg transition group-hover:opacity-100",
                  tipTone,
                )}
                role="tooltip"
              >
                {href === "/app/plan" && tokenTip ? `${label} · ${tokenTip}` : label}
              </span>
            </Link>
          );
        })}

        <span className={clsx("my-1 h-px", onDark ? "bg-white/10" : "bg-black/10")} aria-hidden />

        {showSignOut ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          title="Sign out"
          className={clsx(
            "group relative grid h-11 w-11 place-items-center rounded-xl border border-transparent transition disabled:opacity-60",
            signOutIdle,
          )}
        >
          <LogOut className="h-[1.15rem] w-[1.15rem]" aria-hidden />
          <span className="sr-only">Sign out</span>
          <span
            className={clsx(
              "pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-lg transition group-hover:opacity-100",
              tipTone,
            )}
            role="tooltip"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </span>
        </button>
        ) : null}
      </nav>

      {/* Phone / tablet — floating pill ---------------------------------- */}
      <nav
        className={clsx(
          "fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-2xl border px-1.5 py-1.5 backdrop-blur-xl md:hidden",
          shell,
        )}
        aria-label="Workspace navigation"
      >
        <Link
          href="/app"
          title="BluCloacking"
          className="flex h-11 min-w-[2.4rem] items-center justify-center rounded-xl px-1 transition hover:bg-meta-500/15"
        >
          <img
            src={brandMark}
            alt="BluCloacking"
            width={24}
            height={24}
            className="h-6 w-6 drop-shadow-[0_0_8px_rgba(51,133,255,0.5)]"
          />
        </Link>
        <span className={clsx("mx-0.5 h-7 w-px self-center", onDark ? "bg-white/10" : "bg-black/10")} aria-hidden />
        {items.map(({ href, label, icon: Icon }) => {
          const current = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={clsx(
                "flex h-11 min-w-[2.4rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border border-transparent px-1 transition",
                idle,
                current && active,
              )}
            >
              <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
              <span className={clsx("text-[8.5px] font-medium leading-none whitespace-nowrap", href === "/app/plan" && tokensLow && "text-red-600 dark:text-red-300")}>
                {href === "/app/plan" && tokens !== null ? `${compactTokens(tokens)} tok` : label}
              </span>
            </Link>
          );
        })}
        {showSignOut ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={clsx(
            "flex h-11 min-w-[2.4rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border border-transparent px-1 transition disabled:opacity-60",
            signOutIdle,
          )}
        >
          <LogOut className="h-[1.1rem] w-[1.1rem]" aria-hidden />
          <span className="text-[8.5px] font-medium leading-none whitespace-nowrap">Sign out</span>
        </button>
        ) : null}
      </nav>
    </>
  );
}

export default DeckRail;
