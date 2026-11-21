import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sniffImage } from "@/lib/image/sniff";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "../../fixtures/listings", name)));

describe("sniffImage", () => {
  it("recognises JPEG, PNG and WebP by their magic bytes", () => {
    expect(sniffImage(fixture("tiny.jpg"))).toBe("image/jpeg");
    expect(sniffImage(fixture("tiny.png"))).toBe("image/png");
    expect(sniffImage(fixture("tiny.webp"))).toBe("image/webp");
  });

  it("rejects text, HEIC-like and truncated data", () => {
    expect(sniffImage(fixture("not-an-image.txt"))).toBeNull();
    expect(sniffImage(new Uint8Array([]))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeNull();
    // ISO-BMFF ("....ftypheic"), i.e. HEIC
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull();
    // RIFF but not WEBP (a WAV file)
    expect(sniffImage(new TextEncoder().encode("RIFF\x24\x00\x00\x00WAVEfmt "))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});
