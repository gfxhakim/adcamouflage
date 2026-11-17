"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { readSidebarOpen } from "@/lib/sidebarCookie";

interface SidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SidebarStateContext = createContext<SidebarState | null>(null);

const never = () => () => {};
const no = () => false;
const yes = () => true;

/**
 * Keeps the workspace sidebar open or collapsed while the customer moves
 * between pages. It lives in the workspace layout, which stays mounted, and
 * starts from the cookie the sidebar writes, so a reload keeps the choice too.
 */
export function SidebarStateProvider({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  // True on the server and while React attaches to the page the server sent, false when this
  // layout is built in the browser.
  const fromServer = useSyncExternalStore(never, no, yes);
  // The page the server sent was drawn with `initialOpen`, so the state must start there too.
  // Built in the browser, the cookie itself is the truth: `initialOpen` can be an old answer when
  // Next brings this layout back from its cache (Back / Forward after leaving the workspace).
  const [open, setOpen] = useState(() => (fromServer ? initialOpen : readSidebarOpen()));
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
}

/** The shared state, or a private one when a page is shown outside the workspace layout. */
export function useSidebarState(): SidebarState {
  const shared = useContext(SidebarStateContext);
  const [open, setOpen] = useState(true);
  return shared ?? { open, setOpen };
}
