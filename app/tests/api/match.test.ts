import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/buildings/match/route";
import { setAppMeta } from "@/lib/db/meta";
import { normalise } from "@/lib/domain";
import { __aliasRefreshForTests, getAliasRows, invalidateAliasCache } from "@/lib/db/repo/buildings";
import { appMeta, buildingAliases, buildings, sales } from "@/lib/db/schema";
import { matchBuildings } from "@/lib/services/match";
import type { MatchResponse } from "@/lib/types";
import { useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

async function match(query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return call<MatchResponse & { error: { code: string; fields?: Record<string, string> } }>(GET, {
    url: `/api/buildings/match?${qs}`,
  });
}

async function idOf(name: string): Promise<number> {
  const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name));
  return row.id;
}

// A§2.3: query, areaHint → candidate names in order, preselect, towerCheck, strengths
const TABLE: Array<{ q: string; area?: string; names: string[]; strengths: string[]; pre: string | null; tower: boolean }> = [
  { q: "Mockup Crest", area: "Dubai Marina", names: ["Mockup Crest Tower", "Mockup Crest Tower 2"], strengths: ["strong", "strong"], pre: "Mockup Crest Tower", tower: true },
  { q: "Mockup Crest II", names: ["Mockup Crest Tower 2", "Mockup Crest Tower"], strengths: ["strong", "strong"], pre: "Mockup Crest Tower 2", tower: true },
  { q: "Mockup Crest 2", names: ["Mockup Crest Tower 2", "Mockup Crest Tower"], strengths: ["strong", "strong"], pre: "Mockup Crest Tower 2", tower: true },
  { q: "Fake Vista Res.", area: "JVC", names: ["Fake Vista Residences", "Fake Vista Residences 2"], strengths: ["strong", "strong"], pre: "Fake Vista Residences", tower: true },
  { q: "Dummyside Hts 2", area: "Al Jaddaf", names: ["Dummyside Heights 2", "Dummyside Heights 1"], strengths: ["strong", "possible"], pre: "Dummyside Heights 2", tower: true },
  { q: "Dummyside Heights", names: ["Dummyside Heights 1", "Dummyside Heights 2"], strengths: ["possible", "possible"], pre: null, tower: true },
  { q: "Nowhere Point Tower", area: "Dubai Creek Harbour", names: [], strengths: [], pre: null, tower: false },
  { q: "Tower", names: [], strengths: [], pre: null, tower: false },
  { q: "Dubai Mockup Tower", names: ["Mockup Crest Tower"], strengths: ["possible"], pre: null, tower: false },
  { q: "Mockup Crest Twr 1", names: ["Mockup Crest Tower", "Mockup Crest Tower 2"], strengths: ["strong", "possible"], pre: "Mockup Crest Tower", tower: true },
];

