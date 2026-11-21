import "server-only";
/**
 * Fixed-window rate limits (A§6.4), stored in `rate_limits`.
 * - "day" is the Dubai calendar day (UTC+4, no DST): it resets at Dubai midnight.
 * - "hour" and "15m" are aligned to the clock.
 * Increments are atomic (INSERT … ON CONFLICT DO UPDATE … RETURNING count). A denied attempt still
 * counts against the key that denied it, but not against the keys after it (see enforce()).
 * Expired rows are pruned on boot (migrateAndSeed) and on about every 500th call.
 */
import { lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { dubaiToday } from "@/lib/domain/dates";
import { HttpError, STATUS_FOR_CODE } from "@/lib/http/errors";
import { log } from "@/lib/log";
import type { ErrorCode, RateLimitScope } from "@/lib/types";

export type Window = "day" | "hour" | "15m";

export interface HitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** Seconds until the window ends (at least 1). */
  retryAfterSec: number;
}

export interface RateRule {
  key: string;
  limit: number;
  window: Window;
  /** The error when this rule denies: usually `rate_limited` (429); `daily_cap_reached` gives 503. */
  onDeny: ErrorCode;
  /** Picks the `rate_limited` message: extract_burst | extract_daily | spam | admin_login. */
  scope: RateLimitScope | (string & {});
}

const HOUR_MS = 3_600_000;
const QUARTER_MS = 15 * 60_000;
const DUBAI_OFFSET = "+04:00";
const PRUNE_EVERY = 500;

let callsSincePrune = 0;

/** The window containing `nowMs`: [start, end). */
export function windowBounds(window: Window, nowMs: number): { start: Date; end: Date } {
  switch (window) {
    case "day": {
      const start = Date.parse(`${dubaiToday(new Date(nowMs))}T00:00:00${DUBAI_OFFSET}`);
      return { start: new Date(start), end: new Date(start + 24 * HOUR_MS) };
    }
    case "hour": {
      const start = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
      return { start: new Date(start), end: new Date(start + HOUR_MS) };
    }
    case "15m": {
      const start = Math.floor(nowMs / QUARTER_MS) * QUARTER_MS;
      return { start: new Date(start), end: new Date(start + QUARTER_MS) };
    }
  }
}

/** Deletes rows whose window has ended. Returns the number deleted. */
export async function pruneRateLimits(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, now)).returning({ k: rateLimits.key });
  return rows.length;
}

/** Counts one call against `key` and says whether it is within `limit` for the current window. */
export async function hit(db: Db, key: string, limit: number, window: Window): Promise<HitResult> {
  const nowMs = Date.now();
  const { start, end } = windowBounds(window, nowMs);
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1, expiresAt: end })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = rows[0]?.count ?? 1;

  callsSincePrune += 1;
  if (callsSincePrune >= PRUNE_EVERY) {
    callsSincePrune = 0;
    try {
      await pruneRateLimits(db, new Date(nowMs));
    } catch (err) {
      log.warn("rate_limit_prune_failed", { err });
    }
  }

  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSec: Math.max(1, Math.ceil((end.getTime() - nowMs) / 1000)),
  };
}

/**
 * Hits the rules in the order given and throws for the first one that denies. The rules after a
 * denial are not counted, so put the narrow keys (per person, per IP) first and shared keys (a global
 * cap) last: a client that is already over its own limit can never use up everyone's shared quota.
 * The denying rule's own count still goes up. `retryAfterSec` is that rule's time to its window end.
 */
export async function enforce(db: Db, rules: RateRule[]): Promise<void> {
  for (const rule of rules) {
    const res = await hit(db, rule.key, rule.limit, rule.window);
    if (res.allowed) continue;
    log.info("rate_limited", { scope: rule.scope, window: rule.window, limit: rule.limit, count: res.count });
    throw new HttpError(STATUS_FOR_CODE[rule.onDeny], rule.onDeny, {
      retryAfterSec: res.retryAfterSec,
      scope: rule.scope,
    });
  }
}

/** Tests: reset the prune counter. */
export function __resetRateLimitForTests(): void {
  callsSincePrune = 0;
}
