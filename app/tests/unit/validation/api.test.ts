import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import {
  FIXTURE_CHECK_MARINA,
  FIXTURE_CONFIG,
  FIXTURE_CONFIG_NO_LEADS,
  FIXTURE_COVERAGE,
  FIXTURE_EXTRACT_OK,
  FIXTURE_ME,
  FIXTURE_SAVED,
} from "../../fixtures/api-fixtures";
import {
  BuildingRequestSchema,
  CheckRequestSchema,
  CheckViewSchema,
  CLIENT_EVENT_NAMES,
  CoverageQuerySchema,
  CoverageResponseSchema,
  EventRequestSchema,
  ExtractResponseSchema,
  LeadRequestSchema,
  MatchQuerySchema,
  MeViewSchema,
  PublicConfigSchema,
  SavedItemViewSchema,
  fieldErrorSummary,
  zodFieldErrors,
} from "@/lib/validation";

const fields = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };
const lead = {
  code: "k7q2mx",
  name: "Sara",
  phone: "050 123 4567",
  consent: true,
  consentVersion: "optin-v1",
  downPct: 20,
  ratePct: 4.25,
  years: 25,
};

describe("request schemas", () => {
  it("CheckRequestSchema", () => {
    const r = CheckRequestSchema.parse({ fields, buildingId: 1, source: "claude" });
    expect(r.editedFields).toEqual([]);
    expect(CheckRequestSchema.safeParse({ fields, buildingId: null, source: "manual", editedFields: ["bedrooms"] }).success).toBe(true);
    const bad = CheckRequestSchema.safeParse({ fields: { ...fields, bedrooms: null }, buildingId: 1, source: "claude" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(zodFieldErrors(bad.error)["fields.bedrooms"]).toBe(COPY["err.bedrooms"]);
    const psf = CheckRequestSchema.safeParse({ fields: { ...fields, sizeSqft: 300, priceAed: 2_100_000 }, buildingId: 1, source: "claude" });
    expect(psf.success).toBe(false);
    if (!psf.success) {
      const f = zodFieldErrors(psf.error);
      expect(f["fields.sizeSqft"]).toBe(f["fields.priceAed"]);
      expect(f["fields.sizeSqft"]).toContain("AED 7,000 per sq ft");
    }
  });

  it("LeadRequestSchema", () => {
    const r = LeadRequestSchema.parse(lead);
    expect(r.code).toBe("K7Q2MX");
    // The demo consent version is gone (REAL_DATA.md section 8).
    expect(LeadRequestSchema.safeParse({ ...lead, consentVersion: "optin-v1-demo" }).success).toBe(false);
    expect(LeadRequestSchema.safeParse({ ...lead, consent: false }).success).toBe(false);
    expect(LeadRequestSchema.safeParse({ ...lead, years: 30 }).success).toBe(false);
    expect(LeadRequestSchema.safeParse({ ...lead, downPct: 22 }).success).toBe(false);
    const phone = LeadRequestSchema.safeParse({ ...lead, phone: "12345" });
    expect(phone.success).toBe(false);
    if (!phone.success) expect(zodFieldErrors(phone.error).phone).toBe(COPY["lead.errMobile"]);
    const name = LeadRequestSchema.safeParse({ ...lead, name: "  " });
    if (!name.success) expect(zodFieldErrors(name.error).name).toBe(COPY["lead.errName"]);
    expect(name.success).toBe(false);
  });

  it("BuildingRequestSchema, EventRequestSchema, MatchQuerySchema", () => {
    expect(BuildingRequestSchema.parse({ text: " Nowhere Point Tower " }).text).toBe("Nowhere Point Tower");
    expect(BuildingRequestSchema.safeParse({ text: "ab" }).success).toBe(false);
    expect(EventRequestSchema.safeParse({ name: "share_whatsapp", code: "K7Q2MX" }).success).toBe(true);
    expect(EventRequestSchema.safeParse({ name: "check_created" }).success).toBe(false);
    expect(CLIENT_EVENT_NAMES).toContain("recovery_link_copied");
    expect(MatchQuerySchema.parse({ q: "Marina", beds: "2" }).beds).toBe(2);
    expect(MatchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(MatchQuerySchema.safeParse({ q: "x", beds: "8" }).success).toBe(false);
    // An empty beds= is absent, not 0 (Studio); "0" is still Studio.
    expect(MatchQuerySchema.parse({ q: "Marina", beds: "" }).beds).toBeUndefined();
    expect(MatchQuerySchema.parse({ q: "Marina", beds: "0" }).beds).toBe(0);
    expect(MatchQuerySchema.parse({ q: "Marina", completion: "off_plan" }).completion).toBe("off_plan");
    expect(MatchQuerySchema.safeParse({ q: "Marina", completion: "villa" }).success).toBe(false);
  });

  it("samples are gone: no sample source, no sample event (REAL_DATA.md section 8)", () => {
    expect(CheckRequestSchema.safeParse({ fields, buildingId: 1, source: "sample" }).success).toBe(false);
    expect(EventRequestSchema.safeParse({ name: "sample_used" }).success).toBe(false);
    expect(CLIENT_EVENT_NAMES).not.toContain("sample_used");
    // The fictional example card is gone, and so is its event (REAL_DATA.md section 8).
    expect(CLIENT_EVENT_NAMES).not.toContain("example_viewed");
  });

  it("CoverageQuerySchema: q up to 120 characters, page from 1", () => {
    expect(CoverageQuerySchema.parse({ q: " marina ", page: "2" })).toEqual({ q: "marina", page: 2 });
    expect(CoverageQuerySchema.parse({})).toEqual({});
    expect(CoverageQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(CoverageQuerySchema.safeParse({ q: "x".repeat(121) }).success).toBe(false);
  });

  it("zodFieldErrors keys root issues as _", () => {
    const r = EventRequestSchema.safeParse("nope");
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error))).toEqual(["_"]);
    expect(fieldErrorSummary(2)).toBe("Fix 2 things to compare the price");
  });
});

describe("fixtures satisfy the response schemas", () => {
  it("parses", () => {
    expect(CheckViewSchema.parse(FIXTURE_CHECK_MARINA)).toEqual(FIXTURE_CHECK_MARINA);
    expect(ExtractResponseSchema.parse(FIXTURE_EXTRACT_OK)).toEqual(FIXTURE_EXTRACT_OK);
    expect(CoverageResponseSchema.parse(FIXTURE_COVERAGE)).toEqual(FIXTURE_COVERAGE);
    expect(PublicConfigSchema.parse(FIXTURE_CONFIG)).toEqual(FIXTURE_CONFIG);
    expect(PublicConfigSchema.parse(FIXTURE_CONFIG_NO_LEADS)).toEqual(FIXTURE_CONFIG_NO_LEADS);
    expect(MeViewSchema.parse(FIXTURE_ME)).toEqual(FIXTURE_ME);
    for (const s of FIXTURE_SAVED) expect(SavedItemViewSchema.parse(s)).toEqual(s);
  });

  it("the views carry no demo or sample flags any more", () => {
    for (const v of [FIXTURE_CHECK_MARINA, FIXTURE_CONFIG, FIXTURE_COVERAGE.buildings[0], FIXTURE_SAVED[0]]) {
      expect(v).not.toHaveProperty("isDemo");
      expect(v).not.toHaveProperty("isSample");
    }
    expect(FIXTURE_CONFIG).not.toHaveProperty("dataSourceLabel");
    // A demo flag sent by an old server is stripped, not trusted.
    expect(CheckViewSchema.parse({ ...FIXTURE_CHECK_MARINA, isDemo: true })).not.toHaveProperty("isDemo");
  });
});
