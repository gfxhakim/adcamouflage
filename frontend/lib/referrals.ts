import { API_BASE, ApiError } from "./api";

/** A discount a link or coupon gives on the first subscription payment. */
export interface ReferralOffer {
  code: string;
  channel: "friend" | "partner";
  discount_pct: number;
  plans: string[];
  /** Plan id -> price after the discount. */
  prices: Record<string, number>;
}

export interface CodeStats {
  clicks: number;
  signups: number;
  paying: number;
}

export interface FriendProgram {
  enabled: boolean;
  /** Only active subscribers have a link. */
  eligible: boolean;
  discount_pct: number;
  plans: string[];
  reward_tokens: Record<string, number>;
  hold_days: number;
  monthly_cap: number;
  code: string | null;
  stats: CodeStats;
  rewards_this_month: number;
  tokens_earned: number;
  tokens_left: number;
  friends: { email: string; status: string; reward_tokens: number; reward_due_at: string | null; created_at: string }[];
}

export interface CommissionTotals {
  pending: number;
  payable: number;
  paid: number;
  reserved?: number;
  available?: number;
}

export interface CommissionLine {
  id: number;
  kind: "sale" | "clawback";
  amount: number;
  month: string;
  rate_pct: number;
  commission: number;
  status: "pending" | "payable" | "paid" | "void";
  payable_at: string;
  created_at: string;
  note?: string;
}

export interface PartnerCustomer {
  id: number;
  name: string;
  source: "promo_code" | "link";
  code: string;
  status: "active" | "cancelling" | "signed_up" | "ended" | "refunded" | "void" | "blocked";
  plan_id: string;
  plan_label: string;
  subscription_active: boolean;
  current_period_end: string | null;
  payments_count: number;
  total_paid: number;
  commission_earned: number;
  commission_pending: number;
  commission_payable: number;
  commission_paid: number;
  joined_at: string;
  first_paid_at: string | null;
  last_paid_at: string | null;
}

export interface WithdrawalRequest {
  id: number;
  partner_id: number;
  amount: number;
  method: string;
  address: string;
  note: string;
  status: "pending" | "paid" | "rejected" | "cancelled";
  payout_id: number | null;
  reference: string;
  admin_note: string;
  created_at: string;
  decided_at: string | null;
}

export interface StatementMonth {
  month: string;
  customers: number;
  revenue: number;
  rate_pct: number;
  commission: number;
}

export interface PartnerProgram {
  enabled: boolean;
  applications_open: boolean;
  discount_pct: number;
  tiers: { min: number; pct: number }[];
  hold_days: number;
  min_payout: number;
  status: "pending" | "approved" | "rejected" | "suspended" | null;
  full_name?: string;
  email?: string;
  social_links?: string[];
  audience?: string;
  requested_code?: string;
  affiliate_link?: string;
  payout_method?: string;
  payout_address?: string;
  code?: string | null;
  stats?: CodeStats;
  active_subscribers?: number;
  totals?: CommissionTotals;
  month?: { month: string; customers: number; rate_pct: number };
  statement?: StatementMonth[];
  customers?: PartnerCustomer[];
  commissions?: CommissionLine[];
  withdrawal_requests?: WithdrawalRequest[];
  payouts?: { id: number; amount: number; method: string; reference: string; created_at: string }[];
}

export interface MyReferrals {
  link_days: number;
  my_offer: ReferralOffer | null;
  friend: FriendProgram;
  partner: PartnerProgram;
}

export interface PublicAffiliateProgram {
  link_days: number;
  currency: string;
  plans: { id: string; label: string; price: number }[];
  partner: {
    enabled: boolean;
    applications_open: boolean;
    discount_pct: number;
    plans: string[];
    tiers: { min: number; pct: number }[];
    hold_days: number;
    min_payout: number;
  };
}

