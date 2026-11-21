import { afterEach, describe, expect, it } from "vitest";
import { __resetEnvForTests } from "@/lib/env";
import { json, route } from "@/lib/http/handler";
import { isAllowedOrigin } from "@/lib/http/origin";
import { call } from "../../helpers/http";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  __resetEnvForTests();
});

// anon "none" and no DB access: the origin check alone decides.
const handler = route({}, async () => json({ ok: true }));
const optedOut = route({ origin: false }, async () => json({ ok: true }));

describe("origin check through route()", () => {
  it("rejects a POST from another origin with 403 bad_origin", async () => {
    const res = await call<{ error: { code: string; message: string; requestId: string } }>(handler, {
      method: "POST",
      url: "/api/x",
      json: {},
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bad_origin");
    expect(res.body.error.message).toBe("This request was blocked. Reload the page and try again.");
    expect(res.body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("rejects a POST with no Origin", async () => {
    const res = await call(handler, { method: "POST", url: "/api/x", json: {}, origin: null });
    expect(res.status).toBe(403);
  });

  it("rejects Sec-Fetch-Site: cross-site even with a matching Origin", async () => {
    const res = await call(handler, {
      method: "POST",
      url: "/api/x",
      json: {},
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("passes same-origin requests, and GETs without an Origin", async () => {
    expect((await call(handler, { method: "POST", url: "/api/x", json: {} })).status).toBe(200);
    expect(
      (await call(handler, { method: "DELETE", url: "/api/x", headers: { "sec-fetch-site": "same-origin" } })).status,
    ).toBe(200);
    expect((await call(handler, { url: "/api/x", origin: null })).status).toBe(200);
  });

  it("can be switched off per route", async () => {
    expect((await call(optedOut, { method: "POST", url: "/api/x", json: {}, origin: "https://evil.example" })).status).toBe(
      200,
    );
  });
});

function req(method: string, headers: Record<string, string>) {
  return { method, headers: new Headers(headers) };
}

describe("isAllowedOrigin", () => {
  it("uses x-forwarded-host over host", () => {
    expect(
      isAllowedOrigin(req("POST", { origin: "https://fairsquare.example", host: "internal:8080", "x-forwarded-host": "fairsquare.example" })),
    ).toBe(true);
    expect(isAllowedOrigin(req("POST", { origin: "https://fairsquare.example", host: "internal:8080" }))).toBe(false);
  });

  it("rejects 'null', non-http and unparsable origins", () => {
    expect(isAllowedOrigin(req("POST", { origin: "null", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { origin: "ftp://localhost:3000", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { origin: "not a url", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(req("PATCH", { origin: "https://a.example" }))).toBe(false);
  });

  it("accepts any http://localhost port outside production", () => {
    expect(isAllowedOrigin(req("POST", { origin: "http://localhost:3105", host: "localhost:3000" }))).toBe(true);
    expect(isAllowedOrigin(req("PUT", { origin: "http://127.0.0.1:3000", host: "example.com" }))).toBe(true);
  });

  it("in production requires APP_URL's host too, and no localhost shortcut", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SESSION_SECRET: "p".repeat(40),
      APP_URL: "https://fairsquare.example",
    });
    __resetEnvForTests();
    expect(isAllowedOrigin(req("POST", { origin: "https://fairsquare.example", host: "fairsquare.example" }))).toBe(true);
    expect(isAllowedOrigin(req("POST", { origin: "https://other.example", host: "other.example" }))).toBe(false);
    expect(isAllowedOrigin(req("POST", { origin: "http://localhost:3000", host: "fairsquare.example" }))).toBe(false);
  });
});
