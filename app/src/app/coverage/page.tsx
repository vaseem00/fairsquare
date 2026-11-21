import type { Metadata } from "next";
import { connection } from "next/server";
import { CoverageView } from "@/components/coverage/coverage-view";
import { COPY } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { getCoverage } from "@/lib/db/repo/buildings";
import { dubaiToday } from "@/lib/domain/dates";
import { getEnv } from "@/lib/env";
import { CoverageQuerySchema } from "@/lib/validation/api";

export const metadata: Metadata = {
  title: COPY["coverage.h1"],
  description: COPY["coverage.intro"],
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /coverage (DESIGN.md section 3.7, A§4.5, REAL_DATA.md section 11): server-rendered from getCoverage()
 * (`?q=` searches name or area, `?page=` pages by 50), so the page works as a plain link. The list
 * then searches and pages in place through GET /api/buildings and keeps the URL in step.
 */
export default async function CoveragePage({ searchParams }: PageProps<"/coverage">) {
  // Today's Dubai date and the live sales table: render per request.
  await connection();
  const sp = await searchParams;
  const parsed = CoverageQuerySchema.safeParse({ q: first(sp.q) ?? null, page: first(sp.page) || null });
  const query = parsed.success ? { q: parsed.data.q ?? null, page: parsed.data.page ?? 1 } : {};
  const coverage = await getCoverage(getDb(), dubaiToday(), getEnv().rules, query);
  return <CoverageView initial={coverage} nearby={getEnv().NEARBY_TIER !== "off"} />;
}
