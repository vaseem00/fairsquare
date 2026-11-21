import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as POST_CHECK } from "@/app/api/checks/route";
import { GET as GET_ME } from "@/app/api/me/route";
import { DELETE as DELETE_SAVED } from "@/app/api/saved/[code]/route";
import { POST as POST_SEEN } from "@/app/api/saved/[code]/seen/route";
import { GET as GET_SAVED, POST as POST_SAVED } from "@/app/api/saved/route";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { getCheckRowByCode } from "@/lib/db/repo/checks";
import { listSaved, markSeen, saveCheck, unsaveCheck } from "@/lib/db/repo/saved";
import { appMeta, buildings, events, sales, savedListings } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { addDays, dubaiToday } from "@/lib/domain/dates";
import type { CheckView, MeView, SavedItemView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

/**
 * These tests run on the real clock, seeded for the real Dubai day. "New since you saved" compares
 * `created_at` timestamps written by the database's now(), and PGlite's clock follows JS Date: faking
 * Date would freeze now() and make every row look recorded at the same instant.
 */
const TODAY = dubaiToday();
const t = setupTestDb({ today: TODAY });

beforeEach(async () => {
  await clearUserData(t.db);
});

type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type ItemRes = { item: SavedItemView } & ErrBody;
type ListRes = { items: SavedItemView[] };

const MARINA = { buildingText: "Mockup Crest Tower", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

async function buildingId(name: string): Promise<number> {
  const [b] = await t.db.select().from(buildings).where(eq(buildings.name, name));
  return b.id;
}

/** A Marina comparison; returns its code and the cookie of the person who made it. */
async function marinaCheck(source: "manual" | "text" = "manual", cookie?: string, completion?: "ready" | "off_plan") {
  const res = await call<{ check: CheckView }>(POST_CHECK, {
    method: "POST",
    url: "/api/checks",
    json: { fields: MARINA, buildingId: await buildingId("Mockup Crest Tower"), source, ...(completion ? { completion } : {}) },
    cookies: cookie ? { mz_aid: cookie } : undefined,
  });
  expect(res.status).toBe(201);
  return { code: res.body.check.code, cookie: cookie ?? res.cookies.mz_aid.value };
}

function save(code: string, cookie?: string) {
  return call<ItemRes>(POST_SAVED, { method: "POST", url: "/api/saved", json: { code }, cookies: cookie ? { mz_aid: cookie } : undefined });
}
function list(cookie?: string) {
  return call<ListRes>(GET_SAVED, { url: "/api/saved", cookies: cookie ? { mz_aid: cookie } : undefined });
}
function me(cookie?: string) {
  return call<MeView>(GET_ME, { url: "/api/me", cookies: cookie ? { mz_aid: cookie } : undefined });
}
function remove(code: string, cookie: string) {
  return call(DELETE_SAVED, { method: "DELETE", url: `/api/saved/${code}`, params: { code }, cookies: { mz_aid: cookie } });
}
function seen(code: string, cookie: string) {
  return call<ErrBody>(POST_SEEN, { method: "POST", url: `/api/saved/${code}/seen`, params: { code }, cookies: { mz_aid: cookie } });
}

/** An admin-registered Mockup Crest Tower 2-bed sale dated today (recorded now). */
async function addAdminSale(saleDate = TODAY, completion: "ready" | "off_plan" = "ready") {
  // PGlite's now() follows the JS clock: make sure the sale is recorded strictly after the save.
  await new Promise((r) => setTimeout(r, 20));
  await t.db.insert(sales).values({
    buildingId: await buildingId("Mockup Crest Tower"),
    saleDate,
    bedrooms: 2,
    sizeSqft: 1300,
    priceAed: 2_400_000,
    source: "admin",
    completion,
  });
}

describe("POST /api/saved", () => {
  it("is idempotent: 201 then 200 with the same item, one row", async () => {
    const { code, cookie } = await marinaCheck();
    const first = await save(code, cookie);
    expect(first.status).toBe(201);
    expect(first.body.item).toMatchObject({
      code,
      building: { name: "Mockup Crest Tower", area: "Dubai Marina" },
      bedrooms: 2,
      priceAed: 2_450_000,
      atSave: { band: "above", count: 11 },
      now: { band: "above", count: 11 },
      newSalesSinceSave: 0,
      unseenNewSales: 0,
    });
    expect(first.body.item.atSave.diff).toBeCloseTo(0.1395, 3);

    const second = await save(code, cookie);
    expect(second.status).toBe(200);
    expect(second.body.item).toEqual(first.body.item);
    expect(await t.db.select().from(savedListings)).toHaveLength(1);
    expect(await t.db.select().from(events).where(eq(events.name, "saved"))).toHaveLength(1);
  });

  it("lets a person save someone else's comparison (a shared card)", async () => {
    const { code } = await marinaCheck();
    const res = await save(code);
    expect(res.status).toBe(201);
    expect(res.cookies.mz_aid).toBeDefined();
  });

  it("an unknown code → 404; a malformed code → 422", async () => {
    const { cookie } = await marinaCheck("text");
    const unknown = await save("ZZZZZZ", cookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
    expect((await save("nope", cookie)).status).toBe(422);
    expect(await t.db.select().from(savedListings)).toHaveLength(0);
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code: "ABCDEF" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/saved/[code] and Undo", () => {
  it("remove → 204 and the item leaves GET; saving again → 200 with the original savedAt and atSave", async () => {
    const { code, cookie } = await marinaCheck();
    const saved = await save(code, cookie);
    const res = await remove(code, cookie);
    expect(res.status).toBe(204);
    expect((await list(cookie)).body.items).toEqual([]);
    expect(await t.db.select().from(events).where(eq(events.name, "unsaved"))).toHaveLength(1);

    // Idempotent
    expect((await remove(code, cookie)).status).toBe(204);
    expect((await remove("ZZZZZZ", cookie)).status).toBe(204);
    expect(await t.db.select().from(events).where(eq(events.name, "unsaved"))).toHaveLength(1);

    // A sale arrives while it is removed: the restored baseline still is the original one.
    await addAdminSale();
    const undo = await save(code, cookie);
    expect(undo.status).toBe(200);
    expect(undo.body.item.savedAt).toBe(saved.body.item.savedAt);
    expect(undo.body.item.atSave).toEqual(saved.body.item.atSave);
    expect(undo.body.item.now.count).toBe(12);
    expect(undo.body.item.newSalesSinceSave).toBe(1);
    expect((await list(cookie)).body.items.map((i) => i.code)).toEqual([code]);
    expect(await t.db.select().from(savedListings)).toHaveLength(1);
  });
});

describe("GET /api/saved", () => {
  it("with no cookie: empty items and no Set-Cookie (GET /api/me likewise)", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.setCookies).toEqual([]);
    const m = await me();
    expect(m.status).toBe(200);
    expect(m.body).toEqual({ savedCount: 0, savedWithNewSales: 0, checksCount: 0, requests: [], leads: [] });
    expect(m.setCookies).toEqual([]);
  });

  it("lists newest first", async () => {
    const a = await marinaCheck();
    await save(a.code, a.cookie);
    const b = await marinaCheck("manual", a.cookie);
    await save(b.code, a.cookie);
    expect((await list(a.cookie)).body.items.map((i) => i.code)).toEqual([b.code, a.code]);
  });
});

describe("new sales since saving", () => {
  it("an admin sale gives newSalesSinceSave 1 and the badge 1; Open clears the badge only", async () => {
    const { code, cookie } = await marinaCheck();
    await save(code, cookie);
    expect((await me(cookie)).body.savedWithNewSales).toBe(0);

    await addAdminSale();
    const items = (await list(cookie)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ newSalesSinceSave: 1, unseenNewSales: 1, now: { count: 12 }, atSave: { count: 11 } });
    expect((await me(cookie)).body).toMatchObject({ savedCount: 1, savedWithNewSales: 1 });

    const opened = await seen(code, cookie);
    expect(opened.status).toBe(204);
    expect((await me(cookie)).body.savedWithNewSales).toBe(0);
    const after = (await list(cookie)).body.items[0];
    expect(after).toMatchObject({ newSalesSinceSave: 1, unseenNewSales: 0 });
  });

  it("a sale dated outside the window does not count", async () => {
    const { code, cookie } = await marinaCheck();
    await save(code, cookie);
    await addAdminSale(addDays(TODAY, -400));
    expect((await list(cookie)).body.items[0]).toMatchObject({ newSalesSinceSave: 0, unseenNewSales: 0 });
    expect((await me(cookie)).body.savedWithNewSales).toBe(0);
  });

  it("only sales of the comparison's completion basis count (REAL_DATA.md section 7)", async () => {
    const ready = await marinaCheck();
    const offPlan = await marinaCheck("manual", ready.cookie, "off_plan");
    await save(ready.code, ready.cookie);
    await save(offPlan.code, ready.cookie);
    await addAdminSale(TODAY, "off_plan");
    const items = (await list(ready.cookie)).body.items;
    expect(items.find((i) => i.code === ready.code)).toMatchObject({ newSalesSinceSave: 0, now: { count: 11 } });
    expect(items.find((i) => i.code === offPlan.code)).toMatchObject({ newSalesSinceSave: 1, unseenNewSales: 1, now: { count: 1 } });
    expect((await me(ready.cookie)).body.savedWithNewSales).toBe(1);
  });

  it("a sale after data_through waits for the next snapshot (the window ends at data_through)", async () => {
    const { code, cookie } = await marinaCheck();
    await save(code, cookie);
    await t.db.update(appMeta).set({ value: addDays(TODAY, -1) }).where(eq(appMeta.key, "data_through"));
    try {
      await addAdminSale(TODAY);
      expect((await list(cookie)).body.items[0]).toMatchObject({ newSalesSinceSave: 0 });
      expect((await me(cookie)).body.savedWithNewSales).toBe(0);
    } finally {
      await t.db.update(appMeta).set({ value: TODAY }).where(eq(appMeta.key, "data_through"));
    }
    expect((await list(cookie)).body.items[0]).toMatchObject({ newSalesSinceSave: 1 });
  });

  it("a removed item never counts toward savedWithNewSales", async () => {
    const { code, cookie } = await marinaCheck();
    await save(code, cookie);
    await addAdminSale();
    expect((await me(cookie)).body.savedWithNewSales).toBe(1);
    await remove(code, cookie);
    expect((await me(cookie)).body).toMatchObject({ savedCount: 0, savedWithNewSales: 0 });
  });

  it("seen: an unknown, unsaved or removed code → 404", async () => {
    const { code, cookie } = await marinaCheck();
    expect((await seen(code, cookie)).status).toBe(404);
    expect((await seen("ZZZZZZ", cookie)).body.error.code).toBe("not_found");
    await save(code, cookie);
    expect((await seen(code, cookie)).status).toBe(204);
    await remove(code, cookie);
    expect((await seen(code, cookie)).status).toBe(404);
  });

});

describe("saved repo", () => {
  it("saveCheck outcomes, unsaveCheck and markSeen", async () => {
    const { code } = await marinaCheck();
    const anon = "4f9a5d88-6e71-4293-8e3f-4a5b6c7d8e9f";
    await ensureAnonUser(t.db, anon);
    const row = await getCheckRowByCode(t.db, code);
    if (!row) throw new Error("no row");
    expect((await saveCheck(t.db, anon, row, TODAY, DEFAULT_RULES)).outcome).toBe("created");
    expect((await saveCheck(t.db, anon, row, TODAY, DEFAULT_RULES)).outcome).toBe("existing");
    expect(await unsaveCheck(t.db, anon, code.toLowerCase())).toBe(row.id);
    expect(await unsaveCheck(t.db, anon, code)).toBeNull();
    expect(await markSeen(t.db, anon, code)).toBe(false);
    expect((await saveCheck(t.db, anon, row, TODAY, DEFAULT_RULES)).outcome).toBe("restored");
    expect(await markSeen(t.db, anon, ` ${code.toLowerCase()} `)).toBe(true);
    const rows = await t.db
      .select()
      .from(savedListings)
      .where(and(eq(savedListings.anonId, anon), eq(savedListings.checkId, row.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].removedAt).toBeNull();
    expect(await listSaved(t.db, "5a0b6e99-7f82-43a4-9f40-5b6c7d8e9f0a", TODAY, DEFAULT_RULES)).toEqual([]);
  });
});
