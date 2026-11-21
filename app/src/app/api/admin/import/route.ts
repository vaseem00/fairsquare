/**
 * POST /api/admin/import?kind=buildings|aliases|sales&commit=0|1 (A§4.4): multipart `file` (CSV,
 * ≤ 5 MB, ≤ 50,000 rows) → `ImportResult`.
 * - `commit=0` (default) is a dry run: rows checked, duplicates counted, impact computed, no writes.
 * - `commit=1` runs in one transaction and rolls back fully on any database error.
 * A file-level problem (missing column, no rows, too many rows) → 422 on `fields.file`.
 */
import { COPY } from "@/lib/copy";
import { CsvFormatError, importCsv } from "@/lib/csv/import";
import { getEnv } from "@/lib/env";
import { isBodyTooLarge, readFormDataLimited } from "@/lib/http/body";
import { HttpError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/handler";
import { log } from "@/lib/log";
import { CSV_MAX_BYTES, ImportQuerySchema } from "@/lib/validation/admin";
import { zodFieldErrors } from "@/lib/validation/api";

/** Multipart overhead allowed on top of the file itself. */
const ENVELOPE_BYTES = 64 * 1024;

export const POST = route({ admin: true }, async (ctx) => {
  const sp = ctx.req.nextUrl.searchParams;
  const q = ImportQuerySchema.safeParse({ kind: sp.get("kind") ?? undefined, commit: sp.get("commit") ?? undefined });
  if (!q.success) throw new HttpError(422, "validation_failed", { fields: zodFieldErrors(q.error) });

  const type = (ctx.req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) throw new HttpError(415, "bad_request");
  const declared = Number(ctx.req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CSV_MAX_BYTES + ENVELOPE_BYTES) throw new HttpError(413, "file_too_large");

  let form: FormData;
  try {
    // Counted as it streams in: a chunked body has no Content-Length to check above.
    form = await readFormDataLimited(ctx.req, CSV_MAX_BYTES + ENVELOPE_BYTES);
  } catch (err) {
    if (isBodyTooLarge(err)) throw new HttpError(413, "file_too_large");
    throw new HttpError(400, "bad_request");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new HttpError(422, "validation_failed", { fields: { file: COPY["adminUi.csv.noFile"] } });
  }
  if (file.size > CSV_MAX_BYTES) throw new HttpError(413, "file_too_large");
  const text = await file.text();

  try {
    const result = await importCsv(ctx.db, {
      kind: q.data.kind,
      text,
      commit: q.data.commit,
      today: ctx.today,
      rules: getEnv().rules,
    });
    log.info("admin_import", {
      requestId: ctx.requestId,
      kind: result.kind,
      rows: result.rows,
      ok: result.ok,
      rejected: result.rejectedCount,
      created: result.created,
      skipped: result.skippedDuplicates,
      committed: result.committed,
    });
    return json(result);
  } catch (err) {
    if (err instanceof CsvFormatError) {
      throw new HttpError(422, "validation_failed", { fields: { file: err.message } });
    }
    throw err;
  }
});
