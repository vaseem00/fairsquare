/**
 * GET /api/buildings/match?q=&area=&beds=&completion= (A§4.3): 200 `MatchResponse`.
 * `q` 1–120 chars, `area` ≤ 80, `beds` 0–7 (optional; fills `salesForBedrooms`), `completion`
 * ready | off_plan | unknown (optional; `salesForBedrooms` then counts off-plan sales for off_plan and
 * ready sales otherwise, REAL_DATA.md section 7).
 * An invalid query gives 422 validation_failed with `fields`. No rate limit (in-memory alias cache).
 */
import { HttpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";
import { matchBuildings } from "@/lib/services/match";
import { MatchQuerySchema, zodFieldErrors } from "@/lib/validation/api";

/** Empty parameters count as absent ("?beds=" must never become 0 = Studio). */
function param(sp: URLSearchParams, name: string): string | null {
  const v = sp.get(name);
  return v === null || v.trim() === "" ? null : v;
}

export const GET = route({ anon: "none" }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const parsed = MatchQuerySchema.safeParse({
    q: sp.get("q") ?? "",
    area: param(sp, "area"),
    beds: param(sp, "beds"),
    completion: param(sp, "completion"),
  });
  if (!parsed.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(parsed.error) });
  const { q, area, beds, completion } = parsed.data;
  const res = await matchBuildings(ctx.db, q, area || null, beds ?? null, ctx.today, completion ?? null);
  return json(res);
});
