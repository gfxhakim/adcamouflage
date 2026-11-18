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
  /** The title is a button that starts something over ("New guide"): point at it, never press it. */
  noPress?: boolean;
}

const e = (tab: AdminTabId, title: string, keywords?: string, via?: string, noPress?: boolean): AdminSearchEntry => ({
  tab,
  title,
  keywords,
  via,
  noPress,
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
  e("sales", "Refund requests", "refunds money back cancel approve reject rules"),
  e("sales", "Customers can ask for refunds from Account settings", "refund rules allow turn off", "Rules"),
  e("sales", "Plan payments can be refunded", "refund rules subscription", "Rules"),
  e("sales", "Top-ups can be refunded", "refund rules extra tokens", "Rules"),
  e("sales", "Days after payment a customer can ask", "refund rules window period limit", "Rules"),
  e("sales", "Most of the order's tokens used, % (0 = unused only, 100 = no limit)", "refund rules usage limit", "Rules"),
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
  // The card is only on the page while there is a request. Its title goes on with the minimum in brackets.
  e("affiliates", "Withdrawal requests", "withdrawals partner payouts pay out cash commission mark paid reject"),
  e("affiliates", "Affiliate applications & partners", "creator influencers promo code link commissions payouts earnings"),
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
  e("settings", "Phone alerts", "telegram notifications bot cancel refund"),
  e("settings", "Customer emails", "automatic email templates welcome subject design colours logo"),
  // Every email's own tab has this box; "Logo & colours" does not, so the first email is opened.
  e("settings", "Top line and highlight box", "email design", "Welcome"),
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
  // Pressing "New guide" empties the form, so the search only points at the button.
  e("guides", "New guide", "article seo write add post", undefined, true),
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

const tidy = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The words an element holds itself, without what its children add (a count chip, a field). */
function ownText(node: Element): string {
  let text = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
  });
  return tidy(text);
}

/**
 * The first element in `root` whose text is `wanted`. A count may follow it,
 * in brackets ("Support Queue (3)") or as a chip inside the title. With
 * `ownOnly`, only the element's own words count (a label that wraps its field).
 */
function findByText(root: ParentNode, selector: string, wanted: string, ownOnly = false): HTMLElement | null {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (ownText(node) === wanted) return node;
    if (ownOnly) continue;
    const text = tidy(node.textContent ?? "");
    if (text === wanted || text.startsWith(`${wanted} (`)) return node;
  }
  return null;
}

/** How long a jump waits for the page to show the title: pages load their data after opening. */
const FIND_MS = 12000;
const FIND_STEP_MS = 150;
/** Once the title is in view the jump keeps it there at least this long... */
const HOLD_MS = 3500;
/** ...and until the page has stopped moving it for this long, but never longer than HOLD_MAX_MS. */
const QUIET_MS = 2500;
const HOLD_MAX_MS = 15000;
const HOLD_STEP_MS = 100;
/** Right after the first scroll, a title that is not in view is always brought back. */
const SETTLE_MS = 1500;
const GLOW_MS = 2600;
/** Room kept clear at the top of the window for the sticky header. */
const TOP_CLEAR = 76;

/** What the owner does to take over the page: the jump stops steering at once. */
const TAKE_OVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
/** The second press of a double click lands within this time: it belongs to picking the result. */
const DOUBLE_PRESS_MS = 450;
/** Keys held for a shortcut (Alt+Tab to another window): pressing one steers nothing. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock"]);

let stopJump: (() => void) | null = null;

/** Stops the jump in progress, if any. Call it when the admin opens another page. */
export function cancelJump(): void {
  stopJump?.();
}

/** True while a jump is finding or holding its title: a page should not scroll itself meanwhile. */
export function jumpActive(): boolean {
  return stopJump !== null;
}

/**
 * Scrolls to the element showing `entry.title` inside `root` and flashes it.
 *
 * Pages load their data after opening, so the jump first waits for the title to
 * appear. Cards above it then keep loading and push it down the page, so once it
 * is found the jump follows it for a few seconds and scrolls again whenever the
 * page moved it out of view. Scrolling, clicking or typing stops the jump.
 *
 * A title that is itself a button (an inner tab such as "Tab & SEO") is pressed,
 * unless the entry says `noPress`, and `entry.via` is pressed first when the
 * title sits behind it.
 */
