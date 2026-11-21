import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_TTL_MS,
  checkAdminPassword,
  createAdminSession,
  revokeAdminSession,
  verifyAdminSession,
} from "@/lib/auth/admin";
import { sign } from "@/lib/auth/sign";
import { adminSessions } from "@/lib/db/schema";
import { __resetEnvForTests } from "@/lib/env";
import { __setLogSinkForTests } from "@/lib/log";
import { useTestDb as setupTestDb } from "../../helpers/db";

const t = setupTestDb({ seed: false });

afterEach(() => {
  process.env.ADMIN_PASSWORD = "test-admin-pass";
  __resetEnvForTests();
  __setLogSinkForTests(null);
  process.env.LOG_LEVEL = "error";
  vi.useRealTimers();
});

describe("checkAdminPassword", () => {
  it("accepts only ADMIN_PASSWORD", () => {
    expect(checkAdminPassword("test-admin-pass")).toBe(true);
    expect(checkAdminPassword("test-admin-pas")).toBe(false);
    expect(checkAdminPassword("test-admin-pass ")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
  });

  it("always fails, with a warning, when ADMIN_PASSWORD is unset", () => {
    const lines: string[] = [];
    __setLogSinkForTests((_l, line) => lines.push(line));
    process.env.LOG_LEVEL = "info";
    delete process.env.ADMIN_PASSWORD;
    __resetEnvForTests();
    expect(checkAdminPassword("test-admin-pass")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
    expect(lines.join("\n")).toContain("admin_login_disabled");
  });
});

describe("admin sessions", () => {
  it("creates a session that verifies, stores only the hash, and revokes", async () => {
    const { cookieValue, expiresAt } = await createAdminSession(t.db, "iphash");
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(ADMIN_SESSION_TTL_MS - 5000);
    expect(await verifyAdminSession(t.db, cookieValue)).toBe(true);

    const token = cookieValue.slice(0, cookieValue.lastIndexOf("."));
    const rows = await t.db.select().from(adminSessions);
    expect(rows.some((r) => r.idHash === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.idHash))).toBe(true);

    expect(await revokeAdminSession(t.db, cookieValue)).toBe(true);
    expect(await verifyAdminSession(t.db, cookieValue)).toBe(false);
    expect(await revokeAdminSession(t.db, cookieValue)).toBe(false);
  });

  it("rejects forged, foreign-purpose and malformed cookies", async () => {
    const fakeToken = "A".repeat(43);
    expect(await verifyAdminSession(t.db, `${fakeToken}.forged`)).toBe(false);
    expect(await verifyAdminSession(t.db, sign("adm", fakeToken))).toBe(false); // signed but no row
    const { cookieValue } = await createAdminSession(t.db, "iphash");
    const token = cookieValue.slice(0, cookieValue.lastIndexOf("."));
    expect(await verifyAdminSession(t.db, sign("aid", token))).toBe(false);
    expect(await verifyAdminSession(t.db, sign("adm", "short"))).toBe(false);
    expect(await verifyAdminSession(t.db, undefined)).toBe(false);
    expect(await revokeAdminSession(t.db, "nope")).toBe(false);
  });

  it("expires after 12 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
    const { cookieValue } = await createAdminSession(t.db, "iphash");
    vi.setSystemTime(new Date("2026-11-17T19:59:00Z"));
    expect(await verifyAdminSession(t.db, cookieValue)).toBe(true);
    vi.setSystemTime(new Date("2026-11-17T20:00:01Z"));
    expect(await verifyAdminSession(t.db, cookieValue)).toBe(false);
  });
});
