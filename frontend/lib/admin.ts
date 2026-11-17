import { API_BASE, ApiError } from "./api";
import type { BillingMode, BillingRules, PaymentProviderId, PricePromo, TokenPlanCard, TopupTable } from "./types";

export interface PlanInfo {
  id: string;
  label: string;
  monthly_quota: number | null;
  price: number;
  users: number;
}

export interface AdminUser {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  is_active: boolean;
  is_admin: boolean;
  admin_from_settings: boolean;
  plan: string;
  plan_label: string;
  price: number;
  monthly_quota: number | null;
  used_this_month: number;
  plan_expires_at: string | null;
  plan_expired: boolean;
  batch_count: number;
  files_total: number;
  admin_notes: string | null;
  /** Token billing; the quota fields above apply to legacy accounts. */
  billing_mode: BillingMode;
  sub_plan: string | null;
  sub_period_end: string | null;
  subscription_active: boolean;
}

export interface UserPage {
  total: number;
  users: AdminUser[];
}

export interface AdminBatch {
  id: string;
  asset_count: number;
  preset: string;
  created_at: string;
}

export interface ActivityEvent {
  id: number;
  user_id: number;
  email: string;
  kind: string;
  detail: string;
  created_at: string;
}

export interface UserDetail {
  user: AdminUser;
  batches: AdminBatch[];
  activity: ActivityEvent[];
}

export interface Overview {
  total_users: number;
  suspended_users: number;
  active_7d: number;
  signups_7d: number;
  files_this_month: number;
  batches_today: number;
  plans: Record<string, number>;
  daily: { day: string; files: number; batches: number }[];
  mrr: number;
  paying_users: number;
  currency: string;
  near_limit: number;
  expiring_soon: number;
  hit_limit_this_month: number;
  /** Paid token orders in the last 30 days and subscriptions still running. */
  token_revenue_30d: number;
  active_subscriptions: number;
}

export interface Point {
  day: string;
  value: number;
}

export interface UserUsage {
  id: number;
  email: string;
  plan_label: string;
  used: number;
  monthly_quota: number | null;
}

export interface UserExpiry {
  id: number;
  email: string;
  plan_label: string;
  plan_expires_at: string;
}

export interface Analytics {
  days: number;
  currency: string;
  mrr: number;
  arr: number;
  paying_users: number;
  arpu: number;
  paid_share: number;
  total_users: number;
  dau: number;
  wau: number;
  mau: number;
  files_this_month: number;
  batches_this_month: number;
  avg_files_per_batch: number;
  signups: Point[];
  active: Point[];
  files: Point[];
  revenue_by_plan: { id: string; label: string; price: number; users: number; revenue: number }[];
  top_users: UserUsage[];
  near_limit: UserUsage[];
  hit_limit: UserUsage[];
  expiring_soon: UserExpiry[];
  expired: UserExpiry[];
  presets: Record<string, number>;
}

export interface SalesTotals {
  signups: number;
  checkouts: number;
  approved: number;
  revenue: number;
  conversion: number;
  average_order: number;
  subscriptions: number;
  topups: number;
}

export interface Sales {
  start: string;
  end: string;
  days: number;
  currency: string;
  totals: SalesTotals;
  previous: SalesTotals;
  signups: Point[];
  checkouts: Point[];
  approved: Point[];
  revenue: Point[];
  by_plan: { id: string; label: string; approved: number; revenue: number }[];
  recent: {
    id: string;
    paid_at: string;
    user_id: number;
    email: string;
    kind: string;
    plan_label: string;
    amount: number;
    provider: string;
  }[];
}

export interface AppSettings {
  registration_open: boolean;
  registration_locked: boolean;
  default_plan: string;
  announcement: string;
  currency: string;
}

