import { afterEach, describe, expect, it } from "vitest";
import { DbConfigError, assertDbConfig, type Db } from "@/lib/db/client";
import { invalidateDataMeta, UNKNOWN_DATA_STATUS } from "@/lib/data-status";
import { __resetEnvForTests, getEnv, leadPartner, parseEnv } from "@/lib/env";
import { getPublicConfig, publicConfigWith } from "@/lib/config";
import { __setLogSinkForTests } from "@/lib/log";

const base = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

describe("parseEnv", () => {
  it("applies the A§7.1 defaults", () => {
    const e = parseEnv(base);
    expect(e).toMatchObject({
      PGLITE_DATA_DIR: "./.data/pglite",
      ALLOW_PGLITE_IN_PRODUCTION: false,
      CLAUDE_MODEL: "claude-opus-5-5",
      CLAUDE_EFFORT: "low",
      CLAUDE_MAX_TOKENS: 8192,
      CLAUDE_TIMEOUT_MS: 24_000,
      APP_URL: "http://localhost:3000",
      MAX_IMAGE_BYTES: 8_388_608,
      EXTRACT_ANON_BURST_LIMIT: 6,
      EXTRACT_ANON_DAILY_LIMIT: 20,
      EXTRACT_IP_DAILY_LIMIT: 60,
      EXTRACT_DAILY_GLOBAL_CAP: 1000,
      CHECKS_ANON_DAILY_LIMIT: 100,
      CHECKS_IP_DAILY_LIMIT: 500,
      LEADS_ANON_DAILY_LIMIT: 3,
      LEADS_PHONE_DAILY_LIMIT: 3,
      LEADS_IP_DAILY_LIMIT: 10,
      LEADS_DAILY_GLOBAL_CAP: 500,
      CSP_MODE: "nonce",
      LOG_LEVEL: "info",
      rules: { minSales: 5, windowDays: 365, bandPct: 5 },
      MORTGAGE_RATE_PCT: 4.25,
      MORTGAGE_YEARS: 25,
      MORTGAGE_DOWN_PCT: 20,
      isProduction: false,
    });
    expect(e.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    // REAL_DATA.md section 8: no fictional partner by default, and no demo switches at all.
    expect(e.PARTNER_NAME).toBeUndefined();
    expect(e.OPEN_DATA_DIR).toBeUndefined();
    for (const gone of ["DEMO_MODE", "SEED_DEMO", "DATA_SOURCE_LABEL"]) expect(e).not.toHaveProperty(gone);
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.DATABASE_URL).toBeUndefined();
  });

  it("treats empty strings as unset and parses booleans and numbers", () => {
    const e = parseEnv({
      ...base,
      DATABASE_URL: "",
      ALLOW_PGLITE_IN_PRODUCTION: "yes",
      MIN_SALES: "4",
      APP_URL: "https://fairsquare.example/",
      OPEN_DATA_DIR: " /srv/open-data ",
      PARTNER_NAME: "",
    });
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.ALLOW_PGLITE_IN_PRODUCTION).toBe(true);
    expect(e.rules.minSales).toBe(4);
    expect(e.APP_URL).toBe("https://fairsquare.example");
    expect(e.OPEN_DATA_DIR).toBe("/srv/open-data");
    expect(e.PARTNER_NAME).toBeUndefined();
  });

  it("ignores the removed demo variables (an old .env keeps working)", () => {
    const e = parseEnv({ ...base, DEMO_MODE: "true", SEED_DEMO: "true", DATA_SOURCE_LABEL: "demo sales" });
    for (const gone of ["DEMO_MODE", "SEED_DEMO", "DATA_SOURCE_LABEL"]) expect(e).not.toHaveProperty(gone);
  });

  it("rejects invalid values with every problem listed", () => {
    expect(() => parseEnv({ ...base, CLAUDE_EFFORT: "extreme", MIN_SALES: "x" })).toThrow(/CLAUDE_EFFORT.*MIN_SALES/);
  });

  it("requires a 32+ char SESSION_SECRET in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production", APP_URL: "https://fairsquare.example" } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    const ok = parseEnv({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(32), APP_URL: "https://fairsquare.example" } as NodeJS.ProcessEnv);
    expect(ok.isProduction).toBe(true);
  });

  it("refuses to start in production without APP_URL, falling back to RAILWAY_PUBLIC_DOMAIN", () => {
    const prod = { NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv;
    expect(() => parseEnv(prod)).toThrow(/APP_URL must be set/);
    expect(parseEnv({ ...prod, RAILWAY_PUBLIC_DOMAIN: "mizan.up.railway.app" }).APP_URL).toBe("https://mizan.up.railway.app");
    expect(parseEnv({ ...prod, APP_URL: "https://fairsquare.example/" }).APP_URL).toBe("https://fairsquare.example");
    // Outside production the localhost default stays.
    expect(parseEnv({ NODE_ENV: "development", SESSION_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv).APP_URL).toBe("http://localhost:3000");
  });

  it("turns admin off (without crashing the site) for an ADMIN_PASSWORD under 12 characters in production", () => {
    const prod = { NODE_ENV: "production", SESSION_SECRET: "x".repeat(32), APP_URL: "https://fairsquare.example" } as NodeJS.ProcessEnv;
    expect(() => parseEnv({ ...prod, ADMIN_PASSWORD: "admin123" })).not.toThrow();
    expect(parseEnv({ ...prod, ADMIN_PASSWORD: "admin123" }).ADMIN_PASSWORD).toBeUndefined();
    expect(parseEnv({ ...prod, ADMIN_PASSWORD: "a-long-admin-pass" }).ADMIN_PASSWORD).toBe("a-long-admin-pass");
    expect(parseEnv(prod).ADMIN_PASSWORD).toBeUndefined();
    // Development keeps short passwords working.
    expect(parseEnv({ ...base, ADMIN_PASSWORD: "dev" }).ADMIN_PASSWORD).toBe("dev");
  });

  it("warns once about the dev fallback secret outside tests", () => {
    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "info";
    try {
      parseEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
      expect(lines.some((l) => l.includes("env_insecure_session_secret"))).toBe(true);
    } finally {
      __setLogSinkForTests(null);
      process.env.LOG_LEVEL = "error";
    }
  });
});

