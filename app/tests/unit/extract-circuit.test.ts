import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetEnvForTests } from "@/lib/env";
import {
  CIRCUIT_OPEN_MS,
  __resetCircuitForTests,
  extractionEnabled,
  recordExtractOutcome,
} from "@/lib/extract-circuit";
import { publicConfigWith } from "@/lib/config";
import { UNKNOWN_DATA_STATUS } from "@/lib/data-status";

const getPublicConfig = () => publicConfigWith(UNKNOWN_DATA_STATUS);

const T0 = 1_800_000_000_000;

function withKey(key: string | undefined) {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  __resetEnvForTests();
}

describe("extract-circuit", () => {
  beforeEach(() => {
    __resetCircuitForTests();
    withKey("sk-test-fake");
  });
  afterEach(() => withKey(undefined));

  it("no key → disabled", () => {
    withKey(undefined);
    expect(extractionEnabled(T0)).toBe(false);
    expect(getPublicConfig().extractEnabled).toBe(false);
  });

  it("a key and a closed circuit → enabled", () => {
    expect(extractionEnabled(T0)).toBe(true);
    expect(getPublicConfig().extractEnabled).toBe(true);
  });

  it("three server_fail in a row open the circuit for 5 minutes", () => {
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("server_fail", T0 + 1);
    expect(extractionEnabled(T0 + 2)).toBe(true);
    recordExtractOutcome("server_fail", T0 + 2);
    expect(extractionEnabled(T0 + 3)).toBe(false);
    expect(extractionEnabled(T0 + 2 + CIRCUIT_OPEN_MS - 1)).toBe(false);
    expect(extractionEnabled(T0 + 2 + CIRCUIT_OPEN_MS)).toBe(true);
    // After closing, it takes three new failures to open again.
    recordExtractOutcome("server_fail", T0 + CIRCUIT_OPEN_MS + 10);
    expect(extractionEnabled(T0 + CIRCUIT_OPEN_MS + 11)).toBe(true);
  });

  it("one ok resets the count", () => {
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("ok", T0);
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("server_fail", T0);
    expect(extractionEnabled(T0)).toBe(true);
  });

  it("other never trips it", () => {
    for (let i = 0; i < 10; i++) recordExtractOutcome("other", T0);
    expect(extractionEnabled(T0)).toBe(true);
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("other", T0);
    recordExtractOutcome("server_fail", T0);
    recordExtractOutcome("other", T0);
    expect(extractionEnabled(T0)).toBe(true);
    recordExtractOutcome("server_fail", T0);
    expect(extractionEnabled(T0)).toBe(false);
  });

  it("uses the real clock by default", () => {
    expect(extractionEnabled()).toBe(true);
    recordExtractOutcome("server_fail");
    recordExtractOutcome("server_fail");
    recordExtractOutcome("server_fail");
    expect(extractionEnabled()).toBe(false);
  });
});
