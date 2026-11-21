/**
 * POST /api/admin/sales/preview `NewSale` (A§4.4): `SalePreview` = the 12-month median before and after
 * for that building and bedroom count, the saved listings that will show a new sale, and the
 * `admin.impact` sentence. Writes nothing. Same validation as POST /api/admin/sales.
 */
import { previewSale } from "@/lib/db/repo/admin";
import { getEnv } from "@/lib/env";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { newSaleSchema } from "@/lib/validation/admin";

export const POST = route({ admin: true }, async (ctx) => {
  const body = await readJson(ctx.req, newSaleSchema(ctx.today));
  const preview = await previewSale(ctx.db, body, ctx.today, getEnv().rules);
  if (!preview) throw httpError("building_not_found");
  return json(preview);
});
