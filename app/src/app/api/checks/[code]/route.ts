/**
 * GET /api/checks/[code] (A§4.3): 200 `{ check, current }`, where `current` is the verdict recomputed
 * today. 404 not_found for an unknown or malformed code. Public: it never reads or issues `mz_aid`.
 */
import { getCheckWithCurrent } from "@/lib/db/repo/checks";
import { getEnv } from "@/lib/env";
import { httpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";

export const GET = route<{ code: string }>({ anon: "none" }, async (ctx, params) => {
  const env = getEnv();
  const found = await getCheckWithCurrent(ctx.db, String(params.code ?? ""), ctx.today, env.rules, env.APP_URL);
  if (!found) throw httpError("not_found");
  return json(found);
});
