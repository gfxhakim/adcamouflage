import { API_BASE, ApiError } from "./api";

export interface PlanInfo {
  id: string;
  label: string;
  monthly_quota: number | null;
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
  monthly_quota: number | null;
  used_this_month: number;
  plan_expires_at: string | null;
  plan_expired: boolean;
  batch_count: number;
  files_total: number;
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
}

/** Fields to change; a key that is present with null clears that value. */
export interface UserUpdate {
  plan?: string;
  monthly_quota?: number | null;
  plan_expires_at?: string | null;
  is_active?: boolean;
  is_admin?: boolean;
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
  return (await response.json()) as T;
}

export const getOverview = () => call<Overview>("/overview");
export const getPlans = () => call<PlanInfo[]>("/plans");
export const getActivity = (limit = 50) => call<ActivityEvent[]>(`/activity?limit=${limit}`);
export const getUser = (id: number) => call<UserDetail>(`/users/${id}`);

export function listUsers(query: string, plan: string, offset = 0, limit = 50) {
  const params = new URLSearchParams({ q: query, plan, offset: String(offset), limit: String(limit) });
  return call<UserPage>(`/users?${params.toString()}`);
}

export function updateUser(id: number, changes: UserUpdate) {
  return call<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
}

export function resetUsage(id: number) {
  return call<AdminUser>(`/users/${id}/reset-usage`, { method: "POST" });
}
