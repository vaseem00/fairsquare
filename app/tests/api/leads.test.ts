import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_CHECK } from "@/app/api/checks/route";
import { POST as POST_WITHDRAW } from "@/app/api/leads/[id]/withdraw/route";
import { GET as GET_LEADS, POST as POST_LEAD } from "@/app/api/leads/route";
import { COPY, consentFor } from "@/lib/copy";
import { buildings, events, leads } from "@/lib/db/schema";
import { dubaiToday } from "@/lib/domain/dates";
import { __resetEnvForTests } from "@/lib/env";
import { leadBuildingName } from "@/lib/services/lead";
import type { CheckView, LeadView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb({ today: dubaiToday() });
/** tests/setup.ts configures this synthetic partner (name, regulator and licence). */
const PARTNER = "Test Mortgage Partner";

beforeEach(async () => {
  await clearUserData(t.db);
});

type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };
type LeadRes = { lead: LeadView } & ErrBody;

const MARINA = { buildingText: "Mockup Crest Tower", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };
const HARBOUR = { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 };

async function marinaId(): Promise<number> {
  const [b] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
  return b.id;
}

async function makeCheck(opts: { fields?: typeof MARINA; covered?: boolean; source?: "manual" | "text"; cookie?: string } = {}) {
  const res = await call<{ check: CheckView }>(POST_CHECK, {
    method: "POST",
    url: "/api/checks",
    json: {
      fields: opts.fields ?? MARINA,
      buildingId: opts.covered === false ? null : await marinaId(),
      source: opts.source ?? "manual",
    },
    cookies: opts.cookie ? { mz_aid: opts.cookie } : undefined,
  });
  expect(res.status).toBe(201);
  return { code: res.body.check.code, cookie: opts.cookie ?? res.cookies.mz_aid.value };
}

function leadBody(code: string, over: Record<string, unknown> = {}) {
  return {
    code,
    name: "Sara Ahmed",
    phone: "050 123 4567",
    consent: true,
    consentVersion: "optin-v1",
    downPct: 20,
    ratePct: 4.25,
    years: 25,
    ...over,
  };
}

function postLead(json: unknown, cookie?: string) {
  return call<LeadRes>(POST_LEAD, { method: "POST", url: "/api/leads", json, cookies: cookie ? { mz_aid: cookie } : undefined });
}
function withdraw(id: number | string, cookie: string) {
  return call<LeadRes>(POST_WITHDRAW, {
    method: "POST",
    url: `/api/leads/${id}/withdraw`,
    params: { id: String(id) },
    cookies: { mz_aid: cookie },
  });
}

describe("POST /api/leads: consent", () => {
  it("missing or false consent → 422 consent_required", async () => {
    const { code, cookie } = await makeCheck();
    const { consent: _omit, ...noConsent } = leadBody(code);
    void _omit;
    const missing = await postLead(noConsent, cookie);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("consent_required");
    const no = await postLead(leadBody(code, { consent: false }), cookie);
    expect(no.status).toBe(422);
    expect(no.body.error.code).toBe("consent_required");
    expect((await postLead("yes", cookie)).body.error.code).toBe("consent_required");
    expect(await t.db.select().from(leads)).toHaveLength(0);
  });

  it("any version but optin-v1 (the retired optin-v1-demo too) → 409; optin-v1 is accepted and stored with its text", async () => {
    const { code, cookie } = await makeCheck();
    for (const version of ["optin-v1-demo", "optin-v2"]) {
      const stale = await postLead(leadBody(code, { consentVersion: version }), cookie);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("consent_version_mismatch");
    }
    const ok = await postLead(leadBody(code), cookie);
    expect(ok.status).toBe(201);
    const [row] = await t.db.select().from(leads);
    expect(row.consentVersion).toBe("optin-v1");
    expect(row.consentText).toBe(consentFor(PARTNER).text);
  });
});

