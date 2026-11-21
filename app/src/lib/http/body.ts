import "server-only";
/**
 * Byte-limited request body reading. Route handlers have no default body limit and a chunked request
 * has no Content-Length, so `req.formData()` / `req.text()` would buffer whatever the client streams.
 * These helpers count the bytes as they arrive and stop reading (cancelling the stream) as soon as
 * the limit is passed, so memory use per request is bounded whatever the headers say.
 */

/** Thrown when a body is larger than the limit; callers map it to their own 400 or 413. */
export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body is larger than ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export function isBodyTooLarge(err: unknown): err is BodyTooLargeError {
  return err instanceof BodyTooLargeError;
}

/** Reads the whole body, throwing BodyTooLargeError once more than `maxBytes` have arrived. */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Reads a body as UTF-8 text with a byte limit. */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyLimited(req, maxBytes));
}

/** Parses a multipart (or urlencoded) body with a byte limit on the raw body. */
export async function readFormDataLimited(req: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyLimited(req, maxBytes);
  const type = req.headers.get("content-type") ?? "";
  return new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData();
}
