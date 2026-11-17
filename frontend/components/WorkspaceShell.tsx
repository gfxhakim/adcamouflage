"use client";

import type { CSSProperties, ReactNode } from "react";

import Header from "@/components/Header";
import { useSidebarState } from "@/components/SidebarState";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import { type UserProfile } from "@/lib/auth";
import { useDeckTheme } from "@/lib/deckTheme";
import { SIDEBAR_COOKIE } from "@/lib/sidebarCookie";
import type { HealthReport } from "@/lib/types";

interface WorkspaceShellProps {
  user: UserProfile | null;
  /** The page follows the black / white switch. Leave off for the always-white pages. */
  deck?: boolean;
  /** Passed on to the top bar; leave both out on pages that do not watch the render engine. */
  health?: HealthReport | null;
  healthError?: string | null;
  /** Opens the workspace "How to use" help drawer. */
  onOpenHelp?: () => void;
  helpUnread?: boolean;
  children: ReactNode;
}

// Folded, it is a slim icon column, about as wide as the rail it replaces.
const SIZES = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3.75rem" } as CSSProperties;

/**
 * The frame every signed-in customer page sits in: the sidebar on the left
 * (a drawer on phones and tablets) and the top bar with its menu button.
 */
export function WorkspaceShell({ user, deck = false, health, healthError, onOpenHelp, helpUnread, children }: WorkspaceShellProps) {
  const theme = useDeckTheme();
  const onDark = deck && theme === "dark";
  const { open, setOpen } = useSidebarState();

  return (
    <SidebarProvider open={open} onOpenChange={setOpen} cookieName={SIDEBAR_COOKIE} className={deck ? "deck" : undefined} style={SIZES}>
      <WorkspaceSidebar deck={deck} onDark={onDark} user={user} onOpenHelp={onOpenHelp} helpUnread={helpUnread} />
      <div className="relative flex min-h-svh min-w-0 flex-1 flex-col">
        <Header
          health={health}
          healthError={healthError}
          user={user}
          onDark={onDark}
          leading={
            <SidebarTrigger
              className="h-9 w-9 shrink-0 rounded-lg border border-black/10 text-ink-muted hover:bg-meta-50 hover:text-meta-700 focus-visible:ring-meta-500 focus-visible:ring-offset-0 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white [&>svg]:h-4 [&>svg]:w-4"
              aria-label="Open or close the menu"
            />
          }
        />
        {children}
      </div>
    </SidebarProvider>
  );
}

export default WorkspaceShell;
