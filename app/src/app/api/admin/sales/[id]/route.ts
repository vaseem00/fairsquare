/**
 * DELETE /api/admin/sales/[id] (A§4.4): 204. The UI confirms first with an AlertDialog ("Delete this
 * sale?"). Unknown id → 404 not_found.
 */
import { deleteSale } from "@/lib/db/repo/admin";
import { httpError } from "@/lib/http/errors";
import { noContent, route } from "@/lib/http/handler";
import { log } from "@/lib/log";
import { IdSchema } from "@/lib/validation/fields";

export const DELETE = route<{ id: string }>({ admin: true }, async (ctx, params) => {
  const id = IdSchema.safeParse(params.id);
  if (!id.success || !(await deleteSale(ctx.db, id.data))) throw httpError("not_found");
  log.info("admin_sale_deleted", { requestId: ctx.requestId, saleId: id.data });
  return noContent();
});
