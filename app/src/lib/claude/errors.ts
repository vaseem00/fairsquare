import "server-only";
/**
 * Error mapping for a Claude read (A§5.6). Only SDK error classes and `.status` are used, never message
 * strings. Timeouts come from our own deadline signal, not from an SDK timeout class.
 *
 * | condition (in this order)                                  | code                | HTTP |
 * |------------------------------------------------------------|---------------------|------|
 * | the caller's signal aborted (the client went away)         | ExtractAbortedError | 499  |
 * | our deadline fired                                         | extract_timeout     | 504  |
 * | RateLimitError, OverloadedError or status 529              | extract_busy (+30s) | 503  |
 * | AuthenticationError, PermissionDeniedError or status 403   | extract_unavailable | 503  |
 * | BadRequestError (or 413) with an image                     | image_rejected      | 422  |
 * | BadRequestError without an image                           | extract_failed      | 502  |
 * | any other APIError (5xx, connection error)                 | extract_failed      | 502  |
 * | stop_reason refusal / max_tokens / bad JSON                | refused/unreadable/failed | 422/422/502 |
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ErrorCode } from "@/lib/types";

export type ExtractErrorCode = Extract<
  ErrorCode,
  | "extract_refused"
  | "extract_unreadable"
  | "extract_timeout"
  | "extract_failed"
  | "extract_busy"
  | "extract_unavailable"
  | "image_rejected"
>;

export const EXTRACT_ERROR_STATUS: Record<ExtractErrorCode, number> = {
  extract_refused: 422,
  extract_unreadable: 422,
  extract_timeout: 504,
  extract_failed: 502,
  extract_busy: 503,
  extract_unavailable: 503,
  image_rejected: 422,
};

/** Seconds the UI waits before "Try again" after `extract_busy`. */
export const BUSY_RETRY_AFTER_SEC = 30;

/** Safe diagnostics only: never the model output, the input or extracted values. */
export interface ExtractErrorDetail {
  stopReason?: string | null;
  refusalCategory?: string | null;
  errorClass?: string;
  upstreamStatus?: number | null;
  model?: string;
}

export class ExtractError extends Error {
  override name = "ExtractError";
  readonly code: ExtractErrorCode;
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly detail: ExtractErrorDetail;

  constructor(code: ExtractErrorCode, detail: ExtractErrorDetail = {}, opts: { cause?: unknown } = {}) {
    super(code, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.code = code;
    this.status = EXTRACT_ERROR_STATUS[code];
    this.retryAfterSec = code === "extract_busy" ? BUSY_RETRY_AFTER_SEC : undefined;
    this.detail = detail;
  }
}

export function isExtractError(err: unknown): err is ExtractError {
  return err instanceof ExtractError;
}

/** The person stopped the read (or closed the page). The route answers 499 and logs no error. */
export class ExtractAbortedError extends Error {
  override name = "AbortError";
  constructor() {
    super("extract_aborted");
  }
}

export function isExtractAborted(err: unknown): err is ExtractAbortedError {
  return err instanceof ExtractAbortedError;
}

/** How a finished read counts for the circuit breaker (A§5.6). */
export function circuitKind(code: ExtractErrorCode | "ok"): "ok" | "server_fail" | "other" {
  if (code === "ok") return "ok";
  return code === "extract_failed" || code === "extract_timeout" ? "server_fail" : "other";
}

function className(err: unknown): string {
  if (err && typeof err === "object") {
    const ctor = (err as { constructor?: { name?: string } }).constructor;
    if (ctor?.name) return ctor.name;
  }
  return typeof err;
}

export interface MapContext {
  /** The caller's signal (the request). Aborted → ExtractAbortedError. */
  callerSignal?: AbortSignal;
  /** Our own deadline. Aborted → extract_timeout. */
  deadlineSignal?: AbortSignal;
  /** An image was sent: a 400 means Claude rejected the image. */
  hasImage: boolean;
}

/** Maps anything thrown by the SDK call to ExtractError (or ExtractAbortedError for a client abort). */
export function mapClaudeError(err: unknown, ctx: MapContext): ExtractError | ExtractAbortedError {
  if (err instanceof ExtractError || err instanceof ExtractAbortedError) return err;
  if (ctx.callerSignal?.aborted) return new ExtractAbortedError();
  const errorClass = className(err);
  if (ctx.deadlineSignal?.aborted || err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ExtractError("extract_timeout", { errorClass }, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : null;
    const detail: ExtractErrorDetail = { errorClass, upstreamStatus: status };
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.OverloadedError || status === 529) {
      return new ExtractError("extract_busy", detail, { cause: err });
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || status === 403) {
      return new ExtractError("extract_unavailable", detail, { cause: err });
    }
    if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.ContentTooLargeError) {
      return new ExtractError(ctx.hasImage ? "image_rejected" : "extract_failed", detail, { cause: err });
    }
    return new ExtractError("extract_failed", detail, { cause: err });
  }
  return new ExtractError("extract_failed", { errorClass }, { cause: err });
}
