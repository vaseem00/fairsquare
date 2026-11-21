import "server-only";
/**
 * Admin pages read cookies, the database and the clock, so they must render at request time
 * (Cache Components): `connection()` before any of that. Outside a Next request scope (Vitest) there
 * is no request to wait for and connection() throws; that is fine.
 */
import { connection } from "next/server";

export async function requestTime(): Promise<void> {
  let pending: Promise<void>;
  try {
    pending = connection();
  } catch {
    return;
  }
  try {
    await pending;
  } catch (err) {
    // A real request rejects only with Next's own control-flow errors: let those through.
    if (err && typeof err === "object" && "digest" in err) throw err;
  }
}
