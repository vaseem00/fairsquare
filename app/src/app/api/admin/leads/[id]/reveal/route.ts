/**
 * GET /api/admin/leads/[id]/reveal (A§4.4, A§6.7): `{ phoneE164, name }` (both null after withdrawal).
 * Every reveal records a `lead_revealed` event (no PII in its meta).
 */
import { revealLead } from "@/lib/db/repo/admin";
import { trackEvent } from "@/lib/db/repo/events";
import { httpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";
import type { LeadReveal } from "@/lib/validation/admin";
import { IdSchema } from "@/lib/validation/fields";

export const GET = route<{ id: string }>({ admin: true }, async (ctx, params) => {
  const id = IdSchema.safeParse(params.id);
  if (!id.success) throw httpError("not_found");
  const found = await revealLead(ctx.db, id.data);
  if (!found) throw httpError("not_found");
  await trackEvent(ctx.db, { name: "lead_revealed", checkId: found.checkId, meta: { leadId: id.data } });
  const body: LeadReveal = { phoneE164: found.phoneE164, name: found.name };
  return json(body);
});
