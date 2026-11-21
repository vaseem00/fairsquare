/**
 * POST /api/requests (A§4.3): `{ text, area?, code? }` → `{ id, othersAsked, created }`.
 * - With `code` (the not-covered result's "Request it and track"): source none_of_these, linked to that
 *   comparison; `area` defaults to its areaText. Unknown code → 404 not_found.
 * - Without `code` (the Coverage form): source request_form.
 * Idempotent per person and normalised text: a repeat returns 200 with the same id; a new row returns
 * 201 and records `request_created`. 20 per Dubai day per person, 60 per IP.
 */
import { getCheckRowByCode } from "@/lib/db/repo/checks";
import { trackEvent } from "@/lib/db/repo/events";
import { countOthersAsked, requestTextNorm, upsertRequest } from "@/lib/db/repo/requests";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { enforce } from "@/lib/rate-limit";
import type { BuildingRequestResponse } from "@/lib/types";
import { BuildingRequestSchema } from "@/lib/validation/api";

const REQUESTS_ANON_DAILY_LIMIT = 20;
const REQUESTS_IP_DAILY_LIMIT = 60;

export const POST = route({ anon: "require" }, async (ctx) => {
  const anonId = ctx.anonId as string;
  const body = await readJson(ctx.req, BuildingRequestSchema);
  await enforce(ctx.db, [
    {
      key: `requests:anon:${anonId}`,
      limit: REQUESTS_ANON_DAILY_LIMIT,
      window: "day",
      onDeny: "rate_limited",
      scope: "spam",
    },
    // The anon id is self-issued; the IP bounds a script that drops its cookie on every call.
    {
      key: `requests:ip:${ctx.ipHash}`,
      limit: REQUESTS_IP_DAILY_LIMIT,
      window: "day",
      onDeny: "rate_limited",
      scope: "spam",
    },
  ]);

  let checkId: number | null = null;
  let area: string | null = body.area?.trim() ? body.area.trim() : null;
  let source: "none_of_these" | "request_form" = "request_form";
  if (body.code) {
    const check = await getCheckRowByCode(ctx.db, body.code);
    if (!check) throw httpError("not_found");
    checkId = check.id;
    area ??= check.areaText;
    source = "none_of_these";
  }

  const { id, created } = await upsertRequest(ctx.db, { anonId, text: body.text, area, checkId, source });
  if (created) await trackEvent(ctx.db, { name: "request_created", anonId, checkId, meta: { source } });
  const othersAsked = await countOthersAsked(ctx.db, requestTextNorm(body.text), anonId);
  const res: BuildingRequestResponse = { id, othersAsked, created };
  return json(res, created ? 201 : 200);
});
