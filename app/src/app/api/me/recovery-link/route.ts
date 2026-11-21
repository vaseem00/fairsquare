/**
 * POST /api/me/recovery-link (A§4.3, anon required): 200 `{ url }` = `${APP_URL}/r/<token>`, valid for
 * 30 days. It moves a saved list from WhatsApp's in-app browser to Safari or Chrome.
 */
import { createRecoveryToken } from "@/lib/db/repo/me";
import { getEnv } from "@/lib/env";
import { json, route } from "@/lib/http/handler";

export const POST = route({ anon: "require" }, async (ctx) => {
  const token = createRecoveryToken(ctx.anonId as string);
  return json({ url: `${getEnv().APP_URL}/r/${token}` });
});
