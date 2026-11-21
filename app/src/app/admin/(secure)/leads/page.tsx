import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { LeadsView } from "@/components/admin/leads-view";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { listAdminLeads } from "@/lib/db/repo/admin";
import { LeadsQuerySchema, type LeadsQuery } from "@/lib/validation/admin";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = { title: COPY["adminUi.leadsH1"] };

type SearchParams = Record<string, string | string[] | undefined>;

/** Reads `?status=&from=&to=`, dropping anything invalid. */
function leadsQuery(sp: SearchParams): LeadsQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const raw = { status: first(sp.status), from: first(sp.from), to: first(sp.to) };
  const out: LeadsQuery = {};
  for (const key of ["status", "from", "to"] as const) {
    const one = LeadsQuerySchema.safeParse({ [key]: raw[key] });
    if (one.success && one.data[key] !== undefined) Object.assign(out, { [key]: one.data[key] });
  }
  return out;
}

/** /admin/leads (DESIGN.md section 3.8): masked phones, reveal, sent and partner-told tracking, export. */
export default async function AdminLeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Request-time only: the session check reads cookies and the clock.
  await requestTime();
  await requireAdminPage();
  const query = leadsQuery(await searchParams);
  const leads = await listAdminLeads(getDb(), query);
  return <LeadsView key={JSON.stringify(query)} leads={leads} query={query} />;
}
