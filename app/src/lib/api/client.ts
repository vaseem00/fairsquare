/**
 * Typed fetch wrapper for the public API (A§4). Used by every client component.
 * - Never throws on HTTP errors: every call resolves to ApiResult<T>.
 * - A network failure (offline, DNS) resolves to `{ ok: false, status: 0 }` with `error.offline` copy.
 * - An aborted request (Stop, or the 28 s backstop) rejects with the AbortError, so callers can tell
 *   "the person stopped it" apart from a failure.
 */
import { COPY, ERROR_COPY } from "@/lib/copy";
import type {
  ApiError,
  ApiResult,
  BuildingRequestResponse,
  CheckRequest,
  CheckView,
  AnalysisView,
  ClientEventName,
  Completion,
  CoverageResponse,
  ErrorCode,
  ExtractResponse,
  LeadRequest,
  LeadView,
  MatchResponse,
  MetaResponse,
  MeView,
  SavedItemView,
} from "@/lib/types";
import { ERROR_CODES } from "@/lib/validation/api";
import { CONTRACT, pathFor } from "./contract";

let fetchImpl: typeof fetch | null = null;
const doFetch: typeof fetch = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);

/** Tests inject a fake fetch; null restores the global one. */
export function __setFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f;
}

const KNOWN_CODES = new Set<string>(ERROR_CODES);

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

function fallbackError(status: number, requestId: string): ApiError {
  const code: ErrorCode =
    status === 404 ? "not_found" : status === 429 ? "rate_limited" : status === 400 ? "bad_request" : "internal";
  return { code, message: ERROR_COPY[code], requestId };
}

async function readError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get("x-request-id") ?? "";
  try {
    const body = (await res.json()) as { error?: Partial<ApiError> } | null;
    const e = body?.error;
    if (e && typeof e.code === "string" && KNOWN_CODES.has(e.code)) {
      const code = e.code as ErrorCode;
      return {
        code,
        message: typeof e.message === "string" && e.message ? e.message : ERROR_COPY[code],
        ...(e.fields ? { fields: e.fields } : {}),
        ...(typeof e.retryAfterSec === "number" ? { retryAfterSec: e.retryAfterSec } : {}),
        requestId: e.requestId ?? requestId,
      };
    }
  } catch {
    // not JSON: fall through
  }
  const retryAfter = Number(res.headers.get("retry-after"));
  const err = fallbackError(res.status, requestId);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? { ...err, retryAfterSec: retryAfter } : err;
}

interface RequestOptions {
  method: string;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  let res: Response;
  try {
    res = await doFetch(path, {
      method: opts.method,
      headers,
      body,
      signal: opts.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw err;
    return { ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } };
  }
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  if (res.status === 204) return { ok: true, data: null as T };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw err;
    return { ok: false, status: res.status, error: fallbackError(500, res.headers.get("x-request-id") ?? "") };
  }
}

function query(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const api = {
  /** POST /api/extract (multipart). Send the downscaled image and/or pasted text. */
  extract(input: { image?: Blob; text?: string }, signal?: AbortSignal): Promise<ApiResult<ExtractResponse>> {
    const form = new FormData();
    if (input.image) form.append("image", input.image, "screenshot.jpg");
    if (input.text) form.append("text", input.text);
    return request(CONTRACT.extract.path, { method: "POST", form, signal });
  },

  /** GET /api/buildings/match. `completion` picks which sales `salesForBedrooms` counts. */
  match(
    q: string,
    area?: string | null,
    beds?: number | null,
    completion?: Completion | null,
    signal?: AbortSignal,
  ): Promise<ApiResult<MatchResponse>> {
    return request(`${CONTRACT.match.path}${query({ q, area, beds, completion })}`, { method: "GET", signal });
  },

  /** GET /api/buildings?q=&page=: one page (50) of the coverage list, searched on the server. */
  buildings(params: { q?: string | null; page?: number | null } = {}): Promise<ApiResult<CoverageResponse>> {
    return request(`${CONTRACT.buildings.path}${query({ q: params.q, page: params.page })}`, { method: "GET" });
  },

  /** GET /api/meta: the loaded data's status and the "From the data" panel. */
  meta(): Promise<ApiResult<MetaResponse>> {
    return request(CONTRACT.meta.path, { method: "GET" });
  },

  /** POST /api/checks. */
  createCheck(body: CheckRequest, signal?: AbortSignal): Promise<ApiResult<{ check: CheckView }>> {
    return request(CONTRACT.createCheck.path, { method: "POST", json: body, signal });
  },

  /** GET /api/checks/[code]: the stored comparison plus `current`, recomputed today. */
  getCheck(code: string): Promise<ApiResult<{ check: CheckView; current: AnalysisView }>> {
    return request(pathFor("getCheck", { code }), { method: "GET" });
  },

  saved: {
    list(): Promise<ApiResult<{ items: SavedItemView[] }>> {
      return request(CONTRACT.savedList.path, { method: "GET" });
    },
    /** Also the Undo after remove (restores the original savedAt and baseline). */
    add(code: string): Promise<ApiResult<{ item: SavedItemView }>> {
      return request(CONTRACT.savedAdd.path, { method: "POST", json: { code } });
    },
    remove(code: string): Promise<ApiResult<null>> {
      return request(pathFor("savedRemove", { code }), { method: "DELETE" });
    },
    markSeen(code: string): Promise<ApiResult<null>> {
      return request(pathFor("savedSeen", { code }), { method: "POST" });
    },
  },

  leads: {
    create(body: LeadRequest): Promise<ApiResult<{ lead: LeadView }>> {
      return request(CONTRACT.leadsCreate.path, { method: "POST", json: body });
    },
    withdraw(id: number): Promise<ApiResult<{ lead: LeadView }>> {
      return request(pathFor("leadsWithdraw", { id }), { method: "POST" });
    },
    list(): Promise<ApiResult<{ leads: LeadView[] }>> {
      return request(CONTRACT.leadsList.path, { method: "GET" });
    },
  },

  me: {
    get(): Promise<ApiResult<MeView>> {
      return request(CONTRACT.meGet.path, { method: "GET" });
    },
    remove(): Promise<ApiResult<null>> {
      return request(CONTRACT.meDelete.path, { method: "DELETE" });
    },
    recoveryLink(): Promise<ApiResult<{ url: string }>> {
      return request(CONTRACT.meRecoveryLink.path, { method: "POST" });
    },
    /** The confirmed recovery link: switches this browser to the token's list. */
    recover(token: string): Promise<ApiResult<null>> {
      return request(CONTRACT.meRecover.path, { method: "POST", json: { token } });
    },
  },

  requests: {
    create(body: { text: string; area?: string; code?: string }): Promise<ApiResult<BuildingRequestResponse>> {
      return request(CONTRACT.requestsCreate.path, { method: "POST", json: body });
    },
  },

  /** Fire-and-forget usage event (keepalive). Never throws, never rejects. */
  track(name: ClientEventName, code?: string): void {
    try {
      void doFetch(CONTRACT.events.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(code ? { name, code } : { name }),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => undefined);
    } catch {
      // ignore: tracking must never break the page
    }
  },
};

export type Api = typeof api;
