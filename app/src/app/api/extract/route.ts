/**
 * POST /api/extract (A§4.3, A§5): read a screenshot and/or pasted listing text with Claude, then match
 * the building. 200 `ExtractResponse`; `not_listing`, `rental` and `not_apartment` are outcomes, not errors.
 *
 * Checks, in order:
 *  1. Origin and body type (route()).
 *  2. Content-Length > MAX_IMAGE_BYTES + 64 KB → 413 image_too_large, before the body is read.
 *  3. Reading switched off (no key, or the circuit is open) → 503 extract_unavailable, no Claude call.
 *  4. Rate limits (A§6.4): burst per person, per person per day, per IP per day → 429. Checked before
 *     the body is read; enforce() stops at the first denial.
 *  5. The body, read with a byte limit (MAX_IMAGE_BYTES + 64 KB, also for chunked bodies) → 413;
 *     neither an image nor text → 400 empty_input; text over 4,000 chars → 400 bad_request.
 *  6. image.size ≤ MAX_IMAGE_BYTES (413) and JPEG/PNG/WebP by magic bytes (415). The declared type is ignored.
 *  7. The global daily cap → 503 daily_cap_reached, counted only for a valid input about to reach Claude.
 *  8. extractListing() with the request signal; a client abort answers 499 with no error log.
 *  9. matchBuildings() when a building name was read.
 * Every response other than 200 and 499 records an `extract_fail` event with `meta.code`; a success
 * records `extract_ok` with `meta.ms`. One log line per read, without PII (A§5.8).
 * The image is held in memory for this request only: never written to disk, the DB or logs.
 */
import { createHash } from "node:crypto";
import { extractListing, type ExtractionOutcome } from "@/lib/claude/extract";
import { isExtractAborted, isExtractError } from "@/lib/claude/errors";
import { trackEvent } from "@/lib/db/repo/events";
import { getEnv } from "@/lib/env";
import { extractionEnabled } from "@/lib/extract-circuit";
import { isBodyTooLarge, readFormDataLimited } from "@/lib/http/body";
import { HttpError, isHttpError } from "@/lib/http/errors";
import { json, route, type RouteCtx } from "@/lib/http/handler";
import { sniffImage, type SniffedType } from "@/lib/image/sniff";
import { log, type LogFields } from "@/lib/log";
import { enforce } from "@/lib/rate-limit";
import { matchBuildings } from "@/lib/services/match";
import type { ErrorCode, ExtractResponse, MatchResponse } from "@/lib/types";
import { LIMITS } from "@/lib/validation/fields";

/** Multipart overhead allowed on top of the image limit (declared or streamed). */
const MULTIPART_ALLOWANCE = 64 * 1024;

/** The rate-limit key of the shared daily cap. */
const EXTRACT_GLOBAL_KEY = "extract:global";

/** Safe facts about the input for the log line (sizes only, never content). */
interface ReadInfo {
  hasImage: boolean;
  imageBytes: number;
  textChars: number;
}

interface ParsedInput {
  image?: { mediaType: SniffedType; base64: string };
  text?: string;
}

const emptyMatch = (): MatchResponse => ({ candidates: [], preselectId: null, towerCheck: false, areaCheck: false });

function anonHash(anonId: string | null): string | null {
  return anonId ? createHash("sha256").update(anonId).digest("hex").slice(0, 8) : null;
}

function checkDeclaredLength(ctx: RouteCtx, maxImageBytes: number): void {
  const declared = Number(ctx.req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxImageBytes + MULTIPART_ALLOWANCE) {
    throw new HttpError(413, "image_too_large");
  }
}

