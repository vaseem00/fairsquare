/**
 * GET /api/buildings?q=&page= (A§4.3, REAL_DATA.md section 11): one page of the coverage list →
 * 200 `CoverageResponse`. Buildings are searched by name or area on the server (`q`, 2+ characters;
 * shorter is ignored) and paged by 50, most sales in the comparison window first. Each row has its
 * ready and off-plan sale counts, its latest sale date and one entry per bedroom count, with each
 * basis counted and judged on its own (`readyComparable` / `offPlanComparable`: MIN_SALES sales of
 * that basis once unusual ones are left out). With no sales data loaded the list is
 * empty and `window` is null. An invalid `page` → 422. Public; no anon cookie.
 */
import { getCoverage } from "@/lib/db/repo/buildings";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";
import { CoverageQuerySchema, zodFieldErrors } from "@/lib/validation/api";

export const GET = route({ anon: "none" }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const page = sp.get("page");
  const parsed = CoverageQuerySchema.safeParse({ q: sp.get("q"), page: page === null || page.trim() === "" ? null : page });
  if (!parsed.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(parsed.error) });
  const { q, page: p } = parsed.data;
  return json(await getCoverage(ctx.db, ctx.today, getEnv().rules, { q: q ?? null, page: p ?? 1 }));
});
