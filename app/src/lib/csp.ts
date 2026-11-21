/**
 * Content Security Policy for page requests (A§6.6), built per request by `src/proxy.ts`.
 * Pure and dependency-free (no "server-only", no env module) so the proxy can import it.
 *
 * nonce mode (default):
 *   script-src 'self' 'nonce-{N}' 'strict-dynamic' (+ 'unsafe-eval' in dev)
 * relaxed mode (CSP_MODE=relaxed, only if a third-party component breaks under strict-dynamic):
 *   script-src 'self' 'unsafe-inline' (+ 'unsafe-eval' in dev)
 */

export type CspMode = "nonce" | "relaxed";

export interface CspOptions {
  nonce: string;
  mode?: CspMode;
  /** `next dev`: allows eval (React debugging) and the HMR websocket. */
  isDev?: boolean;
  /** Adds upgrade-insecure-requests. */
  isProduction?: boolean;
}

/** A fresh, unguessable nonce (128 bits, base64). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** CSP_MODE from the environment; anything other than "relaxed" means "nonce". */
export function cspModeFrom(value: string | undefined): CspMode {
  return value?.trim().toLowerCase() === "relaxed" ? "relaxed" : "nonce";
}

/** The Content-Security-Policy header value. */
export function buildCsp({ nonce, mode = "nonce", isDev = false, isProduction = false }: CspOptions): string {
  const evalSrc = isDev ? " 'unsafe-eval'" : "";
  const scriptSrc =
    mode === "relaxed" ? `'self' 'unsafe-inline'${evalSrc}` : `'self' 'nonce-${nonce}' 'strict-dynamic'${evalSrc}`;
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind, base-ui, motion and next/font write inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Screenshot previews (blob:) and the canvas card (data:/blob:).
    "img-src 'self' blob: data:",
    // next/font self-hosts; the stamp WOFFs load from /fonts.
    "font-src 'self'",
    // Claude is called server-side only.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ];
  if (isProduction) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
