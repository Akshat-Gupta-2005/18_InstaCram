import { API_URL } from "@/config";

/** An error the API returned, in the contract's shape (API-CONTRACT §7). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** Web: let the request finish after the page unloads (refresh, tab closed). */
  keepalive?: boolean;
}

/**
 * The one way the app talks to the API. Every non-2xx response becomes an
 * ApiError carrying the server's code, so screens branch on `code`, never on
 * message text. A network failure becomes status 0, "network_error" - on a phone
 * that is usually the API address being wrong (see src/config.ts).
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError(0, "network_error", `Could not reach the server at ${API_URL}`);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (a proxy's HTML error page, say) falls through below.
  }

  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`);
  }
  return parsed as T;
}
