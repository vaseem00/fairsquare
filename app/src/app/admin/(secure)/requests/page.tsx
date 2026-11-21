import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { RequestsView } from "@/components/admin/requests-view";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { listBuildingOptions, listRequestAggregates } from "@/lib/db/repo/admin";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = { title: COPY["adminUi.requestsH1"] };

/** /admin/requests (DESIGN.md section 3.8): requests aggregated by normalised text, "Mark as covered". */
export default async function AdminRequestsPage() {
  // Request-time only: the session check reads cookies and the clock.
  await requestTime();
  await requireAdminPage();
  const db = getDb();
  // The picker needs id, name and area only (thousands of DLD buildings: no aliases or counts).
  const [requests, buildings] = await Promise.all([listRequestAggregates(db), listBuildingOptions(db)]);
  return <RequestsView requests={requests} buildings={buildings} />;
}
