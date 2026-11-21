/**
 * DELETE /api/saved/[code] (A§4.3, anon required): soft-deletes the saved listing (`removed_at`) and
 * returns 204. Idempotent: an unsaved, already removed or unknown code is also 204. Saving the same
 * code again restores it with its original savedAt and baseline (the Saved page's Undo).
 */
import { trackEvent } from "@/lib/db/repo/events";
import { unsaveCheck } from "@/lib/db/repo/saved";
import { noContent, route } from "@/lib/http/handler";

export const DELETE = route<{ code: string }>({ anon: "require" }, async (ctx, params) => {
  const anonId = ctx.anonId as string;
  const checkId = await unsaveCheck(ctx.db, anonId, String(params.code ?? ""));
  if (checkId !== null) await trackEvent(ctx.db, { name: "unsaved", anonId, checkId });
  return noContent();
});