describe("POST /api/leads without a configured partner (REAL_DATA.md section 8)", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { PARTNER_NAME: env.PARTNER_NAME, PARTNER_REGULATOR: env.PARTNER_REGULATOR, PARTNER_LICENCE: env.PARTNER_LICENCE };
  afterEach(() => {
    Object.assign(env, saved);
    __resetEnvForTests();
  });

  it.each(["PARTNER_NAME", "PARTNER_REGULATOR", "PARTNER_LICENCE"])("without %s → 404 leads_unavailable, nothing stored", async (key) => {
    const { code, cookie } = await makeCheck();
    delete env[key];
    __resetEnvForTests();
    const res = await postLead(leadBody(code), cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "leads_unavailable", message: COPY["lead.unavailable"] });
    expect(await t.db.select().from(leads)).toHaveLength(0);
    // Even an empty or invalid body gets the same answer: nothing is read first.
    expect((await postLead({}, cookie)).body.error.code).toBe("leads_unavailable");
  });

  it("earlier requests can still be listed and withdrawn", async () => {
    const { code, cookie } = await makeCheck();
    const created = await postLead(leadBody(code), cookie);
    expect(created.status).toBe(201);
    delete env.PARTNER_LICENCE;
    __resetEnvForTests();
    const list = await call<{ leads: LeadView[] }>(GET_LEADS, { url: "/api/leads", cookies: { mz_aid: cookie } });
    expect(list.body.leads).toHaveLength(1);
    expect((await withdraw(created.body.lead.id, cookie)).body.lead.status).toBe("withdrawn");
  });
});