/** Fields to change; a key that is present with null clears that value. */
export interface UserUpdate {
  plan?: string;
  monthly_quota?: number | null;
  plan_expires_at?: string | null;
  is_active?: boolean;
  is_admin?: boolean;
  display_name?: string | null;
  admin_notes?: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/admin${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const detail = (await response.json())?.detail;
      if (typeof detail === "string") message = detail;
    } catch {
      /* keep the status text */
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getOverview = () => call<Overview>("/overview");
export const getPlans = () => call<PlanInfo[]>("/plans");
export const getActivity = (limit = 50, kind = "") =>
  call<ActivityEvent[]>(`/activity?limit=${limit}&kind=${encodeURIComponent(kind)}`);
export const getAnalytics = (days: number) => call<Analytics>(`/analytics?days=${days}`);
export const getSales = (start: string, end: string) =>
  call<Sales>(`/sales?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
export const getSettings = () => call<AppSettings>("/settings");
export const updateSettings = (changes: Partial<Omit<AppSettings, "registration_locked">>) =>
  call<AppSettings>("/settings", { method: "PATCH", body: JSON.stringify(changes) });

export function editPlan(
  id: string,
  plan: { label: string; monthly_quota: number | null; price: number; apply_to_users: boolean },
) {
  return call<PlanInfo>(`/plans/${id}`, { method: "PUT", body: JSON.stringify(plan) });
}
export const getUser = (id: number) => call<UserDetail>(`/users/${id}`);

export interface UserFilters {
  q: string;
  plan: string;
  state: string;
  sort: string;
}

export function listUsers(filters: UserFilters, offset = 0, limit = 50) {
  const params = new URLSearchParams({ ...filters, offset: String(offset), limit: String(limit) });
  return call<UserPage>(`/users?${params.toString()}`);
}

/** Same-origin link; the session cookie authorises the download. */
export function exportUsersUrl(filters: Omit<UserFilters, "sort">): string {
  return `${API_BASE}/api/v1/admin/users/export.csv?${new URLSearchParams(filters).toString()}`;
}

export function createUser(user: { email: string; display_name?: string; plan?: string; password?: string }) {
  return call<{ user: AdminUser; temporary_password: string | null }>("/users", {
    method: "POST",
    body: JSON.stringify(user),
  });
}

export const extendPlan = (id: number, days: number) =>
  call<AdminUser>(`/users/${id}/extend`, { method: "POST", body: JSON.stringify({ days }) });
export const resetPassword = (id: number) =>
  call<{ temporary_password: string }>(`/users/${id}/reset-password`, { method: "POST" });
export const signOutUser = (id: number) => call<AdminUser>(`/users/${id}/sign-out`, { method: "POST" });
export const deleteUser = (id: number) => call<void>(`/users/${id}`, { method: "DELETE" });

export function updateUser(id: number, changes: UserUpdate) {
  return call<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
}

export function resetUsage(id: number) {
  return call<AdminUser>(`/users/${id}/reset-usage`, { method: "POST" });
}

// --- token billing ---------------------------------------------------------

export interface BillingConfig {
  currency: string;
  plans: Record<string, TokenPlanCard>;
  topups: TopupTable;
  rules: BillingRules;
  promo?: PricePromo;
}

/** The limited-time offer as the admin saves it. */
export interface PromoEdit {
  enabled: boolean;
  /** ISO time; read as UTC when it has no offset. */
  ends_at: string;
  /** plan id → regular price billed once the offer ends */
  regular: Record<string, number>;
}

/** The editable part of one token plan (id, generations and prices per generation are derived). */
export interface TokenPlanEdit {
  label: string;
  price: number;
  tokens: number;
  tokens_per_generation: number;
  rollover_months: number;
  topup_rate: number;
  /** Users who share the plan, owner included. */
  seats?: number;
  /** Render-setting groups the plan includes. */
  features?: Record<"full_engine" | "metadata_wipe", boolean>;
}

/** Only the parts that are sent are changed. */
export interface BillingConfigUpdate {
  plans?: Record<string, TokenPlanEdit>;
  promo?: PromoEdit;
  topups?: TopupTable;
  rules?: BillingRules;
}

export interface LedgerEntry {
  id: number;
  bucket: "subscription" | "topup";
  kind: "grant" | "rollover" | "expire" | "topup" | "bonus" | "consume" | "refund" | "admin";
  amount: number;
  batch_id: string | null;
  order_id: string | null;
  note: string;
  created_at: string;
}

export interface AdminOrder {
  id: string;
  kind: "subscription" | "topup";
  plan_id: string;
  amount: number;
  tokens: number;
  status: "pending" | "paid" | "expired" | "invalid" | "refunded";
  provider: PaymentProviderId;
  created_at: string;
  paid_at: string | null;
  /** The referral or partner code used at checkout, and what it took off. */
  coupon_code?: string | null;
  discount?: number;
  /** Meta Purchase for a paid order: "sent" | "failed" | "no consent" | "sending" | "no data" | "" */
  meta_purchase?: string;
}

export interface AdminSubscription {
  plan_id: string;
  plan_label: string;
  price: number;
  tokens_per_generation: number;
  period_start: string | null;
  period_end: string | null;
  active: boolean;
  days_left: number;
  cancelled: boolean;
  grace_until: string | null;
  in_grace: boolean;
}

export interface AdminBalance {
  subscription_tokens: number;
  topup_tokens: number;
  /** Reward tokens from the friend referral program. */
  referral_tokens?: number;
  usable_tokens: number;
  generations_left: number;
  frozen_topup: boolean;
}

export interface UserBilling {
  user_id: number;
  billing_mode: BillingMode;
  subscription: AdminSubscription | null;
  balance: AdminBalance;
  /** The last 20 ledger lines, newest first. */
  ledger: LedgerEntry[];
  orders: AdminOrder[];
  /** The latest admin actions on this user's plan and tokens, newest first. */
  audit?: AuditEntry[];
}

/** One admin action on a plan or tokens: who, when, what. */
export interface AuditEntry {
  id: number;
  admin_email: string;
  user_id: number | null;
  user_email: string;
  action: string;
  detail: string;
  created_at: string;
}

export const getBillingConfig = () => call<BillingConfig>("/billing/config");
export const updateBillingConfig = (changes: BillingConfigUpdate) =>
  call<BillingConfig>("/billing/config", { method: "PUT", body: JSON.stringify(changes) });

export const getUserBilling = (id: number) => call<UserBilling>(`/users/${id}/billing`);

/** Start or extend a paid period without a payment; also moves the user to token billing. */
export const grantPeriod = (id: number, plan: string, months: number) =>
  call<UserBilling>(`/users/${id}/billing/grant`, {
    method: "POST",
    body: JSON.stringify({ plan_id: plan, months }),
  });

/** Add (negative: take away) top-up tokens by hand; the note stays on the ledger line. */
export const adjustTokens = (id: number, amount: number, note: string) =>
  call<UserBilling>(`/users/${id}/billing/tokens`, {
    method: "POST",
    body: JSON.stringify({ amount, note }),
  });

/** Cancel a token plan: at the period end (like the customer's Cancel) or now (tokens left are written off). */
export const cancelPlan = (id: number, mode: "end_of_period" | "now", reason: string) =>
  call<UserBilling>(`/users/${id}/billing/cancel`, { method: "POST", body: JSON.stringify({ mode, reason }) });

/** Undo a cancel-at-period-end while the period is still running. */
export const resumePlan = (id: number) => call<UserBilling>(`/users/${id}/billing/resume`, { method: "POST" });

/** Add days to the token period (from its end, or today if it ended). No tokens are added. */
export const extendTokenPlan = (id: number, days: number, reason: string) =>
  call<UserBilling>(`/users/${id}/billing/extend`, { method: "POST", body: JSON.stringify({ days, reason }) });

/** Give bonus tokens (top-up bucket, never expire). */
export const giveBonusTokens = (id: number, amount: number, note: string) =>
  call<UserBilling>(`/users/${id}/billing/bonus`, { method: "POST", body: JSON.stringify({ amount, note }) });

export const getAudit = (userId?: number) =>
  call<AuditEntry[]>(`/audit${userId ? `?user_id=${userId}` : ""}`);

export const setBillingMode = (id: number, mode: BillingMode) =>
  call<UserBilling>(`/users/${id}/billing/mode`, { method: "POST", body: JSON.stringify({ mode }) });

// --- phone alerts (Telegram / ntfy) ------------------------------------------
export interface NotifyStatus {
  channels: string[];
  events: string[];
  /** Approve / Reject buttons under Telegram payment alerts. */
  telegram_buttons?: "off" | "not_connected" | "connected" | "unknown";
  telegram_buttons_detail?: string;
}
export const getNotifyStatus = () => call<NotifyStatus>("/notify");
export const sendTestAlert = () => call<{ results: Record<string, string> }>("/notify/test", { method: "POST" });
export const connectTelegramButtons = () =>
  call<{ telegram_buttons: NotifyStatus["telegram_buttons"]; telegram_buttons_detail: string }>(
    "/notify/telegram/connect",
    { method: "POST" },
  );

// --- customer emails -----------------------------------------------------------

/** welcome, activated, ending, ended, verify, reset, password_code, ... (the server lists them in order). */
export type EmailKind = string;

export interface EmailTemplate {
  label: string;
  when: string;
  enabled: boolean;
  /** Codes and security notices: always sent, cannot be switched off. */
  locked?: boolean;
  subject: string;
  body: string;
  /** Renewal reminder only: how many days before the period ends. */
  days_before?: number;
  /** Design text. Blank hides that part (headline blank = the subject). */
  kicker: string;
  stat: string;
  stat_sub: string;
  headline: string;
  button: string;
}

/** The look shared by every customer email. */
export interface EmailStyle {
  logo_url: string;
  logo_size: number;
  header_color: string;
  header_text_color: string;
  page_color: string;
  card_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  footer_text: string;
  show_footer_logo: boolean;
}

export type EmailTemplateInput = Pick<
  EmailTemplate,
  "enabled" | "subject" | "body" | "days_before" | "kicker" | "stat" | "stat_sub" | "headline" | "button"
>;

export interface EmailSettings {
  /** "smtp", "resend" or "" when email is not set up on the server. */
  transport: string;
  from: string;
  public_url_set: boolean;
  placeholders: Record<string, string>;
  templates: Record<EmailKind, EmailTemplate>;
  defaults: Record<EmailKind, EmailTemplate>;
  style: EmailStyle;
  style_defaults: EmailStyle;
}

export const getEmailSettings = () => call<EmailSettings>("/emails");
export const saveEmailSettings = (templates: Record<string, EmailTemplateInput>, style?: EmailStyle) =>
  call<EmailSettings>("/emails", { method: "PUT", body: JSON.stringify({ templates, style }) });
export const previewEmail = (kind: EmailKind, template: EmailTemplateInput, style: EmailStyle) =>
  call<{ subject: string; html: string; text: string }>("/emails/preview", {
    method: "POST",
    body: JSON.stringify({ kind, template, style }),
  });
export const sendTestEmail = (kind: EmailKind) =>
  call<{ sent_to: string }>("/emails/test", { method: "POST", body: JSON.stringify({ kind }) });

// --- group emails (send to a group) ----------------------------------------------

export interface EmailGroup {
  id: string;
  label: string;
  hint: string;
  count: number;
}

export interface EmailPerson {
  id: number;
  email: string;
  name: string;
  plan: string | null;
  tokens: number;
  created_at: string | null;
  unsubscribed: boolean;
  groups: string[];
}

export interface EmailDraft {
  id: string;
  label: string;
  groups: string[];
  subject: string;
  body: string;
  button: string;
}

export interface GroupEmailCampaign {
  id: number;
  subject: string;
  audience: string;
  admin_email: string;
  status: "sending" | "done" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  created_at: string | null;
  finished_at: string | null;
}

export interface GroupEmailRules {
  daily_limit: number;
  seconds_between: number;
}

export interface GroupEmailStatus {
  transport: string;
  public_url_set: boolean;
  groups: EmailGroup[];
  people: EmailPerson[];
  placeholders: Record<string, string>;
  drafts: EmailDraft[];
  rules: GroupEmailRules;
  sent_today: number;
  left_today: number;
  campaigns: GroupEmailCampaign[];
}

export interface GroupEmailRecipient {
  email: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  error: string;
  sent_at: string | null;
}

type GroupMessage = { subject: string; body: string; button: string };

export const getGroupEmails = () => call<GroupEmailStatus>("/emails/groups");
export const saveGroupEmailRules = (rules: GroupEmailRules) =>
  call<GroupEmailStatus>("/emails/groups/rules", { method: "PUT", body: JSON.stringify(rules) });
export const previewGroupEmail = (message: GroupMessage & { user_id?: number }) =>
  call<{ subject: string; text: string; html: string; for: string }>("/emails/groups/preview", {
    method: "POST",
    body: JSON.stringify(message),
  });
export const testGroupEmail = (message: GroupMessage) =>
  call<{ sent_to: string }>("/emails/groups/test", { method: "POST", body: JSON.stringify(message) });
export const sendGroupEmail = (message: GroupMessage & { user_ids: number[]; audience: string; confirm: string }) =>
  call<{ campaign: GroupEmailCampaign; left_out_unsubscribed: number }>("/emails/groups/send", {
    method: "POST",
    body: JSON.stringify(message),
  });
export const getGroupEmail = (id: number) =>
  call<{ campaign: GroupEmailCampaign; body: string; recipients: GroupEmailRecipient[] }>(`/emails/groups/${id}`);
export const stopGroupEmail = (id: number) =>
  call<GroupEmailCampaign>(`/emails/groups/${id}/cancel`, { method: "POST" });
export const retryGroupEmail = (id: number) =>
  call<GroupEmailCampaign>(`/emails/groups/${id}/retry`, { method: "POST" });

// --- danger zone: delete every non-admin account ------------------------------

export interface PurgeSummary {
  users: number;
  batches: number;
  orders: number;
  token_entries: number;
  activity: number;
  support_threads: number;
  team_seats: number;
  kept: string[];
  confirm_phrase?: string;
}

export const previewPurgeUsers = () => call<PurgeSummary>("/purge-users");
export const purgeUsers = (confirm: string, expectedUsers: number) =>
  call<PurgeSummary>("/purge-users", {
    method: "POST",
    body: JSON.stringify({ confirm, expected_users: expectedUsers }),
  });

// --------------------------------------------------------------------------
// Referral and partner program (Admin > Affiliates) and batch costs
// --------------------------------------------------------------------------

export interface AffiliateTier {
  min: number;
  pct: number;
}

export interface AffiliateProgram {
  link_days: number;
  friend: {
    enabled: boolean;
    discount_pct: number;
    plans: string[];
    reward_tokens: Record<string, number>;
    hold_days: number;
    monthly_cap: number;
  };
  partner: {
    enabled: boolean;
    applications_open: boolean;
    discount_pct: number;
    plans: string[];
    tiers: AffiliateTier[];
    hold_days: number;
    min_payout: number;
  };
}

export interface AffiliateTotals {
  pending: number;
  payable: number;
  paid: number;
}

export interface AffiliatePartnerRow {
  user_id: number;
  email: string;
  name: string;
  full_name: string;
  contact_email: string;
  social_links: string[];
  status: "pending" | "approved" | "rejected" | "suspended";
  requested_code: string;
  code: string | null;
  affiliate_link: string;
  audience: string;
  payout_method: string;
  payout_address: string;
  admin_note: string;
  created_at: string;
  stats: { clicks: number; signups: number; paying: number };
  totals: AffiliateTotals;
  month_customers: number;
  month_rate_pct: number;
}

export interface AffiliateOverview {
  program: AffiliateProgram;
  plans: { id: string; label: string; price: number }[];
  summary: {
    friend_signups: number;
    friend_paying: number;
    friend_rewards: number;
    friend_reward_tokens: number;
    partner_signups: number;
    partner_paying: number;
    flagged: number;
    applications: number;
    commission: AffiliateTotals;
  };
  partners: AffiliatePartnerRow[];
}

export interface AffiliateReferral {
  id: number;
  channel: "friend" | "partner";
  code: string;
  source: string;
  status: string;
  flags: string[];
  referrer_id: number;
  referrer_email: string;
  customer_id: number;
  customer_email: string;
  reward_tokens: number;
  reward_due_at: string | null;
  reward_given_at: string | null;
  first_paid_at: string | null;
  note: string;
  created_at: string;
}

export interface AffiliateCommissionRow {
  id: number;
  order_id: string;
  customer_id: number;
  customer_email: string;
  kind: "sale" | "clawback";
  amount: number;
  month: string;
  rate_pct: number;
  commission: number;
  status: "pending" | "payable" | "paid" | "void";
  payable_at: string;
  created_at: string;
  note: string;
}

export interface AffiliatePartnerDetail {
  partner: AffiliatePartnerRow;
  statement: { month: string; customers: number; revenue: number; rate_pct: number; commission: number }[];
  commissions: AffiliateCommissionRow[];
  payouts: { id: number; amount: number; method: string; reference: string; note: string; admin_email: string; created_at: string }[];
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const getAffiliates = () => call<AffiliateOverview>("/affiliates");
export const saveAffiliateProgram = (program: AffiliateProgram) =>
  call<AffiliateProgram>("/affiliates/settings", json("PUT", program));
export const decidePartner = (
  userId: number,
  body: { action: "approve" | "reject" | "suspend" | "reinstate" | "note"; code?: string; affiliate_link?: string; note?: string },
) => call<AffiliatePartnerRow>(`/affiliates/partners/${userId}`, json("POST", body));
export const getPartnerDetail = (userId: number) => call<AffiliatePartnerDetail>(`/affiliates/partners/${userId}`);
export const recordPartnerPayout = (
  userId: number,
  body: { method: string; reference: string; note: string; force: boolean },
) => call<{ id: number; amount: number }>(`/affiliates/partners/${userId}/payout`, json("POST", body));
export const getAffiliateReferrals = (channel?: "friend" | "partner", flagged = false) =>
  call<AffiliateReferral[]>(
    `/affiliates/referrals?${new URLSearchParams({ ...(channel ? { channel } : {}), ...(flagged ? { flagged: "true" } : {}) })}`,
  );
export const actOnReferral = (id: number, action: "void" | "allow" | "reward_now", reason = "") =>
  call<{ id: number; status: string }>(`/affiliates/referrals/${id}`, json("POST", { action, reason }));
export const markOrderRefunded = (orderId: string, note = "") =>
  call<{ id: string; status: string; reversed: string }>(
    `/affiliates/orders/${encodeURIComponent(orderId)}/refund`,
    json("POST", { note }),
  );

export interface CostRates {
  vcpu_per_minute: number;
  gb_ram_per_minute: number;
  egress_per_gb: number;
  vcpus_busy: number;
  ram_gb: number;
}

export interface BatchCostRow {
  batch_id: string;
  user_id: number | null;
  email: string;
  outputs: number;
  resolution: string;
  duration_seconds: number;
  render_seconds: number;
  output_mb: number;
  downloads: number;
  created_at: string;
  compute: number;
  egress: number;
  total: number;
}

export interface BatchCosts {
  days: number;
  rates: CostRates;
  totals: { batches: number; outputs: number; compute: number; egress: number; total: number; average: number };
  batches: BatchCostRow[];
  /** Expected cost of a batch of 5 by video length (seconds), heaviest settings. */
  estimate: { seconds: number; "1080p": number; "4K": number }[];
}

export const getBatchCosts = (days = 30) => call<BatchCosts>(`/affiliates/batch-costs?days=${days}`);
export const saveCostRates = (rates: CostRates) => call<CostRates>("/affiliates/batch-costs/rates", json("PUT", rates));

// --- guides (Admin > Guides) --------------------------------------------------

export interface GuideEdit {
  title: string;
  description: string;
  body: string;
  category: string;
  cover: string;
  cover_alt: string;
  published: boolean;
}

export interface SavedGuide extends GuideEdit {
  slug: string;
  created_at: string;
  updated_at: string;
}

export const listSavedGuides = () => call<{ guides: SavedGuide[] }>("/guides");
export const saveGuide = (slug: string, guide: GuideEdit) =>
  call<SavedGuide>(`/guides/${encodeURIComponent(slug)}`, { method: "PUT", body: JSON.stringify(guide) });
export const deleteSavedGuide = (slug: string) =>
  call<void>(`/guides/${encodeURIComponent(slug)}`, { method: "DELETE" });

// --- refund requests ---------------------------------------------------------

export interface RefundRules {
  enabled: boolean;
  window_days: number;
  max_used_percent: number;
  allow_subscriptions: boolean;
  allow_topups: boolean;
}

export interface AdminRefundRequest {
  id: number;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reason: string;
  details: string;
  network: string;
  address: string | null;
  refund_tx: string | null;
  admin_note: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  tokens_removed: number;
  user_id: number;
  email: string;
  name: string | null;
  user_is_active?: boolean;
  order: {
    id: string;
    ref: string;
    kind: "subscription" | "topup";
    plan_label: string;
    amount: number;
    tokens: number;
    tokens_used: number;
    provider: string;
    provider_ref: string | null;
    status: string;
    paid_at: string | null;
  } | null;
  in_rules: boolean;
  outside_rules: string;
}

export interface AdminRefunds {
  currency: string;
  pending: number;
  rules: RefundRules;
  requests: AdminRefundRequest[];
}

export const getRefundRequests = (state: "pending" | "all") => call<AdminRefunds>(`/refunds?state=${state}`);
export const approveRefund = (id: number, body: { note: string; refund_tx: string; remove_access: boolean }) =>
  call<AdminRefundRequest>(`/refunds/${id}/approve`, json("POST", body));
export const rejectRefund = (id: number, note: string, reactivateAccount = false) =>
  call<AdminRefundRequest>(`/refunds/${id}/reject`, json("POST", { note, reactivate_account: reactivateAccount }));
export const saveRefundRules = (rules: RefundRules) => call<RefundRules>("/refunds/rules", json("PUT", rules));
