import { API_BASE, ApiError } from "./api";

export interface UserProfile {
  id: number;
  email: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  is_admin: boolean;
  plan: string;
  plan_label: string;
  /** Files per calendar month; null means unlimited. */
  monthly_quota: number | null;
  used_this_month: number;
  plan_expires_at: string | null;
  plan_expired: boolean;
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
