import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimits } from "@/lib/db/schema";
import { HttpError } from "@/lib/http/errors";
import { __resetRateLimitForTests, enforce, hit, pruneRateLimits, windowBounds } from "@/lib/rate-limit";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";

const t = setupTestDb({ seed: false });

beforeEach(async () => {
  await clearUserData(t.db);
  __resetRateLimitForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z")); // 12:00 in Dubai
});
afterEach(() => vi.useRealTimers());

describe("windowBounds", () => {
  it("day is the Dubai calendar day", () => {
    const { start, end } = windowBounds("day", Date.parse("2026-11-17T08:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-16T20:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-17T20:00:00.000Z");
    // 21:00 UTC is already the next Dubai day
    expect(windowBounds("day", Date.parse("2026-11-17T21:00:00Z")).start.toISOString()).toBe("2026-11-17T20:00:00.000Z");
  });

  it("hour and 15m are clock-aligned", () => {
    const now = Date.parse("2026-11-17T08:37:12Z");
    expect(windowBounds("hour", now).start.toISOString()).toBe("2026-11-17T08:00:00.000Z");
    expect(windowBounds("15m", now).start.toISOString()).toBe("2026-11-17T08:30:00.000Z");
    expect(windowBounds("15m", now).end.toISOString()).toBe("2026-11-17T08:45:00.000Z");
  });
});

describe("hit", () => {
  it("day window: calls 1–20 pass, the 21st is denied until Dubai midnight", async () => {
    for (let i = 1; i <= 20; i++) {
      const r = await hit(t.db, "extract:anon:a", 20, "day");
      expect(r.allowed, `call ${i}`).toBe(true);
      expect(r.count).toBe(i);
    }
    const denied = await hit(t.db, "extract:anon:a", 20, "day");
    expect(denied).toEqual({ allowed: false, count: 21, limit: 20, retryAfterSec: 12 * 3600 });

    // other keys are independent
    expect((await hit(t.db, "extract:anon:b", 20, "day")).allowed).toBe(true);

    // still the same Dubai day one second before midnight
    vi.setSystemTime(new Date("2026-11-17T19:59:59Z"));
    const late = await hit(t.db, "extract:anon:a", 20, "day");
    expect(late.allowed).toBe(false);
    expect(late.retryAfterSec).toBe(1);

    // the next Dubai day allows calls again
    vi.setSystemTime(new Date("2026-11-17T20:00:00Z"));
    const next = await hit(t.db, "extract:anon:a", 20, "day");
    expect(next).toMatchObject({ allowed: true, count: 1 });
  });

  it("15-minute burst window behaves the same way", async () => {
    vi.setSystemTime(new Date("2026-11-17T08:05:00Z"));
    for (let i = 1; i <= 6; i++) expect((await hit(t.db, "extract:anon-burst:a", 6, "15m")).allowed).toBe(true);
    const denied = await hit(t.db, "extract:anon-burst:a", 6, "15m");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(10 * 60);
    vi.setSystemTime(new Date("2026-11-17T08:15:00Z"));
    expect(await hit(t.db, "extract:anon-burst:a", 6, "15m")).toMatchObject({ allowed: true, count: 1 });
  });

  it("hour window", async () => {
    expect((await hit(t.db, "h", 1, "hour")).allowed).toBe(true);
    const d = await hit(t.db, "h", 1, "hour");
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSec).toBe(3600);
  });

  it("counts concurrent calls atomically", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => hit(t.db, "burst", 100, "day")));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("prunes expired rows", async () => {
    await hit(t.db, "old", 5, "15m");
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    await hit(t.db, "new", 5, "15m");
    expect(await pruneRateLimits(t.db, new Date())).toBe(1);
    const keys = (await t.db.select().from(rateLimits)).map((r) => r.key);
    expect(keys).toEqual(["new"]);
  });

  it("prunes on about every 500th call", async () => {
    await hit(t.db, "stale", 5, "15m");
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    for (let i = 0; i < 498; i++) await hit(t.db, "busy", 10_000, "day");
    expect((await t.db.select().from(rateLimits)).some((r) => r.key === "stale")).toBe(true);
    await hit(t.db, "busy", 10_000, "day");
    expect((await t.db.select().from(rateLimits)).some((r) => r.key === "stale")).toBe(false);
  });
});

describe("enforce", () => {
  it("passes within limits and counts every rule", async () => {
    await enforce(t.db, [
      { key: "a", limit: 2, window: "day", onDeny: "rate_limited", scope: "extract_daily" },
      { key: "b", limit: 2, window: "day", onDeny: "rate_limited", scope: "extract_daily" },
    ]);
    const rows = await t.db.select().from(rateLimits);
    expect(rows.map((r) => [r.key, r.count]).sort()).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("throws 429 rate_limited with the scope's message and retryAfterSec; the denying key counts, later keys do not", async () => {
    const rules = [
      { key: "burst", limit: 1, window: "15m" as const, onDeny: "rate_limited" as const, scope: "extract_burst" },
      { key: "global", limit: 100, window: "day" as const, onDeny: "daily_cap_reached" as const, scope: "spam" },
    ];
    await enforce(t.db, rules);
    const err = await enforce(t.db, rules).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const he = err as HttpError;
    expect(he.status).toBe(429);
    expect(he.code).toBe("rate_limited");
    expect(he.scope).toBe("extract_burst");
    expect(he.retryAfterSec).toBe(15 * 60);
    const rows = await t.db.select().from(rateLimits);
    expect(rows.find((r) => r.key === "burst")?.count).toBe(2);
    expect(rows.find((r) => r.key === "global")?.count).toBe(1);
  });

  it("requests already denied by a narrow rule never use up the shared global key", async () => {
    const rules = [
      { key: "burst:x", limit: 1, window: "15m" as const, onDeny: "rate_limited" as const, scope: "extract_burst" },
      { key: "global", limit: 5, window: "day" as const, onDeny: "daily_cap_reached" as const, scope: "extract_daily" },
    ];
    await enforce(t.db, rules);
    for (let i = 0; i < 20; i++) await expect(enforce(t.db, rules)).rejects.toMatchObject({ code: "rate_limited" });
    const global = (await t.db.select().from(rateLimits)).find((r) => r.key === "global");
    expect(global?.count).toBe(1);
    // Someone else still gets through.
    await enforce(t.db, [{ ...rules[0], key: "burst:y" }, rules[1]]);
  });

  it("uses the deny code's status (daily cap → 503)", async () => {
    const rules = [{ key: "cap", limit: 1, window: "day" as const, onDeny: "daily_cap_reached" as const, scope: "spam" }];
    await enforce(t.db, rules);
    const err = (await enforce(t.db, rules).catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(503);
    expect(err.code).toBe("daily_cap_reached");
  });
});
