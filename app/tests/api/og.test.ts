import { inflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checks/route";
import Image, { buildingLine, buildingWidth, contentType, ogLines, OG_STAMP_CENTRE, size } from "@/app/c/[code]/opengraph-image";
import { FIXTURE_CHECK_JVC, FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN } from "../fixtures/api-fixtures";
import { stampProps } from "@/lib/copy";
import { buildings } from "@/lib/db/schema";
import { layoutStamp, STAMP_WIDTH } from "@/lib/stamp/geometry";
import type { CheckView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(async () => clearUserData(t.db));

async function create(fields: Record<string, unknown>, building: string | null): Promise<CheckView> {
  let buildingId: number | null = null;
  if (building) {
    const [row] = await t.db.select({ id: buildings.id }).from(buildings).where(eq(buildings.name, building));
    buildingId = row.id;
  }
  const res = await call<{ check: CheckView }>(POST, { method: "POST", url: "/api/checks", json: { fields, buildingId, source: "manual" } });
  expect(res.status).toBe(201);
  return res.body.check;
}

/** Minimal PNG decoder (8-bit RGBA or RGB, all five filters) for pixel checks. */
function decodePng(buf: Buffer): { width: number; height: number; px: (x: number, y: number) => number[] } {
  let o = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const r = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = r;
      if (f === 1) v = r + a;
      else if (f === 2) v = r + b;
      else if (f === 3) v = r + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, px: (x, y) => [...out.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

/** Pixels close to the stamp ink (#3A37C9 at 0.9 over the paper) inside a region. */
function inkPixels(img: ReturnType<typeof decodePng>, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const [r, g, b] = img.px(x, y);
      if (b > 150 && r < 120 && g < 120) n++;
    }
  }
  return n;
}

describe("GET /c/<code>/opengraph-image", () => {
  it("exports 1200x630 image/png", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("Marina: a PNG 1200x630 on paper, under 600 KB, cached for a bounded time, with the verdict stamp", async () => {
    const check = await create(
      { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 },
      "Mockup Crest Tower",
    );
    const res = await Image({ params: Promise.resolve({ code: check.code }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // Bounded so a deleted comparison's image expires (not immutable).
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, stale-while-revalidate=86400");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeLessThan(600 * 1024);
    const png = decodePng(buf);
    expect([png.width, png.height]).toEqual([1200, 630]);
    // Stamp ink around its centre; its figure stays inside WhatsApp's centre square (x 285 to 915).
    expect(OG_STAMP_CENTRE).toEqual({ x: 770, y: 314 });
    expect(inkPixels(png, 560, 160, 915, 440)).toBeGreaterThan(400);
    const figure = layoutStamp(stampProps(check), STAMP_WIDTH.og).rows.find((r) => r.id === "b")!;
    expect(OG_STAMP_CENTRE.x + figure.width / 2).toBeLessThanOrEqual(915);
    expect(OG_STAMP_CENTRE.x - figure.width / 2).toBeGreaterThanOrEqual(285);
    // Row A reads FAIRSQUARE [scale] ABOVE, inside the inner border; row D has no READY.
    const layout = layoutStamp(stampProps(check), STAMP_WIDTH.og);
    expect(layout.w).toBe(470);
    const rowA = layout.rows.find((r) => r.id === "a")!;
    const header = rowA.items.find((i) => i.kind === "text" && i.text === "ABOVE") as { x: number; width: number };
    expect(header).toBeTruthy();
    expect(header.x).toBeGreaterThan(layout.inner.x);
    expect(header.x + header.width).toBeLessThan(layout.inner.x + layout.inner.width);
    // The text keeps to its column: no dark text ink where the stamp sits, so the stamp never lowers
    // the contrast of the figures in small previews.
    let textInk = 0;
    for (let y = 120; y < 500; y += 2) {
      for (let x = 600; x < 1150; x += 2) {
        const [r, g, b] = png.px(x, y);
        if (r < 70 && g < 80 && b < 90) textInk++;
      }
    }
    expect(textInk).toBe(0);
    // Paper to the edge: no petrol bar any more (RESULT_SPEC section 8.3).
    expect(png.px(600, 627)).toEqual([0xf6, 0xf7, 0xf4]);
    expect(png.px(10, 10)).toEqual([0xf6, 0xf7, 0xf4]);
    if (process.env.OG_SNAPSHOT_DIR) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.OG_SNAPSHOT_DIR}/og-marina.png`, buf);
    }
  });

  it("not covered: the building and Not covered yet, no stamp", async () => {
    const check = await create(
      { buildingText: "Nowhere Point Tower", areaText: "Dubai Creek Harbour", bedrooms: 2, sizeSqft: 1150, priceAed: 2_300_000 },
      null,
    );
    const res = await Image({ params: Promise.resolve({ code: check.code }) });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const png = decodePng(buf);
    expect(inkPixels(png, 470, 160, 1000, 460)).toBe(0);
    if (process.env.OG_SNAPSHOT_DIR) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.OG_SNAPSHOT_DIR}/og-none.png`, buf);
    }
  });

  it("an unknown code → 404, not cached", async () => {
    const res = await Image({ params: Promise.resolve({ code: "ZZZZZZ" }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("the building stays on one line clear of the stamp: 52px, 44 or 36, else cut with an ellipsis", () => {
    expect(buildingLine("Mockup Crest")).toEqual({ text: "Mockup Crest", size: 52 });
    expect(buildingLine("Aykon City Tower C")).toEqual({ text: "Aykon City Tower C", size: 52 });
    expect(buildingLine("Marina Gate Tower 2")).toMatchObject({ text: "Marina Gate Tower 2", size: 44 });
    const long = buildingLine("The Address Residence Dubai Opera Tower 2");
    expect(long.size).toBe(36);
    expect(long.text).toMatch(/^The Address Residence .*…$/);
    for (const name of ["Aykon City Tower C", "Marina Gate Tower 2", "The Address Residence Dubai Opera Tower 2"]) {
      const l = buildingLine(name);
      expect(buildingWidth(l.text, l.size)).toBeLessThanOrEqual(500);
    }
  });

  it("the lines per band (RESULT_SPEC section 8.3): the listing's own text, the verdict, both figures, the source", () => {
    const m = ogLines(FIXTURE_CHECK_MARINA);
    expect(m.building).toBe("Mockup Crest");
    expect(m.listing).toBe("Ready 2-bed, 1,284 sq ft, AED 2,450,000");
    expect(m.head).toMatchObject({ figure: "14.0% above", hue: "#8F4A0A", line1: "", line2: "registered sales" });
    expect(m.figures).toBe("Asking AED 1,908, median AED 1,674 per sq ft, 11 registered sales");
    expect(m.source).toBe("DLD open data via Data.Dubai. Data to 17 Nov 2026. Not a valuation.");
    const j = ogLines(FIXTURE_CHECK_JVC);
    expect(j.head).toMatchObject({ figure: "In line", hue: "#17191E", line1: "with", line2: "registered sales" });
    const thin = ogLines(FIXTURE_CHECK_THIN);
    expect(thin.head).toMatchObject({ figure: null, line1: "Too few sales", line2: "to compare yet" });
    expect(thin.figures).toBe("Asking AED 1,890 per sq ft, 2 of the 5 registered sales needed");
    expect(thin.recent).toBeNull();
    const none = ogLines(FIXTURE_CHECK_NONE);
    expect(none.head).toMatchObject({ figure: null, line1: "Not covered yet" });
    expect(none.figures).toBe("Fairsquare doesn't cover this building yet.");
    // A listing that didn't say ready or off-plan is not called "Ready" (the fact line leaves it out too).
    expect(ogLines({ ...FIXTURE_CHECK_MARINA, completion: "unknown" }).listing).toBe("2-bed, 1,284 sq ft, AED 2,450,000");
    expect(ogLines({ ...FIXTURE_CHECK_NONE, completion: "unknown" }).listing).not.toMatch(/^Ready/);
    // Nothing on the image is a valuation word, a middle dot or an arrow.
    for (const l of [m, j, thin, none]) {
      const all = [l.building, l.listing, l.head.figure, l.head.line1, l.head.line2, l.figures, l.recent, l.source].join(" ");
      expect(all).not.toMatch(/value|worth|deal|overpriced|·|→/i);
    }
  });
});
