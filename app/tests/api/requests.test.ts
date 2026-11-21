import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POST_CHECK } from "@/app/api/checks/route";
import { POST } from "@/app/api/requests/route";
import { ensureAnonUser } from "@/lib/db/repo/anon";
import { countOthersAsked, listRequestsForAnon, requestTextNorm, upsertRequest } from "@/lib/db/repo/requests";
import { buildingRequests, buildings, checks, events, rateLimits } from "@/lib/db/schema";
import type { BuildingRequestResponse, CheckView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await clearUserData(t.db);
});

type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type ReqRes = BuildingRequestResponse & ErrBody;

const HARBOUR = { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 };

/** A not-covered comparison; returns its code and the cookie of the person who made it. */
async function noneCheck(source: "manual" | "text" = "manual", cookie?: string) {
  const res = await call<{ check: CheckView }>(POST_CHECK, {
    method: "POST",
    url: "/api/checks",
    json: { fields: HARBOUR, buildingId: null, source },
    cookies: cookie ? { mz_aid: cookie } : undefined,
  });
  expect(res.status).toBe(201);
  return { code: res.body.check.code, cookie: cookie ?? res.cookies.mz_aid.value };
}

function postRequest(json: unknown, cookie?: string) {
  return call<ReqRes>(POST, { method: "POST", url: "/api/requests", json, cookies: cookie ? { mz_aid: cookie } : undefined });
}