describe("GET /api/buildings/match", () => {
  for (const row of TABLE) {
    it(`reproduces A§2.3: "${row.q}"${row.area ? ` in ${row.area}` : ""}`, async () => {
      const query: Record<string, string> = { q: row.q };
      if (row.area) query.area = row.area;
      const res = await match(query);
      expect(res.status).toBe(200);
      const names = res.body.candidates.map((c) => c.name);
      // Equal scores sort by name; the doc lists the two Dummyside towers either way.
      if (row.q === "Dummyside Heights") expect([...names].sort()).toEqual([...row.names].sort());
      else expect(names).toEqual(row.names);
      if (row.q !== "Dummyside Heights") expect(res.body.candidates.map((c) => c.strength)).toEqual(row.strengths);
      expect(res.body.preselectId).toBe(row.pre ? await idOf(row.pre) : null);
      expect(res.body.towerCheck).toBe(row.tower);
      for (const c of res.body.candidates) expect(c.salesForBedrooms).toBeNull();
    });
  }

  it("never exposes a numeric score", async () => {
    const res = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2" });
    for (const c of res.body.candidates) {
      const keys = ["area", "buildingId", "name", "salesForBedrooms", "strength"];
      // Only the preselected candidate carries the size buttons and the sales by basis.
      if (c.buildingId === res.body.preselectId) keys.push("sizes", "basisSales");
      expect(Object.keys(c).sort()).toEqual(keys.sort());
    }
    expect(res.text).not.toMatch(/score/i);
  });

  it("the preselected candidate carries the usual sizes of the same sales (RESULT_SPEC section 2.5)", async () => {
    // Mockup Crest Tower's 11 ready 2-beds: 1,198 x 2, then 1,262 to 1,340 within 3% steps (9 sales,
    // median 1,284, shown as about 1,285). The two 1,198 sales are too few for a button.
    const res = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2" });
    const pre = res.body.candidates.find((c) => c.buildingId === res.body.preselectId);
    expect(pre?.name).toBe("Mockup Crest Tower");
    expect(pre?.sizes).toEqual([{ sqft: 1285, sales: 9 }]);
    // Its sales by basis (the ready or off-plan question): the test sales are all ready.
    expect(pre?.basisSales).toEqual({ ready: 11, offPlan: 0 });
    expect(res.body.candidates.filter((c) => c.basisSales !== undefined)).toHaveLength(1);
    expect(res.body.candidates.filter((c) => c.sizes !== undefined)).toHaveLength(1);
    // No bedrooms, no sizes; no preselect, no sizes; no sales of that type, an empty list.
    expect((await match({ q: "Mockup Crest", area: "Dubai Marina" })).body.candidates.every((c) => c.sizes === undefined)).toBe(true);
    const tie = await match({ q: "Dummyside Heights", beds: "3" });
    expect(tie.body.preselectId).toBeNull();
    expect(tie.body.candidates.every((c) => c.sizes === undefined)).toBe(true);
    const none = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "1" });
    expect(none.body.candidates.find((c) => c.buildingId === none.body.preselectId)?.sizes).toEqual([]);
  });

  it("sizes come from the listing's completion basis and need loaded data", async () => {
    const id = await idOf("Mockup Crest Tower");
    await t.db.insert(sales).values(
      [900, 905, 910].map((sizeSqft) => ({ buildingId: id, saleDate: "2026-11-01", bedrooms: 2, sizeSqft, priceAed: 2_000_000, source: "admin" as const, completion: "off_plan" as const })),
    );
    try {
      const offPlan = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2", completion: "off_plan" });
      expect(offPlan.body.candidates.find((c) => c.buildingId === id)?.sizes).toEqual([{ sqft: 905, sales: 3 }]);
      // Both kinds counted, whichever basis the listing has.
      expect(offPlan.body.candidates.find((c) => c.buildingId === id)?.basisSales).toEqual({ ready: 11, offPlan: 3 });
      const ready = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2" });
      expect(ready.body.candidates.find((c) => c.buildingId === id)?.basisSales).toEqual({ ready: 11, offPlan: 3 });
      await t.db.delete(appMeta).where(eq(appMeta.key, "data_through"));
      const noData = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2" });
      expect(noData.body.candidates.every((c) => c.sizes === undefined)).toBe(true);
    } finally {
      await setAppMeta(t.db, "data_through", "2026-11-17");
      await t.db.delete(sales).where(eq(sales.completion, "off_plan"));
    }
  });

  it("with beds=2, Mockup Crest Tower has salesForBedrooms 11 (and Tower 2 has 4)", async () => {
    const res = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2" });
    const by = Object.fromEntries(res.body.candidates.map((c) => [c.name, c.salesForBedrooms]));
    expect(by["Mockup Crest Tower"]).toBe(11);
    expect(by["Mockup Crest Tower 2"]).toBe(4);
    const one = await match({ q: "Mockup Crest", beds: "1" });
    expect(one.body.candidates.every((c) => c.salesForBedrooms === 0)).toBe(true);
  });

  it("an empty beds or area parameter counts as absent (never Studio)", async () => {
    const res = await match({ q: "Mockup Crest", area: "", beds: "" });
    expect(res.status).toBe(200);
    expect(res.body.candidates.every((c) => c.salesForBedrooms === null)).toBe(true);
  });

  it("validates the query: q 1–120 chars, beds 0–7", async () => {
    expect((await match({ q: "" })).status).toBe(422);
    expect((await match({})).status).toBe(422);
    expect((await match({ q: "x".repeat(121) })).status).toBe(422);
    const bad = await match({ q: "Marina", beds: "9" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("validation_failed");
    expect(bad.body.error.fields?.beds).toBeTruthy();
    expect((await match({ q: "Marina", beds: "two" })).status).toBe(422);
    expect((await match({ q: "x".repeat(120) })).status).toBe(200);
  });

  it("sets no cookie", async () => {
    const res = await match({ q: "Mockup Crest" });
    expect(res.setCookies).toEqual([]);
  });
});

