/**
 * POST /api/checks (A§4.3): compute and store a verdict → 201 `{ check: CheckView }`.
 * 422 validation_failed (per-field messages, the price-per-sq-ft one on both size and price),
 * 404 building_not_found, 429 after CHECKS_ANON_DAILY_LIMIT (100) comparisons in a Dubai day per
 * person, or CHECKS_IP_DAILY_LIMIT (500) per IP.
 */
import { getEnv } from "@/lib/env";
import { json, readJson, route } from "@/lib/http/handler";
import { enforce } from "@/lib/rate-limit";
import { runCheck } from "@/lib/services/check";
import { CheckRequestSchema } from "@/lib/validation/api";

export const POST = route({ anon: "require" }, async (ctx) => {
  const anonId = ctx.anonId as string;
  const body = await readJson(ctx.req, CheckRequestSchema);
  const env = getEnv();
  await enforce(ctx.db, [
    {
      key: `checks:anon:${anonId}`,
      limit: env.CHECKS_ANON_DAILY_LIMIT,
      window: "day",
      onDeny: "rate_limited",
      scope: "spam",
    },
    // The anon id is self-issued; the IP bounds a script that drops its cookie on every call.
    {
      key: `checks:ip:${ctx.ipHash}`,
      limit: env.CHECKS_IP_DAILY_LIMIT,
      window: "day",
      onDeny: "rate_limited",
      scope: "spam",
    },
  ]);
  const check = await runCheck(ctx.db, body, {
    anonId,
    today: ctx.today,
    appUrl: env.APP_URL,
    rules: env.rules,
  });
  return json({ check }, 201);
});
