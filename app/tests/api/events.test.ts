import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/events/route";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { checkIdForCode, trackEvent } from "@/lib/db/repo/events";
import { checks, events, rateLimits } from "@/lib/db/schema";
import { __setLogSinkForTests } from "@/lib/log";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();

beforeEach(async () => {
  await clearUserData(t.db);
});

async function insertCheck(anonId: string, code: string): Promise<number> {
  await ensureAnonUser(t.db, anonId);
  const [row] = await t.db
    .insert(checks)
    .values({
      code,
      anonId,
      buildingText: "Mockup Crest Tower",
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 2_450_000,
      source: "manual",
      band: "above",
      askingPsf: 1908,
      windowStart: "2025-11-17",
      windowEnd: "2026-11-17",
      minSales: 3,
      bandPct: 5,
    })
    .returning({ id: checks.id });
  return row.id;
}

describe("POST /api/events", () => {
  it("records a client event with 204, issuing mz_aid on first touch", async () => {
    const res = await call(POST, { method: "POST", url: "/api/events", json: { name: "share_whatsapp" } });
    expect(res.status).toBe(204);
    expect(res.cookies.mz_aid).toBeDefined();
    const rows = await t.db.select().from(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "share_whatsapp", checkId: null, meta: {} });
    expect(rows[0].anonId).toBeTruthy();
  });

  it("links the comparison when a known code is sent, and ignores unknown codes", async () => {
    const first = await call(POST, { method: "POST", url: "/api/events", json: { name: "link_copied" } });
    const cookie = first.cookies.mz_aid.value;
    const anonId = (await t.db.select().from(events))[0].anonId as string;
    const id = await insertCheck(anonId, "K7Q2MX");

    await call(POST, { method: "POST", url: "/api/events", json: { name: "card_downloaded", code: "K7Q2MX" }, cookies: { mz_aid: cookie } });
    await call(POST, { method: "POST", url: "/api/events", json: { name: "card_downloaded", code: "ABCDEF" }, cookies: { mz_aid: cookie } });
    const rows = await t.db.select().from(events).where(eq(events.name, "card_downloaded"));
    expect(rows.map((r) => r.checkId).sort()).toEqual([id, null].sort());
  });

  it("rejects unknown and server-only names with 400, and never takes meta from the client", async () => {
    const unknown = await call<{ error: { code: string } }>(POST, { method: "POST", url: "/api/events", json: { name: "hack" } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("bad_request");
    const serverOnly = await call(POST, { method: "POST", url: "/api/events", json: { name: "lead_created" } });
    expect(serverOnly.status).toBe(400);
    const badCode = await call(POST, { method: "POST", url: "/api/events", json: { name: "cost_opened", code: "nope" } });
    expect(badCode.status).toBe(400);

    const withMeta = await call(POST, {
      method: "POST",
      url: "/api/events",
      json: { name: "cost_opened", meta: { phone: "+971501234567" } },
    });
    expect(withMeta.status).toBe(204);
    const row = (await t.db.select().from(events).where(eq(events.name, "cost_opened")))[0];
    expect(row.meta).toEqual({});
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST, { method: "POST", url: "/api/events", json: { name: "cost_opened" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await t.db.select().from(events)).toHaveLength(0);
  });

  it("allows 300 events per day per anon, then 429", async () => {
    const first = await call(POST, { method: "POST", url: "/api/events", json: { name: "link_copied" } });
    const cookie = first.cookies.mz_aid.value;
    const anonId = (await t.db.select().from(events))[0].anonId as string;
    await t.db.update(rateLimits).set({ count: 300 }).where(eq(rateLimits.key, `events:anon:${anonId}`));
    const res = await call<{ error: { code: string; retryAfterSec: number; message: string } }>(POST, {
      method: "POST",
      url: "/api/events",
      json: { name: "link_copied" },
      cookies: { mz_aid: cookie },
    });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.body.error.retryAfterSec).toBeGreaterThan(0);
    expect(res.body.error.message).toBe("Too many requests from this browser. Wait a minute and try again.");
  });
});

describe("events repo", () => {
  it("trackEvent never throws (bad anon reference is logged, not raised)", async () => {
    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "info";
    try {
      await expect(
        trackEvent(t.db, { name: "saved", anonId: "6f1c2c1e-6a7b-4c1d-9e0f-1a2b3c4d5e6f" }),
      ).resolves.toBeUndefined();
      expect(lines.join("\n")).toContain("event_track_failed");
    } finally {
      __setLogSinkForTests(null);
      process.env.LOG_LEVEL = "error";
    }
    await trackEvent(t.db, { name: "data_deleted", anonId: "not-a-uuid", meta: { n: 1 } });
    const row = (await t.db.select().from(events).where(eq(events.name, "data_deleted")))[0];
    expect(row).toMatchObject({ anonId: null, meta: { n: 1 } });
  });

  it("checkIdForCode ignores malformed codes", async () => {
    expect(await checkIdForCode(t.db, "nope")).toBeNull();
    expect(await checkIdForCode(t.db, null)).toBeNull();
    expect(await checkIdForCode(t.db, "ZZZZZZ")).toBeNull();
  });
});
