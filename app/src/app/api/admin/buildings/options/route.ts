/**
 * GET /api/admin/buildings/options → `{ options: AdminBuildingOption[] }`: every building as id,
 * name and area, by name, for the admin pickers ("Register a sale", "Mark as covered"). No aliases or
 * counts, so it stays small with thousands of DLD buildings; the pickers render at most 100 matches.
 */
import { listBuildingOptions } from "@/lib/db/repo/admin";
import { json, route } from "@/lib/http/handler";

export const GET = route({ admin: true }, async (ctx) => {
  return json({ options: await listBuildingOptions(ctx.db) });
});
