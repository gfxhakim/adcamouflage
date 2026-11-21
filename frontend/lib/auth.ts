import type { PlanFeatureId } from "@/lib/plan-features";
import { API_BASE, ApiError } from "./api";
import { deviceHeaders } from "./referrals";
import type { BillingMode, PaymentProviderId, TokenPlanCard, TopupOption } from "./types";

export type { PaymentProviderId };

export interface UserProfile {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  account_role?: "customer" | "affiliate";
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
  /** True for accounts made with Google until a password is set (older APIs leave it out). */
  social_only?: boolean;
}

/** Sign-up accepted; the account opens once the emailed code is entered. */
export interface PendingSignup {
  verify: true;
  email: string;
}

export function isPending(result: UserProfile | PendingSignup): result is PendingSignup {
  return (result as PendingSignup).verify === true;
}

export interface AuthProviders {
  google: boolean;
  /** New sign-ups must enter an emailed code. */
  email_codes: boolean;
  registration_open?: boolean;
  trusted_email_domains?: string[];
}

/** Which sign-in buttons the server has keys for. */
export async function fetchProviders(): Promise<AuthProviders> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/auth/providers`, { cache: "no-store" });
    if (response.ok) return (await response.json()) as AuthProviders;
  } catch {
    /* fall through */
  }
  return { google: false, email_codes: false, registration_open: true };
}

/** Where the "Continue with Google" button goes; the API redirects to Google. */
export function oauthStartUrl(
  provider: "google",
  next?: string | null,
  role?: "customer" | "affiliate",
): string {
  const qs = new URLSearchParams();
  if (next) qs.set("next", next);
  if (role === "affiliate") qs.set("role", "affiliate");
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return `${API_BASE}/api/v1/auth/oauth/${provider}/start${query}`;
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
      headers: { "Content-Type": "application/json", ...deviceHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) throw new ApiError(await readDetail(response), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function signUp(
  email: string,
  password: string,
  displayName?: string,
  accountRole: "customer" | "affiliate" = "customer",
  acceptedPolicy = true,
) {
  return post<UserProfile | PendingSignup>("/api/v1/auth/register", {
    email,
    password,
    display_name: displayName || null,
    account_role: accountRole,
    accepted_policy: acceptedPolicy,
  });
}

export function signIn(email: string, password: string) {
  return post<UserProfile>("/api/v1/auth/login", { email, password });
}

export function signOut() {
  return post<void>("/api/v1/auth/logout");
}

export function verifyEmail(email: string, code: string) {
  return post<UserProfile>("/api/v1/auth/verify-email", { email, code });
}

export function resendVerification(email: string) {
  return post<{ ok: boolean }>("/api/v1/auth/verify-email/resend", { email });
}

export function forgotPassword(email: string) {
  return post<{ ok: boolean; email_ready?: boolean }>("/api/v1/auth/password/forgot", { email });
}

export function resetPassword(email: string, code: string, newPassword: string) {
  return post<UserProfile>("/api/v1/auth/password/reset", { email, code, new_password: newPassword });
}

/** Email the code that confirms a password change. `required` is false when the server cannot send email. */
export function requestPasswordCode() {
  return post<{ sent: boolean; required: boolean }>("/api/v1/auth/password/code");
}

export function changePassword(currentPassword: string, newPassword: string, code = "") {
  return post<UserProfile>("/api/v1/auth/password", {
    current_password: currentPassword,
    new_password: newPassword,
    code,
  });
}

export function requestEmailChange(newEmail: string, currentPassword: string) {
  return post<{ sent_to: string }>("/api/v1/auth/email/code", { new_email: newEmail, current_password: currentPassword });
}

export function confirmEmailChange(code: string) {
  return post<UserProfile>("/api/v1/auth/email", { code });
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
  /** Reward tokens from inviting friends: spent after subscription tokens, before top-ups. */
  referral_tokens?: number;
  /** Everything spendable while active; 0 once the period has ended. */
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
  /** Seats and members; for a member, subscription/balance/alerts above are the owner's. */
  team?: Team | null;
  /** Render-setting groups the paying plan does not include (older APIs leave it out = none). */
  locked_features?: PlanFeatureId[];
}

// ---------------------------------------------------------------------------
// team seats
// ---------------------------------------------------------------------------

export interface TeamMember {
  email: string;
  /** False until someone signs up with this email. */
  joined: boolean;
  display_name: string | null;
  last_seen_at: string | null;
  added_at: string;
  /** False when the plan has fewer seats than members. */
  sharing: boolean;
}

export interface Team {
  role: "owner" | "member" | "none";
  /** Seats on the plan, owner included. */
  seats: number;
  seats_used: number;
  owner_email: string | null;
  sharing: boolean;
  members: TeamMember[];
}

export const addTeamMember = (email: string) => post<Team>("/api/v1/team/members", { email });
export const leaveTeam = () => post<Team>("/api/v1/team/leave");

export async function removeTeamMember(email: string): Promise<Team> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/team/members/${encodeURIComponent(email)}`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) throw new ApiError(await readDetail(response), response.status);
  return (await response.json()) as Team;
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

