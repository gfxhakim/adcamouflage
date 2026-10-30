import { API_BASE, ApiError } from "./api";
import type { BillingMode, PaymentProviderId, TokenPlanCard, TopupOption } from "./types";

export type { PaymentProviderId };

export interface UserProfile {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  plan: string;
  plan_label: string;
  /** Files per calendar month; null means unlimited. */
  monthly_quota: number | null;
  used_this_month: number;
  plan_expires_at: string | null;
  plan_expired: boolean;
  /** A message from the admin for every signed-in user; empty for none. */
  announcement: string;
  /** 'tokens' for paid 30-day periods; 'legacy' keeps the monthly file quota above. */
  billing_mode: BillingMode;
  /** Tokens that can be spent right now (0 while the subscription has lapsed). */
  tokens_usable: number;
  subscription_active: boolean;
}

export interface BatchSummary {
  id: string;
  asset_count: number;
  preset: string;
  created_at: string;
}

async function readDetail(response: Response): Promise<string> {
  try {
    const detail = (await response.json())?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((e) => (e as { msg?: string }).msg ?? "invalid").join("; ");
    }
  } catch {
    /* fall through to the status text */
  }
  return `${response.status} ${response.statusText}`;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) throw new ApiError(await readDetail(response), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function signUp(email: string, password: string, displayName?: string) {
  return post<UserProfile>("/api/v1/auth/register", {
    email,
    password,
    display_name: displayName || null,
  });
}

export function signIn(email: string, password: string) {
  return post<UserProfile>("/api/v1/auth/login", { email, password });
}

export function signOut() {
  return post<void>("/api/v1/auth/logout");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return post<UserProfile>("/api/v1/auth/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/** The signed-in user, or null when there is no valid session. */
export async function fetchMe(): Promise<UserProfile | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new ApiError(await readDetail(response), response.status);
    return (await response.json()) as UserProfile;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return null;
  }
}

export async function fetchMyBatches(): Promise<BatchSummary[]> {
  const response = await fetch(`${API_BASE}/api/v1/auth/batches`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json()) as BatchSummary[];
}

export interface PlanOption {
  id: string;
  label: string;
  monthly_quota: number | null;
  price: number;
}

export interface PlanRequest {
  plan_id: string;
  plan_label: string;
  created_at: string;
}

/** The paid 30-day period a token account is on; null until the first purchase. */
export interface TokenSubscription {
  plan_id: string;
  plan_label: string;
  price: number;
  tokens_per_generation: number;
  period_start: string | null;
  period_end: string | null;
  active: boolean;
  days_left: number;
  cancelled: boolean;
  /** Renewing before this keeps the rolled-over tokens. */
  grace_until: string | null;
  in_grace: boolean;
}

export interface TokenBalance {
  subscription_tokens: number;
  topup_tokens: number;
  /** Subscription + top-up while active; 0 once the period has ended. */
  usable_tokens: number;
  generations_left: number;
  /** Top-up tokens are kept but unusable while the subscription has lapsed. */
  frozen_topup: boolean;
}

export type AlertLevel = "info" | "warning" | "danger";

export type AlertCode = "no_subscription" | "ends_soon" | "ended" | "low_tokens" | "cancelled";

export interface BillingAlert {
  level: AlertLevel;
  code: AlertCode;
  text: string;
}

export interface Topups {
  amounts: number[];
  /** Priced for the user's current plan; empty until they have one. */
  options: TopupOption[];
}

/** A payment method the server has set up; the customer picks one when there are several. */
export interface PaymentProvider {
  id: PaymentProviderId;
  label: string;
}

export interface Subscription {
  plan: PlanOption;
  /** The limit on this account; support may have set it apart from the plan's. */
  monthly_quota: number | null;
  currency: string;
  used_this_month: number;
  left_this_month: number | null;
  window_start: string;
  resets_at: string;
  projected_this_month: number;
  plan_expires_at: string | null;
  plan_expired: boolean;
  member_since: string;
  files_total: number;
  batches_total: number;
  favourite_preset: string | null;
  daily: { day: string; value: number }[];
  monthly: { month: string; files: number; batches: number }[];
  plans: PlanOption[];
  pending_request: PlanRequest | null;
  retention_hours: number;
  // --- token billing ------------------------------------------------------
  billing_mode: BillingMode;
  subscription: TokenSubscription | null;
  balance: TokenBalance;
  token_plans: TokenPlanCard[];
  topups: Topups;
  /** The payment methods set up on the server, in the order they are offered. */
  payment_providers: PaymentProvider[];
  /** False until at least one payment method is configured; buttons become a notice. */
  payments_enabled: boolean;
  grace_days: number;
  alerts: BillingAlert[];
}

/** The signed-in user's plan, usage and history, or null when signed out. */
export async function fetchSubscription(): Promise<Subscription | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/auth/subscription`, {
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(await readDetail(response), response.status);
  return (await response.json()) as Subscription;
}

/** Ask support to move this account to another plan (nothing is charged). */
export function requestPlan(planId: string, note = "") {
  return post<PlanRequest>("/api/v1/auth/plan-request", { plan_id: planId, note });
}

// --- token billing ---------------------------------------------------------

export type OrderKind = "subscription" | "topup";

export type OrderStatus = "pending" | "paid" | "expired" | "invalid";

export interface Order {
  id: string;
  kind: OrderKind;
  plan_id: string;
  amount: number;
  tokens: number;
  status: OrderStatus;
  provider: PaymentProviderId;
  checkout_url: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface Checkout {
  order_id: string;
  provider: PaymentProviderId;
  /**
   * Where the browser goes to pay: BTCPay's invoice page, or the app's own
   * /api/v1/billing/orders/{id}/pay page that forwards to Volet. Either way it
   * comes back to /app/plan with ?order=.
   */
  checkout_url: string;
  amount: number;
  tokens: number;
}

export interface SubscriptionState {
  cancelled: boolean;
  period_end: string | null;
}

/**
 * Start a checkout for a plan period or a top-up on the current plan. The
 * provider is sent only when given; the server then uses the first one set up.
 */
export function startCheckout(
  kind: OrderKind,
  choice: { plan_id?: string; amount?: number },
  provider?: PaymentProviderId,
) {
  return post<Checkout>("/api/v1/billing/checkout", { kind, ...choice, ...(provider ? { provider } : {}) });
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) throw new ApiError(await readDetail(response), response.status);
  return (await response.json()) as T;
}

/** One order's status; the server also checks BTCPay if a webhook was missed. */
export function fetchOrder(orderId: string) {
  return get<Order>(`/api/v1/billing/orders/${encodeURIComponent(orderId)}`);
}

export function fetchOrders() {
  return get<Order[]>("/api/v1/billing/orders");
}

/** Stop at the end of the paid period; access continues until then. */
export function cancelSubscription() {
  return post<SubscriptionState>("/api/v1/billing/cancel");
}

export function resumeSubscription() {
  return post<SubscriptionState>("/api/v1/billing/resume");
}
