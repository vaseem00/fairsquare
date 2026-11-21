import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";

/**
 * robots.txt. Admin, the API and recovery links are never crawled. /c pages stay reachable so link
 * previews work; each one sets `robots: noindex` itself (A§4.5).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection(); // APP_URL is read at runtime, not at build time
  const appUrl = getEnv().APP_URL;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/r/"] }],
    host: appUrl,
  };
}