describe("POST /api/leads: stored lead", () => {
  it("stores the server-built consent text and its SHA-256, the E.164 phone and the estimate", async () => {
    const { code, cookie } = await makeCheck();
    const res = await postLead(leadBody(code, { consentText: "client text is ignored" }), cookie);
    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({
      partner: PARTNER,
      status: "new",
      withdrawnAt: null,
      phoneMasked: "+971 •• ••• 4567",
      checkCode: code,
      buildingName: "Mockup Crest Tower",
      bedrooms: 2,
      priceAed: 2_450_000,
    });

    const [row] = await t.db.select().from(leads);
    const consent = consentFor(PARTNER);
    expect(row.consentVersion).toBe("optin-v1");
    expect(row.consentText).toBe(consent.text);
    expect(row.consentTextSha256).toBe(createHash("sha256").update(consent.text, "utf8").digest("hex"));
    expect(row).toMatchObject({
      name: "Sara Ahmed",
      phoneE164: "+971501234567",
      phoneLast4: "4567",
      downPct: 20,
      years: 25,
      loanEstimateAed: 1_960_000,
      monthlyEstimateAed: 10_618,
      sizeSqft: 1284,
    });
    expect(row.ratePct).toBeCloseTo(4.25, 5);
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.consentedAt).toBeInstanceOf(Date);

    const ev = await t.db.select().from(events).where(eq(events.name, "lead_created"));
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].meta)).not.toMatch(/Sara|4567|\+971/);
  });

  it("an invalid phone → 422 on fields.phone; a missing name → 422 on fields.name", async () => {
    const { code, cookie } = await makeCheck();
    const phone = await postLead(leadBody(code, { phone: "12345" }), cookie);
    expect(phone.status).toBe(422);
    expect(phone.body.error.code).toBe("validation_failed");
    expect(phone.body.error.fields?.phone).toBeTruthy();
    const name = await postLead(leadBody(code, { name: "  " }), cookie);
    expect(name.status).toBe(422);
    expect(name.body.error.fields?.name).toBeTruthy();
  });

  it("downPct below minDownPct(price) → 422 on fields.downPct", async () => {
    const { code, cookie } = await makeCheck();
    const low = await postLead(leadBody(code, { downPct: 15 }), cookie);
    expect(low.status).toBe(422);
    expect(low.body.error.fields?.downPct).toBeTruthy();

    // Above AED 5M the minimum is 30%.
    const big = await makeCheck({ fields: { ...MARINA, priceAed: 6_000_000 }, cookie });
    const res = await postLead(leadBody(big.code, { downPct: 25 }), cookie);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.fields?.downPct).toBeTruthy();
    expect((await postLead(leadBody(big.code, { downPct: 30 }), cookie)).status).toBe(201);
  });

  it("a lead on a not-covered comparison stores the typed building text", async () => {
    const { code, cookie } = await makeCheck({ fields: HARBOUR, covered: false });
    const res = await postLead(leadBody(code), cookie);
    expect(res.status).toBe(201);
    expect(res.body.lead.buildingName).toBe("Nowhere Point Tower");
    const [row] = await t.db.select().from(leads);
    expect(row.buildingName).toBe("Nowhere Point Tower");
    expect(leadBuildingName({ buildingName: null, buildingText: "X Tower" })).toBe("X Tower");
  });

  it("an unknown code → 404", async () => {
    const { cookie } = await makeCheck();
    const unknown = await postLead(leadBody("ZZZZZZ"), cookie);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
  });

  it("a duplicate active lead returns the existing one (200); the 4th lead in a day → 429", async () => {
    const first = await makeCheck();
    const cookie = first.cookie;
    const a = await postLead(leadBody(first.code), cookie);
    expect(a.status).toBe(201);
    const dup = await postLead(leadBody(first.code, { name: "Someone Else" }), cookie);
    expect(dup.status).toBe(200);
    expect(dup.body.lead.id).toBe(a.body.lead.id);

    const second = await makeCheck({ cookie });
    const third = await makeCheck({ cookie });
    const fourth = await makeCheck({ cookie });
    expect((await postLead(leadBody(second.code), cookie)).status).toBe(201);
    expect((await postLead(leadBody(third.code), cookie)).status).toBe(201);
    const limited = await postLead(leadBody(fourth.code), cookie);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await t.db.select().from(leads)).toHaveLength(3);

    // A duplicate still returns the existing lead at the limit.
    expect((await postLead(leadBody(first.code), cookie)).status).toBe(200);
  });

  it("dropping the cookie does not reset the limits: the same mobile number is limited across browsers", async () => {
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const fresh = await makeCheck(); // a new cookie (new anon id) every time
      results.push((await postLead(leadBody(fresh.code), fresh.cookie)).status);
    }
    expect(results).toEqual([201, 201, 201, 429]);
    expect(await t.db.select().from(leads)).toHaveLength(3);
  });

  it("the per-IP limit applies across cookies and phone numbers", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.LEADS_IP_DAILY_LIMIT = "2";
    __resetEnvForTests();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const fresh = await makeCheck();
        statuses.push((await postLead(leadBody(fresh.code, { phone: `050 123 456${i}` }), fresh.cookie)).status);
      }
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      delete env.LEADS_IP_DAILY_LIMIT;
      __resetEnvForTests();
    }
  });

  it("a global daily ceiling stops leads from everyone", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.LEADS_DAILY_GLOBAL_CAP = "1";
    __resetEnvForTests();
    try {
      const a = await makeCheck();
      expect((await postLead(leadBody(a.code), a.cookie)).status).toBe(201);
      const b = await makeCheck();
      const res = await postLead(leadBody(b.code, { phone: "050 765 4321" }), b.cookie);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("rate_limited");
    } finally {
      delete env.LEADS_DAILY_GLOBAL_CAP;
      __resetEnvForTests();
    }
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST_LEAD, { method: "POST", url: "/api/leads", json: {}, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/leads/[id]/withdraw and GET /api/leads", () => {
  it("withdraw nulls name and phone, keeps phone_last4, and is idempotent; another person's id → 404", async () => {
    const { code, cookie } = await makeCheck();
    const created = await postLead(leadBody(code), cookie);
    const id = created.body.lead.id;

    const other = await makeCheck();
    expect((await withdraw(id, other.cookie)).status).toBe(404);
    expect((await withdraw("abc", cookie)).status).toBe(404);
    expect((await withdraw(999_999, cookie)).body.error.code).toBe("not_found");

    const res = await withdraw(id, cookie);
    expect(res.status).toBe(200);
    expect(res.body.lead).toMatchObject({ id, status: "withdrawn", phoneMasked: null, checkCode: code });
    expect(res.body.lead.withdrawnAt).toBeTruthy();
    const [row] = await t.db.select().from(leads).where(eq(leads.id, id));
    expect(row).toMatchObject({ status: "withdrawn", name: null, phoneE164: null, phoneLast4: "4567" });

    const again = await withdraw(id, cookie);
    expect(again.status).toBe(200);
    expect(again.body.lead).toEqual(res.body.lead);
    expect(await t.db.select().from(events).where(eq(events.name, "lead_withdrawn"))).toHaveLength(1);

    // A new lead on the same comparison is allowed after withdrawal.
    expect((await postLead(leadBody(code), cookie)).status).toBe(201);
  });

  it("GET /api/leads lists the person's leads, newest first", async () => {
    const a = await makeCheck();
    const b = await makeCheck({ cookie: a.cookie });
    const la = await postLead(leadBody(a.code), a.cookie);
    const lb = await postLead(leadBody(b.code), a.cookie);
    const res = await call<{ leads: LeadView[] }>(GET_LEADS, { url: "/api/leads", cookies: { mz_aid: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.body.leads.map((l) => l.id)).toEqual([lb.body.lead.id, la.body.lead.id]);
    const other = await makeCheck();
    const none = await call<{ leads: LeadView[] }>(GET_LEADS, { url: "/api/leads", cookies: { mz_aid: other.cookie } });
    expect(none.body.leads).toEqual([]);
  });
});
