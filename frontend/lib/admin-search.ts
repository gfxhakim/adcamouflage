/** What the admin sidebar's search box can find: every settings card and
 *  named parameter in the admin pages, by its on-screen title. Picking a
 *  result opens the page and scrolls to the title. Add a line here when a
 *  new card or parameter is added to an admin page. */

export type AdminTabId =
  | "overview"
  | "support"
  | "users"
  | "sales"
  | "affiliates"
  | "analytics"
  | "settings"
  | "landing"
  | "workspace"
  | "guides";

export interface AdminSearchEntry {
  /** The title as it is written on the page. */
  title: string;
  tab: AdminTabId;
  /** Extra words that should also find it. */
  keywords?: string;
  /** A button on that page to press first, when the title sits behind it (a closed panel or inner tab). */
  via?: string;
}

const e = (tab: AdminTabId, title: string, keywords?: string, via?: string): AdminSearchEntry => ({
  tab,
  title,
  keywords,
  via,
});

export const ADMIN_SEARCH_INDEX: AdminSearchEntry[] = [
  // Dashboard
  e("overview", "Needs your attention", "alerts warnings"),
  e("overview", "Files processed per day", "chart usage"),
  e("overview", "System", "queue workers storage health status"),
  e("overview", "Live activity", "events feed log"),

  // Support
  e("support", "Support Queue", "tickets live chat agent"),

  // Sales
  e("sales", "Daily", "chart revenue sign-ups checkouts"),
  e("sales", "Funnel", "conversion sign-ups checkouts payments"),
  e("sales", "Revenue by plan", "income money"),
  e("sales", "Latest approved payments", "orders transactions"),
  e("sales", "Batch costs", "hosting cost render"),
  e("sales", "Expected cost of a batch of 5", "hosting cost estimate"),
  e("sales", "vCPU, $ per minute", "hosting rate cost", "Edit rates"),
  e("sales", "RAM, $ per GB-minute", "hosting rate cost memory", "Edit rates"),
  e("sales", "Download bandwidth, $ per GB", "hosting rate cost egress", "Edit rates"),
  e("sales", "vCPUs busy while rendering", "hosting cost", "Edit rates"),
  e("sales", "RAM used while rendering, GB", "hosting cost memory", "Edit rates"),
  e("sales", "Latest batches", "cost"),

  // Affiliates
  e("affiliates", "Program settings", "referral commission coupon reward"),
  e("affiliates", "Commission tiers, by paying customers in the month", "percent partners"),
  e("affiliates", "Reward tokens for the referrer, by the friend's plan", "referral bonus invite"),
  e("affiliates", "Plans the coupon works on", "discount code"),
  e("affiliates", "Creator partners", "affiliates influencers commissions payouts earnings"),
  e("affiliates", "All referrals", "invites friends"),

  // Analytics
  e("analytics", "New sign-ups", "registrations chart"),
  e("analytics", "Active users per day", "chart"),
  e("analytics", "Files processed", "usage chart"),
  e("analytics", "Revenue by plan", "income mrr"),
  e("analytics", "This month's usage", "quota"),
  e("analytics", "Top users this month", "biggest heavy"),
  e("analytics", "Close to their limit", "quota"),
  e("analytics", "Hit their limit this month", "quota"),
  e("analytics", "Plans ending in 7 days", "renewal expiring"),
  e("analytics", "Expired plans", "ended lapsed"),

  // Settings
  e("settings", "Token plans", "pricing price starter pro max subscription"),
  e("settings", "Price", "plan pricing cost"),
  e("settings", "Tokens", "plan allowance"),
  e("settings", "Per generation", "plan token cost"),
  e("settings", "Rollover", "plan unused tokens"),
  e("settings", "Top-up rate", "plan tokens per dollar"),
  e("settings", "Period length (days)", "billing cycle month"),
  e("settings", "Grace days after a period ends", "billing expiry"),
  e("settings", "Limited-time offer", "discount launch price sale"),
  e("settings", "Top-ups", "extra tokens buy"),
  e("settings", "Phone alerts", "telegram notifications bot"),
  e("settings", "Customer emails", "automatic email templates welcome subject design colours logo"),
  e("settings", "Top line and highlight box", "email design"),
  e("settings", "Send to a group", "broadcast newsletter group email sent history"),
  e("settings", "App settings", "general"),
  e("settings", "Allow new sign-ups", "registration open close accounts"),
  e("settings", "Legacy plan for hand-made accounts", "default plan"),
  e("settings", "Currency", "usd money symbol"),
  e("settings", "Announcement banner", "notice message maintenance"),
  e("settings", "Legacy plans (older accounts)", "files per month quota"),
  e("settings", "Danger zone", "delete users reset wipe"),

  // Landing page + workspace editors
  e("landing", "Colours", "theme accent design", "Colours & fonts"),
  e("landing", "Fonts", "theme typography design", "Colours & fonts"),
  e("landing", "Shape & behaviour", "theme roundness animation scrollbar", "Colours & fonts"),
  e("landing", "Custom CSS", "theme style", "Colours & fonts"),
  e("landing", "Reviews", "testimonials customers"),
  e("landing", "Tab & SEO", "title description link preview google favicon"),
  e("workspace", "Colours", "theme accent design", "Colours & fonts"),
  e("workspace", "Fonts", "theme typography design", "Colours & fonts"),
  e("workspace", "Shape & behaviour", "theme roundness animation", "Colours & fonts"),
  e("workspace", "Custom CSS", "theme style", "Colours & fonts"),
  e("workspace", "Tab & SEO", "title description favicon"),

  // Guides
  e("guides", "New guide", "article seo write add post"),
];

