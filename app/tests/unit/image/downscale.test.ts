/**
 * downscaleForUpload runs in the browser. Node has no image decoder or canvas, so these tests stand in a
 * fake `createImageBitmap` that reads the real PNG header (IHDR width/height) and rejects anything else,
 * plus a fake `OffscreenCanvas` (or `document.createElement("canvas")`) that records what was drawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownscaleError, MAX_EDGE, downscaleForUpload, fitWithin } from "@/lib/image/downscale";

/** A PNG signature + IHDR chunk for the given size (enough for the fake decoder). */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  v.setUint32(16, width);
  v.setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

const pngBlob = (w: number, h: number) => new Blob([pngHeader(w, h) as BlobPart], { type: "image/png" });

interface Drawn {
  canvas: { width: number; height: number };
  drawn: Array<[number, number, number, number]>;
  encoded: Array<{ type?: string; quality?: number }>;
}

function installFakes(opts: { offscreen: boolean }): Drawn & { closed: number } {
  const state: Drawn & { closed: number } = { canvas: { width: 0, height: 0 }, drawn: [], encoded: [], closed: 0 };
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || sig.some((x, i) => bytes[i] !== x)) throw new DOMException("decode failed", "InvalidStateError");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20), close: () => (state.closed += 1) };
  });
  const ctx = {
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillRect: () => undefined,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => state.drawn.push([x, y, w, h]),
  };
  if (opts.offscreen) {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(public width: number, public height: number) {
          state.canvas = { width, height };
        }
        getContext() {
          return ctx;
        }
        async convertToBlob(o: { type?: string; quality?: number }) {
          state.encoded.push(o);
          return new Blob([new Uint8Array(1234) as BlobPart], { type: o.type });
        }
      },
    );
  } else {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", {
      createElement: () => {
        const el = {
          width: 0,
          height: 0,
          getContext: () => ctx,
          toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
            state.canvas = { width: el.width, height: el.height };
            state.encoded.push({ type, quality });
            cb(new Blob([new Uint8Array(999) as BlobPart], { type }));
          },
        };
        return el;
      },
    });
  }
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fitWithin", () => {
  it("scales the long edge to MAX_EDGE and never upscales", () => {
    expect(MAX_EDGE).toBe(1568);
    expect(fitWithin(3000, 6000)).toEqual({ width: 784, height: 1568 });
    expect(fitWithin(6000, 3000)).toEqual({ width: 1568, height: 784 });
    expect(fitWithin(1170, 2532)).toEqual({ width: 725, height: 1568 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1568, 1568)).toEqual({ width: 1568, height: 1568 });
    expect(fitWithin(100_000, 10)).toEqual({ width: 1568, height: 1 });
  });
});

describe("downscaleForUpload", () => {
  it("a 3000×6000 PNG gives a 784×1568 JPEG (OffscreenCanvas)", async () => {
    const s = installFakes({ offscreen: true });
    const out = await downscaleForUpload(pngBlob(3000, 6000));
    expect(out.width).toBe(784);
    expect(out.height).toBe(1568);
    expect(out.blob.type).toBe("image/jpeg");
    expect(out.blob.size).toBeGreaterThan(0);
    expect(s.canvas).toEqual({ width: 784, height: 1568 });
    expect(s.drawn).toEqual([[0, 0, 784, 1568]]);
    expect(s.encoded).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
    expect(s.closed).toBe(1);
  });

  it("does not upscale a small image, and honours maxEdge and quality", async () => {
    const s = installFakes({ offscreen: true });
    const small = await downscaleForUpload(pngBlob(640, 480));
    expect([small.width, small.height]).toEqual([640, 480]);
    expect(small.blob.type).toBe("image/jpeg");
    const custom = await downscaleForUpload(pngBlob(2000, 1000), { maxEdge: 1000, quality: 0.7 });
    expect([custom.width, custom.height]).toEqual([1000, 500]);
    expect(s.encoded.at(-1)).toEqual({ type: "image/jpeg", quality: 0.7 });
  });

  it("falls back to a DOM canvas without OffscreenCanvas", async () => {
    const s = installFakes({ offscreen: false });
    const out = await downscaleForUpload(pngBlob(3000, 6000));
    expect([out.width, out.height]).toEqual([784, 1568]);
    expect(out.blob.type).toBe("image/jpeg");
    expect(s.canvas).toEqual({ width: 784, height: 1568 });
  });

  it("a corrupt blob throws unsupported_image", async () => {
    installFakes({ offscreen: true });
    const corrupt = new Blob([new TextEncoder().encode("not an image at all") as BlobPart], { type: "image/png" });
    const err = await downscaleForUpload(corrupt).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownscaleError);
    expect((err as DownscaleError).code).toBe("unsupported_image");
  });

  it("throws unsupported_image when the browser cannot decode images at all", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(downscaleForUpload(pngBlob(10, 10))).rejects.toMatchObject({ code: "unsupported_image" });
  });
});
