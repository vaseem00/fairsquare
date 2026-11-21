/**
 * Seeds the synthetic test buildings (tests/fixtures/test-buildings.ts) the way the open-data loader
 * stores real ones: buildings with `dld_key` and `area_dld`, their aliases, ready sales with
 * `source = 'open_data'` and an `external_ref`, and app_meta `data_from` / `data_through` (= today,
 * so comparison windows end today and no stale-data note shows). Tests only.
 */
import { count } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { setAppMeta } from "@/lib/db/meta";
import { buildingAliases, buildings, sales } from "@/lib/db/schema";
import { addDays } from "@/lib/domain/dates";
import { normalise } from "@/lib/domain/normalise";
import { dldKey } from "@/lib/ingest/identity";
import { TEST_BUILDINGS, TEST_TODAY, type TestBuilding } from "../fixtures/test-buildings";

/** The building name plus each alias, normalised and de-duplicated (the name is always an alias). */
export function testAliases(b: Pick<TestBuilding, "name" | "aliases">): Array<{ raw: string; norm: string }> {
  const seen = new Set<string>();
  const out: Array<{ raw: string; norm: string }> = [];
  for (const raw of [b.name, ...b.aliases]) {
    const norm = normalise(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ raw, norm });
  }
  return out;
}

/** The external_ref of test sale `j` of building `i` (both 0-based). */
export const testSaleRef = (i: number, j: number) => `test:${i + 1}-${j + 1}`;

export interface SeedCounts {
  buildings: number;
  aliases: number;
  sales: number;
}

/**
 * Inserts the 6 test buildings, 9 aliases and 32 sales (dated `daysAgo` before `today`) in one
 * transaction. Runs only on a database without buildings; returns the number of sales added (0 otherwise).
 */
export async function seedTestBuildings(db: Db, today: string = TEST_TODAY): Promise<number> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [{ n }] = await tx.select({ n: count() }).from(buildings);
    if (n > 0) return 0;
    let added = 0;
    let first = today;
    for (const [i, b] of TEST_BUILDINGS.entries()) {
      const [row] = await tx
        .insert(buildings)
        .values({
          name: b.name,
          area: b.area,
          areaDld: b.areaDld,
          project: b.project,
          masterProject: b.masterProject,
          dldKey: dldKey(b.name, b.areaDld),
        })
        .returning({ id: buildings.id });
      await tx
        .insert(buildingAliases)
        .values(testAliases(b).map((a) => ({ buildingId: row.id, aliasRaw: a.raw, aliasNorm: a.norm, source: "seed" as const })));
      await tx.insert(sales).values(
        b.sales.map(([daysAgo, sizeSqft, priceAed], j) => {
          const saleDate = addDays(today, -daysAgo);
          if (saleDate < first) first = saleDate;
          return {
            buildingId: row.id,
            saleDate,
            bedrooms: b.bedrooms,
            sizeSqft,
            priceAed,
            source: "open_data" as const,
            completion: "ready" as const,
            externalRef: testSaleRef(i, j),
            rawBuildingName: b.name.toUpperCase(),
          };
        }),
      );
      added += b.sales.length;
    }
    await setAppMeta(tx, "data_from", first);
    await setAppMeta(tx, "data_through", today);
    return added;
  });
}

/** Counts of buildings, aliases and sales (seed checks). */
export async function seedCounts(db: Db): Promise<SeedCounts> {
  const [b] = await db.select({ n: count() }).from(buildings);
  const [a] = await db.select({ n: count() }).from(buildingAliases);
  const [s] = await db.select({ n: count() }).from(sales);
  return { buildings: b.n, aliases: a.n, sales: s.n };
}
