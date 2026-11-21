import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as GET_CHECK } from "@/app/api/checks/[code]/route";
import { POST as POST_CHECK } from "@/app/api/checks/route";
import { POST as POST_LEAD } from "@/app/api/leads/route";
import { DELETE as DELETE_ME, GET as GET_ME } from "@/app/api/me/route";
import { DELETE as DELETE_SAVED } from "@/app/api/saved/[code]/route";
import { POST as POST_SAVED } from "@/app/api/saved/route";
import { POST as POST_REQUEST } from "@/app/api/requests/route";
import { verifyAnonCookie } from "@/lib/auth/anon";
import { getCheckWithCurrent } from "@/lib/db/repo/checks";
import { deleteAllForAnon, getMe } from "@/lib/db/repo/me";
import { anonUsers, buildingRequests, buildings, checks, events, leads, savedListings } from "@/lib/db/schema";
import { DEFAULT_RULES } from "@/lib/domain/analyse";
import { dubaiToday } from "@/lib/domain/dates";
import type { CheckView, LeadView, MeView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const TODAY = dubaiToday();
const t = setupTestDb({ today: TODAY });

beforeEach(async () => {
  await clearUserData(t.db);
});

const MARINA = { buildingText: "Mockup Crest Tower", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };
const HARBOUR = { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 };

async function marinaId(): Promise<number> {
  const [b] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
  return b.id;
}

async function makeCheck(covered: boolean, cookie?: string) {
  const res = await call<{ check: CheckView }>(POST_CHECK, {
    method: "POST",
    url: "/api/checks",
    json: { fields: covered ? MARINA : HARBOUR, buildingId: covered ? await marinaId() : null, source: "manual" },
    cookies: cookie ? { mz_aid: cookie } : undefined,
  });
  expect(res.status).toBe(201);
  return { code: res.body.check.code, cookie: cookie ?? res.cookies.mz_aid.value };
}

function me(cookie?: string) {
  return call<MeView>(GET_ME, { url: "/api/me", cookies: cookie ? { mz_aid: cookie } : undefined });
}

describe("GET /api/me", () => {
  it("with no cookie: the empty MeView and no Set-Cookie", async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ savedCount: 0, savedWithNewSales: 0, checksCount: 0, requests: [], leads: [] });
    expect(res.setCookies).toEqual([]);
    expect(await t.db.select().from(anonUsers)).toHaveLength(0);
  });

  it("a tampered cookie counts as absent and issues nothing", async () => {
    const { cookie } = await makeCheck(true);
    const res = await me(`${cookie}x`);
    expect(res.body.checksCount).toBe(0);
    expect(res.setCookies).toEqual([]);
  });

  it("counts comparisons and saved listings, and lists leads", async () => {
    const { code, cookie } = await makeCheck(true);
    await makeCheck(false, cookie);
    await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code }, cookies: { mz_aid: cookie } });
    const lead = await call<{ lead: LeadView }>(POST_LEAD, {
      method: "POST",
      url: "/api/leads",
      json: { code, name: "Sara", phone: "0501234567", consent: true, consentVersion: "optin-v1", downPct: 20, ratePct: 4.25, years: 25 },
      cookies: { mz_aid: cookie },
    });
    expect(lead.status).toBe(201);
    const res = await me(cookie);
    expect(res.body).toMatchObject({ savedCount: 1, savedWithNewSales: 0, checksCount: 2, requests: [] });
    expect(res.body.leads).toEqual([lead.body.lead]);
  });

  it("returns requests from listRequestsForAnon: not covered, then covered after admin resolution", async () => {
    const { code, cookie } = await makeCheck(false);
    const req = await call<{ id: number }>(POST_REQUEST, {
      method: "POST",
      url: "/api/requests",
      json: { text: "Nowhere Point Tower", code },
      cookies: { mz_aid: cookie },
    });
    expect(req.status).toBe(201);

    let res = await me(cookie);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({
      id: req.body.id,
      text: "Nowhere Point Tower",
      area: "Dubai Creek Harbour",
      covered: false,
      coveredBuilding: null,
    });

    // Admin "Mark as covered" resolves every request with this text to a building.
    const id = await marinaId();
    await t.db
      .update(buildingRequests)
      .set({ resolvedBuildingId: id })
      .where(eq(buildingRequests.textNorm, "nowhere point tower"));
    res = await me(cookie);
    expect(res.body.requests[0]).toMatchObject({ covered: true, coveredBuilding: { id, name: "Mockup Crest Tower" } });
  });

  it("getMe with a malformed id gives the empty view", async () => {
    expect(await getMe(t.db, "not-a-uuid", TODAY, DEFAULT_RULES)).toEqual({
      savedCount: 0,
      savedWithNewSales: 0,
      checksCount: 0,
      requests: [],
      leads: [],
    });
  });
});

