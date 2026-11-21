import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, CODE_RE, codeSeed, generateShareCode, normaliseCode } from "@/lib/domain";

describe("share codes", () => {
  it("10,000 generated codes all match CODE_RE", () => {
    for (let i = 0; i < 10_000; i++) expect(CODE_RE.test(generateShareCode())).toBe(true);
  });

  it("uses the injected random bytes", () => {
    expect(generateShareCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe("ABCDEF");
    expect(generateShareCode(() => new Uint8Array([31, 63, 255, 32, 0, 0]))).toBe("999A" + "AA");
  });

  it("alphabet has 32 symbols without I, O, 0 or 1", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
    expect(CODE_LENGTH).toBe(6);
  });

  it("normaliseCode trims, uppercases and validates", () => {
    expect(normaliseCode(" abc234 ")).toBe("ABC234");
    expect(normaliseCode("ABCDE0")).toBeNull();
    expect(normaliseCode("ABCDEFG")).toBeNull();
    expect(normaliseCode("ABC-23")).toBeNull();
    expect(normaliseCode(undefined as unknown as string)).toBeNull();
  });

  it("codeSeed is stable and differs between codes", () => {
    expect(codeSeed("K7Q2MX")).toBe(codeSeed("K7Q2MX"));
    expect(codeSeed("K7Q2MX")).not.toBe(codeSeed("K7Q2MY"));
    expect(Number.isInteger(codeSeed("K7Q2MX"))).toBe(true);
  });
});
