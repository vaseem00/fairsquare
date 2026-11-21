/**
 * Admin leads (A§4.4, A§6.7): masked phones in the list; Reveal shows the full number and records
 * `lead_revealed`; "Mark sent to partner" sets sent_at; a withdrawn lead keeps "tell the partner"
 * until withdrawalNotified; there is no demo flag any more; the CSV export has full phones, is
 * injection-safe and records `leads_exported`.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as exportGet } from "@/app/api/admin/leads/export/route";
import { PATCH } from "@/app/api/admin/leads/[id]/route";
import { GET as revealGet } from "@/app/api/admin/leads/[id]/reveal/route";
import { GET as listGet } from "@/app/api/admin/leads/route";
import { leads, events } from "@/lib/db/schema";
import type { AdminLeadRow } from "@/lib/validation/admin";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";
import { addAnon, addCheck, addLead, adminCookies, daysAgo, pinClock } from "./admin-helpers";

const t = setupTestDb();
let cookies: Record<string, string>;
let ids: { live: number; withdrawn: number; old: number; formula: number; checkCode: string };

beforeEach(async () => {
  pinClock();
  await clearUserData(t.db);
  cookies = await adminCookies(t.db);
  const anon = await addAnon(t.db);
  const check = await addCheck(t.db, { anonId: anon });
  ids = {
    checkCode: check.code,
    live: await addLead(t.db, { anonId: anon, checkId: check.id, name: "Sara", phone: "+971501234567" }),
    withdrawn: await addLead(t.db, {
      name: null,
      phone: null,
      status: "withdrawn",
      withdrawnAt: daysAgo(1),
      createdAt: daysAgo(3),
    }),
    old: await addLead(t.db, { name: "Omar", phone: "+971559876543", createdAt: daysAgo(40) }),
    formula: await addLead(t.db, { name: '=HYPERLINK("http://evil","x")', phone: "+971521112233", createdAt: daysAgo(2) }),
  };
});
afterEach(() => vi.useRealTimers());

async function list(qs = ""): Promise<AdminLeadRow[]> {
  const res = await call<{ leads: AdminLeadRow[] }>(listGet, { url: `/api/admin/leads${qs}`, cookies });
  expect(res.status).toBe(200);
  return res.body.leads;
}

describe("GET /api/admin/leads", () => {
  it("lists newest first with masked phones and no full number anywhere", async () => {
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual([ids.live, ids.formula, ids.withdrawn, ids.old]);
    const live = rows[0];
    expect(live).toMatchObject({
      name: "Sara",
      phoneMasked: "+971 •• ••• 4567",
      status: "new",
      checkCode: ids.checkCode,
      consentVersion: "optin-v1",
      sentAt: null,
      withdrawalNotifiedAt: null,
      buildingName: "Mockup Crest Tower",
      bedrooms: 2,
      priceAed: 2_450_000,
    });
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain("501234567");
    expect(raw).not.toContain("559876543");
    const withdrawn = rows.find((r) => r.id === ids.withdrawn);
    expect(withdrawn).toMatchObject({ status: "withdrawn", name: null, phoneMasked: "•• ••• 4567" });
    expect(withdrawn).not.toHaveProperty("isDemo");
    expect(withdrawn?.withdrawnAt).not.toBeNull();
  });

  it("filters by status and inclusive Dubai dates", async () => {
    expect((await list("?status=withdrawn")).map((r) => r.id)).toEqual([ids.withdrawn]);
    expect((await list("?status=new&from=2026-11-15")).map((r) => r.id)).toEqual([ids.live, ids.formula]);
    expect((await list("?to=2026-10-31")).map((r) => r.id)).toEqual([ids.old]);
    expect((await list("?from=2026-11-17&to=2026-11-17")).map((r) => r.id)).toEqual([ids.live]);
  });

  it("rejects a bad filter with 422", async () => {
    const res = await call<{ error: { code: string; fields: Record<string, string> } }>(listGet, {
      url: "/api/admin/leads?status=lost&from=17-11-2026",
      cookies,
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["from", "status"]);
  });
});

describe("reveal", () => {
  it("returns the full number and name, and records lead_revealed", async () => {
    const res = await call<{ phoneE164: string; name: string }>(revealGet, {
      url: `/api/admin/leads/${ids.live}/reveal`,
      params: { id: String(ids.live) },
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phoneE164: "+971501234567", name: "Sara" });
    const ev = await t.db.select().from(events).where(eq(events.name, "lead_revealed"));
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toEqual({ leadId: ids.live });
    expect(JSON.stringify(ev[0].meta)).not.toContain("4567");
  });

  it("a withdrawn lead has nothing to reveal; an unknown id is 404", async () => {
    const w = await call(revealGet, { url: "/x", params: { id: String(ids.withdrawn) }, cookies });
    expect(w.body).toEqual({ phoneE164: null, name: null });
    expect((await call(revealGet, { url: "/x", params: { id: "999999" }, cookies })).status).toBe(404);
    expect((await call(revealGet, { url: "/x", params: { id: "abc" }, cookies })).status).toBe(404);
  });
});

describe("PATCH /api/admin/leads/[id]", () => {
  it("Mark sent to partner sets sent_at and is idempotent", async () => {
    const res = await call<{ lead: AdminLeadRow }>(PATCH, {
      method: "PATCH",
      url: `/api/admin/leads/${ids.live}`,
      params: { id: String(ids.live) },
      json: { status: "sent" },
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe("sent");
    expect(res.body.lead.sentAt).toBe("2026-11-17T08:00:00.000Z");
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    const again = await call<{ lead: AdminLeadRow }>(PATCH, {
      method: "PATCH",
      url: "/x",
      params: { id: String(ids.live) },
      json: { status: "sent" },
      cookies,
    });
    expect(again.body.lead.sentAt).toBe(res.body.lead.sentAt);
  });

  it("a withdrawn lead stays withdrawn; Partner told sets withdrawalNotified", async () => {
    const sent = await call<{ lead: AdminLeadRow }>(PATCH, {
      method: "PATCH",
      url: "/x",
      params: { id: String(ids.withdrawn) },
      json: { status: "sent" },
      cookies,
    });
    expect(sent.body.lead).toMatchObject({ status: "withdrawn", sentAt: null, withdrawalNotifiedAt: null });
    const told = await call<{ lead: AdminLeadRow }>(PATCH, {
      method: "PATCH",
      url: "/x",
      params: { id: String(ids.withdrawn) },
      json: { withdrawalNotified: true },
      cookies,
    });
    expect(told.body.lead.withdrawalNotifiedAt).toBe("2026-11-17T08:00:00.000Z");
    // withdrawalNotified on a lead that was never withdrawn changes nothing
    const live = await call<{ lead: AdminLeadRow }>(PATCH, {
      method: "PATCH",
      url: "/x",
      params: { id: String(ids.live) },
      json: { withdrawalNotified: true },
      cookies,
    });
    expect(live.body.lead.withdrawalNotifiedAt).toBeNull();
  });

  it("validates the body and the id", async () => {
    const empty = await call(PATCH, { method: "PATCH", url: "/x", params: { id: String(ids.live) }, json: {}, cookies });
    expect(empty.status).toBe(422);
    const bad = await call(PATCH, { method: "PATCH", url: "/x", params: { id: String(ids.live) }, json: { status: "new" }, cookies });
    expect(bad.status).toBe(422);
    const unknown = await call(PATCH, { method: "PATCH", url: "/x", params: { id: "424242" }, json: { status: "sent" }, cookies });
    expect(unknown.status).toBe(404);
    const cross = await call(PATCH, {
      method: "PATCH",
      url: "/x",
      params: { id: String(ids.live) },
      json: { status: "sent" },
      cookies,
      origin: "https://evil.example",
    });
    expect(cross.status).toBe(403);
  });
});

describe("GET /api/admin/leads/export", () => {
  it("is text/csv with full phones, injection-safe, and records leads_exported", async () => {
    const res = await call<string>(exportGet, { url: "/api/admin/leads/export", cookies });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="fairsquare-leads-2026-11-17.csv"');
    const lines = res.text.trim().split("\r\n");
    expect(lines[0].split(",")).toEqual(expect.arrayContaining(["id", "name", "phone", "consent_version", "status"]));
    expect(lines).toHaveLength(5);
    // the full E.164 number as is: no apostrophe inside the number partners import
    expect(res.text).toMatch(/(^|,)\+971501234567(,|\r\n)/m);
    expect(res.text).toMatch(/(^|,)\+971559876543(,|\r\n)/m);
    expect(res.text).not.toContain("'+971");
    // a name starting with = is exported as '=…
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
    const ev = await t.db.select().from(events).where(eq(events.name, "leads_exported"));
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toEqual({ count: 4 });
  });

  it("uses the same filters as the list", async () => {
    const res = await call<string>(exportGet, { url: "/api/admin/leads/export?status=withdrawn", cookies });
    const lines = res.text.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("withdrawn");
    // withdrawn: no name and no phone
    const [row] = await t.db.select().from(leads).where(and(eq(leads.id, ids.withdrawn)));
    expect(row.phoneE164).toBeNull();
  });
});
