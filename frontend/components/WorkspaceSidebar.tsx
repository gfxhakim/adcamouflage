/* eslint-disable @next/next/no-img-element -- small static brand PNG; the image optimizer adds nothing here. */
"use client";

import clsx from "clsx";
import { Clock, Crown, HelpCircle, LayoutGrid, LogOut, Megaphone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import BrandLogo, { MARK_GLOW_ON_DARK } from "@/components/BrandLogo";
import { useCms } from "@/components/cms/ContentProvider";
import { ICONS } from "@/components/cms/icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut, type UserProfile } from "@/lib/auth";
import { formatTokens } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The signed-in navigation for the workspace: Workspace, History, My plan and
 * Invite & earn, then Help and Sign out. A full sidebar with the page names on
 * desktop (it folds down to icons), a slide-in drawer on phones and tablets.
 * Colours are the workspace's own: Meta blue on white, or on the dark deck.
 */
const ITEMS: NavItem[] = [
  { href: "/app", label: "Workspace", icon: LayoutGrid },
  { href: "/app/history", label: "History", icon: Clock },
  { href: "/app/plan", label: "My plan", icon: Crown },
  { href: "/app/referrals", label: "Affiliate program", icon: Megaphone },
];

const BRAND_MARK = "/brand/proteusflow-mark.png";

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** "1.2k" for the small badge; the full number is in the tooltip. */
function compactTokens(value: number): string {
  if (value >= 10_000) return `${Math.floor(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function initials(name: string | null, email: string): string {
  const parts = (name || email).trim().split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// One row of the menu. `dark:` switches on inside the deck, so the same
// classes serve the white pages and the black workspace.
const ROW =
  "group/item h-10 gap-3 rounded-xl border border-transparent px-3 font-medium transition-colors [&>svg]:size-[1.15rem] group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0";
const ROW_IDLE =
  "text-ink-muted hover:bg-meta-50 hover:text-meta-700 active:bg-meta-100 active:text-meta-700 dark:text-slate-400 dark:hover:bg-meta-500/15 dark:hover:text-meta-100 dark:active:bg-meta-500/25 dark:active:text-white";
const ROW_CURRENT =
  "data-[active=true]:border-meta-500/50 data-[active=true]:bg-meta-50 data-[active=true]:text-meta-700 data-[active=true]:shadow-[0_0_18px_-6px_rgb(8_102_255/0.5)] dark:data-[active=true]:bg-meta-500/20 dark:data-[active=true]:text-white dark:data-[active=true]:shadow-[0_0_18px_-4px_rgb(8_102_255/0.7)]";
const GROUP_LABEL = "px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint dark:text-slate-500";
// Folded to icons, the name stays for screen readers and voice control.
const LABEL = "truncate group-data-[collapsible=icon]:sr-only";

interface WorkspaceSidebarProps {
  /** This page follows the black / white switch (the plan and referral pages stay white). */
  deck?: boolean;
  /** The sidebar is on a dark surface right now. */
  onDark?: boolean;
  /** When given, token accounts get a token count on the My plan item. */
  user?: UserProfile | null;
  /** Opens the workspace "How to use" help drawer. */
  onOpenHelp?: () => void;
  /** Shows a small green dot on the help button until first opened. */
  helpUnread?: boolean;
}

export function WorkspaceSidebar({ deck = false, onDark = false, user, onOpenHelp, helpUnread = false }: WorkspaceSidebarProps) {
  const pathname = usePathname() ?? "";
  const { isMobile, setOpenMobile } = useSidebar();
  // Admin > Workspace can rename, re-icon, reorder or hide each item.
  const cms = useCms();
  const brandMark = cms.media("brand.mark", { src: BRAND_MARK, kind: "image", alt: "" }, "Logo mark").src || BRAND_MARK;
  const items = cms.list("rail.nav", ITEMS, "Navigation items", ITEMS.map((i) => i.label)).map(({ item, key }) => {
    const icon = cms.iconName(`${key}.icon`, "");
    return { ...item, icon: (icon && ICONS[icon]) || item.icon };
  });
  const showHelp = !cms.hidden("rail.help");
  cms.register({ key: "rail.help", type: "toggle", label: "Help center (?) button" });
  const showSignOut = !cms.hidden("rail.signOut");
  cms.register({ key: "rail.signOut", type: "toggle", label: "Sign out button" });
  const [signingOut, setSigningOut] = useState(false);

  // The token count: only for token accounts; red once there is nothing to spend.
  const tokens = user && user.billing_mode === "tokens" ? user.tokens_usable : null;
  const tokensLow = tokens !== null && (!user?.subscription_active || tokens <= 0);
  const tokenTip = tokens === null ? null : user?.subscription_active ? `${formatTokens(tokens)} tokens` : "No active subscription";
  const tokenTone = tokensLow
    ? "border-red-400/50 bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-200"
    : "border-meta-500/40 bg-white text-meta-700 dark:border-meta-500/50 dark:bg-slate-900 dark:text-meta-200";

  const closeDrawer = () => {
    if (isMobile) setOpenMobile(false);
  };

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

  const handleHelp = () => {
    closeDrawer();
    if (onOpenHelp) {
      onOpenHelp();
      return;
    }
    window.location.assign("/app?help=1");
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-black/[0.07] dark:border-white/10 [&>[data-sidebar=sidebar]]:bg-white/85 [&>[data-sidebar=sidebar]]:backdrop-blur-xl dark:[&>[data-sidebar=sidebar]]:bg-slate-900/85"
      // The phone drawer opens outside the page, so it carries the deck switch itself, and the
      // class the theme from Admin > Workspace (corner radius, text colour, own CSS) is scoped to.
      mobileClassName={clsx(
        "cms-workspace border-black/[0.07] bg-white text-black",
        deck && "deck dark:border-white/10 dark:!bg-slate-900 dark:![background-image:none] dark:text-slate-100",
      )}
      aria-label="Workspace navigation"
    >
      <SidebarHeader className="h-[calc(4.25rem+1px)] justify-center border-b border-black/[0.07] px-4 py-0 dark:border-white/10 group-data-[collapsible=icon]:px-2">
        <Link
          href="/"
          onClick={closeDrawer}
          className="flex min-w-0 items-center group-data-[collapsible=icon]:hidden"
          aria-label="ProteusFlow home"
        >
          <BrandLogo caption="Workspace" onDark={onDark} />
        </Link>
        <Link
          href="/"
          title="ProteusFlow"
          className="mx-auto hidden size-11 place-items-center rounded-xl transition hover:bg-meta-500/15 group-data-[collapsible=icon]:grid"
        >
          <img
            src={brandMark}
            alt="ProteusFlow"
            width={28}
            height={28}
            className={clsx("h-7 w-7 object-contain", onDark ? MARK_GLOW_ON_DARK : "drop-shadow-[0_0_10px_rgba(51,133,255,0.5)]")}
          />
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-3 group-data-[collapsible=icon]:px-2">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className={GROUP_LABEL}>Menu</SidebarGroupLabel>
          <SidebarGroupContent className="mt-1">
            <SidebarMenu className="gap-1.5">
              {items.map(({ href, label, icon: Icon }) => {
                const current = isActive(pathname, href);
                const showTokens = href === "/app/plan" && tokens !== null;
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      asChild
                      isActive={current}
                      tooltip={showTokens && tokenTip ? `${label} · ${tokenTip}` : label}
                      className={clsx(ROW, ROW_IDLE, ROW_CURRENT)}
                    >
                      <Link href={href} aria-current={current ? "page" : undefined} onClick={closeDrawer}>
                        <Icon aria-hidden />
                        <span className={LABEL}>{label}</span>
                        {showTokens ? (
                          <span
                            className={clsx(
                              "ml-auto shrink-0 rounded-full border px-1.5 font-mono text-[10px] leading-[1.125rem] tabular-nums group-data-[collapsible=icon]:hidden",
                              tokenTone,
                            )}
                            title={tokenTip ?? undefined}
                            data-cms-skip
                          >
                            {compactTokens(tokens)}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                    {showTokens ? (
                      <span
                        className={clsx(
                          "pointer-events-none absolute -right-1 -top-1 hidden rounded-full border px-1 font-mono text-[9px] leading-4 tabular-nums group-data-[collapsible=icon]:block",
                          tokenTone,
                        )}
                        aria-hidden
                        data-cms-skip
                      >
                        {compactTokens(tokens)}
                      </span>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showHelp ? (
          <SidebarGroup className="mt-4 p-0">
            <SidebarGroupLabel className={GROUP_LABEL}>Help</SidebarGroupLabel>
            <SidebarGroupContent className="mt-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={handleHelp}
                    data-tour="help"
                    tooltip="How to use · Guide & tips"
                    className={clsx(
                      ROW,
                      "bg-meta-500 text-white shadow-[0_0_0_4px_rgba(8,102,255,0.18)] hover:bg-meta-600 hover:text-white active:bg-meta-700 active:text-white",
                    )}
                  >
                    <HelpCircle aria-hidden />
                    <span className={LABEL}>How to use</span>
                  </SidebarMenuButton>
                  {helpUnread ? (
                    <span
                      className="pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900"
                      aria-hidden
                    />
                  ) : null}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="gap-1.5 border-t border-black/[0.07] p-3 dark:border-white/10 group-data-[collapsible=icon]:p-2">
        {user ? (
          <Link
            href="/app/plan"
            onClick={closeDrawer}
            title="Plan & account"
            className="flex min-w-0 items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0.5"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback
                className="bg-meta-50 text-xs font-bold text-meta-700 dark:bg-meta-500/20 dark:text-meta-200"
                data-cms-skip
              >
                {initials(user.display_name, user.email)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:sr-only" data-cms-skip>
              <span className="block truncate text-sm font-semibold text-black dark:text-slate-100">
                {user.display_name || user.email.split("@")[0]}
              </span>
              <span className="block truncate text-xs text-ink-faint dark:text-slate-400">{user.email}</span>
            </span>
          </Link>
        ) : (
          <div className="flex items-center gap-3 p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0.5" aria-hidden>
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/10" />
            <span className="h-3 flex-1 animate-pulse rounded bg-black/[0.06] dark:bg-white/10 group-data-[collapsible=icon]:hidden" />
          </div>
        )}

        {showSignOut ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleSignOut}
                disabled={signingOut}
                tooltip="Sign out"
                className={clsx(
                  ROW,
                  "text-rose-600 hover:bg-rose-50 hover:text-rose-700 active:bg-rose-100 active:text-rose-700 disabled:opacity-60 dark:text-rose-300/80 dark:hover:bg-rose-500/15 dark:hover:text-rose-200 dark:active:bg-rose-500/25 dark:active:text-rose-100",
                )}
              >
                <LogOut aria-hidden />
                <span className={LABEL}>{signingOut ? "Signing out…" : "Sign out"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}

export default WorkspaceSidebar;
