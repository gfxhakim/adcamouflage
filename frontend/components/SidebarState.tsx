"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface SidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SidebarStateContext = createContext<SidebarState | null>(null);

/**
 * Keeps the workspace sidebar open or collapsed while the customer moves
 * between pages. It lives in the workspace layout, which stays mounted, and
 * starts from the cookie the sidebar writes, so a reload keeps the choice too.
 */
export function SidebarStateProvider({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
}

/** The shared state, or a private one when a page is shown outside the workspace layout. */
export function useSidebarState(): SidebarState {
  const shared = useContext(SidebarStateContext);
  const [open, setOpen] = useState(true);
  return shared ?? { open, setOpen };
}