export const FALLBACK_PUBLIC_AFFILIATE_PROGRAM: PublicAffiliateProgram = {
  link_days: 30,
  currency: "USD",
  plans: [
    { id: "starter", label: "Starter", price: 37 },
    { id: "pro", label: "Pro", price: 89 },
    { id: "max", label: "Max", price: 149 },
  ],
  partner: {
    enabled: true,
    applications_open: true,
    discount_pct: 15,
    plans: ["starter", "pro", "max"],
    tiers: [
      { min: 0, pct: 25 },
      { min: 20, pct: 30 },
      { min: 50, pct: 35 },
    ],
    hold_days: 30,
    min_payout: 100,
  },
};

const DEVICE_KEY = "pf_device";

/**
 * A random id for this browser, kept in local storage. Sent with sign-up,
 * sign-in and checkout so one person cannot refer themselves from the same
 * browser. It identifies nothing but the browser.
 */
export function deviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, "");
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function deviceHeaders(): Record<string, string> {
  const id = deviceId();
  return id ? { "X-Device-Id": id } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/referrals${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...deviceHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const detail = (await response.json())?.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail.map((e) => e?.msg ?? "invalid").join("; ");
    } catch {
      /* keep the status text */
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchMyReferrals = () => call<MyReferrals>("/me");
export const fetchVisitorOffer = () => call<{ offer: ReferralOffer | null }>("/visitor-offer");
export const recordClick = (code: string) =>
  call<{ valid: boolean; offer?: ReferralOffer }>("/click", send("POST", { code }));
export const applyCode = (code: string) => call<{ offer: ReferralOffer }>("/apply", send("POST", { code }));

export const VISITOR_OFFER_EVENT = "pf:ref-offer";

export function dispatchVisitorOffer(offer: ReferralOffer | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReferralOffer | null>(VISITOR_OFFER_EVENT, { detail: offer }));
}

export function subscribeVisitorOffer(listener: (offer: ReferralOffer | null) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<ReferralOffer | null>).detail ?? null);
  };
  window.addEventListener(VISITOR_OFFER_EVENT, handler);
  return () => window.removeEventListener(VISITOR_OFFER_EVENT, handler);
}
export const applyAsPartner = (body: {
  full_name: string;
  email: string;
  social_links: string[];
  audience: string;
  code?: string;
  payout_method?: string;
  payout_address?: string;
}) => call<PartnerProgram>("/partner/apply", send("POST", body));
export const savePayoutDetails = (body: { payout_method: string; payout_address: string }) =>
  call<PartnerProgram>("/partner/payout", send("PUT", body));
export const requestWithdrawal = (body: { amount?: number; method: string; address: string; note?: string }) =>
  call<PartnerProgram>("/partner/withdraw", send("POST", body));
export const cancelWithdrawal = (requestId: number) =>
  call<PartnerProgram>(`/partner/withdraw/${requestId}/cancel`, send("POST", {}));

/** The link a friend or a creator's audience opens. */
export function referralLink(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/?ref=${encodeURIComponent(code)}`;
}

export function offerLine(offer: ReferralOffer, labels: Record<string, string> = {}): string {
  const names = offer.plans.map((id) => labels[id] ?? id.replace(/^\w/, (c) => c.toUpperCase()));
  const where = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "a plan";
  return `${offer.discount_pct}% off your first ${where} payment`;
}

export async function loadPublicAffiliateProgram(serverSide = false): Promise<PublicAffiliateProgram> {
  const base = serverSide ? (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "") : API_BASE;
  try {
    const response = await fetch(`${base}/api/v1/referrals/public-program`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      const data = (await response.json()) as Partial<PublicAffiliateProgram>;
      if (data.partner && Array.isArray(data.partner.tiers) && data.partner.tiers.length > 0) {
        return {
          link_days: data.link_days ?? FALLBACK_PUBLIC_AFFILIATE_PROGRAM.link_days,
          currency: data.currency || "USD",
          plans: data.plans?.length ? data.plans : FALLBACK_PUBLIC_AFFILIATE_PROGRAM.plans,
          partner: data.partner,
        };
      }
    }
  } catch {
    /* Fall back cleanly to built-in strategy defaults */
  }
  return FALLBACK_PUBLIC_AFFILIATE_PROGRAM;
}
