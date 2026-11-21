/**
 * GET /api/admin/stats (A§4.4 AdminStats): the 7/30/90-day ranges change the numbers; the funnel
 * matches a seeded fixture; shares sum the four share events;
 * checksFromShares counts ref_code; kFactor is their ratio (null with no checks); Quality numbers
 * (editedFieldRate, extractFailByCode incl. rate_limited and image_rejected, medianReadMs, freshness).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/stats/route";
import type { AdminStats } from "@/lib/validation/admin";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { addAnon, addCheck, addEvent, addLead, addRequest, adminCookies, daysAgo, NOW, pinClock } from "./admin-helpers";

const t = setupTestDb();
let cookies: Record<string, string>;

async function stats(range?: string): Promise<AdminStats> {
  const res = await call<AdminStats>(GET, { url: `/api/admin/stats${range ? `?range=${range}` : ""}`, cookies });
  expect(res.status).toBe(200);
  return res.body;
}

beforeEach(() => pinClock());
afterEach(() => vi.useRealTimers());

describe("with no activity", () => {
  beforeAll(async () => {
    pinClock();
    await clearUserData(t.db);
    cookies = await adminCookies(t.db);
    vi.useRealTimers();
  });

  it("returns zeros, kFactor null and no median read time", async () => {
    const s = await stats("7");
    expect(s.range).toBe(7);
    expect(s.funnel).toMatchObject({ checks: 0, checksFromShares: 0, shares: 0, newVisitors: 0, kFactor: null });
    expect(s.medianReadMs).toBeNull();
    expect(s.perDay).toHaveLength(7);
    expect(s.perDay.every((d) => d.checks === 0 && d.extractFail === 0)).toBe(true);
    expect(s.editedFieldRate).toEqual({ buildingText: 0, areaText: 0, bedrooms: 0, sizeSqft: 0, priceAed: 0 });
    expect(s.verdicts).toEqual({ above: 0, inline: 0, below: 0, thin: 0, none: 0 });
  });
});

describe("with a seeded fixture", () => {
  beforeAll(async () => {
    pinClock();
    await clearUserData(t.db);
    cookies = await adminCookies(t.db);
    const db = t.db;
    const a = await addAnon(db, daysAgo(2));
    const b = await addAnon(db, daysAgo(20));
    const c = await addAnon(db, daysAgo(60));

    const c1 = await addCheck(db, { anonId: a, band: "above", source: "claude", editedFields: ["bedrooms"] });
    await addCheck(db, { anonId: a, createdAt: daysAgo(1), band: "inline", source: "claude", refCode: "ABCDEF" });
    await addCheck(db, { anonId: b, createdAt: daysAgo(10), band: "thin", source: "manual", refCode: "ABCDEF" });
    await addCheck(db, { anonId: c, createdAt: daysAgo(50), band: "none", source: "claude", editedFields: ["buildingText", "priceAed"] });

    await addEvent(db, "extract_ok", { meta: { ms: 4000 } });
    await addEvent(db, "extract_ok", { createdAt: daysAgo(2), meta: { ms: 6000 } });
    await addEvent(db, "extract_ok", { createdAt: daysAgo(40), meta: { ms: 9000 } });
    await addEvent(db, "extract_fail", { meta: { code: "rate_limited", ms: 3 } });
    await addEvent(db, "extract_fail", { createdAt: daysAgo(3), meta: { code: "image_rejected", ms: 40 } });
    await addEvent(db, "extract_fail", { createdAt: daysAgo(20), meta: { code: "extract_refused", ms: 9000 } });
    for (const name of ["share_native", "share_whatsapp", "link_copied", "card_downloaded"]) {
      await addEvent(db, name, { checkId: c1.id });
    }
    await addEvent(db, "card_viewed", { checkId: c1.id });
    await addEvent(db, "card_viewed", { checkId: c1.id });
    await addEvent(db, "cost_opened", { checkId: c1.id });
    await addEvent(db, "card_viewed", { createdAt: daysAgo(100), checkId: c1.id }); // outside 90 days

    await addLead(db, { anonId: a, checkId: c1.id });
    await addLead(db, { anonId: b, createdAt: daysAgo(15), status: "withdrawn", withdrawnAt: daysAgo(2), name: null, phone: null });

    await addRequest(db, { anonId: a, text: "Nowhere Point Tower", area: "Dubai Creek Harbour" });
    await addRequest(db, { anonId: b, text: "Nowhere Point Twr", createdAt: daysAgo(10) });
    await addRequest(db, { anonId: c, text: "Bay View", createdAt: daysAgo(40) });
    vi.useRealTimers();
  });

  it("7 days: funnel, kFactor, verdicts and per-day", async () => {
    const s = await stats("7");
    expect(s.funnel).toEqual({
      newVisitors: 1,
      extractOk: 2,
      extractFail: 2,
      checks: 2,
      checksFromShares: 1,
      shares: 4,
      cardViews: 2,
      costOpened: 1,
      leads: 1,
      leadsWithdrawn: 1,
      kFactor: 0.5,
    });
    expect(s.verdicts).toEqual({ above: 1, inline: 1, below: 0, thin: 0, none: 0 });
    expect(s.perDay.map((d) => d.date)).toEqual([
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
    ]);
    expect(s.perDay.find((d) => d.date === "2026-11-17")).toEqual({ date: "2026-11-17", checks: 1, extractFail: 1 });
    expect(s.perDay.find((d) => d.date === "2026-11-16")).toEqual({ date: "2026-11-16", checks: 1, extractFail: 0 });
    expect(s.perDay.find((d) => d.date === "2026-11-14")).toEqual({ date: "2026-11-14", checks: 0, extractFail: 1 });
  });

  it("7 days: Quality numbers", async () => {
    const s = await stats("7");
    expect(s.extractFailByCode).toEqual({ rate_limited: 1, image_rejected: 1 });
    expect(s.medianReadMs).toBe(5000);
    expect(s.editedFieldBase).toBe(2);
    expect(s.editedFieldRate).toEqual({ buildingText: 0, areaText: 0, bedrooms: 0.5, sizeSqft: 0, priceAed: 0 });
  });

  it("30 days changes the numbers", async () => {
    const s = await stats("30");
    expect(s.range).toBe(30);
    expect(s.funnel).toMatchObject({ newVisitors: 2, checks: 3, checksFromShares: 2, extractFail: 3, leads: 2, leadsWithdrawn: 1 });
    expect(s.funnel.kFactor).toBeCloseTo(2 / 3, 10);
    expect(s.verdicts).toMatchObject({ above: 1, inline: 1, thin: 1, none: 0 });
    expect(s.extractFailByCode).toEqual({ rate_limited: 1, image_rejected: 1, extract_refused: 1 });
    expect(s.perDay).toHaveLength(30);
    expect(s.topRequests).toEqual([{ text: "Nowhere Point Tower", count: 2, resolved: false }]);
  });

  it("90 days changes them again", async () => {
    const s = await stats("90");
    expect(s.funnel).toMatchObject({ newVisitors: 3, checks: 4, extractOk: 3, cardViews: 2 });
    expect(s.verdicts.none).toBe(1);
    expect(s.medianReadMs).toBe(6000);
    expect(s.editedFieldBase).toBe(3);
    expect(s.editedFieldRate.buildingText).toBeCloseTo(1 / 3, 10);
    expect(s.editedFieldRate.sizeSqft).toBe(0);
    expect(s.topRequests.map((r) => r.text)).toEqual(["Nowhere Point Tower", "Bay View"]);
    expect(s.perDay).toHaveLength(90);
  });

  it("an unknown range falls back to 30 days", async () => {
    expect((await stats("12")).range).toBe(30);
    expect((await stats()).range).toBe(30);
  });

  it("freshness lists the latest sale per building and bedroom count", async () => {
    const s = await stats("7");
    const marina = s.freshness.find((f) => f.name === "Mockup Crest Tower" && f.bedrooms === 2);
    expect(marina).toMatchObject({ sales12m: 11 });
    expect(marina?.latestSaleDate).toMatch(/^2026-1[01]-\d\d$/);
    const thin = s.freshness.find((f) => f.name === "Dummyside Heights 2" && f.bedrooms === 3);
    expect(thin?.sales12m).toBe(2);
    expect(s.freshness.length).toBe(6);
    expect(s.freshnessTotal).toBe(6);
    // By building name, then bedrooms.
    expect(s.freshness.map((f) => f.name)).toEqual([...s.freshness.map((f) => f.name)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it("the clock used is the Dubai day", () => {
    expect(NOW.toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });
});
