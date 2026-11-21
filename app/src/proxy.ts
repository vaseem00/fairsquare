/**
 * Proxy (Next 16's renamed middleware; Node runtime). For page requests only (A§6.6):
 * - generates a fresh nonce, sets the Content-Security-Policy response header, and forwards the
 *   policy plus `x-nonce` on the request so Next applies the nonce to its own scripts and the root
 *   layout can pass it to the next-themes script;
 * - optimistic /admin gate: no `mz_admin` cookie → redirect to /admin/login. The real check is
 *   `requireAdminPage()` in the admin layout and `route({ admin: true })` in every /api/admin handler.
 * The matcher keeps it off /api (no upload-body buffering, no CSP on JSON), static files, metadata
 * images (icon, apple-icon, opengraph-image), robots.txt, the manifest and router prefetches.
 */
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspModeFrom, generateNonce } from "@/lib/csp";

const ADMIN_COOKIE = "mz_admin";
const ADMIN_LOGIN = "/admin/login";

function needsAdminRedirect(req: NextRequest): boolean {
  const p = req.nextUrl.pathname;
  const isAdmin = p === "/admin" || p.startsWith("/admin/");
  const isLogin = p === ADMIN_LOGIN || p.startsWith(`${ADMIN_LOGIN}/`);
  return isAdmin && !isLogin && !req.cookies.has(ADMIN_COOKIE);
}

export function proxy(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    mode: cspModeFrom(process.env.CSP_MODE),
    isDev: process.env.NODE_ENV === "development",
    isProduction: process.env.NODE_ENV === "production",
  });

  if (needsAdminRedirect(req)) {
    const res = NextResponse.redirect(new URL(ADMIN_LOGIN, req.url), 307);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|icon|apple-icon|robots\\.txt|manifest\\.webmanifest|fonts/|.*opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|txt|xml|webmanifest|map)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
