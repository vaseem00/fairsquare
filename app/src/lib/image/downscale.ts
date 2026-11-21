/**
 * Client-side downscale before upload (A§5.7). Browser only: it needs `createImageBitmap` and a canvas.
 * - The long edge is scaled to at most MAX_EDGE (1568 px, Claude's own working size); small images are
 *   never upscaled.
 * - The result is always re-encoded as `image/jpeg` (quality 0.85 by default), typically 150–400 KB.
 * - Decoding failures (a corrupt file, HEIC outside Safari) throw `DownscaleError` with code
 *   `unsupported_image`, which the UI maps to `error.badImage` copy.
 * The original file stays with the caller (for the on-screen sheet and the card); only the copy is sent.
 */

export const MAX_EDGE = 1568;
export const DEFAULT_JPEG_QUALITY = 0.85;

export class DownscaleError extends Error {
  override name = "DownscaleError";
  readonly code = "unsupported_image" as const;
  constructor(cause?: unknown) {
    super("unsupported_image", cause === undefined ? undefined : { cause });
  }
}

export function isDownscaleError(err: unknown): err is DownscaleError {
  return err instanceof DownscaleError;
}

/** Target size for an image: the long edge at most `maxEdge`, aspect ratio kept, never upscaled. */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

async function encode(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new DownscaleError();
    draw(ctx, bitmap, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  if (typeof document === "undefined") throw new DownscaleError();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new DownscaleError();
  draw(ctx, bitmap, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new DownscaleError())), "image/jpeg", quality);
  });
}

function draw(ctx: Canvas2D, bitmap: ImageBitmap, width: number, height: number): void {
  // JPEG has no alpha: paint white first so transparent PNG areas do not turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
}

/**
 * Decodes `file`, scales its long edge to at most `maxEdge` and re-encodes it as JPEG.
 * Throws DownscaleError (`unsupported_image`) when the browser cannot decode or encode it.
 */
export async function downscaleForUpload(
  file: Blob,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;
  if (typeof createImageBitmap !== "function") throw new DownscaleError();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new DownscaleError(err);
  }
  try {
    if (!bitmap.width || !bitmap.height) throw new DownscaleError();
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    let blob: Blob;
    try {
      blob = await encode(bitmap, width, height, quality);
    } catch (err) {
      throw isDownscaleError(err) ? err : new DownscaleError(err);
    }
    if (!blob.size) throw new DownscaleError();
    return { blob, width, height };
  } finally {
    bitmap.close?.();
  }
}
