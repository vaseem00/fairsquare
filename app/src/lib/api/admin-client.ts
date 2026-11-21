/**
 * Typed fetch wrapper for /api/admin/* (A§1, admin UI only). Like `client.ts`, it never throws on HTTP
 * errors: every call resolves to ApiResult<T>; a network failure resolves to status 0.
 */
import { COPY, ERROR_COPY } from "@/lib/copy";
import type { ApiError, ApiResult, ErrorCode } from "@/lib/types";
import type {
  AdminAlias,
  AdminBuilding,
  AdminBuildingOption,
  AdminBuildingsPage,
  AdminLeadRow,
  AdminRange,
  AdminRequestRow,
  AdminSale,
  AdminStats,
  BuildingCreate,
  CsvKind,
  DataSourcePanel,
  ImportResult,
  LeadPatch,
  LeadReveal,
  LeadsQuery,
  NewSaleBody,
  SalePreview,
} from "@/lib/validation/admin";
import { ERROR_CODES } from "@/lib/validation/api";

let fetchImpl: typeof fetch | null = null;
const doFetch: typeof fetch = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);

/** Tests inject a fake fetch; null restores the global one. */
export function __setAdminFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f;
}

const KNOWN = new Set<string>(ERROR_CODES);

async function readError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get("x-request-id") ?? "";
  try {
    const body = (await res.json()) as { error?: Partial<ApiError> } | null;
    const e = body?.error;
    if (e && typeof e.code === "string" && KNOWN.has(e.code)) {
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
    // not JSON
  }
  const code: ErrorCode = res.status === 401 ? "unauthorized" : res.status === 404 ? "not_found" : "internal";
  return { code, message: ERROR_COPY[code], requestId };
}

async function request<T>(path: string, init: { method: string; json?: unknown; form?: FormData }): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) body = init.form;
  let res: Response;
  try {
    res = await doFetch(path, { method: init.method, headers, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } };
  }
  if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
  if (res.status === 204) return { ok: true, data: null as T };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: res.status, error: { code: "internal", message: ERROR_COPY.internal, requestId: "" } };
  }
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The CSV export URL (a plain link: the browser downloads it with the admin cookie). */
export function leadsExportUrl(q: LeadsQuery = {}): string {
  return `/api/admin/leads/export${qs({ status: q.status, from: q.from, to: q.to })}`;
}

export const adminApi = {
  /** POST /api/admin/login (WP1). */
  login(password: string): Promise<ApiResult<null>> {
    return request("/api/admin/login", { method: "POST", json: { password } });
  },
  /** POST /api/admin/logout (WP1). */
  logout(): Promise<ApiResult<null>> {
    return request("/api/admin/logout", { method: "POST" });
  },
  stats(range: AdminRange): Promise<ApiResult<AdminStats>> {
    return request(`/api/admin/stats${qs({ range })}`, { method: "GET" });
  },
  /** GET /api/admin/data-source: the sales data page's "Data source" panel (REAL_DATA.md section 12). */
  dataSource(): Promise<ApiResult<{ dataSource: DataSourcePanel }>> {
    return request("/api/admin/data-source", { method: "GET" });
  },
  leads: {
    list(q: LeadsQuery = {}): Promise<ApiResult<{ leads: AdminLeadRow[] }>> {
      return request(`/api/admin/leads${qs({ status: q.status, from: q.from, to: q.to })}`, { method: "GET" });
    },
    reveal(id: number): Promise<ApiResult<LeadReveal>> {
      return request(`/api/admin/leads/${id}/reveal`, { method: "GET" });
    },
    update(id: number, patch: LeadPatch): Promise<ApiResult<{ lead: AdminLeadRow }>> {
      return request(`/api/admin/leads/${id}`, { method: "PATCH", json: patch });
    },
  },
  requests: {
    list(): Promise<ApiResult<{ requests: AdminRequestRow[] }>> {
      return request("/api/admin/requests", { method: "GET" });
    },
    resolve(
      textNorm: string,
      resolvedBuildingId: number | null,
    ): Promise<ApiResult<{ textNorm: string; updated: number; resolvedBuilding: { id: number; name: string } | null }>> {
      return request("/api/admin/requests", { method: "PATCH", json: { textNorm, resolvedBuildingId } });
    },
  },
  buildings: {
    /** One page of 50, searched on the server by name, area, DLD area or alias (`q`, 2+ characters). */
    list(q: { q?: string | null; page?: number } = {}): Promise<ApiResult<AdminBuildingsPage>> {
      return request(`/api/admin/buildings${qs({ q: q.q, page: q.page && q.page > 1 ? q.page : null })}`, { method: "GET" });
    },
    /** Every building as id, name and area (the pickers). */
    options(): Promise<ApiResult<{ options: AdminBuildingOption[] }>> {
      return request("/api/admin/buildings/options", { method: "GET" });
    },
    create(body: BuildingCreate): Promise<ApiResult<{ building: AdminBuilding }>> {
      return request("/api/admin/buildings", { method: "POST", json: body });
    },
    addAlias(id: number, alias: string): Promise<ApiResult<{ alias: AdminAlias; created: boolean }>> {
      return request(`/api/admin/buildings/${id}/aliases`, { method: "POST", json: { alias } });
    },
  },
  sales: {
    list(q: { buildingId?: number; bedrooms?: number } = {}): Promise<ApiResult<{ sales: AdminSale[] }>> {
      return request(`/api/admin/sales${qs(q)}`, { method: "GET" });
    },
    preview(body: NewSaleBody): Promise<ApiResult<SalePreview>> {
      return request("/api/admin/sales/preview", { method: "POST", json: body });
    },
    create(body: NewSaleBody): Promise<ApiResult<{ sale: AdminSale }>> {
      return request("/api/admin/sales", { method: "POST", json: body });
    },
    remove(id: number): Promise<ApiResult<null>> {
      return request(`/api/admin/sales/${id}`, { method: "DELETE" });
    },
  },
  /**
   * POST /api/admin/import. With `onProgress`, the upload goes through XMLHttpRequest so the caller can
   * show a Progress bar (0–1); without it, through fetch.
   */
  import(
    kind: CsvKind,
    file: File,
    commit: boolean,
    onProgress?: (fraction: number) => void,
  ): Promise<ApiResult<ImportResult>> {
    const form = new FormData();
    form.append("file", file, file.name || "import.csv");
    const path = `/api/admin/import${qs({ kind, commit: commit ? 1 : 0 })}`;
    if (!onProgress || typeof XMLHttpRequest === "undefined") return request(path, { method: "POST", form });
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
      xhr.onerror = () =>
        resolve({ ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } });
      xhr.onload = () => {
        onProgress(1);
        const res = new Response(xhr.responseText || null, {
          status: xhr.status,
          headers: { "content-type": xhr.getResponseHeader("content-type") ?? "application/json" },
        });
        if (xhr.status >= 200 && xhr.status < 300) {
          res
            .json()
            .then((data) => resolve({ ok: true, data: data as ImportResult }))
            .catch(() =>
              resolve({ ok: false, status: xhr.status, error: { code: "internal", message: ERROR_COPY.internal, requestId: "" } }),
            );
        } else {
          void readError(res).then((error) => resolve({ ok: false, status: xhr.status, error }));
        }
      };
      xhr.send(form);
    });
  },
};

export type AdminApi = typeof adminApi;
