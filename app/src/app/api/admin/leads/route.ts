/**
 * GET /api/admin/leads?status=&from=&to= (A§4.4): `{ leads: AdminLeadRow[] }`, newest first, with the
 * phone masked. `from`/`to` are inclusive Dubai days (YYYY-MM-DD). The full number needs Reveal.
 */
import { listAdminLeads } from "@/lib/db/repo/admin";
import { HttpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";
import { LeadsQuerySchema } from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

export const GET = route({ admin: true }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const raw = Object.fromEntries([...sp.entries()].filter(([, v]) => v !== ""));
  const q = LeadsQuerySchema.safeParse(raw);
  if (!q.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(q.error) });
  return json({ leads: await listAdminLeads(ctx.db, q.data) });
});
