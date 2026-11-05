import { API_BASE, ApiError } from "./api";

export type SupportThreadStatus = "bot" | "escalated" | "agent_active" | "resolved";
export type SupportSenderRole = "user" | "bot" | "agent" | "system";

export interface SupportMessage {
  id: number;
  thread_id: number;
  sender_role: SupportSenderRole;
  sender_name: string | null;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  suggestions: string[];
  created_at: string;
}

export interface SupportThread {
  id: number;
  user_id: number;
  status: SupportThreadStatus;
  bot_attempts: number;
  max_attempts: number;
  can_escalate: boolean;
  issue_summary: string;
  escalated_at: string | null;
  unread_admin: number;
  unread_user: number;
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
}

export interface SupportCustomerDossier {
  id: number;
  email: string;
  display_name: string | null;
  plan: string;
  plan_label: string;
  billing_mode: string;
  usable_tokens: number;
  subscription_active: boolean;
  sub_plan: string | null;
  sub_period_end: string | null;
  used_this_month: number;
  monthly_quota: number | null;
  plan_expired: boolean;
  batch_count: number;
  files_total: number;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  admin_notes: string | null;
}

export interface AdminSupportThreadSummary {
  id: number;
  status: SupportThreadStatus;
  bot_attempts: number;
  issue_summary: string;
  escalated_at: string | null;
  unread_admin: number;
  unread_user: number;
  created_at: string;
  updated_at: string;
  last_message_preview: string;
  last_message_at: string | null;
  customer: SupportCustomerDossier;
}

export interface AdminSupportThreadDetail {
  thread: SupportThread;
  customer: SupportCustomerDossier;
}

export interface AdminSupportNotifications {
  unread_total: number;
  escalated_count: number;
  active_count: number;
  recent_escalations: AdminSupportThreadSummary[];
}

export interface UploadedSupportMedia {
  url: string;
  name: string;
  type: "image" | "video";
  mime: string;
  size: number;
}

async function readError(response: Response): Promise<string> {
  try {
    const detail = (await response.json())?.detail;
    if (typeof detail === "string") return detail;
  } catch {
    /* ignore */
  }
  return `${response.status} ${response.statusText}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export function resolveSupportMediaUrl(url: string | null): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

// --- User Bot & Live Chat API ---------------------------------------------

export function fetchMySupportThread(): Promise<SupportThread> {
  return request<SupportThread>("/api/v1/support/thread");
}

export function startNewSupportThread(): Promise<SupportThread> {
  return request<SupportThread>("/api/v1/support/thread/new", { method: "POST" });
}

export function sendUserSupportMessage(payload: {
  body: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
}): Promise<SupportThread> {
  return request<SupportThread>("/api/v1/support/thread/message", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function markBotAttemptUnsolved(): Promise<SupportThread> {
  return request<SupportThread>("/api/v1/support/thread/unsolved", {
    method: "POST",
  });
}

export function escalateToLiveAgent(note = ""): Promise<SupportThread> {
  return request<SupportThread>("/api/v1/support/thread/escalate", {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function uploadSupportAttachment(file: File): Promise<UploadedSupportMedia> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadedSupportMedia>("/api/v1/support/upload", {
    method: "POST",
    body: form,
  });
}

// --- Admin Support & Live Chat API ----------------------------------------

export function getAdminSupportNotifications(): Promise<AdminSupportNotifications> {
  return request<AdminSupportNotifications>("/api/v1/admin/support/notifications");
}

export function listAdminSupportThreads(params?: {
  status?: string;
  q?: string;
}): Promise<AdminSupportThreadSummary[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.q) qs.set("q", params.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<AdminSupportThreadSummary[]>(`/api/v1/admin/support/threads${suffix}`);
}

export function getAdminSupportThread(threadId: number): Promise<AdminSupportThreadDetail> {
  return request<AdminSupportThreadDetail>(`/api/v1/admin/support/threads/${threadId}`);
}

export function sendAdminSupportMessage(
  threadId: number,
  payload: {
    body: string;
    attachment_url?: string | null;
    attachment_name?: string | null;
    attachment_type?: string | null;
    attachment_size?: number | null;
  },
): Promise<AdminSupportThreadDetail> {
  return request<AdminSupportThreadDetail>(`/api/v1/admin/support/threads/${threadId}/message`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAdminSupportThreadStatus(
  threadId: number,
  status: SupportThreadStatus,
): Promise<AdminSupportThreadDetail> {
  return request<AdminSupportThreadDetail>(`/api/v1/admin/support/threads/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
