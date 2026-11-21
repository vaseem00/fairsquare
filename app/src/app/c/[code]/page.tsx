/**
 * The share page /c/[code] (DESIGN.md section 3.5, A§4.5). Server-rendered on every request from
 * the stored comparison plus today's verdict (`getCheckWithCurrent`). No screenshot exists here, so
 * the stamp lands on the listing plate (once per code per session). Each view records one
 * `card_viewed` event with the viewer's anonymous id when they already have one (at most 200
 * per viewer IP per day); the page never
 * creates an id or sets a cookie. Unknown code → not-found.tsx (`cNotFound.*`).
 */
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { SharePageView } from "@/components/share/share-page";
import { readAnonFromCookies } from "@/lib/auth/anon";
import { COPY, ogAlt, ogDescription, ogTitle } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { getCheckWithCurrent } from "@/lib/db/repo/checks";
import { checkIdForCode, trackEvent } from "@/lib/db/repo/events";
import { dubaiToday } from "@/lib/domain/dates";
import { getEnv } from "@/lib/env";
import { ipHashFor } from "@/lib/http/ip";
import { hit } from "@/lib/rate-limit";

type Params = { params: Promise<{ code: string }> };

/** card_viewed events recorded per viewer IP per Dubai day; views past it are still served. */
const CARD_VIEW_EVENTS_IP_DAILY = 200;

/** One load per request, shared by generateMetadata and the page. */
const loadCheck = cache(async (code: string) => {
  // Request time only: today's date, the environment and the database (never in a prerendered shell).
  await connection();
  const env = getEnv();
  const db = getDb();
  const today = dubaiToday();
  return getCheckWithCurrent(db, code, today, env.rules, env.APP_URL);
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const found = await loadCheck(code);
  if (!found) return { title: COPY["cNotFound.h1"], robots: { index: false, follow: false } };
  const { check } = found;
  const title = ogTitle(check);
  const description = ogDescription(check);
  const alt = ogAlt(check);
  // Every URL comes from APP_URL (check.url = `${APP_URL}/c/${code}`).
  const image = { url: `${check.url}/opengraph-image`, width: 1200, height: 630, alt, type: "image/png" };
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      url: check.url,
      siteName: COPY["app.name"],
      title,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [{ url: image.url, alt }] },
  };
}

export default async function SharePage({ params }: Params) {
  const { code } = await params;
  const found = await loadCheck(code);
  if (!found) notFound();
  const db = getDb();
  // Verify only: readAnonFromCookies never issues a cookie.
  const anonId = readAnonFromCookies(await cookies());
  // Anyone can load this page without a cookie, so the event rows are capped per IP and day: a
  // script reloading the page cannot grow the events table without bound.
  const ipHash = ipHashFor({ headers: await headers() });
  const { allowed } = await hit(db, `events:card-view:ip:${ipHash}`, CARD_VIEW_EVENTS_IP_DAILY, "day");
  if (allowed) await trackEvent(db, { name: "card_viewed", anonId, checkId: await checkIdForCode(db, found.check.code) });
  return <SharePageView check={found.check} current={found.current} />;
}