describe("getEnv, getPublicConfig and the production database rule", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    __resetEnvForTests();
    __setLogSinkForTests(null);
  });

  it("getEnv caches until reset", () => {
    expect(getEnv()).toBe(getEnv());
    const before = getEnv().PARTNER_NAME;
    process.env.PARTNER_NAME = "Acme Home Finance";
    expect(getEnv().PARTNER_NAME).toBe(before);
    __resetEnvForTests();
    expect(getEnv().PARTNER_NAME).toBe("Acme Home Finance");
  });

  it("publicConfigWith builds the client config from env (a configured partner: leads on)", () => {
    process.env.PARTNER_NAME = "P";
    process.env.PARTNER_REGULATOR = "Test Regulator";
    process.env.PARTNER_LICENCE = "TEST-1";
    __resetEnvForTests();
    const c = publicConfigWith(UNKNOWN_DATA_STATUS);
    expect(c).toMatchObject({
      appUrl: "http://localhost:3000",
      extractEnabled: false,
      leadsEnabled: true,
      partner: { name: "P", regulator: "Test Regulator", licence: "TEST-1", promise: null },
      consent: { version: "optin-v1" },
      rules: { minSales: 5, windowDays: 365, bandPct: 5 },
      mortgage: { downPct: 20, ratePct: 4.25, years: 25 },
      data: UNKNOWN_DATA_STATUS,
    });
    expect(c).not.toHaveProperty("isDemo");
    expect(c).not.toHaveProperty("dataSourceLabel");
    expect(c.consent?.text).toContain("with P, a licensed mortgage broker");
  });

  it.each(["PARTNER_NAME", "PARTNER_REGULATOR", "PARTNER_LICENCE"])(
    "without %s the adviser opt-in is off: no partner, no consent (REAL_DATA.md section 8)",
    (key) => {
      Object.assign(process.env, { PARTNER_NAME: "P", PARTNER_REGULATOR: "R", PARTNER_LICENCE: "L" });
      delete process.env[key];
      __resetEnvForTests();
      expect(publicConfigWith(UNKNOWN_DATA_STATUS)).toMatchObject({ leadsEnabled: false, partner: null, consent: null });
      expect(leadPartner(getEnv())).toBeNull();
    },
  );

  it("leadPartner carries the promise when it is set; PARTNER_NAME has no default", () => {
    expect(leadPartner({ PARTNER_NAME: "P", PARTNER_REGULATOR: "R", PARTNER_LICENCE: "L", PARTNER_PROMISE: "We reply in a day." })).toEqual({
      name: "P",
      regulator: "R",
      licence: "L",
      promise: "We reply in a day.",
    });
    expect(parseEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv).PARTNER_NAME).toBeUndefined();
    expect(parseEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv).MIN_SALES).toBe(5);
  });

  it("getPublicConfig reads the data status (a database error reads as not loaded)", async () => {
    const broken = {
      select: () => {
        throw new Error("no database");
      },
    } as unknown as Db;
    invalidateDataMeta();
    const c = await getPublicConfig({ db: broken, today: "2026-11-17" });
    expect(c.data).toEqual(UNKNOWN_DATA_STATUS);
  });

  it("production without DATABASE_URL fails fast with a clear log line", () => {
    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    Object.assign(process.env, { NODE_ENV: "production", SESSION_SECRET: "s".repeat(40), APP_URL: "https://fairsquare.example" });
    delete process.env.DATABASE_URL;
    __resetEnvForTests();
    expect(() => assertDbConfig()).toThrow(DbConfigError);
    expect(lines.join("\n")).toMatch(/db_config_missing.*DATABASE_URL is not set/);

    process.env.ALLOW_PGLITE_IN_PRODUCTION = "true";
    __resetEnvForTests();
    expect(() => assertDbConfig()).not.toThrow();
  });

  it("development without DATABASE_URL is fine", () => {
    expect(() => assertDbConfig()).not.toThrow();
  });
});