describe("DELETE /api/me", () => {
  it("with no cookie: a 204 no-op", async () => {
    const { cookie } = await makeCheck(true);
    const res = await call(DELETE_ME, { method: "DELETE", url: "/api/me" });
    expect(res.status).toBe(204);
    expect(res.setCookies).toEqual([]);
    expect(await t.db.select().from(checks)).toHaveLength(1);
    expect(verifyAnonCookie(cookie)).toBeTruthy();
  });

  it("deletes checks, saved items (also removed ones) and the anon row; anonymises leads, requests and events", async () => {
    const mine = await makeCheck(true);
    const cookie = mine.cookie;
    const anonId = verifyAnonCookie(cookie) as string;
    const second = await makeCheck(true, cookie);
    const none = await makeCheck(false, cookie);
    await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code: mine.code }, cookies: { mz_aid: cookie } });
    await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code: second.code }, cookies: { mz_aid: cookie } });
    await call(DELETE_SAVED, { method: "DELETE", url: `/api/saved/${second.code}`, params: { code: second.code }, cookies: { mz_aid: cookie } });
    const lead = await call<{ lead: LeadView }>(POST_LEAD, {
      method: "POST",
      url: "/api/leads",
      json: { code: mine.code, name: "Sara", phone: "+971 50 123 4567", consent: true, consentVersion: "optin-v1", downPct: 20, ratePct: 4.25, years: 25 },
      cookies: { mz_aid: cookie },
    });
    expect(lead.status).toBe(201);
    await call(POST_REQUEST, { method: "POST", url: "/api/requests", json: { text: "Nowhere Point Tower", code: none.code }, cookies: { mz_aid: cookie } });

    // Someone else's data is untouched.
    const other = await makeCheck(true);
    await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code: other.code }, cookies: { mz_aid: other.cookie } });
    const otherId = verifyAnonCookie(other.cookie) as string;

    expect((await t.db.select().from(savedListings).where(eq(savedListings.anonId, anonId))).length).toBe(2);
    expect((await t.db.select().from(events).where(eq(events.anonId, anonId))).length).toBeGreaterThan(0);

    const res = await call(DELETE_ME, { method: "DELETE", url: "/api/me", cookies: { mz_aid: cookie } });
    expect(res.status).toBe(204);
    expect(res.cookies.mz_aid).toBeDefined();
    expect(res.cookies.mz_aid.value).toBe("");
    expect(res.cookies.mz_aid.attributes["max-age"]).toBe("0");
    expect(res.cookies.mz_aid.attributes.httponly).toBe(true);
    expect(res.cookies.mz_aid.attributes.path).toBe("/");

    expect(await t.db.select().from(checks).where(eq(checks.anonId, anonId))).toHaveLength(0);
    expect(await t.db.select().from(savedListings).where(eq(savedListings.anonId, anonId))).toHaveLength(0);
    expect(await t.db.select().from(anonUsers).where(eq(anonUsers.id, anonId))).toHaveLength(0);

    const [l] = await t.db.select().from(leads).where(eq(leads.id, lead.body.lead.id));
    expect(l).toMatchObject({ status: "withdrawn", name: null, phoneE164: null, anonId: null, checkId: null, phoneLast4: "4567" });
    expect(l.withdrawnAt).toBeInstanceOf(Date);

    const reqs = await t.db.select().from(buildingRequests);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ anonId: null, textNorm: "nowhere point tower" });
    expect(await t.db.select().from(events).where(eq(events.anonId, anonId))).toHaveLength(0);
    const deleted = await t.db.select().from(events).where(eq(events.name, "data_deleted"));
    expect(deleted).toHaveLength(1);
    expect(deleted[0].anonId).toBeNull();
    expect(await t.db.select().from(events).where(eq(events.name, "lead_withdrawn"))).toHaveLength(1);

    // Their /c/<code> stops working: the API (and getCheckWithCurrent, which /c uses) give 404 / null.
    const card = await call<{ error: { code: string } }>(GET_CHECK, { url: `/api/checks/${mine.code}`, params: { code: mine.code } });
    expect(card.status).toBe(404);
    expect(card.body.error.code).toBe("not_found");
    expect(await getCheckWithCurrent(t.db, mine.code, TODAY, DEFAULT_RULES, "http://localhost:3000")).toBeNull();

    // The other person keeps everything.
    expect(await t.db.select().from(anonUsers).where(eq(anonUsers.id, otherId))).toHaveLength(1);
    expect(await t.db.select().from(savedListings).where(eq(savedListings.anonId, otherId))).toHaveLength(1);
    expect((await call(GET_CHECK, { url: `/api/checks/${other.code}`, params: { code: other.code } })).status).toBe(200);

    // The old cookie now reads as an empty person.
    expect((await me(cookie)).body).toMatchObject({ savedCount: 0, checksCount: 0, leads: [], requests: [] });
  });

  it("counts other people's saved rows of the deleted comparisons in data_deleted", async () => {
    const mine = await makeCheck(true);
    const other = await makeCheck(true);
    // The other person saves my comparison from its share link.
    expect((await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code: mine.code }, cookies: { mz_aid: other.cookie } })).status).toBe(201);
    expect((await call(DELETE_ME, { method: "DELETE", url: "/api/me", cookies: { mz_aid: mine.cookie } })).status).toBe(204);
    const [deleted] = await t.db.select().from(events).where(eq(events.name, "data_deleted"));
    expect(deleted.meta).toMatchObject({ checks: 1, saved: 0, othersSaved: 1 });
    expect(await t.db.select().from(savedListings).where(eq(savedListings.anonId, verifyAnonCookie(other.cookie) as string))).toHaveLength(0);
  });

  it("deleteAllForAnon is a no-op for an unknown or malformed id", async () => {
    await makeCheck(true);
    await deleteAllForAnon(t.db, "6b1c7faa-8093-44b5-8a51-6c7d8e9f0a1b");
    await deleteAllForAnon(t.db, "nope");
    expect(await t.db.select().from(checks)).toHaveLength(1);
    expect(await t.db.select().from(leads).where(isNull(leads.anonId))).toHaveLength(0);
  });
});
