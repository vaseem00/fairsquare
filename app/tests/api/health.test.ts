import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { __setDbForTests } from "@/lib/db/client";
import { __resetEnvForTests } from "@/lib/env";
import { createTestDb } from "../helpers/db";
import { call } from "../helpers/http";

afterEach(() => {
  __setDbForTests(null);
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  __resetEnvForTests();
});

describe("GET /api/health", () => {
  it("returns 200 { ok: true, db: 'pglite' } locally", async () => {
    const t = await createTestDb({ seed: false });
    __setDbForTests(t.db, "pglite");
    try {
      const res = await call<Record<string, unknown>>(GET, { url: "/api/health" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, db: "pglite", version: "dev" });
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(res.setCookies).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("reports the short commit sha on Railway", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "0123456789abcdef";
    __resetEnvForTests();
    const t = await createTestDb({ seed: false });
    __setDbForTests(t.db, "pglite");
    try {
      const res = await call<{ version: string }>(GET, { url: "/api/health" });
      expect(res.body.version).toBe("0123456");
    } finally {
      await t.close();
    }
  });

  it("returns 503 { ok: false } when the database is closed", async () => {
    const t = await createTestDb({ seed: false });
    __setDbForTests(t.db, "pglite");
    await t.close();
    const res = await call(GET, { url: "/api/health" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
  });
});
