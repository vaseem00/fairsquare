/**
 * Sales for admins (A§4.4).
 * - GET ?buildingId=&bedrooms=: `{ sales: AdminSale[] }`, newest sale date first (at most 500).
 * - POST `NewSale` → 201 `{ sale }`. Stored with `source = "admin"` (there is no source picker) and
 *   its `completion` ("ready" by default, or "off_plan"; REAL_DATA.md section 12). A future date,
 *   out-of-range numbers, an unknown completion or a wrong price per sq ft → 422;
 *   an unknown building → 404 building_not_found; a reference already used → 422 on `fields.externalRef`.
 */
import { COPY } from "@/lib/copy";
import { createAdminSale, listAdminSales, saleRefTaken } from "@/lib/db/repo/admin";
import { getBuilding } from "@/lib/db/repo/buildings";
import { isUniqueViolation } from "@/lib/db/repo/checks";
import { HttpError, httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { newSaleSchema, SalesQuerySchema } from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

export const GET = route({ admin: true }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const raw = Object.fromEntries([...sp.entries()].filter(([, v]) => v !== ""));
  const q = SalesQuerySchema.safeParse(raw);
  if (!q.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(q.error) });
  return json({ sales: await listAdminSales(ctx.db, q.data) });
});

export const POST = route({ admin: true }, async (ctx) => {
  const body = await readJson(ctx.req, newSaleSchema(ctx.today));
  const building = await getBuilding(ctx.db, body.buildingId);
  if (!building) throw httpError("building_not_found");
  const refTaken = () => new HttpError(422, "validation_failed", { fields: { externalRef: COPY["adminUi.err.refTaken"] } });
  if (body.externalRef && (await saleRefTaken(ctx.db, body.externalRef))) throw refTaken();
  try {
    const sale = await createAdminSale(ctx.db, body, building);
    return json({ sale }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) throw refTaken();
    throw err;
  }
});
