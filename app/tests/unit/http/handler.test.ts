import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { __setLogSinkForTests } from "@/lib/log";
import { HttpError, httpError, messageFor, STATUS_FOR_CODE, toApiError } from "@/lib/http/errors";
import { json, noContent, readJson, route } from "@/lib/http/handler";
import { serializeCookie } from "@/lib/http/cookies";
import { clientIp, hashIp, ipHashFor } from "@/lib/http/ip";
import { ERROR_CODES } from "@/lib/validation/api";
import { call } from "../../helpers/http";

type ErrBody = { error: { code: string; message: string; fields?: Record<string, string>; retryAfterSec?: number; requestId: string } };

function captureLogs(): string[] {
  const lines: string[] = [];
  __setLogSinkForTests((_l, line) => lines.push(line));
  process.env.LOG_LEVEL = "info";
  return lines;
}

afterEach(() => {
  __setLogSinkForTests(null);
  process.env.LOG_LEVEL = "error";
});

const Body = z.object({ n: z.number().int().min(1, { error: "Too small" }), s: z.string().optional() });
const echo = route({}, async (ctx) => json(await readJson(ctx.req, Body), 201));

describe("route() responses", () => {
  it("adds X-Request-Id and Cache-Control: no-store, and passes params", async () => {
    const h = route<{ code: string }>({}, async (ctx, params) => json({ code: params.code, rid: ctx.requestId, today: ctx.today }));
    const res = await call<{ code: string; rid: string; today: string }>(h, { url: "/api/c/X", params: { code: "K7Q2MX" } });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("K7Q2MX");
    expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.headers.get("x-request-id")).toBe(res.body.rid);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a Cache-Control the handler set", async () => {
    const h = route({}, async () => new Response("ok", { headers: { "Cache-Control": "public, max-age=60" } }));
    const res = await call(h, { url: "/x" });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("handles immutable responses such as Response.redirect and still sets cookies", async () => {
    const h = route({}, async (ctx) => {
      ctx.setCookie("k", "v w", { httpOnly: true, sameSite: "lax", maxAge: 10 });
      return Response.redirect("http://localhost:3000/saved", 303);
    });
    const res = await call(h, { url: "/r/x" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/saved");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.cookies.k.value).toBe("v w");
  });

  it("returns 204 from noContent()", async () => {
    const res = await call(route({}, async () => noContent()), { method: "POST", url: "/x" });
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });
});

describe("readJson", () => {
  it("parses a valid body", async () => {
    const res = await call(echo, { method: "POST", url: "/x", json: { n: 2 } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ n: 2 });
  });

  it("gives 422 validation_failed with fields keyed by path", async () => {
    const res = await call<ErrBody>(echo, { method: "POST", url: "/x", json: { n: 0, s: 5 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.fields?.n).toBe("Too small");
    expect(res.body.error.fields?.s).toBeTruthy();
  });

  it("gives 400 for malformed JSON and 415 for another content type", async () => {
    const bad = await call<ErrBody>(echo, {
      method: "POST",
      url: "/x",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("bad_request");

    const text = await call<ErrBody>(echo, { method: "POST", url: "/x", body: "n=1", headers: { "content-type": "text/plain" } });
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe("bad_request");
  });

  it("rejects an oversized body", async () => {
    const res = await call<ErrBody>(echo, { method: "POST", url: "/x", json: { n: 1, s: "x".repeat(70_000) } });
    expect(res.status).toBe(400);
  });

  it("route() itself rejects a mutation body that is neither JSON nor multipart", async () => {
    const h = route({}, async () => noContent());
    const res = await call(h, { method: "POST", url: "/x", body: "a", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
    const form = await call(h, { method: "POST", url: "/x", form: { a: "1" } });
    expect(form.status).toBe(204);
    const empty = await call(h, { method: "DELETE", url: "/x" });
    expect(empty.status).toBe(204);
  });
});

describe("error mapping", () => {
  it("maps HttpError to the A§4.1 body with Retry-After", async () => {
    const h = route({}, async () => {
      throw new HttpError(429, "rate_limited", { retryAfterSec: 90, scope: "extract_burst" });
    });
    const res = await call<ErrBody>(h, { url: "/x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect(res.body.error).toEqual({
      code: "rate_limited",
      message: "You've read a lot of screenshots in a short time. Wait 2 minutes, or type the details.",
      retryAfterSec: 90,
      requestId: res.headers.get("x-request-id"),
    });
  });

  it("maps unknown errors to 500 internal and logs them with the request id", async () => {
    const lines = captureLogs();
    const h = route({}, async () => {
      throw new Error("boom");
    });
    const res = await call<ErrBody>(h, { url: "/x" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal");
    expect(res.body.error.message).toBe("Something went wrong on our side. Try again.");
    const failed = lines.find((l) => l.includes("request_failed"));
    expect(failed).toContain(res.body.error.requestId);
    expect(failed).toContain("boom");
  });

  it("writes one access line with method, route, status and ms, never the body", async () => {
    const lines = captureLogs();
    await call(echo, { method: "POST", url: "/api/echo", json: { n: 3, s: "secret-body-text" } });
    const access = lines.filter((l) => JSON.parse(l).event === "http");
    expect(access).toHaveLength(1);
    const entry = JSON.parse(access[0]);
    expect(entry).toMatchObject({ method: "POST", route: "/api/echo", status: 201 });
    expect(typeof entry.ms).toBe("number");
    expect(lines.join("\n")).not.toContain("secret-body-text");
  });

  it("admin: true without a session gives 401 unauthorized", async () => {
    const h = route({ admin: true }, async () => noContent());
    const res = await call<ErrBody>(h, { url: "/api/admin/x" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });
});

describe("errors helpers", () => {
  it("has a status for every code and fills vars", () => {
    for (const code of ERROR_CODES) expect(STATUS_FOR_CODE[code]).toBeGreaterThanOrEqual(400);
    expect(httpError("not_found").status).toBe(404);
    expect(messageFor({ code: "rate_limited", scope: "admin_login" })).toBe("Too many tries. Wait 15 minutes.");
    expect(messageFor({ code: "rate_limited", scope: "extract_daily" })).toContain("today");
    expect(messageFor({ code: "rate_limited", scope: "unknown-scope" })).toBe(
      "Too many requests from this browser. Wait a minute and try again.",
    );
    expect(messageFor({ code: "rate_limited" })).toBe("Too many requests from this browser. Wait a minute and try again.");
    expect(toApiError(new HttpError(422, "validation_failed", { fields: { a: "b" } }), "r1")).toMatchObject({
      code: "validation_failed",
      fields: { a: "b" },
      requestId: "r1",
    });
  });
});

describe("cookies and ip", () => {
  it("serialises cookie attributes", () => {
    expect(serializeCookie("a", "b c", { maxAge: 5, httpOnly: true, secure: true, sameSite: "strict" })).toBe(
      "a=b%20c; Path=/; Max-Age=5; HttpOnly; Secure; SameSite=Strict",
    );
    expect(() => serializeCookie("bad name", "x")).toThrow();
  });

  it("takes x-real-ip, then the last (proxy-added) x-forwarded-for entry, never the client-written first one, and hashes it", () => {
    const h = (o: Record<string, string>) => ({ headers: new Headers(o) });
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    // A spoofed leading entry is ignored: the proxy appended the real address.
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown");
    expect(clientIp(h({}))).toBe("unknown");
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
    expect(ipHashFor(h({ "x-forwarded-for": "1.2.3.4" }))).toBe(hashIp("1.2.3.4"));
    expect(hashIp("1.2.3.4")).not.toBe(hashIp("1.2.3.5"));
  });
});
