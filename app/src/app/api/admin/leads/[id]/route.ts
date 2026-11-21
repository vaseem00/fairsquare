/**
 * PATCH /api/admin/leads/[id] (A§4.4): `{ status?: "sent", withdrawalNotified?: true }` →
 * `{ lead: AdminLeadRow }`. "sent" sets `sent_at` (only from "new"; a withdrawn lead stays withdrawn);
 * `withdrawalNotified` records that the partner was told (only for a withdrawn lead). Idempotent.
 */
import { updateAdminLead } from "@/lib/db/repo/admin";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { LeadPatchSchema } from "@/lib/validation/admin";
import { IdSchema } from "@/lib/validation/fields";

export const PATCH = route<{ id: string }>({ admin: true }, async (ctx, params) => {
  const id = IdSchema.safeParse(params.id);
  if (!id.success) throw httpError("not_found");
  const patch = await readJson(ctx.req, LeadPatchSchema);
  const lead = await updateAdminLead(ctx.db, id.data, patch);
  if (!lead) throw httpError("not_found");
  return json({ lead });
});
