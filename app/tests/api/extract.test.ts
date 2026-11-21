import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/extract/route";
import { __setAnthropicForTests } from "@/lib/claude/client";
import { publicConfigWith } from "@/lib/config";
import { UNKNOWN_DATA_STATUS } from "@/lib/data-status";
import { rateLimitMessage } from "@/lib/copy";
import { buildings, events, rateLimits } from "@/lib/db/schema";
import { __resetEnvForTests } from "@/lib/env";
import { CIRCUIT_OPEN_MS, __resetCircuitForTests } from "@/lib/extract-circuit";
import { __setLogSinkForTests } from "@/lib/log";
import type { ApiError, ExtractResponse } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import {
  apiError,
  claudeMessage,
  fakeAnthropic,
  MARINA_EXTRACTION,
  maxTokensMessage,
  refusalMessage,
  type FakeAnthropic,
  type FakeStep,
} from "../helpers/fake-anthropic";
import { buildRequest, call, TEST_ORIGIN, type CallOptions } from "../helpers/http";

const getPublicConfig = () => publicConfigWith(UNKNOWN_DATA_STATUS);

const t = setupTestDb();
const NOW = new Date("2026-11-17T08:00:00Z");
const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/listings");
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const PNG = fixture("tiny.png");
const LISTING_TEXT = readFileSync(path.join(FIXTURES, "marina-listing.txt"), "utf8");

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_TIMEOUT_MS",
  "EXTRACT_ANON_BURST_LIMIT",
  "EXTRACT_ANON_DAILY_LIMIT",
  "EXTRACT_IP_DAILY_LIMIT",
  "EXTRACT_DAILY_GLOBAL_CAP",
];

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetEnvForTests();
}

function file(bytes: Uint8Array, type: string, name = "screenshot.png"): File {
  return new File([bytes as BlobPart], name, { type });
}

type Body = ExtractResponse & { error: ApiError };

function post(form: Record<string, string | Blob> | FormData, opts: Omit<CallOptions, "form"> = {}) {
  return call<Body>(POST, { method: "POST", url: "/api/extract", form, ...opts });
}

let fake: FakeAnthropic;
function useFake(...steps: FakeStep[]): FakeAnthropic {
  fake = fakeAnthropic(...steps);
  __setAnthropicForTests(fake.client);
  return fake;
}

async function eventsNamed(name: "extract_ok" | "extract_fail") {
  return t.db.select().from(events).where(eq(events.name, name));
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
  __setAnthropicForTests(null);
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
});
beforeEach(async () => {
  vi.setSystemTime(NOW);
  setEnv({ ...Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])), ANTHROPIC_API_KEY: "sk-test-not-a-real-key" });
  __resetCircuitForTests();
  useFake();
  await clearUserData(t.db);
});
afterEach(() => {
  __setLogSinkForTests(null);
});

