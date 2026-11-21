/**
 * POST /api/admin/logout (A§4.4): revokes the session row and clears the cookie → 204.
 * Idempotent: with no valid session it still clears the cookie and answers 204.
 */
import { revokeAdminSession } from "@/lib/auth/admin";
import { ADMIN_COOKIE, adminCookieOptions, clearCookieOptions } from "@/lib/http/cookies";
import { noContent, route } from "@/lib/http/handler";

export const POST = route({ anon: "none" }, async (ctx) => {
  await revokeAdminSession(ctx.db, ctx.req.cookies.get(ADMIN_COOKIE)?.value);
  ctx.setCookie(ADMIN_COOKIE, "", clearCookieOptions(adminCookieOptions()));
  return noContent();
});
