import { describe, expect, it } from "vitest";
import { last4, maskPhone, normalisePhone } from "@/lib/domain";

describe("normalisePhone", () => {
  it.each([
    ["050 123 4567", "+971501234567"],
    ["+971 50 123 4567", "+971501234567"],
    ["00971501234567", "+971501234567"],
    ["501234567", "+971501234567"],
    ["971501234567", "+971501234567"],
    ["(050) 123-4567", "+971501234567"],
    ["+44 7700 900123", "+447700900123"],
    ["12345", null],
    ["", null],
    ["+0123456789", null],
  ])("%s → %s", (input, out) => {
    expect(normalisePhone(input)).toBe(out);
  });

  it("tolerates non-string input", () => {
    expect(normalisePhone(undefined as unknown as string)).toBeNull();
  });
});

describe("mask", () => {
  it("masks UAE and other numbers", () => {
    expect(maskPhone("+971501234567")).toBe("+971 •• ••• 4567");
    expect(maskPhone("+447700900123")).toBe("+44 •• ••• 0123");
    expect(last4("+971501234567")).toBe("4567");
  });
});