export type OrderStatus = "pending" | "paid" | "expired" | "invalid" | "refunded";

export interface Order {
  /** The referral or partner code used, and what it took off the price. */
  coupon_code?: string | null;
  discount?: number;
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
  /** Whop plan id (`plan_xxx`) passed to `<WhopCheckout />`. */
  whop_plan: string;
  /** Whop CheckoutConfiguration id (`ch_xxx`) carrying server-side redirect_url & metadata. */
  whop_checkout_config?: string | null;
  provider: PaymentProviderId;
  checkout_url: string;
  amount: number;
  original_amount?: number | null;
  discount?: number;
  promo_code?: string | null;
  whop_promo_to_prefill?: string | null;
  whop_metadata?: Record<string, string>;
  tokens: number;
}

export interface SubscriptionState {
  cancelled: boolean;
  period_end: string | null;
}

/**
 * Start a checkout for a plan period or a top-up on the current plan.
 */
export function startCheckout(
  kind: OrderKind,
  choice: { plan_id?: string; amount?: number; coupon?: string | null },
  provider?: PaymentProviderId,
) {
  const body: Record<string, unknown> = { kind, ...(provider ? { provider } : {}) };
  if (choice.plan_id) body.plan_id = choice.plan_id;
  if (choice.amount !== undefined) body.amount = choice.amount;
  if (choice.coupon?.trim()) body.coupon = choice.coupon.trim();
  return post<Checkout>("/api/v1/billing/checkout", body);
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

/** One order's status (used while confirming a Whop payment). */
export function fetchOrder(orderId: string) {
  return get<Order>(`/api/v1/billing/orders/${encodeURIComponent(orderId)}`);
}

export function fetchOrders() {
  return get<Order[]>("/api/v1/billing/orders");
}

/** Stop at the end of the paid period; access continues until then. */
export function cancelSubscription(reason = "") {
  return post<SubscriptionState>("/api/v1/billing/cancel", { reason });
}

// --- refund requests -------------------------------------------------------

export type RefundStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface RefundRequestInfo {
  id: number;
  status: RefundStatus;
  reason: string;
  reason_label: string;
  details: string;
  tokens_remaining?: number | null;
  refund_amount?: number | null;
  network: string | null;
  network_label: string;
  address: string | null;
  /** The owner's note, shown on a declined request. */
  admin_note: string;
  created_at: string;
  decided_at: string | null;
}

export interface RefundableOrder {
  order_id: string;
  ref: string;
  kind: "subscription" | "topup";
  plan_id: string;
  provider?: string;
  amount: number;
  tokens: number;
  tokens_used: number;
  tokens_remaining: number;
  refundable_amount: number;
  paid_at: string;
  status: "paid" | "refunded";
  can_request: boolean;
  why_not: string;
  request: RefundRequestInfo | null;
}

export interface RefundOverview {
  rules: { enabled: boolean; window_days: number; max_used_percent: number };
  reasons: { id: string; label: string }[];
  networks: { id: string; label: string; placeholder: string }[];
  currency: string;
  orders: RefundableOrder[];
}

export function fetchRefunds() {
  return get<RefundOverview>("/api/v1/billing/refunds");
}

export interface RefundRequestResult extends RefundRequestInfo {
  account_stopped?: boolean;
}

export function requestRefund(body: {
  order_id: string;
  reason: string;
  details: string;
  network?: string;
  address?: string;
}) {
  return post<RefundRequestResult>("/api/v1/billing/refunds", body);
}

export function withdrawRefund(id: number) {
  return post<RefundRequestInfo>(`/api/v1/billing/refunds/${id}/withdraw`);
}

export function resumeSubscription() {
  return post<SubscriptionState>("/api/v1/billing/resume");
}
