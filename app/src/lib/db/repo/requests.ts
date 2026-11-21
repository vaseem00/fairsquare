import "server-only";
/**
 * Building requests (A§3.4, A§4.3 POST /api/requests, WP3). A request is an explicit ask: "Request it
 * and track" on the not-covered result (source none_of_these, with the comparison) or the Coverage form
 * (source request_form). One row per person and normalised text (`text_norm`); rows whose `anon_id`
 * was cleared by "Delete all my data" stay and still count as demand.
 */
import { and, desc, eq, inArray, isNull, ne, or, count } from "drizzle-orm";
import { normalise } from "@/lib/domain/normalise";
import type { RequestView } from "@/lib/types";
import type { Db } from "../client";
import { buildingRequests, buildings } from "../schema";

export type RequestSource = "none_of_these" | "request_form";

/** The grouping key for a request: `normalise(text)`, or the lowercased text when that is empty. */
export function requestTextNorm(text: string): string {
  const n = normalise(text);
  if (n) return n;
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stores the ask unless this person already asked for the same building (same `text_norm`).
 * Returns the row id and whether this call created it.
 */
export async function upsertRequest(
  db: Db,
  r: { anonId: string; text: string; area: string | null; checkId: number | null; source: RequestSource },
): Promise<{ id: number; created: boolean }> {
  const textNorm = requestTextNorm(r.text);
  const findExisting = async () => {
    const rows = await db
      .select({ id: buildingRequests.id })
      .from(buildingRequests)
      .where(and(eq(buildingRequests.anonId, r.anonId), eq(buildingRequests.textNorm, textNorm)))
      .limit(1);
    return rows[0]?.id ?? null;
  };

  const existing = await findExisting();
  if (existing !== null) return { id: existing, created: false };

  const area = r.area?.trim() ? r.area.trim() : null;
  const inserted = await db
    .insert(buildingRequests)
    .values({
      anonId: r.anonId,
      textRaw: r.text.trim(),
      textNorm,
      areaText: area,
      source: r.source,
      checkId: r.checkId,
    })
    .onConflictDoNothing()
    .returning({ id: buildingRequests.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };

  // A concurrent request from the same person won the race.
  const raced = await findExisting();
  if (raced === null) throw new Error("upsertRequest: insert conflicted but no row was found");
  return { id: raced, created: false };
}

/** Rows with this `text_norm` that belong to someone else, including rows whose `anon_id` was cleared. */
export async function countOthersAsked(db: Db, textNorm: string, anonId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(buildingRequests)
    .where(
      and(
        eq(buildingRequests.textNorm, textNorm),
        or(isNull(buildingRequests.anonId), ne(buildingRequests.anonId, anonId)),
      ),
    );
  return Number(row?.n ?? 0);
}

/** One RequestView per building this person asked for (per `text_norm`), newest first. */
export async function listRequestsForAnon(db: Db, anonId: string): Promise<RequestView[]> {
  const rows = await db
    .select({
      id: buildingRequests.id,
      textRaw: buildingRequests.textRaw,
      textNorm: buildingRequests.textNorm,
      areaText: buildingRequests.areaText,
      createdAt: buildingRequests.createdAt,
      resolvedId: buildings.id,
      resolvedName: buildings.name,
    })
    .from(buildingRequests)
    .leftJoin(buildings, eq(buildings.id, buildingRequests.resolvedBuildingId))
    .where(eq(buildingRequests.anonId, anonId))
    .orderBy(desc(buildingRequests.createdAt), desc(buildingRequests.id));
  if (rows.length === 0) return [];

  const seen = new Set<string>();
  const mine = rows.filter((r) => (seen.has(r.textNorm) ? false : (seen.add(r.textNorm), true)));

  const others = await db
    .select({ textNorm: buildingRequests.textNorm, n: count() })
    .from(buildingRequests)
    .where(
      and(
        inArray(
          buildingRequests.textNorm,
          mine.map((r) => r.textNorm),
        ),
        or(isNull(buildingRequests.anonId), ne(buildingRequests.anonId, anonId)),
      ),
    )
    .groupBy(buildingRequests.textNorm);
  const othersBy = new Map(others.map((o) => [o.textNorm, Number(o.n)]));

  return mine.map((r) => ({
    id: r.id,
    text: r.textRaw,
    area: r.areaText,
    createdAt: r.createdAt.toISOString(),
    othersAsked: othersBy.get(r.textNorm) ?? 0,
    covered: r.resolvedId !== null,
    coveredBuilding: r.resolvedId !== null && r.resolvedName !== null ? { id: r.resolvedId, name: r.resolvedName } : null,
  }));
}