async function readInput(ctx: RouteCtx, maxImageBytes: number, info: ReadInfo): Promise<ParsedInput> {
  let form: FormData;
  try {
    // Counted while it streams in: a chunked body has no Content-Length for checkDeclaredLength to see.
    form = await readFormDataLimited(ctx.req, maxImageBytes + MULTIPART_ALLOWANCE);
  } catch (err) {
    if (isBodyTooLarge(err)) throw new HttpError(413, "image_too_large");
    throw new HttpError(400, "bad_request");
  }
  const imageEntry = form.get("image");
  const textEntry = form.get("text");

  // Multipart turns line breaks into CRLF; count and send them as plain "\n".
  const text = typeof textEntry === "string" ? textEntry.replace(/\r\n?/g, "\n").trim() : "";
  info.textChars = text.length;
  if (text.length > LIMITS.textMax) throw new HttpError(400, "bad_request");

  // A non-file "image" field is not an image.
  if (typeof imageEntry === "string" && imageEntry.length > 0) throw new HttpError(415, "unsupported_image");
  const file = imageEntry instanceof Blob && imageEntry.size > 0 ? imageEntry : null;
  if (!file && !text) throw new HttpError(400, "empty_input");

  const out: ParsedInput = text ? { text } : {};
  if (file) {
    info.hasImage = true;
    info.imageBytes = file.size;
    if (file.size > maxImageBytes) throw new HttpError(413, "image_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = sniffImage(bytes);
    if (!mediaType) throw new HttpError(415, "unsupported_image");
    out.image = { mediaType, base64: Buffer.from(bytes).toString("base64") };
  }
  return out;
}

/**
 * Per-person and per-IP limits (A§6.4), checked before the body is read so a limited client costs no
 * upload buffering. enforce() stops at the first denial, so a denied attempt counts only against the
 * key that denied it.
 */
async function enforceRequesterLimits(ctx: RouteCtx): Promise<void> {
  const env = getEnv();
  const anonId = ctx.anonId as string;
  await enforce(ctx.db, [
    { key: `extract:anon-burst:${anonId}`, limit: env.EXTRACT_ANON_BURST_LIMIT, window: "15m", onDeny: "rate_limited", scope: "extract_burst" },
    { key: `extract:anon:${anonId}`, limit: env.EXTRACT_ANON_DAILY_LIMIT, window: "day", onDeny: "rate_limited", scope: "extract_daily" },
    { key: `extract:ip:${ctx.ipHash}`, limit: env.EXTRACT_IP_DAILY_LIMIT, window: "day", onDeny: "rate_limited", scope: "extract_daily" },
  ]);
}

/**
 * The shared daily cap, counted only for a valid input that is about to reach Claude. Rejected or
 * rate-limited requests never touch it, so one client cannot use up everyone's quota.
 */
async function enforceGlobalCap(ctx: RouteCtx): Promise<void> {
  await enforce(ctx.db, [
    { key: EXTRACT_GLOBAL_KEY, limit: getEnv().EXTRACT_DAILY_GLOBAL_CAP, window: "day", onDeny: "daily_cap_reached", scope: "extract_daily" },
  ]);
}

async function matchFor(ctx: RouteCtx, read: ExtractionOutcome): Promise<MatchResponse> {
  const { buildingText, areaText, bedrooms } = read.fields;
  if (!buildingText) return emptyMatch();
  try {
    return await matchBuildings(ctx.db, buildingText, areaText, bedrooms, ctx.today, read.completion);
  } catch (err) {
    // The person can still pick or search a building in step 2; a match failure must not lose the read.
    log.warn("extract_match_failed", { requestId: ctx.requestId, err });
    return emptyMatch();
  }
}

/** Which fields were read (booleans only, never the values). */
function found(read: ExtractionOutcome | null) {
  const f = read?.fields;
  return {
    building: Boolean(f?.buildingText),
    area: Boolean(f?.areaText),
    bedrooms: f?.bedrooms != null,
    size: f?.sizeSqft != null,
    price: f?.priceAed != null,
  };
}

export const POST = route({ anon: "require" }, async (ctx) => {
  const started = Date.now();
  const env = getEnv();
  const info: ReadInfo = { hasImage: false, imageBytes: 0, textChars: 0 };
  let logged = false;
  const writeLog = (level: "info" | "error", fields: LogFields) => {
    logged = true;
    log[level]("extract", {
      requestId: ctx.requestId,
      anonHash: anonHash(ctx.anonId),
      ...info,
      ms: Date.now() - started,
      ...fields,
    });
  };

  try {
    checkDeclaredLength(ctx, env.MAX_IMAGE_BYTES);
    if (!extractionEnabled()) throw new HttpError(503, "extract_unavailable");
    await enforceRequesterLimits(ctx);
    const input = await readInput(ctx, env.MAX_IMAGE_BYTES, info);
    await enforceGlobalCap(ctx);

    let read: ExtractionOutcome;
    try {
      read = await extractListing(input, { signal: ctx.req.signal });
    } catch (err) {
      if (isExtractAborted(err) || ctx.req.signal.aborted) {
        writeLog("info", { outcome: "aborted" });
        return new Response(null, { status: 499 });
      }
      if (!isExtractError(err)) throw err;
      writeLog(err.code === "extract_unavailable" ? "error" : "info", {
        errorCode: err.code,
        stopReason: err.detail.stopReason ?? null,
        refusalCategory: err.detail.refusalCategory ?? null,
        errorClass: err.detail.errorClass ?? null,
        upstreamStatus: err.detail.upstreamStatus ?? null,
        model: err.detail.model ?? env.CLAUDE_MODEL,
        found: found(null),
      });
      throw new HttpError(err.status, err.code, err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {});
    }

    const match = await matchFor(ctx, read);
    const body: ExtractResponse = {
      outcome: read.outcome,
      fields: read.fields,
      propertyType: read.propertyType,
      completion: read.completion,
      contactDetailsVisible: read.contactDetailsVisible,
      match,
    };
    const ms = Date.now() - started;
    writeLog("info", {
      ms,
      outcome: read.outcome,
      stopReason: read.stopReason,
      model: read.model,
      servedByFallback: read.servedByFallback,
      inputTokens: read.usage.inputTokens,
      outputTokens: read.usage.outputTokens,
      found: found(read),
    });
    await trackEvent(ctx.db, {
      name: "extract_ok",
      anonId: ctx.anonId,
      meta: { ms, servedByFallback: read.servedByFallback, hasImage: info.hasImage },
    });
    return json(body);
  } catch (err) {
    // Every rejected read feeds the admin Quality page (A§5.6): rate limits, 413, 415, empty input…
    const code: ErrorCode = isHttpError(err) ? err.code : "internal";
    if (!logged) writeLog("info", { errorCode: code, found: found(null) });
    await trackEvent(ctx.db, { name: "extract_fail", anonId: ctx.anonId, meta: { code, ms: Date.now() - started } });
    throw err;
  }
});
