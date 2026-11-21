/**
 * POST /api/saved/[code]/seen (A§4.3, anon required): "Open" on the Saved page. Sets `seen_at = now()`,
 * which clears that listing from the header badge (`MeView.savedWithNewSales`), and returns 204.
 * `newSalesSinceSave` is unaffected. An unknown, unsaved or removed code → 404 not_found.
 */
import { markSeen } from "@/lib/db/repo/saved";
import { httpError } from "@/lib/http/errors";
import { noContent, route } from "@/lib/http/handler";

export const POST = route<{ code: string }>({ anon: "require" }, async (ctx, params) => {
  const ok = await markSeen(ctx.db, ctx.anonId as string, String(params.code ?? ""));
  if (!ok) throw httpError("not_found");
  return noContent();
});
