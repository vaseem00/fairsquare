/**
 * Call a route handler directly (A§8.1): builds a NextRequest with a same-origin Origin header by
 * default, invokes the handler with `{ params: Promise.resolve(params) }`, and returns the parsed result.
 *   const res = await call(POST, { method: "POST", url: "/api/checks", json: body, cookies: { mz_aid } });
 *   expect(res.status).toBe(201); res.body.check.code; res.cookies.mz_aid
 */
import { NextRequest } from "next/server";

export const TEST_ORIGIN = "http://localhost:3000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route handlers have varied context types
export type RouteHandler = (req: NextRequest, ctx: { params: Promise<any> }) => Response | Promise<Response>;

export interface CallOptions {
  method?: string;
  /** Path ("/api/checks?x=1") or absolute URL. Default "/". */
  url?: string;
  /** JSON body (sets Content-Type: application/json). */
  json?: unknown;
  /** Multipart body; plain objects are converted to FormData. */
  form?: FormData | Record<string, string | Blob>;
  /** Raw body (set your own Content-Type header). */
  body?: BodyInit;
  /** Cookies sent with the request. */
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  /** Dynamic route params, passed as a resolved Promise. */
  params?: Record<string, string | string[]>;
  /** Origin header; default TEST_ORIGIN; null sends none. */
  origin?: string | null;
}

export interface ParsedCookie {
  value: string;
  attributes: Record<string, string | true>;
}

export interface CallResult<T = unknown> {
  status: number;
  /** Parsed JSON, the text for other content types, or null for an empty body. */
  body: T;
  text: string;
  headers: Headers;
  /** Raw Set-Cookie header values. */
  setCookies: string[];
  /** Set-Cookie values parsed by name. */
  cookies: Record<string, ParsedCookie>;
}

export function parseSetCookie(header: string): { name: string } & ParsedCookie {
  const [pair, ...attrs] = header.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq);
  const value = decodeURIComponent(pair.slice(eq + 1));
  const attributes: Record<string, string | true> = {};
  for (const a of attrs) {
    if (!a) continue;
    const i = a.indexOf("=");
    if (i < 0) attributes[a.toLowerCase()] = true;
    else attributes[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
  }
  return { name, value, attributes };
}

/** Builds the NextRequest that `call` sends (exported for handlers that need a custom flow). */
export function buildRequest(opts: CallOptions = {}): NextRequest {
  const method = (opts.method ?? "GET").toUpperCase();
  const url = new URL(opts.url ?? "/", TEST_ORIGIN);
  const headers = new Headers(opts.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  const origin = opts.origin === undefined ? TEST_ORIGIN : opts.origin;
  if (origin !== null && !headers.has("origin")) headers.set("origin", origin);
  if (opts.cookies && Object.keys(opts.cookies).length) {
    const cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");
    headers.set("cookie", cookie);
  }
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (opts.form) {
    if (opts.form instanceof FormData) body = opts.form;
    else {
      const fd = new FormData();
      for (const [k, v] of Object.entries(opts.form)) fd.append(k, v);
      body = fd;
    }
  }
  return new NextRequest(url, { method, headers, body });
}

export async function call<T = unknown>(handler: RouteHandler, opts: CallOptions = {}): Promise<CallResult<T>> {
  const req = buildRequest(opts);
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = res.status === 204 ? "" : await res.text();
  const type = res.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (text) {
    if (type.includes("json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = text;
    }
  }
  const setCookies = res.headers.getSetCookie();
  const cookies: Record<string, ParsedCookie> = {};
  for (const h of setCookies) {
    const { name, value, attributes } = parseSetCookie(h);
    cookies[name] = { value, attributes };
  }
  return { status: res.status, body: body as T, text, headers: res.headers, setCookies, cookies };
}

/** Carries cookies from a response into the next request's `cookies` option (drops Max-Age=0 cookies). */
export function cookieJar(prev: Record<string, string>, res: Pick<CallResult, "cookies">): Record<string, string> {
  const next = { ...prev };
  for (const [name, c] of Object.entries(res.cookies)) {
    if (c.attributes["max-age"] === "0" || c.value === "") delete next[name];
    else next[name] = c.value;
  }
  return next;
}
