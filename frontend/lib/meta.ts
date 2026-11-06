/**
 * Meta Pixel in the browser, paired with the server's Conversions API.
 *
 * Every event carries an event id. The server sends the same event with the
 * same id, so Meta counts it once (deduplication):
 *   CompleteRegistration  signup-<user id>
 *   InitiateCheckout      checkout-<order id>
 *   AddPaymentInfo        payinfo-<order id>
 *   Purchase              purchase-<order id>   (only after the payment is confirmed)
 *   PageView/ViewContent  random id, forwarded to the server via /api/v1/meta/event
 *
 * Nothing loads until the visitor accepts cookies, and nothing at all while
 * the API has no Pixel id (ADCAM_META_PIXEL_ID on the api service).
 */

export const CONSENT_COOKIE = "bc_consent";
export const CONSENT_EVENT = "bc-consent-open";
type Consent = "granted" | "denied" | null;

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let pixelId: string | null = null;
let configLoaded: Promise<string> | null = null;
let started = false;

export function readConsent(): Consent {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)bc_consent=(granted|denied)/);
  return (match?.[1] as Consent) ?? null;
}

export function writeConsent(value: "granted" | "denied") {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // Read by the API too, so it is a plain (not httpOnly) first-party cookie.
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
}

export function loadConfig(): Promise<string> {
  if (!configLoaded) {
    configLoaded = fetch("/api/v1/meta/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { pixel_id: "" }))
      .then((body: { pixel_id?: string }) => (body.pixel_id || "").trim())
      .catch(() => "");
  }
  return configLoaded;
}

function installPixel(id: string) {
  if (window.fbq) return;
  // Meta's standard loader, written out so it runs only after consent.
  const fbq: Fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  fbq("init", id);
}

const CLICK_KEY = "bc_fbclid";
const CLICK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Remember the ad click id (?fbclid=) from the page the visitor landed on.
 *
 * The Pixel only turns it into the _fbc cookie when it is running on that
 * same page, but here it only runs after the cookie banner is accepted,
 * often on a later page. Without _fbc a Purchase confirmed hours later is
 * hard for Meta to tie to the ad, so the click id is kept in this browser
 * only (never sent anywhere) until the visitor allows tracking.
 */
export function rememberAdClick() {
  if (typeof window === "undefined") return;
  try {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid && /^[A-Za-z0-9_-]{8,512}$/.test(fbclid)) {
      localStorage.setItem(CLICK_KEY, JSON.stringify({ id: fbclid, at: Date.now() }));
    }
  } catch {
    /* Storage blocked: the Pixel's own _fbc still covers same-page consent. */
  }
}

function readCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : "";
}

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax${secure}`;
}

/**
 * After consent: make sure _fbc (ad click) and _fbp (browser id) exist, in
 * Meta's own format, so the server has them at checkout even when the Pixel
 * script is blocked or the click came in before consent. The Pixel adopts
 * cookies already set in this format.
 */
function ensureMetaCookies() {
  try {
    if (!readCookie("_fbc")) {
      const saved = JSON.parse(localStorage.getItem(CLICK_KEY) || "null") as { id?: string; at?: number } | null;
      if (saved?.id && saved.at && Date.now() - saved.at < CLICK_MAX_AGE_MS) {
        writeCookie("_fbc", `fb.1.${saved.at}.${saved.id}`);
      }
    }
    if (!readCookie("_fbp")) {
      const rand = Math.floor(1_000_000_000 + Math.random() * 8_999_999_999);
      writeCookie("_fbp", `fb.1.${Date.now()}.${rand}`);
    }
  } catch {
    /* Cookies or storage blocked: Meta falls back to email / IP matching. */
  }
}

/** Load the Pixel if the visitor accepted and Meta is set up. Returns whether it is running. */
export async function startPixel(): Promise<boolean> {
  if (started) return true;
  if (readConsent() !== "granted") return false;
  const id = await loadConfig();
  if (!id) return false;
  pixelId = id;
  ensureMetaCookies();
  installPixel(id);
  started = true;
  return true;
}

function randomId(prefix: string) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

type Custom = Record<string, unknown>;

async function fire(name: string, data: Custom | undefined, eventId: string) {
  if (!(await startPixel()) || !window.fbq || !pixelId) return;
  window.fbq("track", name, data ?? {}, { eventID: eventId });
}

/** PageView and ViewContent: the browser fires them and asks the server to send its copy. */
export async function trackPage(name: "PageView" | "ViewContent", contentName?: string) {
  if (!(await startPixel())) return;
  const eventId = randomId(name === "PageView" ? "pv" : "vc");
  await fire(name, contentName ? { content_name: contentName } : undefined, eventId);
  void fetch("/api/v1/meta/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_name: name, event_id: eventId, url: window.location.href, content_name: contentName }),
    keepalive: true,
  }).catch(() => undefined);
}

export function trackRegistration(userId: number | string) {
  return fire("CompleteRegistration", { status: "registered" }, `signup-${userId}`);
}

/** InitiateCheckout + AddPaymentInfo for a new order; the server sends both with the same ids. */
export function trackCheckout(orderId: string, value: number, currency: string, planId: string, provider?: string) {
  const data = { value, currency, content_ids: [planId], content_type: "product", num_items: 1 };
  return Promise.all([
    fire("InitiateCheckout", data, `checkout-${orderId}`),
    fire("AddPaymentInfo", provider ? { ...data, payment_method: provider } : data, `payinfo-${orderId}`),
  ]);
}

/** Only call once the API says the order is paid. Fired once per order per browser. */
export function trackPurchase(orderId: string, value: number, currency: string, planId: string) {
  const key = `bc_purchase_${orderId}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* Private mode: Meta still deduplicates by event id. */
  }
  return fire(
    "Purchase",
    { value, currency, content_ids: [planId], content_type: "product", num_items: 1 },
    `purchase-${orderId}`,
  );
}
