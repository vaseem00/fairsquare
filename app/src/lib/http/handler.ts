import "server-only";
/**
 * The route() wrapper every API route handler uses (A§4, BUILD_PLAN WP1).
 * For each request it:
 * - waits for a real request (`connection()`), so no GET handler is prerendered at build time;
 * - assigns a request id and runs the origin check for mutations (A§6.3);
 * - rejects a mutation body that is neither JSON nor multipart (415 bad_request);
 * - verifies the admin session when `admin: true` (401 unauthorized);
 * - resolves the anon id: "require" issues/renews `mz_aid` and upserts `anon_users`,
 *   "optional" only reads it, "none" ignores it;
 * - maps HttpError to the A§4.1 body and unknown errors to 500 internal (logged with the request id);
 * - adds X-Request-Id (and Cache-Control: no-store unless the handler set one) and writes one
 *   access log line: method, route, status, ms. Never bodies.
 * Route handlers never use `next/headers`; they read `req` and write cookies with `ctx.setCookie`.
 */
import { randomUUID } from "node:crypto";
import { connection, NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { readAnon, requireAnon } from "@/lib/auth/anon";
import { verifyAdminSession } from "@/lib/auth/admin";
import { getDb, type Db } from "@/lib/db/client";
import { dubaiToday, type IsoDate } from "@/lib/domain/dates";
import { log } from "@/lib/log";
import { zodFieldErrors } from "@/lib/validation/api";
import { readTextLimited } from "./body";
import { ADMIN_COOKIE, serializeCookie, type CookieOpts } from "./cookies";
import { HttpError, isHttpError, toApiError } from "./errors";
import { ipHashFor } from "./ip";
import { assertSameOrigin, UNSAFE_METHODS } from "./origin";

export type { CookieOpts } from "./cookies";

export interface RouteCtx {
  req: NextRequest;
  /** The database (opened on first access). */
  db: Db;
  requestId: string;
  /** The Dubai calendar day of this request. */
  today: IsoDate;
  ipHash: string;
  /** Always set with anon: "require"; the verified cookie id (or null) with "optional"; null with "none". */
  anonId: string | null;
  setCookie(name: string, value: string, opts: CookieOpts): void;
}

export interface RouteOpts {
  anon?: "require" | "optional" | "none";
  admin?: boolean;
  /** Origin check; default true for non-GET methods. */
  origin?: boolean;
}

/** Largest JSON body readJson accepts. */
export const MAX_JSON_BYTES = 64 * 1024;

/** A JSON response with Cache-Control: no-store (route() adds X-Request-Id). */
export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** A 204 No Content response. */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function mediaType(req: NextRequest): string {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Parses and validates a JSON body. 415 bad_request for another content type, 400 bad_request for
 * malformed or oversized JSON, 422 validation_failed with `fields` (dotted path → message).
 */
export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (mediaType(req) !== "application/json") throw new HttpError(415, "bad_request");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new HttpError(400, "bad_request");
  let text: string;
  try {
    // Counted as it streams in: a chunked body has no Content-Length to check above.
    text = await readTextLimited(req, MAX_JSON_BYTES);
  } catch {
    throw new HttpError(400, "bad_request");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_request");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(parsed.error) });
  return parsed.data;
}

/** Outside Next (Vitest, scripts) there is no request scope and connection() throws; that is fine. */
async function awaitConnection(): Promise<void> {
  let pending: Promise<void>;
  try {
    pending = connection();
  } catch {
    return;
  }
  await pending;
}

function hasBody(req: NextRequest): boolean {
  const len = req.headers.get("content-length");
  if (len !== null) return Number(len) > 0;
  return req.headers.has("transfer-encoding") || req.body !== null;
}

function assertBodyType(req: NextRequest): void {
  if (!UNSAFE_METHODS.has(req.method) || !hasBody(req)) return;
  const type = mediaType(req);
  if (type !== "application/json" && type !== "multipart/form-data") throw new HttpError(415, "bad_request");
}

function errorResponse(err: HttpError, requestId: string): NextResponse {
  const res = NextResponse.json({ error: toApiError(err, requestId) }, { status: err.status });
  res.headers.set("Cache-Control", "no-store");
  if (err.retryAfterSec !== undefined) res.headers.set("Retry-After", String(Math.max(1, Math.ceil(err.retryAfterSec))));
  return res;
}

/** Adds headers to a response, copying it first when its headers are immutable (e.g. Response.redirect). */
function withHeaders(res: Response, cookies: string[], requestId: string): Response {
  let out = res;
  try {
    out.headers.set("X-Request-Id", requestId);
  } catch {
    out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    out.headers.set("X-Request-Id", requestId);
  }
  if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "no-store");
  for (const c of cookies) out.headers.append("Set-Cookie", c);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- static routes have no params
export function route<P extends Record<string, string> = {}>(
  opts: RouteOpts,
  fn: (ctx: RouteCtx, params: P) => Promise<Response>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response> {
  const anonMode = opts.anon ?? "none";
  return async (req, routeCtx) => {
    await awaitConnection();
    const started = Date.now();
    const requestId = randomUUID();
    const method = req.method.toUpperCase();
    const pendingCookies: string[] = [];
    let db: Db | null = null;
    const ctx: RouteCtx = {
      req,
      get db() {
        db ??= getDb();
        return db;
      },
      requestId,
      today: dubaiToday(),
      ipHash: "",
      anonId: null,
      setCookie(name, value, cookieOpts) {
        pendingCookies.push(serializeCookie(name, value, cookieOpts));
      },
    };

    let res: Response;
    try {
      const checkOrigin = opts.origin ?? method !== "GET";
      if (checkOrigin) assertSameOrigin(req);
      assertBodyType(req);
      ctx.ipHash = ipHashFor(req);
      if (opts.admin) {
        const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
        if (!cookie || !(await verifyAdminSession(ctx.db, cookie))) throw new HttpError(401, "unauthorized");
      }
      if (anonMode === "require") ctx.anonId = (await requireAnon(ctx.db, req, ctx.setCookie)).id;
      else if (anonMode === "optional") ctx.anonId = readAnon(req);
      const params = await routeCtx.params;
      res = await fn(ctx, params);
    } catch (err) {
      if (isHttpError(err)) {
        res = errorResponse(err, requestId);
      } else {
        log.error("request_failed", { requestId, method, route: req.nextUrl.pathname, err });
        res = errorResponse(new HttpError(500, "internal"), requestId);
      }
    }

    const out = withHeaders(res, pendingCookies, requestId);
    log.info("http", { requestId, method, route: req.nextUrl.pathname, status: out.status, ms: Date.now() - started });
    return out;
  };
}