export function jumpToTitle(entry: Pick<AdminSearchEntry, "title" | "via" | "noPress">, root: ParentNode = document): void {
  cancelJump();

  const wanted = tidy(entry.title);
  const via = entry.via ? tidy(entry.via) : undefined;
  const started = Date.now();
  const origin = document.activeElement; // where the keyboard was when the result was picked
  let viaPressed = false;
  let stopped = false;
  let timer = 0;
  let release: (() => void) | null = null; // set once the title is held: stops watching the page's size

  function stop() {
    stopped = true;
    window.clearTimeout(timer);
    release?.();
    release = null;
    for (const type of TAKE_OVER) window.removeEventListener(type, takeOver, true);
    if (stopJump === stop) stopJump = null;
  }
  function takeOver(event: Event) {
    const early = Date.now() - started < DOUBLE_PRESS_MS;
    if (event.type === "keydown") {
      const { key, repeat, target } = event as KeyboardEvent;
      // A key still held from picking the result, or a modifier, is not the owner taking over.
      if (repeat || MODIFIER_KEYS.has(key)) return;
      // Enter again where the result was picked (the search box), or with nothing focused (the
      // phone menu closed and took the search box with it), asks for nothing new. Enter or Space
      // pressed twice is one pick, like a double click.
      if (key === "Enter" && (early || target === origin || target === document.body)) return;
      if (key === " " && early) return;
    } else if (early && event.type !== "wheel") {
      return; // the second press of a double click
    }
    stop();
  }
  for (const type of TAKE_OVER) window.addEventListener(type, takeOver, { capture: true, passive: true });
  stopJump = stop;

  // A plain label around its field is the last place to look.
  const findTitle = () => findByText(root, TITLES, wanted) ?? findByText(root, "label", wanted, true);

  // An attribute, not a class: a pressed tab re-renders its class list and would drop the glow.
  let glowTimer = 0;
  const flash = (target: HTMLElement) => {
    window.clearTimeout(glowTimer);
    target.removeAttribute("data-search-hit");
    void target.offsetWidth; // lets the glow start over when the title is flashed a second time
    target.setAttribute("data-search-hit", "");
    glowTimer = window.setTimeout(() => target.removeAttribute("data-search-hit"), GLOW_MS);
  };

  const inView = (rect: DOMRect) => rect.top >= TOP_CLEAR && rect.bottom <= window.innerHeight - 12;

  /**
   * Scrolls to `first`, then keeps it where it came to rest while the page around it settles:
   * when a card above it loads and pushes it down, the page moves by the same amount.
   */
  const hold = (first: HTMLElement, isButton: boolean) => {
    let target = first;
    const foundAt = Date.now();
    let quietSince = foundAt;
    let lastTop = Number.NaN; // where the title sat in the window at the last look
    let lastOffset = Number.NaN; // ...and in the page
    let resting = false; // it has come to rest in view
    let owed = false; // the page moved it and following it did not bring it back into view
    let moved = false; // the page was scrolled to it since it last glowed
    let scrolls = 0;
    let scrolledAt = 0;

    const scroll = () => {
      scrolls += 1;
      scrolledAt = Date.now();
      moved = true;
      resting = false;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    scroll();

    /**
     * Content above the resting title loaded and pushed it down the page: scroll by as far as it
     * moved in the window, so it stays put. A browser that follows such shifts by itself has
     * already done that, and nothing is left to do.
     */
    const follow = () => {
      if (stopped || !resting || !target.isConnected) return;
      const rect = target.getBoundingClientRect();
      if (Math.abs(rect.top + window.scrollY - lastOffset) <= 1) return;
      const drift = rect.top - lastTop;
      if (Math.abs(drift) > 1) window.scrollBy({ top: drift, behavior: "instant" });
      lastOffset = target.getBoundingClientRect().top + window.scrollY;
      quietSince = Date.now();
      owed = true;
    };
    // The page changes size when a card lands. Following it right then, before the window is
    // drawn again, keeps the shift from showing at all; the timer below is the safety net.
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(follow);
      observer.observe(document.body);
      release = () => observer.disconnect();
    }

    const watch = () => {
      if (stopped) return;
      const now = Date.now();
      if (!target.isConnected) {
        // The card drew itself again with fresh data: pick the title up where it is now.
        const again = findTitle() ?? (isButton ? findByText(root, "button", wanted) : null);
        if (again) {
          target = again;
          resting = false;
          moved = true;
          lastTop = Number.NaN;
          lastOffset = Number.NaN;
        }
      }
      if (target.isConnected) {
        follow();
        const rect = target.getBoundingClientRect();
        const still = Math.abs(rect.top - lastTop) <= 1;
        if (!still) quietSince = now;
        if (still && inView(rect)) {
          owed = false;
          if (!resting) {
            // It has come to rest where the owner can see it: glow now, not while it was still off screen.
            resting = true;
            if (moved) flash(target);
            moved = false;
          }
        } else if (still && now - scrolledAt >= 400) {
          // Out of view and nothing is moving: scroll again if that is still this jump's job. After it
          // had settled, a window that moved by itself means the owner (or the page) has taken over.
          if (resting && !owed && now - foundAt >= SETTLE_MS) return stop();
          if (scrolls >= 12) return stop();
          scroll();
          quietSince = now;
        }
        lastTop = rect.top;
        lastOffset = rect.top + window.scrollY;
      }
      const held = now - foundAt;
      if (held >= HOLD_MAX_MS || (resting && held >= HOLD_MS && now - quietSince >= QUIET_MS)) return stop();
      timer = window.setTimeout(watch, HOLD_STEP_MS);
    };
    timer = window.setTimeout(watch, HOLD_STEP_MS);
  };

  const look = () => {
    if (stopped) return;
    const title = findTitle();
    if (title) return hold(title, false);
    if (via && !viaPressed) {
      const opener = findByText(root, "button", via);
      if (opener) {
        viaPressed = true;
        opener.click();
      }
    } else if (!via) {
      const button = findByText(root, "button", wanted);
      if (button) {
        if (!entry.noPress) button.click();
        return hold(button, true);
      }
    }
    if (Date.now() - started < FIND_MS) timer = window.setTimeout(look, FIND_STEP_MS);
    else stop();
  };
  look();
}
