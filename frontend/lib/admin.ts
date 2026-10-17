import { API_BASE, ApiError } from "./api";

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
