/**
 * GET /api/admin/leads/export?status=&from=&to= (A§4.4): `text/csv` with the full phone number, which
 * is how leads reach the partner in v1. CSV-injection safe (A§6.5). Records `leads_exported`.
 */
import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv/export";
import { listLeadsForExport } from "@/lib/db/repo/admin";
import { trackEvent } from "@/lib/db/repo/events";
import { HttpError } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { LeadsQuerySchema } from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

const EXPORT_COLUMNS = [
  "id",
  "received_at",
  "name",
  "phone",
  "phone_last4",
  "building",
  "bedrooms",
  "size_sqft",
  "price_aed",
  "down_pct",
  "rate_pct",
  "years",
  "loan_estimate_aed",
  "monthly_estimate_aed",
  "partner",
  "consent_version",
  "consented_at",
  "status",
  "sent_at",
  "withdrawn_at",
  "withdrawal_notified_at",
  "comparison_code",
] as const;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const GET = route({ admin: true }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const raw = Object.fromEntries([...sp.entries()].filter(([, v]) => v !== ""));
  const q = LeadsQuerySchema.safeParse(raw);
  if (!q.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(q.error) });
  const rows = await listLeadsForExport(ctx.db, q.data);
  const csv = toCsv(
    EXPORT_COLUMNS,
    rows.map((l) => [
      l.id,
      l.createdAt.toISOString(),
      l.name,
      l.phoneE164,
      l.phoneLast4,
      l.buildingName,
      l.bedrooms,
      l.sizeSqft,
      l.priceAed,
      l.downPct,
      l.ratePct,
      l.years,
      l.loanEstimateAed,
      l.monthlyEstimateAed,
      l.partner,
      l.consentVersion,
      l.consentedAt.toISOString(),
      l.status,
      iso(l.sentAt),
      iso(l.withdrawnAt),
      iso(l.withdrawalNotifiedAt),
      l.checkCode,
    ]),
  );
  await trackEvent(ctx.db, { name: "leads_exported", meta: { count: rows.length } });
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fairsquare-leads-${ctx.today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
