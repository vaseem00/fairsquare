/**
 * GET /api/admin/stats?range=7|30|90 (A§4.4): `AdminStats` for the Overview and Quality pages.
 * An unknown range falls back to 30 days.
 */
import { getAdminStats } from "@/lib/db/repo/admin";
import { getEnv } from "@/lib/env";
import { json, route } from "@/lib/http/handler";
import { parseAdminRange } from "@/lib/validation/admin";

export const GET = route({ admin: true }, async (ctx) => {
  const env = getEnv();
  const range = parseAdminRange(ctx.req.nextUrl.searchParams.get("range"));
  const stats = await getAdminStats(ctx.db, { today: ctx.today, range, rules: env.rules });
  return json(stats);
});