describe("POST /api/requests", () => {
  it("with a comparison code: 201, one none_of_these row linked to the check with its area; a repeat → 200 same id", async () => {
    const { code, cookie } = await noneCheck();
    expect(await t.db.select().from(buildingRequests)).toHaveLength(0);

    const res = await postRequest({ text: "Nowhere Point Tower", code }, cookie);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: true, othersAsked: 0 });

    const rows = await t.db.select().from(buildingRequests);
    expect(rows).toHaveLength(1);
    const [check] = await t.db.select().from(checks).where(eq(checks.code, code));
    expect(rows[0]).toMatchObject({
      id: res.body.id,
      source: "none_of_these",
      checkId: check.id,
      areaText: "Dubai Creek Harbour",
      textRaw: "Nowhere Point Tower",
      textNorm: "nowhere point tower",
      anonId: check.anonId,
    });
    expect(await t.db.select().from(events).where(eq(events.name, "request_created"))).toHaveLength(1);

    const again = await postRequest({ text: "nowhere point twr", code }, cookie);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: res.body.id, created: false, othersAsked: 0 });
    expect(await t.db.select().from(buildingRequests)).toHaveLength(1);
    expect(await t.db.select().from(events).where(eq(events.name, "request_created"))).toHaveLength(1);
  });

  it("an explicit area wins over the comparison's", async () => {
    const { code, cookie } = await noneCheck();
    await postRequest({ text: "Nowhere Point Tower", area: "Creek Harbour", code }, cookie);
    const [row] = await t.db.select().from(buildingRequests);
    expect(row.areaText).toBe("Creek Harbour");
  });

  it("an unknown code → 404 not_found; a malformed code → 422", async () => {
    const unknown = await postRequest({ text: "Nowhere Point Tower", code: "ZZZZZZ" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
    const malformed = await postRequest({ text: "Nowhere Point Tower", code: "nope" });
    expect(malformed.status).toBe(422);
    expect(await t.db.select().from(buildingRequests)).toHaveLength(0);
  });

  it("a comparison from pasted text files a request like any other (samples are gone)", async () => {
    const { code, cookie } = await noneCheck("text");
    const res = await postRequest({ text: "Nowhere Point Tower", code }, cookie);
    expect(res.status).toBe(201);
    expect(await t.db.select().from(buildingRequests)).toHaveLength(1);
  });

  it("without a code (Coverage form): source request_form, issuing mz_aid on first touch", async () => {
    const res = await postRequest({ text: "Bay View Residences", area: "Business Bay" });
    expect(res.status).toBe(201);
    expect(res.cookies.mz_aid).toBeDefined();
    const [row] = await t.db.select().from(buildingRequests);
    expect(row).toMatchObject({ source: "request_form", checkId: null, areaText: "Business Bay", textNorm: "bay view residences" });
  });

  it("validates text: 3–120 characters", async () => {
    const short = await postRequest({ text: "ab" });
    expect(short.status).toBe(422);
    expect(short.body.error.fields?.text).toBeTruthy();
    expect((await postRequest({ text: "x".repeat(121) })).status).toBe(422);
    expect((await postRequest({})).status).toBe(422);
  });

  it("othersAsked counts other people's rows with the same text_norm, including cleared anon ids", async () => {
    const a = await postRequest({ text: "Nowhere Point Tower" });
    const b = await postRequest({ text: "Nowhere Point Twr." });
    expect(b.body.othersAsked).toBe(1);
    // "Delete all my data" clears anon_id but keeps the row
    await t.db.update(buildingRequests).set({ anonId: null }).where(eq(buildingRequests.id, a.body.id));
    const c = await postRequest({ text: "nowhere point tower" });
    expect(c.status).toBe(201);
    expect(c.body.othersAsked).toBe(2);
    const bAgain = await postRequest({ text: "Nowhere Point Tower" }, b.cookies.mz_aid.value);
    expect(bAgain.body).toMatchObject({ id: b.body.id, created: false, othersAsked: 2 });
    // a different building does not count
    const d = await postRequest({ text: "Other Tower Name" });
    expect(d.body.othersAsked).toBe(0);
  });

  it("allows 20 requests per Dubai day, the 21st → 429", async () => {
    const first = await postRequest({ text: "Building Number One" });
    const cookie = first.cookies.mz_aid.value;
    const [row] = await t.db.select().from(buildingRequests);
    await t.db.update(rateLimits).set({ count: 19 }).where(eq(rateLimits.key, `requests:anon:${row.anonId}`));
    expect((await postRequest({ text: "Building Number Two" }, cookie)).status).toBe(201);
    const res = await postRequest({ text: "Building Number Three" }, cookie);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(await t.db.select().from(buildingRequests)).toHaveLength(2);
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST, { method: "POST", url: "/api/requests", json: { text: "Nowhere Point" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("requests repo", () => {
  const ME = "0b5c1f44-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
  const OTHER = "1c6d2a55-3b4e-4f60-9b0c-1d2e3f4a5b6c";

  it("listRequestsForAnon: one view per text_norm, newest first, covered after resolution", async () => {
    await ensureAnonUser(t.db, ME);
    await ensureAnonUser(t.db, OTHER);
    const first = await upsertRequest(t.db, { anonId: ME, text: "Nowhere Point Tower", area: "Dubai Creek Harbour", checkId: null, source: "request_form" });
    const dup = await upsertRequest(t.db, { anonId: ME, text: "Nowhere Point Twr", area: null, checkId: null, source: "request_form" });
    expect(dup).toEqual({ id: first.id, created: false });
    await upsertRequest(t.db, { anonId: OTHER, text: "nowhere point tower", area: null, checkId: null, source: "request_form" });
    vi.setSystemTime(new Date("2026-11-17T08:05:00Z"));
    const second = await upsertRequest(t.db, { anonId: ME, text: "Bay View", area: "  ", checkId: null, source: "request_form" });
    vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));

    let list = await listRequestsForAnon(t.db, ME);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
    const harbour = list.find((r) => r.id === first.id);
    expect(harbour).toMatchObject({ text: "Nowhere Point Tower", area: "Dubai Creek Harbour", othersAsked: 1, covered: false, coveredBuilding: null });
    expect(list.find((r) => r.id === second.id)).toMatchObject({ area: null, othersAsked: 0 });
    expect(typeof harbour?.createdAt).toBe("string");

    const [mct] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    await t.db
      .update(buildingRequests)
      .set({ resolvedBuildingId: mct.id })
      .where(eq(buildingRequests.textNorm, "nowhere point tower"));
    list = await listRequestsForAnon(t.db, ME);
    expect(list.find((r) => r.id === first.id)).toMatchObject({ covered: true, coveredBuilding: { id: mct.id, name: "Mockup Crest Tower" } });

    expect(await listRequestsForAnon(t.db, "2d7e3b66-4c5f-4071-8c1d-2e3f4a5b6c7d")).toEqual([]);
  });

  it("countOthersAsked excludes the person's own row", async () => {
    await ensureAnonUser(t.db, ME);
    await upsertRequest(t.db, { anonId: ME, text: "Solo Tower", area: null, checkId: null, source: "request_form" });
    expect(await countOthersAsked(t.db, requestTextNorm("Solo Tower"), ME)).toBe(0);
    expect(await countOthersAsked(t.db, requestTextNorm("Solo Tower"), OTHER)).toBe(1);
  });

  it("requestTextNorm falls back to the lowercased text when normalise() empties it", () => {
    expect(requestTextNorm("Fake Vista Res.")).toBe("fake vista residences");
    expect(requestTextNorm("  The  No ")).toBe("the no");
  });
});
