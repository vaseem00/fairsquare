import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { OverviewView } from "@/components/admin/overview-view";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { getAdminStats } from "@/lib/db/repo/admin";
import { dubaiToday } from "@/lib/domain/dates";
import { getEnv } from "@/lib/env";
import { parseAdminRange } from "@/lib/validation/admin";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = { title: COPY["adminUi.overviewH1"] };

/** /admin (DESIGN.md section 3.8): KPIs, funnel, verdicts and comparisons per day for 7/30/90 days. */
export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Request-time only: the session check reads cookies and the clock.
  await requestTime();
  await requireAdminPage();
  const range = parseAdminRange((await searchParams).range);
  const env = getEnv();
  const db = getDb();
  const today = dubaiToday();
  const stats = await getAdminStats(db, { today, range, rules: env.rules });
  return <OverviewView stats={stats} />;
}
