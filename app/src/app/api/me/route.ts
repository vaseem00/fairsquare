/**
 * Me (A§4.3, anon optional).
 * - GET: 200 MeView (badge count, requests, leads, Your data). With no cookie it returns the empty
 *   MeView and sets no cookie, so a page view alone never creates an id.
 * - DELETE: "Delete all my data". 204; in one transaction leads are withdrawn and stripped of PII,
 *   comparisons and saved listings are deleted, requests and events keep their rows with no anon id,
 *   and the anon row is deleted. Clears `mz_aid` (Max-Age=0) and records `data_deleted` with no anon
 *   id. With no cookie it is a 204 no-op.
 */
import { trackEvent } from "@/lib/db/repo/events";
import { deleteAllForAnon, getMe } from "@/lib/db/repo/me";
import { getEnv } from "@/lib/env";
import { ANON_COOKIE, anonCookieOptions, clearCookieOptions } from "@/lib/http/cookies";
import { json, noContent, route } from "@/lib/http/handler";
import { EMPTY_ME } from "@/lib/types";

export const GET = route({ anon: "optional" }, async (ctx) => {
  if (!ctx.anonId) return json({ ...EMPTY_ME, requests: [], leads: [] });
  const env = getEnv();
  return json(await getMe(ctx.db, ctx.anonId, ctx.today, env.rules));
});

export const DELETE = route({ anon: "optional" }, async (ctx) => {
  if (!ctx.anonId) return noContent();
  const summary = await deleteAllForAnon(ctx.db, ctx.anonId);
  for (const leadId of summary.leadsWithdrawn) {
    await trackEvent(ctx.db, { name: "lead_withdrawn", meta: { leadId, via: "delete" } });
  }
  await trackEvent(ctx.db, {
    name: "data_deleted",
    meta: {
      checks: summary.checksDeleted,
      saved: summary.savedDeleted,
      othersSaved: summary.othersSavedDeleted,
      leads: summary.leadsAnonymised,
    },
  });
  ctx.setCookie(ANON_COOKIE, "", clearCookieOptions(anonCookieOptions()));
  return noContent();
});
