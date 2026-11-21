/**
 * POST /api/events (A§4.3): `{ name: ClientEventName, code?: string }` → 204.
 * Unknown names (or any other invalid body) give 400 bad_request. 300 per day per anon, 2,000 per IP.
 * `meta` is never taken from the client.
 */
import { checkIdForCode, trackEvent } from "@/lib/db/repo/events";
import { HttpError } from "@/lib/http/errors";
import { noContent, readJson, route } from "@/lib/http/handler";
import { enforce } from "@/lib/rate-limit";
import { EventRequestSchema } from "@/lib/validation/api";

const EVENTS_ANON_DAILY_LIMIT = 300;
const EVENTS_IP_DAILY_LIMIT = 2000;

async function readEvent(req: Parameters<typeof readJson>[0]) {
  try {
    return await readJson(req, EventRequestSchema);
  } catch (err) {
    // A bad event body is a client bug, not a form: answer 400 rather than 422.
    if (err instanceof HttpError && err.code === "validation_failed") throw new HttpError(400, "bad_request");
    throw err;
  }
}

export const POST = route({ anon: "require" }, async (ctx) => {
  const anonId = ctx.anonId as string;
  const body = await readEvent(ctx.req);
  await enforce(ctx.db, [
    { key: `events:anon:${anonId}`, limit: EVENTS_ANON_DAILY_LIMIT, window: "day", onDeny: "rate_limited", scope: "spam" },
    // The anon id is self-issued; the IP bounds a script that drops its cookie on every call.
    { key: `events:ip:${ctx.ipHash}`, limit: EVENTS_IP_DAILY_LIMIT, window: "day", onDeny: "rate_limited", scope: "spam" },
  ]);
  const checkId = await checkIdForCode(ctx.db, body.code);
  await trackEvent(ctx.db, { name: body.name, anonId, checkId });
  return noContent();
});
