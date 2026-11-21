/**
 * Buildings for admins (A§4.4; REAL_DATA.md sections 11 and 12).
 * - GET `?q=&page=`: one page of 50 buildings by name, with aliases and sale counts →
 *   `AdminBuildingsPage`. `q` (2+ characters; shorter is ignored) searches name, area, DLD area and
 *   aliases on the server, so thousands of DLD buildings never travel at once. An invalid `page` → 422.
 * - POST `{ name, area, project?, masterProject?, aliases? }` → 201 `{ building }`. The name is
 *   always an alias too. Matching sees the building at once (alias cache invalidated).
 *   The same name in the same area (or DLD area) → 422 on `fields.name`; DLD names repeat across
 *   areas, so the same name elsewhere is allowed (REAL_DATA.md section 5).
 * The pickers' full id/name/area list is GET /api/admin/buildings/options.
 */
import { COPY } from "@/lib/copy";
import { buildingNameTaken, createBuilding, getAdminBuilding, searchAdminBuildings } from "@/lib/db/repo/admin";
import { isUniqueViolation } from "@/lib/db/repo/checks";
import { HttpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { AdminBuildingsQuerySchema, BuildingCreateSchema } from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

export const GET = route({ admin: true }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const page = sp.get("page");
  const parsed = AdminBuildingsQuerySchema.safeParse({ q: sp.get("q"), page: page === null || page.trim() === "" ? null : page });
  if (!parsed.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(parsed.error) });
  return json(await searchAdminBuildings(ctx.db, { q: parsed.data.q ?? null, page: parsed.data.page ?? 1 }));
});

export const POST = route({ admin: true }, async (ctx) => {
  const body = await readJson(ctx.req, BuildingCreateSchema);
  const taken = () => new HttpError(422, "validation_failed", { fields: { name: COPY["adminUi.err.nameTaken"] } });
  if (await buildingNameTaken(ctx.db, body.name, body.area)) throw taken();
  let id: number;
  try {
    id = await createBuilding(ctx.db, body);
  } catch (err) {
    if (isUniqueViolation(err)) throw taken();
    throw err;
  }
  return json({ building: await getAdminBuilding(ctx.db, id) }, 201);
});
