import { createElement, type FC, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    jar,
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
    has: (name: string) => jar.has(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  };
});
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore), headers: vi.fn(async () => new Headers()) }));
// The page calls connection() first (request time only); outside a Next request it is a no-op here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));

import { POST } from "@/app/api/checks/route";
import { GET as GET_CHECK } from "@/app/api/checks/[code]/route";
import { setAppMeta } from "@/lib/db/meta";
import SharePage, { generateMetadata } from "@/app/c/[code]/page";
import ShareNotFound from "@/app/c/[code]/not-found";
import { ConfigProvider } from "@/components/shell/config-provider";
import { FIXTURE_CONFIG } from "../fixtures/api-fixtures";
import { attributionText, COPY } from "@/lib/copy";
import { appMeta, buildings, events, rateLimits, sales } from "@/lib/db/schema";
import type { CheckView, PublicConfig } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();
const MARINA = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await clearUserData(t.db);
  cookieStore.jar.clear();
  cookieStore.set.mockClear();
});

async function buildingId(name: string): Promise<number> {
  const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, name));
  return row.id;
}

async function createCheck(fields: typeof MARINA, building: string | null, extra: { completion?: "ready" | "off_plan" } = {}) {
  const res = await call<{ check: CheckView }>(POST, {
    method: "POST",
    url: "/api/checks",
    json: { fields, buildingId: building ? await buildingId(building) : null, source: "manual", ...extra },
  });
  expect(res.status).toBe(201);
  return { check: res.body.check, cookie: res.cookies.mz_aid.value };
}

const params = (code: string) => ({ params: Promise.resolve({ code }) });

async function renderPage(code: string, config: PublicConfig = FIXTURE_CONFIG): Promise<string> {
  const ui = await SharePage(params(code));
  const Provider = ConfigProvider as unknown as FC<{ value: PublicConfig; children?: ReactNode }>;
  return renderToString(createElement(Provider, { value: config }, ui));
}

