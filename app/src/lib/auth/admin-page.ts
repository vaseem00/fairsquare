import "server-only";
/**
 * Admin gate for server components (A§6.2): the `(secure)` admin layout awaits `requireAdminPage()`.
 * The proxy only redirects optimistically when the cookie is missing; this is the real check.
 * Reads cookies at request time, so call it inside the dynamic part of the page.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { ADMIN_COOKIE } from "@/lib/http/cookies";
import { verifyAdminSession } from "./admin";

export const ADMIN_LOGIN_PATH = "/admin/login";

/** True when the request carries a valid admin session (the login page uses it to skip the form). */
export async function hasAdminSession(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  return verifyAdminSession(getDb(), value);
}

/** Redirects to /admin/login unless the request has a valid admin session. */
export async function requireAdminPage(): Promise<void> {
  if (!(await hasAdminSession())) redirect(ADMIN_LOGIN_PATH);
}
