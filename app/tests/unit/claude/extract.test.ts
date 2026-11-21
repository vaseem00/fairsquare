import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setAnthropicForTests, getAnthropic } from "@/lib/claude/client";
import { ExtractAbortedError, ExtractError } from "@/lib/claude/errors";
import { buildRequest, extractListing, FALLBACK_BETA, outcomeFor, sanitiseFields } from "@/lib/claude/extract";
import { EXTRACTION_JSON_SCHEMA } from "@/lib/claude/schema";
import { __resetEnvForTests } from "@/lib/env";
import { __resetCircuitForTests, extractionEnabled } from "@/lib/extract-circuit";
import {
  apiError,
  claudeMessage,
  fakeAnthropic,
  MARINA_EXTRACTION,
  maxTokensMessage,
  refusalMessage,
} from "../../helpers/fake-anthropic";

const IMAGE = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };
const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_MODEL", "CLAUDE_MAX_TOKENS", "CLAUDE_EFFORT", "CLAUDE_TIMEOUT_MS"];

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetEnvForTests();
}

beforeEach(() => {
  setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key" });
  __resetCircuitForTests();
});
afterEach(() => {
  __setAnthropicForTests(null);
  vi.useRealTimers();
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (err instanceof ExtractError) return `${err.code}:${err.status}`;
  if (err instanceof ExtractAbortedError) return "aborted";
  return `unexpected:${String(err)}`;
}

describe("the real client", () => {
  it("is built with maxRetries 0 and a timeout just above CLAUDE_TIMEOUT_MS", () => {
    const c = getAnthropic() as unknown as Anthropic;
    expect(c).toBeInstanceOf(Anthropic);
    expect(c.maxRetries).toBe(0);
    expect(c.timeout).toBe(24_000 + 2_000);
  });
});

describe("request shape", () => {
  it("model, max_tokens, effort, JSON schema, fallback beta; no thinking key", async () => {
    const fake = fakeAnthropic(claudeMessage(MARINA_EXTRACTION));
    __setAnthropicForTests(fake.client);
    await extractListing({ image: IMAGE, text: "2BR" });
    expect(fake.calls).toHaveLength(1);
    const c = fake.calls[0];
    expect(c.model).toBe("claude-opus-5-5");
    expect(c.maxTokens).toBe(8192);
    expect(c.effort).toBe("low");
    expect(c.format).toEqual({ type: "json_schema", schema: EXTRACTION_JSON_SCHEMA });
    expect(c.schema).toBe(EXTRACTION_JSON_SCHEMA);
    expect(c.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(c.fallbacks).toBe("default");
    expect(c.hasThinking).toBe(false);
    expect(c.params.system).toContain("Dubai property listings");
    expect(c.params.messages).toHaveLength(1);
    expect(c.params.messages[0].role).toBe("user");
    expect(c.options?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(c.params).sort()).toEqual(
      ["betas", "fallbacks", "max_tokens", "messages", "model", "output_config", "system"].sort(),
    );
  });

  it("CLAUDE_MODEL, CLAUDE_MAX_TOKENS and CLAUDE_EFFORT come from the environment", () => {
    setEnv({ CLAUDE_MODEL: "claude-opus-5-5-test", CLAUDE_MAX_TOKENS: "4096", CLAUDE_EFFORT: "medium" });
    const body = buildRequest({ text: "x" });
    expect(body.model).toBe("claude-opus-5-5-test");
    expect(body.max_tokens).toBe(4096);
    expect(body.output_config?.effort).toBe("medium");
  });
});

describe("response mapping", () => {
  it("ok: fields, property type, completion, contact details, usage", async () => {
    __setAnthropicForTests(fakeAnthropic(claudeMessage(MARINA_EXTRACTION, { inputTokens: 1800, outputTokens: 120 })).client);
    const out = await extractListing({ image: IMAGE });
    expect(out.outcome).toBe("ok");
    expect(out.fields).toEqual({
      buildingText: "Mockup Crest",
      areaText: "Dubai Marina",
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 2_450_000,
    });
    expect(out.propertyType).toBe("apartment");
    expect(out.completion).toBe("ready");
    expect(out.contactDetailsVisible).toBe(true);
    expect(out.servedByFallback).toBe(false);
    expect(out.model).toBe("claude-opus-5-5");
    expect(out.usage).toEqual({ inputTokens: 1800, outputTokens: 120 });
  });

  it("ignores fallback blocks and reports servedByFallback from usage.iterations", async () => {
    const msg = claudeMessage(MARINA_EXTRACTION, {
      model: "claude-opus-4-8",
      content: [
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: JSON.stringify(MARINA_EXTRACTION), citations: null },
      ],
      iterations: [{ type: "message" }, { type: "fallback_message" }],
    });
    __setAnthropicForTests(fakeAnthropic(msg).client);
    const out = await extractListing({ text: "x" });
    expect(out.servedByFallback).toBe(true);
    expect(out.model).toBe("claude-opus-4-8");
    expect(out.fields.buildingText).toBe("Mockup Crest");
  });

  it("refusal → 422 extract_refused; max_tokens → 422 extract_unreadable", async () => {
    __setAnthropicForTests(fakeAnthropic(refusalMessage("cyber"), maxTokensMessage()).client);
    expect(await codeOf(extractListing({ image: IMAGE }))).toBe("extract_refused:422");
    expect(await codeOf(extractListing({ image: IMAGE }))).toBe("extract_unreadable:422");
  });

  it("non-JSON, schema-invalid or missing text → 502 extract_failed", async () => {
    __setAnthropicForTests(
      fakeAnthropic(
        claudeMessage("Sure! Here are the facts: building Mockup Crest"),
        claudeMessage({ ...MARINA_EXTRACTION, bedrooms: "two" }),
        claudeMessage("", { content: [] }),
      ).client,
    );
    expect(await codeOf(extractListing({ text: "x" }))).toBe("extract_failed:502");
    expect(await codeOf(extractListing({ text: "x" }))).toBe("extract_failed:502");
    expect(await codeOf(extractListing({ text: "x" }))).toBe("extract_failed:502");
  });

  it("outcomes: not_listing, rental, not_apartment (villa, townhouse, other)", async () => {
    expect(outcomeFor({ is_listing: false, listing_type: "sale", property_type: "apartment" })).toBe("not_listing");
    expect(outcomeFor({ is_listing: true, listing_type: "rent", property_type: "apartment" })).toBe("rental");
    expect(outcomeFor({ is_listing: true, listing_type: "sale", property_type: "villa" })).toBe("not_apartment");
    expect(outcomeFor({ is_listing: true, listing_type: "sale", property_type: "townhouse" })).toBe("not_apartment");
    expect(outcomeFor({ is_listing: true, listing_type: "sale", property_type: "other" })).toBe("not_apartment");
    expect(outcomeFor({ is_listing: true, listing_type: "unknown", property_type: "unknown" })).toBe("ok");

    __setAnthropicForTests(
      fakeAnthropic(claudeMessage({ ...MARINA_EXTRACTION, property_type: "villa", completion: "off_plan" })).client,
    );
    const villa = await extractListing({ text: "x" });
    expect(villa.outcome).toBe("not_apartment");
    expect(villa.completion).toBe("off_plan");
    expect(villa.fields.priceAed).toBe(2_450_000);
  });
});

describe("sanitiseFields (A§5.5)", () => {
  const base = { ...MARINA_EXTRACTION } as const;
  it("trims and caps strings; empty becomes null", () => {
    const f = sanitiseFields({ ...base, building_text: `  ${"B".repeat(200)}  `, area_text: "   " });
    expect(f.buildingText).toHaveLength(120);
    expect(f.areaText).toBeNull();
    expect(sanitiseFields({ ...base, area_text: "A".repeat(100) }).areaText).toHaveLength(80);
    expect(sanitiseFields({ ...base, building_text: " Mockup\n  Crest " }).buildingText).toBe("Mockup Crest");
  });

  it("bedrooms: integers 0–7 only (a studio is 0)", () => {
    expect(sanitiseFields({ ...base, bedrooms: 0 }).bedrooms).toBe(0);
    expect(sanitiseFields({ ...base, bedrooms: 7 }).bedrooms).toBe(7);
    expect(sanitiseFields({ ...base, bedrooms: 8 }).bedrooms).toBeNull();
    expect(sanitiseFields({ ...base, bedrooms: -1 }).bedrooms).toBeNull();
    expect(sanitiseFields({ ...base, bedrooms: 2.5 }).bedrooms).toBeNull();
    expect(sanitiseFields({ ...base, bedrooms: null }).bedrooms).toBeNull();
  });

  it("numbers: not finite or ≤ 0 → null; size > 50,000 → null; price < 10,000 → null; whole units", () => {
    expect(sanitiseFields({ ...base, size_sqft: 0 }).sizeSqft).toBeNull();
    expect(sanitiseFields({ ...base, size_sqft: -5 }).sizeSqft).toBeNull();
    expect(sanitiseFields({ ...base, size_sqft: Number.POSITIVE_INFINITY }).sizeSqft).toBeNull();
    expect(sanitiseFields({ ...base, size_sqft: 50_001 }).sizeSqft).toBeNull();
    expect(sanitiseFields({ ...base, size_sqft: 50_000 }).sizeSqft).toBe(50_000);
    expect(sanitiseFields({ ...base, size_sqft: 119.3 * 10.7639 }).sizeSqft).toBe(1284);
    expect(sanitiseFields({ ...base, price_aed: 9_999 }).priceAed).toBeNull();
    expect(sanitiseFields({ ...base, price_aed: 10_000 }).priceAed).toBe(10_000);
    expect(sanitiseFields({ ...base, price_aed: Number.NaN }).priceAed).toBeNull();
    expect(sanitiseFields({ ...base, price_aed: null }).priceAed).toBeNull();
  });
});

describe("SDK errors", () => {
  const cases: Array<[string, unknown, boolean, string]> = [
    ["RateLimitError", apiError(Anthropic.RateLimitError, 429), true, "extract_busy:503"],
    ["status 529", apiError(Anthropic.APIError, 529), true, "extract_busy:503"],
    ["OverloadedError", apiError(Anthropic.OverloadedError, 529), false, "extract_busy:503"],
    ["AuthenticationError", apiError(Anthropic.AuthenticationError, 401), true, "extract_unavailable:503"],
    ["PermissionDeniedError", apiError(Anthropic.PermissionDeniedError, 403), true, "extract_unavailable:503"],
    ["BadRequestError with an image", apiError(Anthropic.BadRequestError, 400), true, "image_rejected:422"],
    ["BadRequestError without an image", apiError(Anthropic.BadRequestError, 400), false, "extract_failed:502"],
    ["InternalServerError", apiError(Anthropic.InternalServerError, 500), true, "extract_failed:502"],
    ["APIConnectionError", apiError(Anthropic.APIConnectionError), true, "extract_failed:502"],
    ["a non-SDK error", new TypeError("boom"), true, "extract_failed:502"],
  ];
  for (const [label, error, withImage, expected] of cases) {
    it(`${label} → ${expected}`, async () => {
      __setAnthropicForTests(fakeAnthropic({ error }).client);
      const input = withImage ? { image: IMAGE } : { text: "x" };
      expect(await codeOf(extractListing(input))).toBe(expected);
    });
  }

  it("extract_busy carries retryAfterSec 30", async () => {
    __setAnthropicForTests(fakeAnthropic({ error: apiError(Anthropic.RateLimitError, 429) }).client);
    const err = (await extractListing({ text: "x" }).catch((e: unknown) => e)) as ExtractError;
    expect(err.retryAfterSec).toBe(30);
  });
});

describe("deadline and abort", () => {
  it("a call that never resolves → 504 extract_timeout after CLAUDE_TIMEOUT_MS (faked timers)", async () => {
    vi.useFakeTimers();
    const fake = fakeAnthropic("hang");
    __setAnthropicForTests(fake.client);
    let settled: string | null = null;
    const p = codeOf(extractListing({ image: IMAGE })).then((c) => (settled = c));
    await vi.advanceTimersByTimeAsync(23_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe("extract_timeout:504");
    expect(fake.calls[0].options?.signal?.aborted).toBe(true);
  });

  it("CLAUDE_TIMEOUT_MS is read from the environment", async () => {
    setEnv({ CLAUDE_TIMEOUT_MS: "5000" });
    vi.useFakeTimers();
    __setAnthropicForTests(fakeAnthropic("hang").client);
    const p = codeOf(extractListing({ text: "x" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe("extract_timeout:504");
  });

  it("a caller abort throws ExtractAbortedError, cancels the upstream call and does not touch the circuit", async () => {
    const fake = fakeAnthropic("hang-until-abort", "hang-until-abort", "hang-until-abort", "hang-until-abort");
    __setAnthropicForTests(fake.client);
    for (let i = 0; i < 4; i++) {
      const ac = new AbortController();
      const p = codeOf(extractListing({ text: "x" }, { signal: ac.signal }));
      ac.abort();
      expect(await p).toBe("aborted");
    }
    expect(extractionEnabled()).toBe(true);
  });

  it("an already-aborted signal makes no call", async () => {
    const fake = fakeAnthropic(claudeMessage(MARINA_EXTRACTION));
    __setAnthropicForTests(fake.client);
    const ac = new AbortController();
    ac.abort();
    expect(await codeOf(extractListing({ text: "x" }, { signal: ac.signal }))).toBe("aborted");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("circuit breaker outcomes", () => {
  it("three extract_failed/extract_timeout in a row open the circuit; refusals and 429s never do", async () => {
    __setAnthropicForTests(
      fakeAnthropic(
        refusalMessage(),
        { error: apiError(Anthropic.RateLimitError, 429) },
        { error: apiError(Anthropic.BadRequestError, 400) },
        refusalMessage(),
        { error: apiError(Anthropic.RateLimitError, 429) },
        maxTokensMessage(),
      ).client,
    );
    for (let i = 0; i < 6; i++) await extractListing({ image: IMAGE }).catch(() => undefined);
    expect(extractionEnabled()).toBe(true);

    __setAnthropicForTests(
      fakeAnthropic(
        { error: apiError(Anthropic.InternalServerError, 500) },
        claudeMessage("not json"),
        { error: apiError(Anthropic.InternalServerError, 503) },
      ).client,
    );
    await extractListing({ text: "x" }).catch(() => undefined);
    await extractListing({ text: "x" }).catch(() => undefined);
    expect(extractionEnabled()).toBe(true);
    await extractListing({ text: "x" }).catch(() => undefined);
    expect(extractionEnabled()).toBe(false);
  });

  it("a success resets the count", async () => {
    __setAnthropicForTests(
      fakeAnthropic(
        { error: apiError(Anthropic.InternalServerError, 500) },
        { error: apiError(Anthropic.InternalServerError, 500) },
        claudeMessage(MARINA_EXTRACTION),
        { error: apiError(Anthropic.InternalServerError, 500) },
        { error: apiError(Anthropic.InternalServerError, 500) },
      ).client,
    );
    for (let i = 0; i < 5; i++) await extractListing({ text: "x" }).catch(() => undefined);
    expect(extractionEnabled()).toBe(true);
  });
});
