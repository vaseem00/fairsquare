/**
 * Building requests for admins (A§4.4).
 * - GET: `{ requests: AdminRequestRow[] }`, aggregated by `text_norm` (requests, people, first and last
 *   asked; `text`/`area` are the latest spelling), most asked first.
 * - PATCH `{ textNorm, resolvedBuildingId }`: "Mark as covered" links every row with that text to the
 *   building (null unlinks). Requesters then see "Now covered" under Saved.
 */
import { getBuilding } from "@/lib/db/repo/buildings";
import { listRequestAggregates, resolveRequests } from "@/lib/db/repo/admin";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { RequestResolveSchema } from "@/lib/validation/admin";

export const GET = route({ admin: true }, async (ctx) => {
  return json({ requests: await listRequestAggregates(ctx.db) });
});

export const PATCH = route({ admin: true }, async (ctx) => {
  const body = await readJson(ctx.req, RequestResolveSchema);
  let building: { id: number; name: string } | null = null;
  if (body.resolvedBuildingId !== null) {
    const b = await getBuilding(ctx.db, body.resolvedBuildingId);
    if (!b) throw httpError("building_not_found");
    building = { id: b.id, name: b.name };
  }
  const updated = await resolveRequests(ctx.db, body.textNorm, building?.id ?? null);
  if (updated === 0) throw httpError("not_found");
  return json({ textNorm: body.textNorm, updated, resolvedBuilding: building });
});
