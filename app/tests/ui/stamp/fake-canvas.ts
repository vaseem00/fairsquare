/**
 * A recording 2D canvas for jsdom (which has none): every method is a no-op except fillText
 * (recorded), measureText (0.55em per character), getImageData (opaque white, or `pixel`) and
 * toBlob (a PNG whose IHDR carries the canvas size). Install with `installFakeCanvas()`.
 */
import { __setCanvasFactoryForTests } from "@/lib/stamp/canvas";

export interface FakeCanvasEnv {
  texts: string[];
  /** Every fillText with its position (untransformed: a translated drawing reports its local y). */
  draws: { text: string; x: number; y: number }[];
  canvases: { width: number; height: number }[];
  /** RGBA returned by getImageData (default white). */
  pixel: [number, number, number, number];
  restore: () => void;
}

/** 8-byte signature + IHDR (width, height) + IEND: enough to read the size back. */
export function pngHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(8 + 25 + 12);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  out.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 33);
  return out;
}

export async function pngSize(blob: Blob): Promise<{ width: number; height: number; signature: boolean }> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    signature: b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    width: dv.getUint32(16),
    height: dv.getUint32(20),
  };
}

export function installFakeCanvas(): FakeCanvasEnv {
  const env: FakeCanvasEnv = { texts: [], draws: [], canvases: [], pixel: [255, 255, 255, 255], restore: () => {} };

  const makeCtx = (canvas: { width: number; height: number }) => {
    const state: Record<string, unknown> = { font: "10px sans-serif" };
    const methods: Record<string, unknown> = {
      fillText: (text: string, x: number, y: number) => {
        env.texts.push(String(text));
        env.draws.push({ text: String(text), x: Number(x), y: Number(y) });
      },
      measureText: (text: string) => {
        const m = /(\d+(?:\.\d+)?)px/.exec(String(state.font));
        const size = m ? Number(m[1]) : 10;
        return { width: [...String(text)].length * size * 0.55 };
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(Math.max(1, w * h) * 4);
        for (let i = 0; i < data.length; i += 4) data.set(env.pixel, i);
        return { data, width: w, height: h };
      },
      createLinearGradient: () => ({ addColorStop: () => {} }),
      canvas,
    };
    return new Proxy(state, {
      get(target, prop: string) {
        if (prop in methods) return methods[prop];
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    });
  };

  __setCanvasFactoryForTests(() => {
    const canvas = {
      width: 300,
      height: 150,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void, type?: string) =>
        cb(new Blob([pngHeader(canvas.width, canvas.height) as BlobPart], { type: type ?? "image/png" })),
    };
    const ctx = makeCtx(canvas);
    env.canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  });

  const g = globalThis as { Path2D?: unknown };
  const hadPath2D = "Path2D" in g;
  const prevPath2D = g.Path2D;
  if (!hadPath2D) g.Path2D = class {};

  env.restore = () => {
    __setCanvasFactoryForTests(null);
    if (!hadPath2D) delete g.Path2D;
    else g.Path2D = prevPath2D;
  };
  return env;
}
