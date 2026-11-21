/**
 * Admin building requests (A§4.4): aggregated by normalised text with requests, people, first and last
 * asked (latest spelling); "Mark as covered" sets resolved_building_id on every row with that
 * text_norm, so the requester's request view (what GET /api/me returns) shows covered: true.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/admin/requests/route";
import { GET as meGet } from "@/app/api/me/route";
import { signAnonId } from "@/lib/auth/anon";
import type { MeView } from "@/lib/types";
import { buildingRequests } from "@/lib/db/schema";
import { listRequestsForAnon } from "@/lib/db/repo/requests";
import type { AdminRequestRow } from "@/lib/validation/admin";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { addAnon, addRequest, adminCookies, buildingId, daysAgo, pinClock } from "./admin-helpers";

const t = setupTestDb();
let cookies: Record<string, string>;
let people: { a: string; b: string; c: string };

beforeEach(async () => {
  pinClock();
  await clearUserData(t.db);
  cookies = await adminCookies(t.db);
  people = { a: await addAnon(t.db), b: await addAnon(t.db), c: await addAnon(t.db) };
  await addRequest(t.db, { anonId: people.a, text: "Nowhere Pt Twr", createdAt: daysAgo(9) });
  await addRequest(t.db, { anonId: people.b, text: "Nowhere Point Tower", area: "Dubai Creek Harbour", createdAt: daysAgo(2) });
  await addRequest(t.db, { anonId: null, text: "nowhere point tower", createdAt: daysAgo(5) }); // someone who deleted their data
  await addRequest(t.db, { anonId: people.c, text: "Bay View", createdAt: daysAgo(1) });
});
afterEach(() => vi.useRealTimers());

async function list(): Promise<AdminRequestRow[]> {
  const res = await call<{ requests: AdminRequestRow[] }>(GET, { url: "/api/admin/requests", cookies });
  expect(res.status).toBe(200);
  return res.body.requests;
}

describe("GET /api/admin/requests", () => {
  it("aggregates by normalised text with the latest spelling", async () => {
    const rows = await list();
    expect(rows).toHaveLength(3);
    const harbour = rows.find((r) => r.text === "Nowhere Point Tower");
    expect(harbour).toMatchObject({
      textNorm: "nowhere point tower",
      area: "Dubai Creek Harbour",
      requests: 2,
      people: 2,
      firstAskedAt: daysAgo(5).toISOString(),
      lastAskedAt: daysAgo(2).toISOString(),
      resolvedBuilding: null,
    });
    // "Nowhere Pt Twr" normalises differently ("nowhere pt tower"): its own row
    expect(rows.find((r) => r.text === "Nowhere Pt Twr")?.requests).toBe(1);
    // most asked first
    expect(rows[0].text).toBe("Nowhere Point Tower");
  });
});

describe("PATCH /api/admin/requests (Mark as covered)", () => {
  it("links every row with that text and the requester sees covered: true", async () => {
    const marina = await buildingId(t.db, "Mockup Crest Tower");
    const res = await call<{ updated: number; resolvedBuilding: { id: number; name: string } }>(PATCH, {
      method: "PATCH",
      url: "/api/admin/requests",
      json: { textNorm: "nowhere point tower", resolvedBuildingId: marina },
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.resolvedBuilding).toEqual({ id: marina, name: "Mockup Crest Tower" });

    const rows = await t.db.select().from(buildingRequests).where(eq(buildingRequests.textNorm, "nowhere point tower"));
    expect(rows.every((r) => r.resolvedBuildingId === marina)).toBe(true);

    const mine = await listRequestsForAnon(t.db, people.b);
    expect(mine[0]).toMatchObject({ covered: true, coveredBuilding: { id: marina, name: "Mockup Crest Tower" } });
    // WP4's GET /api/me shows it under "Buildings you asked for"
    const me = await call<MeView>(meGet, { url: "/api/me", cookies: { mz_aid: signAnonId(people.b) } });
    expect(me.status).toBe(200);
    expect(me.body.requests[0]).toMatchObject({ text: "Nowhere Point Tower", covered: true });
    const other = await listRequestsForAnon(t.db, people.c);
    expect(other[0].covered).toBe(false);

    expect((await list()).find((r) => r.textNorm === "nowhere point tower")?.resolvedBuilding).toEqual({
      id: marina,
      name: "Mockup Crest Tower",
    });

    // null unlinks
    const undo = await call(PATCH, {
      method: "PATCH",
      url: "/api/admin/requests",
      json: { textNorm: "nowhere point tower", resolvedBuildingId: null },
      cookies,
    });
    expect(undo.status).toBe(200);
    expect((await listRequestsForAnon(t.db, people.b))[0].covered).toBe(false);
  });

  it("unknown building → 404 building_not_found; unknown text → 404 not_found; bad body → 422", async () => {
    const nb = await call<{ error: { code: string } }>(PATCH, {
      method: "PATCH",
      url: "/x",
      json: { textNorm: "bay view", resolvedBuildingId: 99999 },
      cookies,
    });
    expect(nb.status).toBe(404);
    expect(nb.body.error.code).toBe("building_not_found");
    const marina = await buildingId(t.db, "Mockup Crest Tower");
    const nt = await call<{ error: { code: string } }>(PATCH, {
      method: "PATCH",
      url: "/x",
      json: { textNorm: "nothing like this", resolvedBuildingId: marina },
      cookies,
    });
    expect(nt.status).toBe(404);
    expect(nt.body.error.code).toBe("not_found");
    expect((await call(PATCH, { method: "PATCH", url: "/x", json: { textNorm: "" }, cookies })).status).toBe(422);
  });
});
