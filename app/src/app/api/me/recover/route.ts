/**
 * POST /api/me/recover (A§4.3): `{ token }` → 204 with `mz_aid` set to the recovery token's id.
 * The confirmed half of the recovery link: GET /r/[token] sends a browser that already holds another
 * list to /saved?recovery=confirm, and the person's "Replace" click lands here (same-origin POST, so a
 * link alone can never switch someone's identity). An invalid, expired or erased token → 404 not_found.
 */
import { setAnonCookie } from "@/lib/auth/anon";
import { touchAnonUser } from "@/lib/db/repo/anon";
import { verifyRecoveryToken } from "@/lib/db/repo/me";
import { httpError } from "@/lib/http/errors";
import { noContent, readJson, route } from "@/lib/http/handler";
import { RecoverRequestSchema } from "@/lib/validation/api";

export const POST = route({ anon: "none" }, async (ctx) => {
  const { token } = await readJson(ctx.req, RecoverRequestSchema);
  const id = verifyRecoveryToken(token);
  if (!id || !(await touchAnonUser(ctx.db, id))) throw httpError("not_found");
  setAnonCookie(ctx.setCookie, id);
  return noContent();
});
