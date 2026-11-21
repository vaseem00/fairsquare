/**
 * GET /api/admin/data-source (A§4.4, REAL_DATA.md section 12): the "Data source" panel of the sales
 * data page → 200 `{ dataSource: DataSourcePanel }`: dataset title and link, downloaded date, data
 * range, rows, buildings, last load time and the exclusion counts from the snapshot's manifest, plus
 * whether a newer snapshot is waiting to load. Admin only.
 */
import { json, route } from "@/lib/http/handler";
import { getDataSourcePanel } from "@/lib/ingest/data-source";
import { openDataDir } from "@/lib/ingest/load";

export const GET = route({ admin: true }, async (ctx) => {
  return json({ dataSource: await getDataSourcePanel(ctx.db, openDataDir()) });
});
