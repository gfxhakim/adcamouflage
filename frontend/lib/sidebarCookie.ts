/** The cookies the sidebar kit (components/ui/sidebar) writes: "true" open, "false" collapsed. */
export const SIDEBAR_COOKIE = "sidebar_state";
/** The admin panel keeps its own, so folding one sidebar leaves the other alone. */
export const ADMIN_SIDEBAR_COOKIE = "admin_sidebar_state";

/** Read in the browser, for shells that only mount after sign-in is checked. */
export function readSidebarOpen(cookie: string = SIDEBAR_COOKIE): boolean {
  if (typeof document === "undefined") return true;
  return !document.cookie.split("; ").includes(`${cookie}=false`);
}
