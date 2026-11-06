import { API_BASE } from "./api";

/**
 * Tell the owner's phone that a visitor pressed a plan's Choose button.
 * Fire-and-forget: sendBeacon survives the page navigating away, and a
 * failure is ignored so the button always works.
 */
export function reportPlanClick(planId: string): void {
  try {
    const url = `${API_BASE}/api/v1/notify/plan-click`;
    const body = JSON.stringify({ plan_id: planId });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).catch(() => undefined);
  } catch {
    /* never block the button */
  }
}
