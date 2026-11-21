/**
 * GET /api/meta (REAL_DATA.md sections 7, 9 and 10): 200 `MetaResponse` =
 * `{ data, fromTheData }`. `data` is the loaded sales data (range, stale flag, dataset and licence
 * links; `loaded: false` before the first load); `fromTheData` is the home page's "From the data"
 * panel (null while no data is loaded), kept for an hour on the server. Public; no anon cookie.
 */
import { readDataMeta, toDataStatusView } from "@/lib/data-status";
import { getEnv } from "@/lib/env";
import { json, route } from "@/lib/http/handler";
import { getFromTheData } from "@/lib/services/from-the-data";
import type { MetaResponse } from "@/lib/types";

export const GET = route({ anon: "none" }, async (ctx) => {
  const [meta, fromTheData] = await Promise.all([readDataMeta(ctx.db), getFromTheData(ctx.db, ctx.today, getEnv().rules)]);
  const body: MetaResponse = { data: toDataStatusView(meta, ctx.today), fromTheData };
  return json(body);
});
