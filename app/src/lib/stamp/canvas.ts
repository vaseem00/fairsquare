/**
 * Canvas creation for the stamped card (client only). Tests swap the factory,
 * because jsdom has no 2D context.
 */

let canvasFactory: (() => HTMLCanvasElement) | null = null;

/** Tests: provide canvases. null restores `document.createElement("canvas")`. */
export function __setCanvasFactoryForTests(f: (() => HTMLCanvasElement) | null): void {
  canvasFactory = f;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = canvasFactory ? canvasFactory() : document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("No 2D canvas context");
  return ctx;
}

function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(",", 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(data ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** How long to wait for toBlob before encoding synchronously (some WebViews never call back). */
const TO_BLOB_TIMEOUT_MS = 3000;

/** PNG-encodes a canvas: `toBlob`, falling back to `toDataURL` if it fails or never calls back. */
export function canvasToPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const viaDataUrl = () => {
      if (settled) return;
      settled = true;
      try {
        resolve(dataUrlToBlob(c.toDataURL("image/png")));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("PNG encoding failed"));
      }
    };
    const timer = setTimeout(viaDataUrl, TO_BLOB_TIMEOUT_MS);
    try {
      c.toBlob((b) => {
        if (settled) return;
        clearTimeout(timer);
        if (b) {
          settled = true;
          resolve(b);
        } else viaDataUrl();
      }, "image/png");
    } catch {
      clearTimeout(timer);
      viaDataUrl();
    }
  });
}
