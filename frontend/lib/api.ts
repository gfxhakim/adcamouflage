import type {
  BatchCreated,
  BatchStatus,
  HealthReport,
  MutationOptions,
  PresetCatalogue,
} from "./types";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  return API_KEY ? { "X-API-Key": API_KEY } : {};
}

/** Pull a human-readable message out of FastAPI's varied error shapes. */
async function readError(response: Response): Promise<string> {
  let detail: unknown;
  try {
    detail = (await response.json())?.detail;
  } catch {
    return `${response.status} ${response.statusText}`;
  }

  if (typeof detail === "string") return detail;

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") {
      const rejected = record.rejected;
      if (Array.isArray(rejected) && rejected.length > 0) {
        const reasons = rejected
          .map((entry) => {
            const item = entry as { filename?: string; reason?: string };
            return `${item.filename ?? "file"}: ${item.reason ?? "rejected"}`;
          })
          .join("; ");
        return `${record.message} ${reasons}`;
      }
      return record.message;
    }
  }

  if (Array.isArray(detail)) {
    // Pydantic validation errors.
    return detail
      .map((entry) => {
        const item = entry as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(item.loc) ? item.loc.slice(-1)[0] : "input";
        return `${String(field)}: ${item.msg ?? "invalid"}`;
      })
      .join("; ");
  }

  return `${response.status} ${response.statusText}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the mutation engine at ${API_BASE}. Is the API running?`,
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthReport> {
  return request<HealthReport>("/api/v1/health");
}

export function getPresets(): Promise<PresetCatalogue> {
  return request<PresetCatalogue>("/api/v1/presets");
}

export function getBatch(batchId: string): Promise<BatchStatus> {
  return request<BatchStatus>(`/api/v1/batches/${batchId}`);
}

export function cancelAsset(assetId: string): Promise<{ status: string }> {
  return request(`/api/v1/assets/${assetId}/cancel`, { method: "POST" });
}

export function deleteBatch(batchId: string): Promise<{ deleted_files: number }> {
  return request(`/api/v1/batches/${batchId}`, { method: "DELETE" });
}

/**
 * Upload a batch with real progress. `fetch` cannot report upload progress, so
 * this uses XMLHttpRequest, which does.
 */
export function createBatch(
  files: File[],
  options: MutationOptions,
  onUploadProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<BatchCreated> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file, file.name));
    form.append("options", JSON.stringify(options));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/v1/batches`);
    Object.entries(authHeaders()).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onUploadProgress) {
        onUploadProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onUploadProgress?.(1);
        resolve(payload as BatchCreated);
        return;
      }

      const detail = (payload as { detail?: unknown } | null)?.detail;
      let message = `Upload failed (${xhr.status})`;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const record = detail as { message?: string; rejected?: unknown[] };
        if (record.message) {
          const reasons = (record.rejected ?? [])
            .map((entry) => {
              const item = entry as { filename?: string; reason?: string };
              return `${item.filename ?? "file"}: ${item.reason ?? "rejected"}`;
            })
            .join("; ");
          message = reasons ? `${record.message} ${reasons}` : record.message;
        }
      } else if (Array.isArray(detail)) {
        message = detail.map((e) => (e as { msg?: string }).msg ?? "invalid").join("; ");
      }
      reject(new ApiError(message, xhr.status));
    };

    xhr.onerror = () =>
      reject(new ApiError(`Cannot reach the mutation engine at ${API_BASE}.`, 0));
    xhr.ontimeout = () => reject(new ApiError("The upload timed out.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Turn a relative API download path into an absolute URL. */
export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}
