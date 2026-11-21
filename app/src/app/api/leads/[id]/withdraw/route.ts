/**
 * POST /api/leads/[id]/withdraw (A§4.3, anon required): 200 `{ lead }`. Sets status withdrawn and
 * `withdrawn_at`, nulls the name and phone, keeps `phone_last4`. Idempotent (a second call returns the
 * same lead and records nothing). Someone else's lead id, or an unknown or malformed id → 404.
 */
import { trackEvent } from "@/lib/db/repo/events";
import { withdrawLead } from "@/lib/db/repo/leads";
import { httpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";

export const POST = route<{ id: string }>({ anon: "require" }, async (ctx, params) => {
  const anonId = ctx.anonId as string;
  const raw = String(params.id ?? "");
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  const result = Number.isSafeInteger(id) ? await withdrawLead(ctx.db, anonId, id) : null;
  if (!result) throw httpError("not_found");
  if (result.changed) {
    await trackEvent(ctx.db, { name: "lead_withdrawn", anonId, meta: { leadId: result.lead.id, via: "person" } });
  }
  return json({ lead: result.lead });
});
