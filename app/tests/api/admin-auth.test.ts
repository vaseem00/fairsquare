import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { sign } from "@/lib/auth/sign";
import { __resetEnvForTests } from "@/lib/env";
import { json, route } from "@/lib/http/handler";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call, type CallResult } from "../helpers/http";

const t = setupTestDb({ seed: false });

/** Stands in for any /api/admin/* handler (WP5 builds them with the same wrapper). */
const adminOnly = route({ admin: true }, async () => json({ ok: true }));

type ErrBody = { error: { code: string; message: string; retryAfterSec?: number } };

beforeEach(async () => {
  await clearUserData(t.db);
});
afterEach(() => {
  vi.useRealTimers();
  process.env.ADMIN_PASSWORD = "test-admin-pass";
  __resetEnvForTests();
});

function attempt(password: unknown, ip = "203.0.113.7"): Promise<CallResult<ErrBody>> {
  return call<ErrBody>(login, {
    method: "POST",
    url: "/api/admin/login",
    json: { password },
    headers: { "x-forwarded-for": ip },
  });
}

describe("POST /api/admin/login", () => {
  it("returns 401 bad_credentials for a wrong password", async () => {
    const res = await attempt("wrong-password");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("bad_credentials");
    expect(res.body.error.message).toBe("That password is wrong.");
    expect(res.cookies.mz_admin).toBeUndefined();
    expect((await attempt("")).status).toBe(401);
    expect((await attempt(42)).status).toBe(401);
  });

  it("returns 204 with an HttpOnly SameSite=Strict 12-hour cookie for the right password", async () => {
    const res = await attempt("test-admin-pass");
    expect(res.status).toBe(204);
    const c = res.cookies.mz_admin;
    expect(c).toBeDefined();
    expect(c.attributes.samesite).toBe("Strict");
    expect(c.attributes.httponly).toBe(true);
    expect(c.attributes.path).toBe("/");
    expect(c.attributes["max-age"]).toBe(String(12 * 3600));
    const ok = await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: c.value } });
    expect(ok.status).toBe(200);
  });

  it("the 6th attempt within 15 minutes returns 429 'Too many tries. Wait 15 minutes.'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:01:00Z"));
    for (let i = 0; i < 5; i++) expect((await attempt("wrong")).status).toBe(401);
    const sixth = await attempt("test-admin-pass");
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("rate_limited");
    expect(sixth.body.error.message).toBe("Too many tries. Wait 15 minutes.");
    expect(sixth.body.error.retryAfterSec).toBe(14 * 60);
    expect(sixth.headers.get("retry-after")).toBe(String(14 * 60));

    // another IP is not affected
    expect((await attempt("test-admin-pass", "198.51.100.1")).status).toBe(204);
    // the next window allows tries again
    vi.setSystemTime(new Date("2026-11-17T08:15:00Z"));
    expect((await attempt("test-admin-pass")).status).toBe(204);
  });

  it("a spoofed x-forwarded-for does not reset the per-IP limit (the proxy-added last hop counts)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:01:00Z"));
    for (let i = 0; i < 5; i++) expect((await attempt("wrong", `10.9.9.${i}, 203.0.113.7`)).status).toBe(401);
    expect((await attempt("test-admin-pass", "10.9.9.99, 203.0.113.7")).status).toBe(429);
  });

  it("caps attempts from all IPs together at 30 per 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:01:00Z"));
    for (let i = 0; i < 30; i++) expect((await attempt("wrong", `198.51.100.${i}`)).status).toBe(401);
    const blocked = await attempt("test-admin-pass", "192.0.2.200");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    vi.setSystemTime(new Date("2026-11-17T08:15:00Z"));
    expect((await attempt("test-admin-pass", "192.0.2.200")).status).toBe(204);
  });

  it("is disabled when ADMIN_PASSWORD is unset", async () => {
    delete process.env.ADMIN_PASSWORD;
    __resetEnvForTests();
    expect((await attempt("test-admin-pass")).status).toBe(401);
  });

  it("rejects a cross-site login", async () => {
    const res = await call<ErrBody>(login, {
      method: "POST",
      url: "/api/admin/login",
      json: { password: "test-admin-pass" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bad_origin");
  });
});

describe("admin sessions on admin routes", () => {
  it("no cookie and a forged cookie give 401 unauthorized", async () => {
    const none = await call<ErrBody>(adminOnly, { url: "/api/admin/stats" });
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("unauthorized");
    const forged = await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: sign("adm", "A".repeat(43)) } });
    expect(forged.status).toBe(401);
    const garbage = await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: "abc.def" } });
    expect(garbage.status).toBe(401);
  });

  it("a cookie used after logout gives 401, and logout clears the cookie", async () => {
    const cookie = (await attempt("test-admin-pass")).cookies.mz_admin.value;
    const out = await call(logout, { method: "POST", url: "/api/admin/logout", cookies: { mz_admin: cookie } });
    expect(out.status).toBe(204);
    expect(out.cookies.mz_admin.value).toBe("");
    expect(out.cookies.mz_admin.attributes["max-age"]).toBe("0");
    expect(out.cookies.mz_admin.attributes.samesite).toBe("Strict");
    const after = await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: cookie } });
    expect(after.status).toBe(401);
    // logout again (or without a session) is still 204
    expect((await call(logout, { method: "POST", url: "/api/admin/logout", cookies: { mz_admin: cookie } })).status).toBe(204);
    expect((await call(logout, { method: "POST", url: "/api/admin/logout" })).status).toBe(204);
  });

  it("an expired session gives 401", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
    const cookie = (await attempt("test-admin-pass")).cookies.mz_admin.value;
    vi.setSystemTime(new Date("2026-11-17T19:00:00Z"));
    expect((await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: cookie } })).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-17T20:00:01Z"));
    expect((await call(adminOnly, { url: "/api/admin/stats", cookies: { mz_admin: cookie } })).status).toBe(401);
  });

  it("logout requires the same origin", async () => {
    const res = await call(logout, { method: "POST", url: "/api/admin/logout", origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});
