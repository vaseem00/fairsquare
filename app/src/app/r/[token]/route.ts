/**
 * GET /r/[token] (A§4.3): the recovery link.
 * - A tampered, malformed or expired token, or one for a person who deleted their data, redirects 303
 *   to /saved?recovery=failed and leaves cookies alone.
 * - When this browser already holds a different person's list (a valid `mz_aid` for an existing id),
 *   it never switches silently: a GET can be triggered by anyone who sends the link, and switching
 *   would drop the visitor's own list and record their activity under someone else's id. It redirects
 *   303 to /saved?recovery=confirm&token=…, where the person chooses; only a same-origin
 *   POST /api/me/recover switches.
 * - Otherwise (no list here, or the same id) it sets `mz_aid` to the token's id and redirects to /saved.
 * Redirects are built on APP_URL, never on the request's Host header.
 */
import { NextResponse } from "next/server";
import { readAnon, setAnonCookie } from "@/lib/auth/anon";
import { getAnonUser, touchAnonUser } from "@/lib/db/repo/anon";
import { verifyRecoveryToken } from "@/lib/db/repo/me";
import { getEnv } from "@/lib/env";
import { route } from "@/lib/http/handler";

function seeOther(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${getEnv().APP_URL}${path}`, "Cache-Control": "no-store" },
  });
}

export const GET = route<{ token: string }>({ anon: "none" }, async (ctx, params) => {
  const token = String(params.token ?? "");
  const id = verifyRecoveryToken(token);
  if (!id || !(await touchAnonUser(ctx.db, id))) return seeOther("/saved?recovery=failed");
  const current = readAnon(ctx.req);
  if (current && current !== id && (await getAnonUser(ctx.db, current))) {
    return seeOther(`/saved?recovery=confirm&token=${encodeURIComponent(token)}`);
  }
  setAnonCookie(ctx.setCookie, id);
  return seeOther("/saved");
});
