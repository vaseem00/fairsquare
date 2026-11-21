import { afterEach, describe, expect, it } from "vitest";
import { hmacHex, safeEqual, sha256Hex, sign, verify } from "@/lib/auth/sign";
import { __resetEnvForTests } from "@/lib/env";

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = ORIGINAL_SECRET;
  delete process.env.SESSION_SECRET_PREVIOUS;
  __resetEnvForTests();
});

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Same bytes, different spelling: set a padding bit in the last character of a 32-byte base64url MAC. */
function nonCanonical(sig: string): string {
  const last = B64URL.indexOf(sig[sig.length - 1]);
  return sig.slice(0, -1) + B64URL[last | 1];
}

describe("sign / verify", () => {
  it("round-trips a value for the same purpose", () => {
    const s = sign("aid", "abc");
    expect(s.startsWith("abc.")).toBe(true);
    expect(verify("aid", s)).toBe("abc");
  });

  it("keeps values that contain dots", () => {
    expect(verify("rec", sign("rec", "a.b.c"))).toBe("a.b.c");
  });

  it("rejects another purpose, a tampered value or signature, and malformed input", () => {
    const s = sign("aid", "abc");
    expect(verify("adm", s)).toBeNull();
    expect(verify("aid", s.replace("abc", "abd"))).toBeNull();
    expect(verify("aid", `${s.slice(0, -2)}xx`)).toBeNull();
    expect(verify("aid", "abc")).toBeNull();
    expect(verify("aid", "abc.")).toBeNull();
    expect(verify("aid", ".sig")).toBeNull();
    expect(verify("aid", "abc.not base64!")).toBeNull();
    expect(verify("aid", "")).toBeNull();
    expect(verify("aid", null)).toBeNull();
    expect(verify("aid", undefined)).toBeNull();
    expect(verify("aid", `${"x".repeat(2000)}.abc`)).toBeNull();
  });

  it("rejects a non-canonical signature spelling that decodes to the same bytes", () => {
    for (const value of ["abc", "6b1c7faa-8093-44b5-8a51-6c7d8e9f0a1b", "a.b.c", "x"]) {
      const s = sign("aid", value);
      const sig = s.slice(s.lastIndexOf(".") + 1);
      const variant = nonCanonical(sig);
      expect(Buffer.from(variant, "base64url").equals(Buffer.from(sig, "base64url"))).toBe(true);
      expect(verify("aid", `${value}.${variant}`)).toBeNull();
      expect(verify("aid", s)).toBe(value);
    }
  });

  it("refuses to sign an empty value", () => {
    expect(() => sign("aid", "")).toThrow();
  });

  it("verifies a value signed with SESSION_SECRET_PREVIOUS after rotation", () => {
    const old = sign("aid", "abc");
    process.env.SESSION_SECRET_PREVIOUS = ORIGINAL_SECRET;
    process.env.SESSION_SECRET = "a-brand-new-secret-0123456789abcdef0123";
    __resetEnvForTests();
    expect(verify("aid", old)).toBe("abc");
    expect(sign("aid", "abc")).not.toBe(old);

    delete process.env.SESSION_SECRET_PREVIOUS;
    __resetEnvForTests();
    expect(verify("aid", old)).toBeNull();
  });
});

describe("hash helpers", () => {
  it("hmacHex and sha256Hex are stable hex digests", () => {
    expect(hmacHex("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacHex("x")).toBe(hmacHex("x"));
    expect(hmacHex("x", "other")).not.toBe(hmacHex("x"));
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("safeEqual compares contents and length", () => {
    expect(safeEqual(Buffer.from("ab"), Buffer.from("ab"))).toBe(true);
    expect(safeEqual(Buffer.from("ab"), Buffer.from("ac"))).toBe(false);
    expect(safeEqual(Buffer.from("ab"), Buffer.from("abc"))).toBe(false);
  });
});
