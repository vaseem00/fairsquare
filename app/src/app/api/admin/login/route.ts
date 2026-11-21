/**
 * POST /api/admin/login (A§4.4, A§6.2): `{ password }` → 204 with the `mz_admin` cookie
 * (HttpOnly, SameSite=Strict, 12 h). Wrong password → 401 bad_credentials.
 * Every attempt counts against 5 per 15 minutes per IP hash; the 6th → 429 "Too many tries. Wait 15 minutes."
 * Attempts from all IPs together are capped at 30 per 15 minutes, so rotating addresses does not help.
 */
import { z } from "zod";
import { checkAdminPassword, createAdminSession } from "@/lib/auth/admin";
import { ADMIN_COOKIE, adminCookieOptions } from "@/lib/http/cookies";
import { HttpError } from "@/lib/http/errors";
import { noContent, readJson, route } from "@/lib/http/handler";
import { log } from "@/lib/log";
import { enforce } from "@/lib/rate-limit";

const LoginSchema = z.object({ password: z.string().min(1).max(256) });

const ADMIN_LOGIN_LIMIT = 5;
/** All IPs together: an attacker with many addresses still gets few guesses per window. */
const ADMIN_LOGIN_GLOBAL_LIMIT = 30;

export const POST = route({ anon: "none" }, async (ctx) => {
  await enforce(ctx.db, [
    {
      key: `admin-login:ip:${ctx.ipHash}`,
      limit: ADMIN_LOGIN_LIMIT,
      window: "15m",
      onDeny: "rate_limited",
      scope: "admin_login",
    },
    {
      key: "admin-login:global",
      limit: ADMIN_LOGIN_GLOBAL_LIMIT,
      window: "15m",
      onDeny: "rate_limited",
      scope: "admin_login",
    },
  ]);
  let password: string;
  try {
    password = (await readJson(ctx.req, LoginSchema)).password;
  } catch (err) {
    // An empty or missing password is simply a wrong password.
    if (err instanceof HttpError && err.code === "validation_failed") throw new HttpError(401, "bad_credentials");
    throw err;
  }
  if (!checkAdminPassword(password)) {
    log.warn("admin_login_failed", { requestId: ctx.requestId });
    throw new HttpError(401, "bad_credentials");
  }
  const { cookieValue } = await createAdminSession(ctx.db, ctx.ipHash);
  ctx.setCookie(ADMIN_COOKIE, cookieValue, adminCookieOptions());
  log.info("admin_login", { requestId: ctx.requestId });
  return noContent();
});
