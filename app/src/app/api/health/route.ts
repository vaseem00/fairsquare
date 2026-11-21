/**
 * GET /api/health (A§4.3): Railway's healthcheck.
 * 200 { ok: true, db, version } once `select 1` answers; 503 { ok: false } otherwise.
 * It never waits for the open-data load (that runs in the background, REAL_DATA.md section 4).
 * Never includes secrets or row counts.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbKind } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { route } from "@/lib/http/handler";
import { log } from "@/lib/log";

const HEADERS = { "Cache-Control": "no-cache" };

export const GET = route({ anon: "none" }, async (ctx) => {
  try {
    await ctx.db.execute(sql`select 1`);
    const env = getEnv();
    return NextResponse.json(
      {
        ok: true,
        db: dbKind(),
        version: env.RAILWAY_GIT_COMMIT_SHA ? env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7) : "dev",
      },
      { status: 200, headers: HEADERS },
    );
  } catch (err) {
    log.error("health_db_failed", { requestId: ctx.requestId, err });
    return NextResponse.json({ ok: false }, { status: 503, headers: HEADERS });
  }
});
