import "server-only";
/**
 * Usage events (A§3.4). `trackEvent` never throws: analytics must never break a request.
 * `meta` is built by the server only and never holds PII (no names, phones, text or IPs).
 */
import { eq } from "drizzle-orm";
import { CODE_RE } from "@/lib/domain/share-code";
import { log } from "@/lib/log";
import type { EventName } from "@/lib/types";
import type { Db } from "../client";
import { checks, events } from "../schema";
import { UUID_RE } from "./anon";

export type EventMeta = Record<string, string | number | boolean | null>;

export interface TrackedEvent {
  name: EventName;
  anonId?: string | null;
  checkId?: number | null;
  meta?: EventMeta;
}

export async function trackEvent(db: Db, e: TrackedEvent): Promise<void> {
  try {
    const anonId = e.anonId && UUID_RE.test(e.anonId) ? e.anonId : null;
    await db.insert(events).values({
      name: e.name,
      anonId,
      checkId: e.checkId ?? null,
      meta: e.meta ?? {},
    });
  } catch (err) {
    log.warn("event_track_failed", { eventName: e.name, err });
  }
}

/** The id of the comparison with this share code, or null (unknown or malformed code). */
export async function checkIdForCode(db: Db, code: string | null | undefined): Promise<number | null> {
  if (!code || !CODE_RE.test(code)) return null;
  const rows = await db.select({ id: checks.id }).from(checks).where(eq(checks.code, code)).limit(1);
  return rows[0]?.id ?? null;
}
