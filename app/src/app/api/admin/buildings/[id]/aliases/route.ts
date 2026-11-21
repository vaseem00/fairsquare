/**
 * POST /api/admin/buildings/[id]/aliases `{ alias }` (A§4.4): 201 `{ alias, created: true }` for a new
 * alias, 200 `{ alias, created: false }` when the building already has it. Matching sees it at once.
 * Unknown building → 404 building_not_found; an alias with no letters or digits → 422 on `fields.alias`.
 */
import { COPY } from "@/lib/copy";
import { addAlias } from "@/lib/db/repo/admin";
import { HttpError, httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { AliasCreateSchema } from "@/lib/validation/admin";
import { IdSchema } from "@/lib/validation/fields";

export const POST = route<{ id: string }>({ admin: true }, async (ctx, params) => {
  const id = IdSchema.safeParse(params.id);
  if (!id.success) throw httpError("building_not_found");
  const body = await readJson(ctx.req, AliasCreateSchema);
  const res = await addAlias(ctx.db, id.data, body.alias);
  if (!res) throw httpError("building_not_found");
  if (!res.alias) throw new HttpError(422, "validation_failed", { fields: { alias: COPY["adminUi.err.alias"] } });
  return json({ alias: res.alias, created: res.created }, res.created ? 201 : 200);
});