/** The page's text without tags (React splits text around links and with comments), no-break spaces as spaces. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/ /g, " ");

/** The h1's text content (its caption and verdict spans joined), with entities decoded and spaces collapsed. */
function h1Text(html: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  expect(m, "an h1").not.toBeNull();
  return textOf(m![1]).replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

async function cardViews() {
  return t.db.select().from(events).where(eq(events.name, "card_viewed"));
}

describe("/c/[code]", () => {
  it("Marina: server-rendered, og metadata, the result's parts (fact line, scale, gap sentence, evidence), CTA with ref", async () => {
    const { check } = await createCheck(MARINA, "Mockup Crest Tower");
    const md = await generateMetadata(params(check.code));
    expect(md.title).toEqual({ absolute: "Mockup Crest 2-bed: 14.0% above registered sales" });
    expect(md.openGraph?.title).toBe("Mockup Crest 2-bed: 14.0% above registered sales");
    expect(String(md.openGraph?.description).startsWith("Demo:")).toBe(false);
    expect(md.description).toBe(
      "11 registered sales in 12 months. Not a valuation.",
    );
    expect(md.robots).toEqual({ index: false, follow: false });
    expect(md.twitter).toMatchObject({ card: "summary_large_image" });
    const images = md.openGraph?.images as { url: string; alt: string; width: number; height: number }[];
    expect(images[0]).toMatchObject({
      url: `http://localhost:3000/c/${check.code}/opengraph-image`,
      width: 1200,
      height: 630,
      alt: "Fairsquare comparison: asking AED 1,908 per sq ft, median AED 1,674 of 11 registered sales.",
    });

    const html = await renderPage(check.code);
    const text = textOf(html);
    expect(html).toContain("Compared on 17 Nov 2026");
    // One h1 (RESULT_SPEC section 6.10): the caption with the listing's own text, then the verdict with
    // only its figure words coloured.
    expect(h1Text(html)).toBe("Mockup Crest, 2-bed. Compared on 17 Nov 2026. 14.0% above registered sales");
    expect(html).toMatch(/<span class="text-verdict-above" data-slot="verdict-figure">14\.0% above<\/span>/);
    // The result's parts: the fact line (no Edit), the market scale with its stamp, the gap sentence and
    // the evidence line naming the DLD building (no "Wrong building?"). No plate, no stamped sheet.
    // Typed with no ready or off-plan: the fact line leaves the basis out (RESULT_SPEC section 2.4).
    expect(text).toContain("Mockup Crest, Dubai Marina. 2-bed, 1,284 sq ft, AED 2,450,000.");
    expect(html).not.toContain("Edit the details");
    expect(html).toContain('data-slot="market-scale"');
    expect(html).toContain('data-slot="scale-stamp"');
    expect(text).toContain("The asking price is AED 234 per sq ft above the median, and higher than all 11 sales.");
    expect(text).toMatch(/evidence\. 11 registered sales of ready 2-beds in Mockup Crest Tower, /);
    expect(text).not.toContain("Wrong building?");
    expect(html).not.toContain('data-slot="listing-plate"');
    expect(html).not.toContain('data-slot="stamped-sheet"');
    expect(text).toContain(COPY["data.independent"]);
    expect(text).toContain("It is not a valuation or a forecast.");
    // REAL_DATA.md section 9: the attribution with the provenance, the dataset and licence linked.
    expect(textOf(html)).toContain(attributionText());
    expect(html).toContain(`<a href="${FIXTURE_CONFIG.data.source?.url}"`);
    expect(html).toContain(`<a href="${FIXTURE_CONFIG.data.source?.licenceUrl}"`);
    // Fresh data: no stale note; old data: the note on top (REAL_DATA.md section 7).
    expect(html).not.toContain("currently runs to");
    const stale = await renderPage(check.code, {
      ...FIXTURE_CONFIG,
      data: { ...FIXTURE_CONFIG.data, dataThrough: "2026-09-30", stale: true },
    });
    expect(textOf(stale)).toContain(
      "Fairsquare&#x27;s sales data currently runs to 30 Sep 2026. Sales registered after that aren&#x27;t included yet.",
    );
    expect(text).toContain("11 registered sales");
    // The outline: the one h1, then the sales list's h2 (no level skipped).
    expect(html).toMatch(/<h2[^>]*>11 registered sales<\/h2>/);
    expect(html).not.toMatch(/<h3[\s>]/);
    expect(html).toContain(`href="/?ref=${check.code}"`);
    expect(html).toContain(COPY["c.cta"].replace("'", "&#x27;"));
    expect(html).not.toContain("DEMO DATA");
    expect(html).toMatch(/registered/i);
    expect(html).not.toContain("Today:");
  });

  it("after a new sale, Today shows 12 sales while the stored comparison stays", async () => {
    const { check } = await createCheck(MARINA, "Mockup Crest Tower");
    await t.db.insert(sales).values({
      buildingId: await buildingId("Mockup Crest Tower"),
      saleDate: "2026-11-10",
      bedrooms: 2,
      sizeSqft: 1300,
      priceAed: 2_500_000,
      source: "admin",
    });
    const html = await renderPage(check.code);
    expect(html).toMatch(/Today: [+−]\d+\.\d% vs 12 sales\./);
    // The stored comparison stays: its headline and its 11 sales.
    expect(h1Text(html)).toMatch(/14\.0% above registered sales$/);
    expect(textOf(html)).toMatch(/evidence\. 11 registered sales of ready 2-beds/);
    // The OG title keeps the stored numbers.
    expect((await generateMetadata(params(check.code))).openGraph?.title).toBe(
      "Mockup Crest 2-bed: 14.0% above registered sales",
    );
  });

  it("not covered: Not covered yet, why there is no match, no scale and no stamp, the attribution, the same CTA", async () => {
    const { check } = await createCheck(
      { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
      null,
    );
    const html = await renderPage(check.code);
    expect(h1Text(html)).toMatch(/^Nowhere Point Tower, 2-bed\. Compared on \d+ \w{3} \d{4}\. Not covered yet$/);
    // og:description has no count for a building Fairsquare couldn't match.
    expect((await generateMetadata(params(check.code))).description).toBe("Not covered yet. Not a valuation.");
    // Nothing was compared, so never "Compared with off-plan sales only", even for an off-plan listing.
    const offPlan = await createCheck(
      { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
      null,
      { completion: "off_plan" },
    );
    expect(offPlan.check.analysis.completionBasis).toBe("off_plan");
    expect(textOf(await renderPage(offPlan.check.code))).not.toContain(COPY["offplan.notice"]);
    expect(textOf(html)).toContain("We couldn’t match “Nowhere Point Tower” to a building in Dubai Land Department sales data.");
    expect(html).not.toContain('data-slot="market-scale"');
    expect(html).not.toContain('data-slot="scale-stamp"');
    expect(html).not.toContain('data-slot="evidence-line"');
    expect(textOf(html)).toContain(attributionText());
    expect(textOf(html)).toContain(COPY["data.independent"]);
    expect(textOf(html)).toContain("It is not a valuation or a forecast.");
    expect(html).toContain(`href="/?ref=${check.code}"`);
  });

  it("a comparison made while no data was loaded shows its first real verdict, with its sales, once data is there", async () => {
    await t.db.delete(appMeta).where(eq(appMeta.key, "data_through"));
    let code: string;
    try {
      const { check } = await createCheck(MARINA, "Mockup Crest Tower");
      expect(check.analysis.band).toBe("none");
      expect(check.building?.name).toBe("Mockup Crest Tower");
      code = check.code;
      // Still loading: the page says so (not covered; the config says the data is being loaded).
      const loading = await renderPage(code, { ...FIXTURE_CONFIG, data: { ...FIXTURE_CONFIG.data, loaded: false } });
      expect(h1Text(loading)).toMatch(/^Mockup Crest, 2-bed\. Compared on .*\. Not covered yet$/);
      expect(textOf(loading)).toContain(COPY["data.loading"]);
      expect(loading).not.toContain('data-slot="market-scale"');
    } finally {
      await setAppMeta(t.db, "data_through", "2026-11-17");
    }
    const html = await renderPage(code);
    expect(h1Text(html)).toMatch(/^Mockup Crest, 2-bed\. Compared on .*\. 14\.0% above registered sales$/);
    expect(textOf(html)).toMatch(/evidence\. 11 registered sales of ready 2-beds in Mockup Crest Tower/);
    expect(textOf(html)).not.toContain(COPY["data.loading"]);
    expect(textOf(html)).toContain("11 registered sales");
    expect(html).toContain('data-slot="scale-stamp"');
    expect((await generateMetadata(params(code))).openGraph?.title).toBe("Mockup Crest 2-bed: 14.0% above registered sales");
    // The stored row is not rewritten: only what people see follows the data.
    const res = await call<{ check: CheckView }>(GET_CHECK, { url: `/api/checks/${code}`, params: { code } });
    expect(res.body.check.analysis).toMatchObject({ band: "above", count: 11 });
  });

  it("sales the admin added are marked and never credited to the DLD when they are all there is", async () => {
    const [b] = await t.db.insert(buildings).values({ name: "TEST ADMIN TOWER", area: "Test Area" }).returning({ id: buildings.id });
    try {
      await t.db.insert(sales).values(
        Array.from({ length: 6 }, (_, i) => ({
          buildingId: b.id,
          saleDate: `2026-10-0${i + 1}`,
          bedrooms: 1,
          sizeSqft: 800,
          priceAed: 1_200_000 + i * 10_000,
          source: "admin" as const,
        })),
      );
      const { check } = await createCheck(
        { buildingText: "TEST ADMIN TOWER", areaText: "Test Area", bedrooms: 1, sizeSqft: 800, priceAed: 1_250_000 },
        "TEST ADMIN TOWER",
      );
      expect(check.sales.every((s) => s.source === "admin")).toBe(true);
      const html = textOf(await renderPage(check.code));
      expect(html).toContain("These sales were added by Fairsquare, not taken from the DLD open data.");
      expect(html).not.toContain(attributionText());
    } finally {
      await t.db.delete(buildings).where(eq(buildings.id, b.id));
    }
  });

  it("an unknown code is a 404 with cNotFound", async () => {
    await expect(SharePage(params("ZZZZZZ"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(SharePage(params("nope!"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    const md = await generateMetadata(params("ZZZZZZ"));
    expect(md.title).toBe(COPY["cNotFound.h1"]);
    const html = renderToString(createElement(ShareNotFound));
    expect(html).toContain("This comparison link doesn&#x27;t work");
    expect(html).toContain(COPY["cNotFound.body"].replace("'", "&#x27;"));
    expect(html).toContain('href="/"');
  });

  it("card_viewed rows are capped per viewer IP and day; the page itself is still served", async () => {
    const { check } = await createCheck(MARINA, "Mockup Crest Tower");
    await renderPage(check.code);
    expect(await cardViews()).toHaveLength(1);
    // Pretend this IP already viewed 200 cards today.
    await t.db.update(rateLimits).set({ count: 200 }).where(like(rateLimits.key, "events:card-view:ip:%"));
    const html = await renderPage(check.code);
    expect(h1Text(html)).toMatch(/14\.0% above registered sales$/);
    expect(await cardViews()).toHaveLength(1);
  });

  it("a viewer without mz_aid: no cookie set, one card_viewed event with anon_id null", async () => {
    const { check } = await createCheck(MARINA, "Mockup Crest Tower");
    await renderPage(check.code);
    expect(cookieStore.set).not.toHaveBeenCalled();
    const rows = await cardViews();
    expect(rows).toHaveLength(1);
    expect(rows[0].anonId).toBeNull();
    expect(rows[0].checkId).not.toBeNull();
  });

  it("a viewer with a valid mz_aid is counted with their id (and still no cookie is set)", async () => {
    const { check, cookie } = await createCheck(MARINA, "Mockup Crest Tower");
    cookieStore.jar.set("mz_aid", cookie);
    await renderPage(check.code);
    const rows = await cardViews();
    expect(rows).toHaveLength(1);
    expect(rows[0].anonId).toBe(cookie.split(".")[0]);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