describe("alias cache", () => {
  it("caches for 60 s and invalidateAliasCache() picks up new aliases", async () => {
    invalidateAliasCache();
    const before = await getAliasRows(t.db);
    expect(before).toHaveLength(9);
    const id = await idOf("Mockup Crest Tower 2");
    await t.db.insert(buildingAliases).values({ buildingId: id, aliasRaw: "Crest Two", aliasNorm: normalise("Crest Two"), source: "admin" });
    expect(await getAliasRows(t.db)).toBe(before);
    expect((await matchBuildings(t.db, "Crest Two", null, null, "2026-11-17")).preselectId).not.toBe(id);

    invalidateAliasCache();
    expect(await getAliasRows(t.db)).toHaveLength(10);
    const m = await matchBuildings(t.db, "Crest Two", null, null, "2026-11-17");
    expect(m.preselectId).toBe(id);

    // Expiry after 60 s: the expired rows are served once more while a background refresh runs
    // (no query waits for the database or the matcher's preparation), then the fresh rows are used.
    await t.db.delete(buildingAliases).where(eq(buildingAliases.aliasNorm, normalise("Crest Two")));
    expect(await getAliasRows(t.db)).toHaveLength(10);
    vi.setSystemTime(new Date("2026-11-17T08:01:01Z"));
    try {
      expect(await getAliasRows(t.db)).toHaveLength(10);
      const refresh = __aliasRefreshForTests();
      expect(refresh).not.toBeNull();
      expect(await getAliasRows(t.db)).toHaveLength(10); // one refresh at a time
      expect(__aliasRefreshForTests()).toBe(refresh);
      expect(await refresh).toHaveLength(9);
      expect(await getAliasRows(t.db)).toHaveLength(9);
      expect(__aliasRefreshForTests()).toBeNull();
    } finally {
      vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
    }
  });
});

describe("salesForBedrooms and the completion basis (REAL_DATA.md section 7)", () => {
  it("counts ready sales by default and off-plan sales for an off-plan listing", async () => {
    const id = await idOf("Mockup Crest Tower");
    await t.db.insert(sales).values({ buildingId: id, saleDate: "2026-11-01", bedrooms: 2, sizeSqft: 1300, priceAed: 2_600_000, source: "admin", completion: "off_plan" });
    try {
      const count = async (completion?: string) => {
        const res = await match({ q: "Mockup Crest", area: "Dubai Marina", beds: "2", ...(completion ? { completion } : {}) });
        expect(res.status).toBe(200);
        return Object.fromEntries(res.body.candidates.map((c) => [c.name, c.salesForBedrooms]));
      };
      expect(await count()).toEqual({ "Mockup Crest Tower": 11, "Mockup Crest Tower 2": 4 });
      expect(await count("ready")).toEqual({ "Mockup Crest Tower": 11, "Mockup Crest Tower 2": 4 });
      expect(await count("unknown")).toEqual({ "Mockup Crest Tower": 11, "Mockup Crest Tower 2": 4 });
      expect(await count("off_plan")).toEqual({ "Mockup Crest Tower": 1, "Mockup Crest Tower 2": 0 });
      expect((await match({ q: "Mockup Crest", completion: "villa" })).status).toBe(422);
    } finally {
      await t.db.delete(sales).where(eq(sales.completion, "off_plan"));
    }
  });

  it("counts 0 while no sales data is loaded", async () => {
    await t.db.delete(appMeta).where(eq(appMeta.key, "data_through"));
    try {
      const res = await match({ q: "Mockup Crest", beds: "2" });
      expect(res.body.candidates.length).toBeGreaterThan(0);
      expect(res.body.candidates.every((c) => c.salesForBedrooms === 0)).toBe(true);
    } finally {
      await setAppMeta(t.db, "data_through", "2026-11-17");
    }
  });
});
