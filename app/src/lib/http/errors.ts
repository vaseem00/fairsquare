import "server-only";
/**
 * HttpError and the A§4.1 error body: `{ error: { code, message, fields?, retryAfterSec?, requestId } }`.
 * `message` is ERROR_COPY[code] filled with `vars`, or, for `rate_limited`, the scope's message.
 */
import { ERROR_COPY, rateLimitMessage } from "@/lib/copy";
import type { ApiError, ErrorCode, RateLimitScope } from "@/lib/types";
import { RATE_LIMIT_SCOPES } from "@/lib/validation/api";

export interface HttpErrorOpts {
  /** 422: field path → message. */
  fields?: Record<string, string>;
  /** 429 / 503: also sent as the Retry-After header. */
  retryAfterSec?: number;
  /** Values for `{placeholders}` in the code's message. */
  vars?: Record<string, string | number>;
  /** `rate_limited` only: picks the DESIGN.md message for the scope (extract burst, daily, admin login…). */
  scope?: RateLimitScope | (string & {});
}

export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly retryAfterSec?: number;
  readonly vars?: Record<string, string | number>;
  readonly scope?: string;

  constructor(status: number, code: ErrorCode, opts: HttpErrorOpts = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = opts.fields;
    this.retryAfterSec = opts.retryAfterSec;
    this.vars = opts.vars;
    this.scope = opts.scope;
  }
}

/** The HTTP status each error code uses by default (A§4.1). */
export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  empty_input: 400,
  validation_failed: 422,
  image_too_large: 413,
  file_too_large: 413,
  unsupported_image: 415,
  image_rejected: 422,
  extract_refused: 422,
  extract_unreadable: 422,
  extract_timeout: 504,
  extract_failed: 502,
  extract_busy: 503,
  extract_unavailable: 503,
  daily_cap_reached: 503,
  rate_limited: 429,
  building_not_found: 404,
  not_found: 404,
  leads_unavailable: 404,
  consent_required: 422,
  consent_version_mismatch: 409,
  unauthorized: 401,
  bad_credentials: 401,
  bad_origin: 403,
  internal: 500,
};

/** Shorthand: `httpError("not_found")` uses the code's default status. */
export function httpError(code: ErrorCode, opts?: HttpErrorOpts): HttpError {
  return new HttpError(STATUS_FOR_CODE[code], code, opts);
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

const SCOPES = new Set<string>(RATE_LIMIT_SCOPES);

function fillVars(template: string, vars: Record<string, string | number> | undefined): string {
  if (!vars) return template;
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The user-facing message for an error (safe to show). */
export function messageFor(err: Pick<HttpError, "code" | "vars" | "scope" | "retryAfterSec">): string {
  if (err.code === "rate_limited" && err.scope) {
    const scope = (SCOPES.has(err.scope) ? err.scope : "spam") as RateLimitScope;
    return rateLimitMessage(scope, err.retryAfterSec);
  }
  return fillVars(ERROR_COPY[err.code], err.vars);
}

/** The ApiError body for an HttpError. */
export function toApiError(err: HttpError, requestId: string): ApiError {
  return {
    code: err.code,
    message: messageFor(err),
    ...(err.fields ? { fields: err.fields } : {}),
    ...(err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {}),
    requestId,
  };
}
