import type { Metadata } from "next";
import { requestTime } from "@/components/admin/request-time";
import { SalesView } from "@/components/admin/sales-view";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { COPY } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { listAdminSales, listBuildingOptions, searchAdminBuildings } from "@/lib/db/repo/admin";
import { getDataSourcePanel } from "@/lib/ingest/data-source";
import { openDataDir } from "@/lib/ingest/load";
import { log } from "@/lib/log";
import { SALES_TABS, type SalesTab } from "@/lib/validation/admin";

/** Admin pages block on the session check (cookies, database, clock): no instant static shell. */
export const instant = false;

export const metadata: Metadata = { title: COPY["adminUi.salesH1"] };

/**
 * /admin/sales (DESIGN.md section 3.8): the "Data source" panel (REAL_DATA.md section 12), then
 * Sales, Register a sale, Buildings, Import CSV.
 */
export default async function AdminSalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Request-time only: the session check reads cookies and the clock.
  await requestTime();
  await requireAdminPage();
  const raw = (await searchParams).tab;
  const tab = (SALES_TABS as readonly string[]).includes(String(raw)) ? (raw as SalesTab) : "sales";
  const db = getDb();
  // The Buildings tab gets its first page (50); the pickers get id, name and area of every building.
  const [sales, buildings, options, dataSource] = await Promise.all([
    listAdminSales(db),
    searchAdminBuildings(db),
    listBuildingOptions(db),
    // The panel is informational: when it cannot be read the rest of the page still works.
    getDataSourcePanel(db, openDataDir()).catch((err: unknown) => {
      log.warn("admin_data_source_failed", { err });
      return null;
    }),
  ]);
  return (
    <SalesView initialSales={sales} initialBuildings={buildings} initialOptions={options} initialTab={tab} dataSource={dataSource} />
  );
}
