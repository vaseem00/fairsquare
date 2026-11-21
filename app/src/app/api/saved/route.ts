/**
 * Saved listings (A§4.3).
 * - GET (anon optional): 200 `{ items }`, newest first, removed rows excluded. With no cookie it
 *   returns `{ items: [] }` and sets no cookie.
 * - POST `{ code }` (anon required): 201 `{ item }` for a new save; 200 with the same item when it is
 *   already saved, or when it was removed (that restores the original savedAt and baseline: Undo).
 *   404 not_found for an unknown code.
 */
import { getCheckRowByCode } from "@/lib/db/repo/checks";
import { trackEvent } from "@/lib/db/repo/events";
import { listSaved, saveCheck } from "@/lib/db/repo/saved";
import { getEnv } from "@/lib/env";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { SaveRequestSchema } from "@/lib/validation/api";

export const GET = route({ anon: "optional" }, async (ctx) => {
  if (!ctx.anonId) return json({ items: [] });
  const env = getEnv();
  return json({ items: await listSaved(ctx.db, ctx.anonId, ctx.today, env.rules) });
});

export const POST = route({ anon: "require" }, async (ctx) => {
  const anonId = ctx.anonId as string;
  const body = await readJson(ctx.req, SaveRequestSchema);
  const env = getEnv();
  const check = await getCheckRowByCode(ctx.db, body.code);
  if (!check) throw httpError("not_found");
  const { item, outcome } = await saveCheck(ctx.db, anonId, check, ctx.today, env.rules);
  if (outcome !== "existing") {
    await trackEvent(ctx.db, { name: "saved", anonId, checkId: check.id, meta: { restored: outcome === "restored" } });
  }
  return json({ item }, outcome === "created" ? 201 : 200);
});
