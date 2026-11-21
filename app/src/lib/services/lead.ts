import "server-only";
/**
 * POST /api/leads orchestration (A§4.3, A§6.7, WP4). The route answers 404 leads_unavailable first
 * when no partner is configured (REAL_DATA.md section 8). Then, in order:
 * 1. `consent !== true` → 422 consent_required.
 * 2. A consent version other than `consentFor(PARTNER_NAME).version` ("optin-v1") → 409
 *    consent_version_mismatch.
 * 3. The body schema (name, phone, down payment, rate, term) → 422 validation_failed with `fields`.
 * 4. Unknown comparison → 404 not_found.
 * 5. `downPct` below `minDownPct(price)` → 422 validation_failed on `fields.downPct`.
 * 6. An active lead for the same person and comparison is returned as is (200).
 * 7. Rate limits per Dubai day → 429: per person (LEADS_ANON_DAILY_LIMIT), per mobile number
 *    (LEADS_PHONE_DAILY_LIMIT), per IP (LEADS_IP_DAILY_LIMIT) and for everyone (LEADS_DAILY_GLOBAL_CAP).
 * 8. Stores the lead with the consent text the server built itself (never the client's), its SHA-256,
 *    the E.164 phone, and the loan and monthly estimates from `estimateMortgage`.
 */
import { hmacHex, sha256Hex } from "@/lib/auth/sign";
import { COPY, consentFor, t } from "@/lib/copy";
import type { Db } from "@/lib/db/client";
import { getCheckRowByCode } from "@/lib/db/repo/checks";
import { trackEvent } from "@/lib/db/repo/events";
import { createLead, getActiveLead } from "@/lib/db/repo/leads";
import { estimateMortgage, minDownPct } from "@/lib/domain/mortgage";
import { last4, normalisePhone } from "@/lib/domain/phone";
import { httpError } from "@/lib/http/errors";
import { enforce } from "@/lib/rate-limit";
import type { LeadView } from "@/lib/types";
import { LeadRequestSchema, zodFieldErrors } from "@/lib/validation/api";

export interface LeadLimits {
  /** LEADS_ANON_DAILY_LIMIT: per browser identity. */
  anonDaily: number;
  /** LEADS_PHONE_DAILY_LIMIT: per mobile number, whoever sends it. */
  phoneDaily: number;
  /** LEADS_IP_DAILY_LIMIT: per client IP (a new cookie does not reset it). */
  ipDaily: number;
  /** LEADS_DAILY_GLOBAL_CAP: all leads together. */
  globalDaily: number;
}

export interface LeadCtx {
  anonId: string;
  ipHash: string;
  partnerName: string;
  limits: LeadLimits;
}

/** The rate-limit key for a phone: an HMAC, so the table never holds the number itself. */
export function leadPhoneKey(phoneE164: string): string {
  return `leads:phone:${hmacHex(`phone:${phoneE164}`).slice(0, 32)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The building name stored with a lead: the covered building, or the typed text for "none". */
export function leadBuildingName(check: { buildingName: string | null; buildingText: string }): string {
  return check.buildingName ?? check.buildingText;
}

/** Validates and stores a lead. Throws HttpError for every rejection listed above. */
export async function submitLead(db: Db, raw: unknown, ctx: LeadCtx): Promise<{ lead: LeadView; created: boolean }> {
  if (!isRecord(raw) || raw.consent !== true) throw httpError("consent_required");
  const consent = consentFor(ctx.partnerName);
  if (typeof raw.consentVersion === "string" && raw.consentVersion !== consent.version) {
    throw httpError("consent_version_mismatch");
  }

  const parsed = LeadRequestSchema.safeParse(raw);
  if (!parsed.success) throw httpError("validation_failed", { fields: zodFieldErrors(parsed.error) });
  const body = parsed.data;

  const check = await getCheckRowByCode(db, body.code);
  if (!check) throw httpError("not_found");
  const minDown = minDownPct(check.priceAed);
  if (body.downPct < minDown) {
    throw httpError("validation_failed", { fields: { downPct: t("lead.errDown", { pct: minDown }) } });
  }
  const phone = normalisePhone(body.phone);
  if (!phone) throw httpError("validation_failed", { fields: { phone: COPY["lead.errMobile"] } });

  const existing = await getActiveLead(db, ctx.anonId, check.id);
  if (existing) return { lead: existing, created: false };

  // The anon id is self-issued (dropping the cookie resets it), so the phone, the IP and a global
  // ceiling bound how many leads a script can send for other people's numbers. Narrow keys first:
  // enforce() stops at the first denial, so a denied script never uses up the global ceiling.
  await enforce(db, [
    { key: `leads:anon:${ctx.anonId}`, limit: ctx.limits.anonDaily, window: "day", onDeny: "rate_limited", scope: "spam" },
    { key: leadPhoneKey(phone), limit: ctx.limits.phoneDaily, window: "day", onDeny: "rate_limited", scope: "spam" },
    { key: `leads:ip:${ctx.ipHash}`, limit: ctx.limits.ipDaily, window: "day", onDeny: "rate_limited", scope: "spam" },
    { key: "leads:global", limit: ctx.limits.globalDaily, window: "day", onDeny: "rate_limited", scope: "spam" },
  ]);

  const est = estimateMortgage({
    priceAed: check.priceAed,
    downPct: body.downPct,
    ratePct: body.ratePct,
    years: body.years,
  });
  const result = await createLead(db, {
    anonId: ctx.anonId,
    checkId: check.id,
    partner: ctx.partnerName,
    consentVersion: consent.version,
    consentText: consent.text,
    consentTextSha256: sha256Hex(consent.text),
    consentedAt: new Date(),
    name: body.name,
    phoneE164: phone,
    phoneLast4: last4(phone),
    ipHash: ctx.ipHash,
    buildingName: leadBuildingName(check),
    bedrooms: check.bedrooms,
    sizeSqft: check.sizeSqft,
    priceAed: check.priceAed,
    downPct: body.downPct,
    ratePct: body.ratePct,
    years: body.years,
    loanEstimateAed: Math.round(est.loanAed),
    monthlyEstimateAed: Math.round(est.monthlyAed),
  });
  if (result.created) {
    await trackEvent(db, {
      name: "lead_created",
      anonId: ctx.anonId,
      checkId: check.id,
      meta: { downPct: body.downPct, years: body.years, band: check.band },
    });
  }
  return result;
}
