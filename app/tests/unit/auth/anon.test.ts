import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { readAnonFromCookies, signAnonId, verifyAnonCookie } from "@/lib/auth/anon";
import { ensureAnonUser, getAnonUser, touchAnonUser } from "@/lib/db/repo/anon";
import { anonUsers } from "@/lib/db/schema";
import { __resetEnvForTests } from "@/lib/env";
import { ANON_MAX_AGE_SEC } from "@/lib/http/cookies";
import { json, route } from "@/lib/http/handler";
import { useTestDb as setupTestDb } from "../../helpers/db";
import { call } from "../../helpers/http";

const t = setupTestDb({ seed: false });
const ORIGINAL_SECRET = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = ORIGINAL_SECRET;
  delete process.env.SESSION_SECRET_PREVIOUS;
  __resetEnvForTests();
});

const requireHandler = route({ anon: "require" }, async (ctx) => json({ anonId: ctx.anonId }));
const optionalHandler = route({ anon: "optional" }, async (ctx) => json({ anonId: ctx.anonId }));
const noneHandler = route({ anon: "none" }, async (ctx) => json({ anonId: ctx.anonId }));

type Body = { anonId: string | null };

describe("route({ anon: 'require' })", () => {
  it("issues mz_aid on the first call and creates the anon_users row", async () => {
    const res = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    expect(res.status).toBe(200);
    const id = res.body.anonId as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const c = res.cookies.mz_aid;
    expect(c).toBeDefined();
    expect(verifyAnonCookie(c.value)).toBe(id);
    expect(c.attributes.httponly).toBe(true);
    expect(c.attributes.samesite).toBe("Lax");
    expect(c.attributes.path).toBe("/");
    expect(c.attributes["max-age"]).toBe(String(ANON_MAX_AGE_SEC));
    expect(c.attributes.secure).toBeUndefined(); // not production
    expect(await getAnonUser(t.db, id)).not.toBeNull();
  });

  it("keeps a valid id and re-issues the cookie (rolling Max-Age)", async () => {
    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    const cookie = first.cookies.mz_aid.value;
    const second = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {}, cookies: { mz_aid: cookie } });
    expect(second.body.anonId).toBe(first.body.anonId);
    expect(second.cookies.mz_aid.value).toBe(cookie);
  });

  it("replaces a tampered value with a new id", async () => {
    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    const cookie = first.cookies.mz_aid.value;
    const tampered = `${cookie.slice(0, 35)}${cookie[35] === "0" ? "1" : "0"}${cookie.slice(36)}`;
    const res = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {}, cookies: { mz_aid: tampered } });
    expect(res.body.anonId).not.toBe(first.body.anonId);
    expect(verifyAnonCookie(res.cookies.mz_aid.value)).toBe(res.body.anonId);
  });

  it("recreates the row for a valid cookie whose row is gone", async () => {
    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    const id = first.body.anonId as string;
    await t.db.delete(anonUsers).where(eq(anonUsers.id, id));
    const res = await call<Body>(requireHandler, {
      method: "POST",
      url: "/api/x",
      json: {},
      cookies: { mz_aid: first.cookies.mz_aid.value },
    });
    expect(res.body.anonId).toBe(id);
    expect(await getAnonUser(t.db, id)).not.toBeNull();
  });

  it("accepts a cookie signed with SESSION_SECRET_PREVIOUS after rotation", async () => {
    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    process.env.SESSION_SECRET_PREVIOUS = ORIGINAL_SECRET;
    process.env.SESSION_SECRET = "rotated-secret-0123456789abcdef0123456789";
    __resetEnvForTests();
    const res = await call<Body>(requireHandler, {
      method: "POST",
      url: "/api/x",
      json: {},
      cookies: { mz_aid: first.cookies.mz_aid.value },
    });
    expect(res.body.anonId).toBe(first.body.anonId);
    // re-issued with the new secret
    expect(res.cookies.mz_aid.value).not.toBe(first.cookies.mz_aid.value);
    expect(verifyAnonCookie(res.cookies.mz_aid.value)).toBe(first.body.anonId);
  });
});

describe("route({ anon: 'optional' | 'none' })", () => {
  it("optional never sets mz_aid, with or without a cookie", async () => {
    const none = await call<Body>(optionalHandler, { url: "/api/x" });
    expect(none.body.anonId).toBeNull();
    expect(none.setCookies).toEqual([]);

    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    const withCookie = await call<Body>(optionalHandler, { url: "/api/x", cookies: { mz_aid: first.cookies.mz_aid.value } });
    expect(withCookie.body.anonId).toBe(first.body.anonId);
    expect(withCookie.setCookies).toEqual([]);

    const tampered = await call<Body>(optionalHandler, { url: "/api/x", cookies: { mz_aid: "garbage.value" } });
    expect(tampered.body.anonId).toBeNull();
    expect(tampered.setCookies).toEqual([]);
  });

  it("none ignores the cookie", async () => {
    const first = await call<Body>(requireHandler, { method: "POST", url: "/api/x", json: {} });
    const res = await call<Body>(noneHandler, { url: "/api/x", cookies: { mz_aid: first.cookies.mz_aid.value } });
    expect(res.body.anonId).toBeNull();
    expect(res.setCookies).toEqual([]);
  });
});

describe("readAnonFromCookies", () => {
  it("verifies only and never issues", () => {
    const id = "6f1c2c1e-6a7b-4c1d-9e0f-1a2b3c4d5e6f";
    const store = new Map([["mz_aid", { value: signAnonId(id) }]]);
    expect(readAnonFromCookies({ get: (n) => store.get(n) })).toBe(id);
    expect(readAnonFromCookies({ get: () => undefined })).toBeNull();
    expect(readAnonFromCookies({ get: () => ({ value: `${id}.forged` }) })).toBeNull();
  });

  it("rejects a correctly signed value that is not a uuid", () => {
    expect(() => signAnonId("not-a-uuid")).toThrow();
  });
});

describe("anon repo", () => {
  it("stores the first valid ref code only and ignores invalid ones", async () => {
    const id = "0b9a3c47-2f6e-4d8a-8b1c-3e5f7a9c1d2e";
    expect(await ensureAnonUser(t.db, id, "nope!")).toBe(true);
    expect((await getAnonUser(t.db, id))?.refCode).toBeNull();
    expect(await ensureAnonUser(t.db, id, "k7q2mx")).toBe(false);
    expect((await getAnonUser(t.db, id))?.refCode).toBe("K7Q2MX");
    await ensureAnonUser(t.db, id, "ABCDEF");
    expect((await getAnonUser(t.db, id))?.refCode).toBe("K7Q2MX");
  });

  it("touchAnonUser bumps an existing row and reports a missing one", async () => {
    const id = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    expect(await touchAnonUser(t.db, id)).toBe(false);
    await ensureAnonUser(t.db, id);
    expect(await touchAnonUser(t.db, id)).toBe(true);
    expect(await touchAnonUser(t.db, "bad")).toBe(false);
    expect(await getAnonUser(t.db, "bad")).toBeNull();
    await expect(ensureAnonUser(t.db, "bad")).rejects.toThrow();
  });
});
