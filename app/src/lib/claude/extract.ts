import "server-only";
/**
 * One Claude read of a listing (A§5.4–5.6): the call, post-processing and the circuit-breaker outcome.
 * - Request: `beta.messages.create` with JSON-schema structured output, effort from CLAUDE_EFFORT,
 *   `max_tokens` from CLAUDE_MAX_TOKENS and the server-side refusal fallback. No `thinking` key
 *   (Opus 5.5 always thinks; `{ type: "disabled" }` is a 400).
 * - Deadline: CLAUDE_TIMEOUT_MS, combined with the caller's signal. A client abort throws
 *   ExtractAbortedError; the deadline throws ExtractError("extract_timeout").
 * - Every finished call records its outcome in the circuit breaker (WP0's extract-circuit).
 * Nothing here logs or stores the image, the pasted text or the extracted values.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";
import { recordExtractOutcome } from "@/lib/extract-circuit";
import type { SniffedType } from "@/lib/image/sniff";
import type { Completion, ExtractedFields, ExtractOutcome, PropertyType } from "@/lib/types";
import { LIMITS } from "@/lib/validation/fields";
import { getAnthropic } from "./client";
import { circuitKind, ExtractAbortedError, ExtractError, mapClaudeError } from "./errors";
import { buildUserContent, SYSTEM_PROMPT } from "./prompt";
import { EXTRACTION_JSON_SCHEMA, ExtractionSchema, type Extraction } from "./schema";

/** The beta that enables `fallbacks: "default"` (the -06-01 header only takes the array form). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Values Claude reports below these are treated as not read (A§5.5). */
export const MIN_PRICE_AED = 10_000;

export interface ExtractionOutcome {
  outcome: ExtractOutcome;
  fields: ExtractedFields;
  propertyType: PropertyType;
  completion: Completion;
  contactDetailsVisible: boolean;
  servedByFallback: boolean;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractListingInput {
  image?: { mediaType: SniffedType; base64: string };
  text?: string;
}

// ---------- post-processing (A§5.5) ----------

function cleanString(v: string | null, max: number): string | null {
  if (v === null) return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s ? s : null;
}

function positive(v: number | null): number | null {
  return v === null || !Number.isFinite(v) || v <= 0 ? null : v;
}

/** Sanitises the raw values: trimmed and capped strings, sane numbers, else null. */
export function sanitiseFields(x: Extraction): ExtractedFields {
  const bedrooms =
    x.bedrooms !== null && Number.isInteger(x.bedrooms) && x.bedrooms >= LIMITS.bedMin && x.bedrooms <= LIMITS.bedMax
      ? x.bedrooms
      : null;
  let size = positive(x.size_sqft);
  if (size !== null && size > LIMITS.sizeMax) size = null;
  let price = positive(x.price_aed);
  if (price !== null && price < MIN_PRICE_AED) price = null;
  return {
    buildingText: cleanString(x.building_text, LIMITS.buildingMax),
    areaText: cleanString(x.area_text, LIMITS.areaMax),
    bedrooms,
    // Whole square feet and dirhams: a square-metre conversion gives decimals nobody types.
    sizeSqft: size === null ? null : Math.max(1, Math.round(size)),
    priceAed: price === null ? null : Math.round(price),
  };
}

/** A§5.5 step 6. */
export function outcomeFor(x: Pick<Extraction, "is_listing" | "listing_type" | "property_type">): ExtractOutcome {
  if (!x.is_listing) return "not_listing";
  if (x.listing_type === "rent") return "rental";
  if (x.property_type === "villa" || x.property_type === "townhouse" || x.property_type === "other") return "not_apartment";
  return "ok";
}

function servedByFallback(response: Anthropic.Beta.BetaMessage): boolean {
  const iterations = response.usage?.iterations ?? [];
  return iterations.some((e) => e.type === "fallback_message") && response.stop_reason !== "refusal";
}

/** Turns a Claude response into an outcome, or throws ExtractError (A§5.5 steps 1–7). */
export function processResponse(response: Anthropic.Beta.BetaMessage): ExtractionOutcome {
  const model = response.model;
  if (response.stop_reason === "refusal") {
    throw new ExtractError("extract_refused", {
      stopReason: "refusal",
      refusalCategory: response.stop_details?.category ?? null,
      model,
    });
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractError("extract_unreadable", { stopReason: "max_tokens", model });
  }
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) throw new ExtractError("extract_failed", { stopReason: response.stop_reason, errorClass: "NoTextBlock", model });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ExtractError("extract_failed", { stopReason: response.stop_reason, errorClass: "SyntaxError", model });
  }
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractError("extract_failed", { stopReason: response.stop_reason, errorClass: "ZodError", model });
  }
  const x = parsed.data;
  return {
    outcome: outcomeFor(x),
    fields: sanitiseFields(x),
    propertyType: x.property_type,
    completion: x.completion,
    contactDetailsVisible: x.contact_details_visible,
    servedByFallback: servedByFallback(response),
    model,
    stopReason: response.stop_reason,
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
  };
}

// ---------- the call ----------

/** The exact request body (exported for tests and the manual script). */
export function buildRequest(input: ExtractListingInput): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const env = getEnv();
  return {
    model: env.CLAUDE_MODEL,
    max_tokens: env.CLAUDE_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent(input) }],
    output_config: {
      effort: env.CLAUDE_EFFORT,
      format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown> },
    },
    betas: [FALLBACK_BETA],
    // A policy decline is re-run on the fallback model inside the same call.
    fallbacks: "default",
  };
}

/** A promise that rejects as soon as `signal` aborts (never settles otherwise). Cleans up its listener. */
function abortRace(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(() => undefined);
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

/**
 * Reads a listing (screenshot and/or pasted text) with Claude.
 * Throws ExtractError for every failure and ExtractAbortedError when `opts.signal` aborts.
 */
export async function extractListing(
  input: ExtractListingInput,
  opts: { signal?: AbortSignal } = {},
): Promise<ExtractionOutcome> {
  const env = getEnv();
  const callerSignal = opts.signal;
  if (callerSignal?.aborted) throw new ExtractAbortedError();

  // Our own deadline uses the global setTimeout (not AbortSignal.timeout) so tests can fake the clock.
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("The read took too long", "TimeoutError")),
    env.CLAUDE_TIMEOUT_MS,
  );
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  const race = abortRace(signal);
  const hasImage = Boolean(input.image);

  let response: Anthropic.Beta.BetaMessage;
  try {
    const call = getAnthropic().beta.messages.create(buildRequest(input), { signal });
    response = await Promise.race([Promise.resolve(call), race.promise]);
  } catch (err) {
    const mapped = mapClaudeError(err, { callerSignal, deadlineSignal: deadline.signal, hasImage });
    if (mapped instanceof ExtractError) recordExtractOutcome(circuitKind(mapped.code));
    throw mapped;
  } finally {
    clearTimeout(timer);
    race.dispose();
  }

  try {
    const result = processResponse(response);
    recordExtractOutcome("ok");
    return result;
  } catch (err) {
    if (err instanceof ExtractError) recordExtractOutcome(circuitKind(err.code));
    throw err;
  }
}
