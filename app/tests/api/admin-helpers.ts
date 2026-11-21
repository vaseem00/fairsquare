/**
 * Shared set-up for the WP5 admin API tests: an admin session cookie, a pinned clock and small
 * inserts for people, comparisons, events, leads and requests with chosen timestamps.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { createAdminSession } from "@/lib/auth/admin";
import type { Db } from "@/lib/db/client";
import { anonUsers, buildingRequests, buildings, checks, events, leads, savedListings } from "@/lib/db/schema";
import { requestTextNorm } from "@/lib/db/repo/requests";

/** 12:00 Dubai on the seed day. */
export const NOW = new Date("2026-11-17T08:00:00Z");

export function pinClock(at: Date = NOW): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

/** A cookie jar with a valid admin session. */
export async function adminCookies(db: Db): Promise<Record<string, string>> {
  const { cookieValue } = await createAdminSession(db, "test-ip-hash");
  return { mz_admin: cookieValue };
}

export const daysAgo = (n: number, from: Date = NOW) => new Date(from.getTime() - n * 86_400_000);

export async function addAnon(db: Db, createdAt: Date = NOW): Promise<string> {
  const id = randomUUID();
  await db.insert(anonUsers).values({ id, createdAt, lastSeenAt: createdAt });
  return id;
}

export async function buildingId(db: Db, name: string): Promise<number> {
  const [b] = await db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name)).limit(1);
  if (!b) throw new Error(`no building ${name}`);
  return b.id;
}

let codeSeq = 0;
function nextCode(): string {
  codeSeq += 1;
  // CODE_RE alphabet (no 0/O/1/I/L): build a 6-char code from a counter.
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let n = codeSeq + 1000;
  let s = "";
  for (let i = 0; i < 6; i++) {
    s = alphabet[n % alphabet.length] + s;
    n = Math.floor(n / alphabet.length);
  }
  return s;
}

export interface CheckOpts {
  anonId: string;
  createdAt?: Date;
  buildingId?: number | null;
  bedrooms?: number;
  band?: "above" | "inline" | "below" | "thin" | "none";
  source?: "claude" | "manual" | "text";
  refCode?: string | null;
  editedFields?: string[];
  completionBasis?: "ready" | "off_plan";
}

export async function addCheck(db: Db, o: CheckOpts): Promise<{ id: number; code: string }> {
  const code = nextCode();
  const [row] = await db
    .insert(checks)
    .values({
      code,
      anonId: o.anonId,
      buildingId: o.buildingId ?? null,
      buildingName: null,
      buildingText: "Some Tower",
      bedrooms: o.bedrooms ?? 2,
      sizeSqft: 1284,
      priceAed: 2_450_000,
      source: o.source ?? "manual",
      editedFields: o.editedFields ?? [],
      band: o.band ?? "above",
      askingPsf: 1908.1,
      salesCount: 11,
      windowStart: "2025-11-17",
      windowEnd: "2026-11-17",
      minSales: 5,
      bandPct: 5,
      completionBasis: o.completionBasis ?? "ready",
      dataThrough: "2026-11-17",
      refCode: o.refCode ?? null,
      createdAt: o.createdAt ?? NOW,
    })
    .returning({ id: checks.id, code: checks.code });
  return row;
}

export async function addEvent(
  db: Db,
  name: string,
  opts: { createdAt?: Date; checkId?: number | null; meta?: Record<string, string | number | boolean | null> } = {},
): Promise<void> {
  await db.insert(events).values({ name, checkId: opts.checkId ?? null, meta: opts.meta ?? {}, createdAt: opts.createdAt ?? NOW });
}

export interface LeadOpts {
  anonId?: string | null;
  checkId?: number | null;
  name?: string | null;
  phone?: string | null;
  createdAt?: Date;
  status?: "new" | "sent" | "withdrawn";
  withdrawnAt?: Date | null;
}

export async function addLead(db: Db, o: LeadOpts = {}): Promise<number> {
  const phone = o.phone === undefined ? "+971501234567" : o.phone;
  const [row] = await db
    .insert(leads)
    .values({
      anonId: o.anonId ?? null,
      checkId: o.checkId ?? null,
      partner: "Test Mortgage Partner",
      consentVersion: "optin-v1",
      consentText: "Share my name...",
      consentTextSha256: "abc",
      consentedAt: o.createdAt ?? NOW,
      name: o.name === undefined ? "Sara" : o.name,
      phoneE164: phone,
      phoneLast4: "4567",
      ipHash: "iphash",
      buildingName: "Mockup Crest Tower",
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 2_450_000,
      downPct: 20,
      ratePct: 4.25,
      years: 25,
      loanEstimateAed: 1_960_000,
      monthlyEstimateAed: 10_618,
      status: o.status ?? "new",
      withdrawnAt: o.withdrawnAt ?? null,
      createdAt: o.createdAt ?? NOW,
    })
    .returning({ id: leads.id });
  return row.id;
}

export async function addRequest(
  db: Db,
  o: { anonId: string | null; text: string; area?: string | null; createdAt?: Date },
): Promise<number> {
  const [row] = await db
    .insert(buildingRequests)
    .values({
      anonId: o.anonId,
      textRaw: o.text,
      textNorm: requestTextNorm(o.text),
      areaText: o.area ?? null,
      source: "request_form",
      createdAt: o.createdAt ?? NOW,
    })
    .returning({ id: buildingRequests.id });
  return row.id;
}

export async function addSaved(db: Db, anonId: string, checkId: number): Promise<void> {
  await db.insert(savedListings).values({ anonId, checkId, bandAtSave: "above", diffAtSave: 0.14, countAtSave: 11 });
}
