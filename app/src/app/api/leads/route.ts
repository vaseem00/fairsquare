/**
 * Leads (A§4.3, anon required).
 * - POST `{ code, name, phone, consent: true, consentVersion, downPct, ratePct, years }`: 201
 *   `{ lead }` for a new lead, 200 with the existing one when the person already has an active lead
 *   for that comparison. Without a configured partner (PARTNER_NAME, PARTNER_REGULATOR and
 *   PARTNER_LICENCE all set) → 404 leads_unavailable before anything else is read (REAL_DATA.md
 *   section 8). Rejections (consent, version, phone, down payment, rate limit) are in
 *   `services/lead.ts`. The server builds the consent text itself.
 * - GET: 200 `{ leads }` for the current person, newest first (also when leads are off, so earlier
 *   requests can still be seen and withdrawn).
 */
import { z } from "zod";
import { listLeadsForAnon } from "@/lib/db/repo/leads";
import { getEnv, leadPartner } from "@/lib/env";
import { httpError } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/handler";
import { submitLead } from "@/lib/services/lead";

export const POST = route({ anon: "require" }, async (ctx) => {
  const env = getEnv();
  const partner = leadPartner(env);
  if (!partner) throw httpError("leads_unavailable");
  const raw = await readJson(ctx.req, z.unknown());
  const { lead, created } = await submitLead(ctx.db, raw, {
    anonId: ctx.anonId as string,
    ipHash: ctx.ipHash,
    partnerName: partner.name,
    limits: {
      anonDaily: env.LEADS_ANON_DAILY_LIMIT,
      phoneDaily: env.LEADS_PHONE_DAILY_LIMIT,
      ipDaily: env.LEADS_IP_DAILY_LIMIT,
      globalDaily: env.LEADS_DAILY_GLOBAL_CAP,
    },
  });
  return json({ lead }, created ? 201 : 200);
});

export const GET = route({ anon: "require" }, async (ctx) => {
  return json({ leads: await listLeadsForAnon(ctx.db, ctx.anonId as string) });
});
