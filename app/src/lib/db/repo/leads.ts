import "server-only";
/**
 * Adviser leads (A§3.3, A§3.4, A§6.7, WP4). PII is the lead's `name` and `phone_e164` only.
 * - One active lead per person and comparison (`leads_active_uq`, partial on `withdrawn_at is null`).
 * - Withdrawal sets `status = withdrawn` and `withdrawn_at`, nulls the name and phone and keeps
 *   `phone_last4` for the partner reference. It is idempotent.
 * - The person sees their own phone masked; a withdrawn lead has no phone to show.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { maskPhone } from "@/lib/domain/phone";
import type { LeadView } from "@/lib/types";
import type { Db } from "../client";
import { checks, leads, type LeadRow, type NewLead } from "../schema";
import { isUniqueViolation } from "./checks";

const leadWithCode = { lead: leads, checkCode: checks.code } as const;

/** The DTO the person sees (A§4.2). `checkCode` is null once the comparison was deleted. */
export function toLeadView(row: LeadRow, checkCode: string | null): LeadView {
  return {
    id: row.id,
    partner: row.partner,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    phoneMasked: row.phoneE164 ? maskPhone(row.phoneE164) : null,
    checkCode,
    buildingName: row.buildingName,
    bedrooms: row.bedrooms,
    priceAed: row.priceAed,
  };
}

/** The person's active (not withdrawn) lead for a comparison, or null. */
export async function getActiveLead(db: Db, anonId: string, checkId: number): Promise<LeadView | null> {
  const rows = await db
    .select(leadWithCode)
    .from(leads)
    .leftJoin(checks, eq(checks.id, leads.checkId))
    .where(and(eq(leads.anonId, anonId), eq(leads.checkId, checkId), isNull(leads.withdrawnAt)))
    .limit(1);
  return rows[0] ? toLeadView(rows[0].lead, rows[0].checkCode) : null;
}

/**
 * Stores a lead. When the person already has an active lead for the comparison (also when a
 * concurrent request won the race), returns that one with `created: false`.
 */
export async function createLead(
  db: Db,
  values: Omit<NewLead, "id" | "createdAt" | "status" | "sentAt" | "withdrawnAt" | "withdrawalNotifiedAt"> & {
    anonId: string;
    checkId: number;
  },
): Promise<{ lead: LeadView; created: boolean }> {
  const existing = await getActiveLead(db, values.anonId, values.checkId);
  if (existing) return { lead: existing, created: false };
  try {
    const [row] = await db.insert(leads).values(values).returning();
    const [code] = await db.select({ code: checks.code }).from(checks).where(eq(checks.id, values.checkId)).limit(1);
    return { lead: toLeadView(row, code?.code ?? null), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await getActiveLead(db, values.anonId, values.checkId);
    if (!raced) throw err;
    return { lead: raced, created: false };
  }
}

/**
 * Withdraws one of the person's leads: status withdrawn, `withdrawn_at` set once, name and phone
 * nulled, `phone_last4` kept. Returns null when the id is not this person's lead (→ 404), and
 * `changed: false` when it was already withdrawn.
 */
export async function withdrawLead(
  db: Db,
  anonId: string,
  id: number,
): Promise<{ lead: LeadView; changed: boolean } | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const updated = await db
    .update(leads)
    .set({ status: "withdrawn", withdrawnAt: sql`now()`, name: null, phoneE164: null })
    .where(and(eq(leads.id, id), eq(leads.anonId, anonId), isNull(leads.withdrawnAt)))
    .returning({ id: leads.id });
  const rows = await db
    .select(leadWithCode)
    .from(leads)
    .leftJoin(checks, eq(checks.id, leads.checkId))
    .where(and(eq(leads.id, id), eq(leads.anonId, anonId)))
    .limit(1);
  if (!rows[0]) return null;
  return { lead: toLeadView(rows[0].lead, rows[0].checkCode), changed: updated.length > 0 };
}

/** GET /api/leads and MeView.leads: the person's leads, newest first. */
export async function listLeadsForAnon(db: Db, anonId: string): Promise<LeadView[]> {
  const rows = await db
    .select(leadWithCode)
    .from(leads)
    .leftJoin(checks, eq(checks.id, leads.checkId))
    .where(eq(leads.anonId, anonId))
    .orderBy(desc(leads.createdAt), desc(leads.id));
  return rows.map((r) => toLeadView(r.lead, r.checkCode));
}