describe("POST /api/extract: success", () => {
  it("Marina screenshot → 200 ok with fields, match (preselect Mockup Crest Tower, tower check) and an extract_ok event", async () => {
    useFake(claudeMessage(MARINA_EXTRACTION));
    const res = await post({ image: file(PNG, "image/png") });
    expect(res.status).toBe(200);
    expect(res.cookies.mz_aid).toBeDefined();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = res.body;
    expect(b.outcome).toBe("ok");
    expect(b.fields).toEqual({ buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 });
    expect(b.propertyType).toBe("apartment");
    expect(b.completion).toBe("ready");
    expect(b.contactDetailsVisible).toBe(true);

    const [marina] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    expect(b.match.preselectId).toBe(marina.id);
    expect(b.match.towerCheck).toBe(true);
    expect(b.match.candidates[0]).toMatchObject({ buildingId: marina.id, name: "Mockup Crest Tower", strength: "strong", salesForBedrooms: 11 });

    // The image reached Claude as base64 with its sniffed type.
    const content = fake.calls[0].params.messages[0].content as Array<{ type: string; source?: { media_type: string; data: string } }>;
    expect(content[0].source).toEqual({ type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") });

    const ok = await eventsNamed("extract_ok");
    expect(ok).toHaveLength(1);
    expect(typeof (ok[0].meta as { ms: unknown }).ms).toBe("number");
    expect(ok[0].meta).toMatchObject({ servedByFallback: false, hasImage: true });
    expect(ok[0].anonId).toBeTruthy();
    expect(await eventsNamed("extract_fail")).toHaveLength(0);
  });

  it("pasted text only works and is sent inside <listing_text>", async () => {
    useFake(claudeMessage({ ...MARINA_EXTRACTION, contact_details_visible: false }));
    const res = await post({ text: LISTING_TEXT });
    expect(res.status).toBe(200);
    expect(res.body.contactDetailsVisible).toBe(false);
    const content = fake.calls[0].params.messages[0].content as Array<{ type: string; text?: string }>;
    expect(content.map((c) => c.type)).toEqual(["text", "text"]);
    expect(content[0].text).toContain(`<listing_text>\n${LISTING_TEXT.trim()}\n</listing_text>`);
  });

  it("no building read → empty match", async () => {
    useFake(claudeMessage({ ...MARINA_EXTRACTION, building_text: null }));
    const res = await post({ text: "2BR for sale AED 2.45M" });
    expect(res.status).toBe(200);
    expect(res.body.fields.buildingText).toBeNull();
    expect(res.body.match).toEqual({ candidates: [], preselectId: null, towerCheck: false, areaCheck: false });
  });

  it.each([
    ["not_listing", { is_listing: false, listing_type: "unknown" }],
    ["rental", { listing_type: "rent", price_aed: 150_000 }],
    ["not_apartment", { property_type: "villa" }],
  ] as const)("outcome %s → 200 with the fields", async (outcome, patch) => {
    useFake(claudeMessage({ ...MARINA_EXTRACTION, ...patch, contact_details_visible: false }));
    const res = await post({ image: file(PNG, "image/png") });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe(outcome);
    expect(res.body.fields.buildingText).toBe("Mockup Crest");
    expect(res.body.contactDetailsVisible).toBe(false);
  });
});

describe("POST /api/extract: Claude errors", () => {
  const cases: Array<[string, FakeStep, number, string]> = [
    ["refusal", refusalMessage("cyber"), 422, "extract_refused"],
    ["max_tokens", maxTokensMessage(), 422, "extract_unreadable"],
    ["non-JSON output", claudeMessage("I think it is Mockup Crest"), 502, "extract_failed"],
    ["RateLimitError", { error: apiError(Anthropic.RateLimitError, 429) }, 503, "extract_busy"],
    ["status 529", { error: apiError(Anthropic.APIError, 529) }, 503, "extract_busy"],
    ["AuthenticationError", { error: apiError(Anthropic.AuthenticationError, 401) }, 503, "extract_unavailable"],
    ["BadRequestError with an image", { error: apiError(Anthropic.BadRequestError, 400) }, 422, "image_rejected"],
    ["another APIError", { error: apiError(Anthropic.InternalServerError, 500) }, 502, "extract_failed"],
  ];
  for (const [label, step, status, code] of cases) {
    it(`${label} → ${status} ${code}, one extract_fail event`, async () => {
      useFake(step);
      const res = await post({ image: file(PNG, "image/png") });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(res.body.error.requestId).toBe(res.headers.get("x-request-id"));
      if (code === "extract_busy") {
        expect(res.body.error.retryAfterSec).toBe(30);
        expect(res.headers.get("retry-after")).toBe("30");
      }
      const fails = await eventsNamed("extract_fail");
      expect(fails).toHaveLength(1);
      expect(fails[0].meta).toMatchObject({ code });
      expect(typeof (fails[0].meta as { ms: unknown }).ms).toBe("number");
    });
  }

  it("BadRequestError for text only → 502 extract_failed", async () => {
    useFake({ error: apiError(Anthropic.BadRequestError, 400) });
    const res = await post({ text: "2BR Marina" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("extract_failed");
  });

  it("a call that never resolves → 504 extract_timeout after CLAUDE_TIMEOUT_MS", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", CLAUDE_TIMEOUT_MS: "1000" });
    useFake("hang");
    const started = performance.now();
    const res = await post({ text: "2BR Marina" });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("extract_timeout");
    expect(performance.now() - started).toBeGreaterThanOrEqual(950);
  });

  it("no API key → 503 extract_unavailable without calling Claude", async () => {
    setEnv({ ANTHROPIC_API_KEY: undefined });
    useFake(claudeMessage(MARINA_EXTRACTION));
    const res = await post({ image: file(PNG, "image/png") });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("extract_unavailable");
    expect(fake.calls).toHaveLength(0);
    expect((await eventsNamed("extract_fail"))[0].meta).toMatchObject({ code: "extract_unavailable" });
  });

  it("client abort → 499 and no error log", async () => {
    const lines: Array<{ level: string; line: string }> = [];
    __setLogSinkForTests((level, line) => lines.push({ level, line }));
    useFake("hang-until-abort");
    const ac = new AbortController();
    const form = new FormData();
    form.append("text", "2BR Marina");
    const req = new NextRequest(new URL("/api/extract", TEST_ORIGIN), {
      method: "POST",
      headers: { origin: TEST_ORIGIN, host: new URL(TEST_ORIGIN).host },
      body: form,
      signal: ac.signal,
    });
    const pending = POST(req, { params: Promise.resolve({}) });
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    ac.abort();
    const res = await pending;
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
    expect(lines.filter((l) => l.level === "error")).toEqual([]);
    expect(await eventsNamed("extract_fail")).toHaveLength(0);
    expect(await eventsNamed("extract_ok")).toHaveLength(0);
  });
});

describe("POST /api/extract: circuit breaker", () => {
  it("three 502/504 in a row → the next call is 503 extract_unavailable without Claude; after 5 minutes Claude is called again", async () => {
    useFake(
      { error: apiError(Anthropic.InternalServerError, 500) },
      claudeMessage("not json"),
      { error: apiError(Anthropic.APIConnectionError) },
      claudeMessage(MARINA_EXTRACTION),
    );
    for (let i = 0; i < 3; i++) {
      const r = await post({ text: "2BR Marina" });
      expect(r.status).toBe(502);
    }
    expect(fake.calls).toHaveLength(3);
    const blocked = await post({ text: "2BR Marina" });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe("extract_unavailable");
    expect(fake.calls).toHaveLength(3);
    expect(getPublicConfig().extractEnabled).toBe(false);

    vi.setSystemTime(new Date(NOW.getTime() + CIRCUIT_OPEN_MS));
    expect(getPublicConfig().extractEnabled).toBe(true);
    const again = await post({ text: "2BR Marina" });
    expect(again.status).toBe(200);
    expect(fake.calls).toHaveLength(4);
  });

  it("refusals and rate limits never trip it", async () => {
    useFake(
      refusalMessage(),
      { error: apiError(Anthropic.RateLimitError, 429) },
      refusalMessage(),
      { error: apiError(Anthropic.RateLimitError, 429) },
      claudeMessage(MARINA_EXTRACTION),
    );
    for (let i = 0; i < 4; i++) await post({ text: "2BR Marina" });
    expect(getPublicConfig().extractEnabled).toBe(true);
    expect((await post({ text: "2BR Marina" })).status).toBe(200);
  });
});

describe("POST /api/extract: upload checks", () => {
  it("a body over 9 MB → 413 before formData() is read", async () => {
    useFake(claudeMessage(MARINA_EXTRACTION));
    const big = new Uint8Array(9 * 1024 * 1024 + 10);
    big.set(PNG);
    const req = buildRequest({
      method: "POST",
      url: "/api/extract",
      body: big as BodyInit,
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(big.byteLength) },
    });
    const spy = vi.spyOn(req, "formData");
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: ApiError }).error.code).toBe("image_too_large");
    expect(spy).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    const fails = await eventsNamed("extract_fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].meta).toMatchObject({ code: "image_too_large" });
  });

  it("a chunked body with no Content-Length is cut off at the limit → 413, without reading the rest", async () => {
    useFake(claudeMessage(MARINA_EXTRACTION));
    const CHUNK = 1024 * 1024;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) controller.close();
        else controller.enqueue(new Uint8Array(CHUNK));
      },
    });
    const req = new NextRequest(new URL("/api/extract", TEST_ORIGIN), {
      method: "POST",
      headers: { origin: TEST_ORIGIN, host: new URL(TEST_ORIGIN).host, "content-type": "multipart/form-data; boundary=x", "transfer-encoding": "chunked" },
      body: stream,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: ApiError }).error.code).toBe("image_too_large");
    expect(pulled).toBeLessThan(16);
    expect(fake.calls).toHaveLength(0);
  });

  it("an image of MAX_IMAGE_BYTES + 1 → 413 image_too_large", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 1);
    bytes.set(PNG);
    const res = await post({ image: file(bytes, "image/png") });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("image_too_large");
    expect(fake.calls).toHaveLength(0);
  });

  it("a text file posted as image/png → 415 unsupported_image", async () => {
    const res = await post({ image: file(fixture("not-an-image.txt"), "image/png", "listing.png") });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_image");
    expect(fake.calls).toHaveLength(0);
    expect((await eventsNamed("extract_fail"))[0].meta).toMatchObject({ code: "unsupported_image" });
  });

  it("a PNG posted as image/jpeg is accepted and sent as image/png; WebP and JPEG are accepted", async () => {
    useFake(claudeMessage(MARINA_EXTRACTION), claudeMessage(MARINA_EXTRACTION), claudeMessage(MARINA_EXTRACTION));
    expect((await post({ image: file(PNG, "image/jpeg", "photo.jpg") })).status).toBe(200);
    expect((await post({ image: file(fixture("tiny.webp"), "application/octet-stream") })).status).toBe(200);
    expect((await post({ image: file(fixture("tiny.jpg"), "image/jpeg") })).status).toBe(200);
    const types = fake.calls.map((c) => (c.params.messages[0].content as Array<{ source?: { media_type: string } }>)[0].source?.media_type);
    expect(types).toEqual(["image/png", "image/webp", "image/jpeg"]);
  });

  it("empty input → 400 empty_input (no fields, blank text, empty file)", async () => {
    const forms: Array<Record<string, string | Blob>> = [{ other: "x" }, { text: "   " }, { image: file(new Uint8Array(0), "image/png"), text: "" }];
    for (const form of forms) {
      const res = await post(form);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("empty_input");
    }
    expect(fake.calls).toHaveLength(0);
    const fails = await eventsNamed("extract_fail");
    expect(fails).toHaveLength(3);
    expect(fails.every((e) => (e.meta as { code: string }).code === "empty_input")).toBe(true);
  });

  it("text over 4,000 characters → 400 bad_request", async () => {
    const res = await post({ text: "x".repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("a cross-site POST → 403 bad_origin", async () => {
    const res = await post({ text: "2BR Marina" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("POST /api/extract: rate limits", () => {
  it("the 7th read within 15 minutes → 429 with the burst message; no Claude call; one extract_fail event", async () => {
    useFake(...Array.from({ length: 6 }, () => claudeMessage(MARINA_EXTRACTION)));
    let cookies: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      const r = await post({ text: "2BR Marina" }, { cookies });
      expect(r.status).toBe(200);
      cookies = { mz_aid: r.cookies.mz_aid.value };
    }
    const res = await post({ text: "2BR Marina" }, { cookies });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.body.error.retryAfterSec).toBe(15 * 60);
    expect(res.body.error.message).toBe(rateLimitMessage("extract_burst", 15 * 60));
    expect(res.body.error.message).toContain("Wait 15 minutes");
    expect(fake.calls).toHaveLength(6);
    const fails = await eventsNamed("extract_fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].meta).toMatchObject({ code: "rate_limited" });
  });

  it("requests the burst rule denies never count against the global cap", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", EXTRACT_DAILY_GLOBAL_CAP: "8" });
    useFake(...Array.from({ length: 7 }, () => claudeMessage(MARINA_EXTRACTION)));
    let cookies: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      const r = await post({ text: "abc" }, { cookies });
      expect(r.status).toBe(200);
      cookies = { mz_aid: r.cookies.mz_aid.value };
    }
    const globalCount = async () =>
      (await t.db.select().from(rateLimits).where(eq(rateLimits.key, "extract:global")))[0]?.count ?? 0;
    expect(await globalCount()).toBe(6);
    for (let i = 0; i < 20; i++) expect((await post({ text: "abc" }, { cookies })).status).toBe(429);
    expect(await globalCount()).toBe(6);
    // Someone else can still read a screenshot.
    expect((await post({ text: "2BR Marina" })).status).toBe(200);
  });

  it("invalid input does not count against the global cap", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", EXTRACT_DAILY_GLOBAL_CAP: "1" });
    useFake(claudeMessage(MARINA_EXTRACTION));
    for (let i = 0; i < 3; i++) expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: "2BR Marina" })).status).toBe(200);
  });

  it("the 21st read in a Dubai day → 429 with the daily message; no Claude call", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", EXTRACT_ANON_BURST_LIMIT: "100" });
    useFake(...Array.from({ length: 20 }, () => claudeMessage(MARINA_EXTRACTION)));
    let cookies: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const r = await post({ text: "2BR Marina" }, { cookies });
      expect(r.status).toBe(200);
      cookies = { mz_aid: r.cookies.mz_aid.value };
    }
    const res = await post({ text: "2BR Marina" }, { cookies });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
    expect(res.body.error.message).toBe(rateLimitMessage("extract_daily"));
    expect(fake.calls).toHaveLength(20);
  });

  it("the per-IP daily limit applies across people", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", EXTRACT_IP_DAILY_LIMIT: "2" });
    useFake(claudeMessage(MARINA_EXTRACTION), claudeMessage(MARINA_EXTRACTION));
    const headers = { "x-forwarded-for": "203.0.113.7" };
    expect((await post({ text: "a" }, { headers })).status).toBe(200);
    expect((await post({ text: "b" }, { headers })).status).toBe(200);
    const res = await post({ text: "c" }, { headers });
    expect(res.status).toBe(429);
    expect(fake.calls).toHaveLength(2);
  });

  it("reaching the global cap → 503 daily_cap_reached; no Claude call", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-test-not-a-real-key", EXTRACT_DAILY_GLOBAL_CAP: "2" });
    useFake(claudeMessage(MARINA_EXTRACTION), claudeMessage(MARINA_EXTRACTION));
    expect((await post({ text: "a" })).status).toBe(200);
    expect((await post({ text: "b" })).status).toBe(200);
    const res = await post({ text: "c" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("daily_cap_reached");
    expect(res.body.error.retryAfterSec).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(2);
    expect((await eventsNamed("extract_fail"))[0].meta).toMatchObject({ code: "daily_cap_reached" });
  });
});