/** Entries whose title or keywords contain every word typed; title matches first. */
export function searchAdmin(query: string, limit = 12): AdminSearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: AdminSearchEntry; score: number }[] = [];
  for (const entry of ADMIN_SEARCH_INDEX) {
    const title = entry.title.toLowerCase();
    const all = `${title} ${entry.keywords ?? ""} ${entry.tab}`;
    if (!words.every((w) => all.includes(w))) continue;
    const inTitle = words.every((w) => title.includes(w));
    scored.push({ entry, score: (title.startsWith(words[0]) ? 0 : inTitle ? 1 : 2) });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.entry);
}

const TITLES = "h2, h3, h4, legend, .label, label span, th";

/** The first element in `root` whose text is `wanted`, allowing a count after it: "Support Queue (3)". */
function findByText(root: ParentNode, selector: string, wanted: string): HTMLElement | null {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const text = (node.textContent ?? "").trim().toLowerCase();
    if (text === wanted || text.startsWith(`${wanted} (`)) return node;
  }
  return null;
}

/**
 * Scrolls to the element showing `entry.title` inside `root` and flashes it.
 * Pages load their data after opening, so it keeps looking for a few seconds.
 * A title that is itself a button (an inner tab such as "Tab & SEO") is pressed,
 * and `entry.via` is pressed first when the title sits behind it.
 */
export function jumpToTitle(entry: Pick<AdminSearchEntry, "title" | "via">, root: ParentNode = document, tries = 24): void {
  const wanted = entry.title.trim().toLowerCase();
  const via = entry.via?.trim().toLowerCase();
  let viaPressed = false;

  // An attribute, not a class: a pressed tab re-renders its class list and would drop the glow.
  const show = (target: HTMLElement) => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.setAttribute("data-search-hit", "");
    window.setTimeout(() => target.removeAttribute("data-search-hit"), 2600);
  };

  const attempt = (left: number) => {
    const title = findByText(root, TITLES, wanted);
    if (title) return show(title);
    if (via && !viaPressed) {
      const opener = findByText(root, "button", via);
      if (opener) {
        viaPressed = true;
        opener.click();
      }
    } else if (!via) {
      const tab = findByText(root, "button", wanted);
      if (tab) {
        tab.click();
        return show(tab);
      }
    }
    if (left > 0) window.setTimeout(() => attempt(left - 1), 150);
  };
  attempt(tries);
}
