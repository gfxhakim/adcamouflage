import { API_BASE, ApiError } from "./api";

/** Result of "Check my payment": is this order / transaction id paid on my account? */
export interface PaymentCheck {
  found: boolean;
  paid: boolean;
  status: string;
  order_id: string | null;
  message: string;
}

export type ProofStatus = "pending" | "matched" | "approved" | "rejected";

export interface PaymentProof {
  id: number;
  order_id: string;
  transaction_id: string;
  status: ProofStatus;
  note: string;
  admin_note: string;
  screenshot_url: string | null;
  created_at: string;
  reviewed_at: string | null;
  // Admin view only.
  user_email?: string | null;
  order_status?: string | null;
  order_amount?: number | null;
  order_plan?: string | null;
  order_kind?: string | null;
  order_provider?: string | null;
  order_transaction_id?: string | null;
  duplicate_transaction?: boolean;
}

async function detailOf(response: Response): Promise<string> {
  try {
    const detail = (await response.json())?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((e) => (e as { msg?: string }).msg ?? "invalid").join("; ");
  } catch {
    /* fall through */
  }
  return `${response.status} ${response.statusText}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (!response.ok) throw new ApiError(await detailOf(response), response.status);
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const checkPayment = (code: string) => call<PaymentCheck>("/api/v1/payments/verify", json({ code }));

export function sendPaymentProof(orderId: string, transactionId: string, screenshot: File, note = "") {
  const form = new FormData();
  form.append("order_id", orderId);
  form.append("transaction_id", transactionId);
  form.append("note", note);
  form.append("screenshot", screenshot);
  return call<PaymentProof>("/api/v1/payments/proof", { method: "POST", body: form });
}

export const fetchMyProofs = () => call<PaymentProof[]>("/api/v1/payments/proofs");

export const fetchProofs = (status: ProofStatus | "all" = "pending") =>
  call<PaymentProof[]>(`/api/v1/admin/payments/proofs?status_filter=${encodeURIComponent(status)}`);

export const approveProof = (id: number, note = "") =>
  call<PaymentProof>(`/api/v1/admin/payments/proofs/${id}/approve`, json({ note }));

export const rejectProof = (id: number, note = "") =>
  call<PaymentProof>(`/api/v1/admin/payments/proofs/${id}/reject`, json({ note }));

/** Screenshot links come from the API as same-site paths; anything else is ignored. */
export function proofImageUrl(url: string | null): string {
  return url && /^\/api\/v1\/payments\/proofs\/\d+\/screenshot$/.test(url) ? `${API_BASE}${url}` : "";
}