describe("POST /api/extract: logging", () => {
  it("one extract line per read, with no building, area, price, size or pasted text", async () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    const lines: Array<{ level: string; line: string }> = [];
    __setLogSinkForTests((level, line) => lines.push({ level, line }));
    try {
      useFake(claudeMessage(MARINA_EXTRACTION), refusalMessage("cyber"));
      expect((await post({ image: file(PNG, "image/png"), text: LISTING_TEXT })).status).toBe(200);
      expect((await post({ text: LISTING_TEXT })).status).toBe(422);
      expect((await post({ text: "" })).status).toBe(400);
    } finally {
      process.env.LOG_LEVEL = prev;
    }
    const extractLines = lines.map((l) => JSON.parse(l.line) as Record<string, unknown>).filter((l) => l.event === "extract");
    expect(extractLines).toHaveLength(3);
    expect(extractLines[0]).toMatchObject({
      outcome: "ok",
      hasImage: true,
      imageBytes: PNG.byteLength,
      textChars: LISTING_TEXT.trim().length,
      model: "claude-opus-5-5",
      servedByFallback: false,
      inputTokens: 1500,
      outputTokens: 90,
      found: { building: true, area: true, bedrooms: true, size: true, price: true },
    });
    expect(typeof extractLines[0].ms).toBe("number");
    expect(extractLines[0].anonHash).toMatch(/^[0-9a-f]{8}$/);
    expect(extractLines[1]).toMatchObject({ errorCode: "extract_refused", stopReason: "refusal", refusalCategory: "cyber" });
    expect(extractLines[2]).toMatchObject({ errorCode: "empty_input" });

    const all = lines.map((l) => l.line).join("\n");
    for (const secret of ["Mockup Crest", "Dubai Marina", "2450000", "2,450,000", "2.45M", "1,284", "Sample Agent", "FOR SALE"]) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toContain(Buffer.from(PNG).toString("base64"));
  });
});
