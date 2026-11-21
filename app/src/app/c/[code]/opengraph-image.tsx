/**
 * The share image for /c/[code] (RESULT_SPEC section 8.3): 1200 x 630 PNG from next/og, built from
 * the **stored** comparison (its numbers and date never change). Paper #F6F7F4 with no petrol bar and
 * no listing screenshot:
 *
 *    64   [mark 40] Fairsquare
 *   120   Aykon City Tower C                               Newsreader 560 52/56, max-w 470
 *   184   Ready 2-bed, 812 sq ft, AED 1,450,000            Archivo 30 pencil, semi-condensed
 *   248   In line with / registered sales                  Newsreader 520 48/52, verdict hue on the figure words
 *   380   Asking AED 1,786, median AED 1,761 per sq ft,    Archivo 28 ink, semi-condensed, w 460
 *         43 registered sales
 *   470   Last 90 days: AED 1,602 per sq ft (11 sales)     Archivo 26 ink, when the recent-sales line triggers
 *   566   DLD open data via Data.Dubai. Data to 16 Nov 2026. Not a valuation.   Archivo 22 pencil
 *         the verdict stamp w 470, centre (770, 314), -9deg, with the pre-made speck texture on top
 *
 * The stamp comes from the same `geometry.ts` layout as the canvas card; its figure stays inside
 * WhatsApp's centre square crop (x 285 to 915). It is cached for an hour (plus a day
 * stale-while-revalidate), not as immutable, so a deleted comparison's image expires. A not-covered
 * comparison shows the building and "Not covered yet" with no stamp.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties, ReactElement } from "react";
import { getDb } from "@/lib/db/client";
import { getCheckRowByCode, publicCheckView } from "@/lib/db/repo/checks";
import { dubaiToday } from "@/lib/domain/dates";
import { acsLead, acsRange, COPY, listingType, nearbyRange, plainNotCovered, similarProject, similarRange, sizeText, stampProps, t, verdictHeadOf } from "@/lib/copy";
import { getEnv } from "@/lib/env";
import { formatDate, formatInt } from "@/lib/format";
import { log } from "@/lib/log";
import { recentSet } from "@/lib/result/scale-model";
import {
  ASCENT_EM,
  diamondPath,
  glyphPath,
  layoutStamp,
  LINE_EM,
  MARK,
  PAPER,
  roundRectPath,
  STAMP_FONTS,
  STAMP_INK,
  STAMP_INK_ALPHA,
  STAMP_ROTATION_DEG,
  STAMP_WIDTH,
  type StampLayout,
} from "@/lib/stamp/geometry";
import type { CheckView } from "@/lib/types";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Bounded, not immutable: "Delete all my data" removes the comparison and its /c link, so caches
 * (browsers, a CDN in front of the app) must let the image go within hours, not a year.
 */
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
/**
 * The stamp centre: the spec's x (so a six-character figure such as "+15.4%" stays inside WhatsApp's
 * square crop, x 285 to 915) and the approved OGImage artboard's y.
 */
export const OG_STAMP_CENTRE = { x: 770, y: 314 };
const C = { ink: "#17191E", pencil: "#53646A", above: "#8F4A0A", below: "#1E5B98" };
const SANS = "Archivo";
/** Archivo at wdth 88 (Satori has no font-stretch): the figure lines. */
const SANS_NARROW = "Archivo SemiCondensed";
const SERIF = "Newsreader";
/**
 * Satori matches weights to the nearest registered one, in hundreds: the static Newsreader instances
 * are registered as 500 (wght 520, the verdict), 600 (wght 560, the building) and 700 (wght 600, the
 * wordmark).
 */
const SERIF_WEIGHT = { verdict: 500, building: 600, brand: 700 } as const;
const CONDENSED_WEIGHT = 800; // the static instance is wght 780; Satori matches the nearest registered weight

type Fonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

let assets: Promise<{ fonts: Fonts; specks: ArrayBuffer }> | null = null;

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** The static WOFF instances and the speck texture, read once as ArrayBuffers. */
function loadAssets() {
  assets ??= (async () => {
    const dir = join(process.cwd(), "src", "assets");
    const font = (f: string) => readFile(join(dir, "fonts", f));
    const [a400, a600, narrow, n520, n560, n600, wide, condensed, specks] = await Promise.all([
      font("archivo-400.woff"),
      font("archivo-600.woff"),
      font("archivo-400-semicondensed.woff"),
      font("newsreader-520.woff"),
      font("newsreader-560.woff"),
      font("newsreader-600.woff"),
      font("archivo-stamp-wide.woff"),
      font("archivo-stamp-condensed.woff"),
      readFile(join(dir, "og", "specks.png")),
    ]);
    const fonts: Fonts = [
      { name: SANS, data: toArrayBuffer(a400), weight: 400, style: "normal" },
      { name: SANS, data: toArrayBuffer(a600), weight: 600, style: "normal" },
      { name: SANS_NARROW, data: toArrayBuffer(narrow), weight: 400, style: "normal" },
      { name: SERIF, data: toArrayBuffer(n520), weight: SERIF_WEIGHT.verdict, style: "normal" },
      { name: SERIF, data: toArrayBuffer(n560), weight: SERIF_WEIGHT.building, style: "normal" },
      { name: SERIF, data: toArrayBuffer(n600), weight: SERIF_WEIGHT.brand, style: "normal" },
      { name: STAMP_FONTS.wide, data: toArrayBuffer(wide), weight: 700, style: "normal" },
      { name: STAMP_FONTS.condensed, data: toArrayBuffer(condensed), weight: CONDENSED_WEIGHT, style: "normal" },
    ];
    return { fonts, specks: toArrayBuffer(specks) };
  })();
  assets.catch(() => {
    assets = null;
  });
  return assets;
}

const px = (n: number) => Math.round(n * 100) / 100;
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The OG image's text lines for a comparison (exported for tests). */
export function ogLines(check: CheckView): {
  building: string;
  listing: string;
  head: { figure: string | null; hue: string; line1: string; line2: string };
  figures: string | null;
  recent: string | null;
  /** The second tier's line (too few sales with a shown range), in the recent-sales line's place. */
  range: string | null;
  source: string;
} {
  const a = check.analysis;
  // A leading range of adjusted registered sales (DESIGN.md section 6.17): "Within the range" over
  // "of adjusted sales", the count of sales adjusted, and the range in the recent-sales line's place.
  const lead = acsLead(check);
  const acs = acsRange(check);
  // The last resort (DESIGN.md section 6.18): "Above the range" over "of nearby sales", the count of
  // sales in other buildings, and the range in the recent-sales line's place.
  const near = nearbyRange(check);
  const { figure, rest, tone } = verdictHeadOf(check);
  const withWord = figure ? /^with\s/.exec(rest) : null;
  const at = figure ? -1 : rest.indexOf(" to ");
  const head = figure
    ? { figure, hue: tone === "above" ? C.above : tone === "below" ? C.below : C.ink, line1: withWord ? "with" : "", line2: withWord ? rest.slice(withWord[0].length) : rest }
    : { figure: null, hue: C.ink, line1: at > 0 ? rest.slice(0, at) : rest, line2: at > 0 ? rest.slice(at + 1) : "" };
  const verdict = a.band === "above" || a.band === "below" || a.band === "inline";
  const figures =
    near
      ? t("nearby.ogFigures", near)
      : lead && acs
      ? t("acs.ogFigures", acs)
      : verdict && a.medianPsf !== null
        ? t("og.figures", { asking: formatInt(a.askingPsf), median: formatInt(a.medianPsf), count: a.count })
        : a.band === "thin"
          ? t("og.figuresThin", { asking: formatInt(a.askingPsf), count: a.count, minSales: check.rules.minSales })
          : COPY["og.sentenceNone"];
  const r = verdict && !lead ? recentSet(check) : null;
  const recent = r && r.trigger && r.medianPsf !== null ? t("og.recent", { median: formatInt(r.medianPsf), count: r.count }) : null;
  return {
    building: check.buildingText,
    // "Ready 2-bed, ..." as the listing says; "2-bed, ..." when it didn't say ready or off-plan.
    listing: t("og.listing", {
      listingType: capitalise(listingType(check)),
      size: sizeText(check),
      price: formatInt(check.priceAed),
    }),
    head,
    figures,
    recent,
    range: (() => {
      if (near) return t("nearby.ogLine", near);
      if (acs) return t("acs.ogLine", acs);
      const range = verdict ? null : similarRange(check);
      const project = range ? similarProject(check) : null;
      return range ? (project ? t("similar.projectOgLine", { ...range, project }) : t("similar.ogLine", range)) : null;
    })(),
    source: t("og.source", { date: formatDate(a.dataThrough ?? a.windowEnd) }),
  };
}

function Mark() {
  return (
    <svg width={40} height={40} viewBox={`0 0 ${MARK.size} ${MARK.size}`} fill="none">
      <path d={roundRectPath(MARK.outer)} stroke={STAMP_INK} strokeWidth={MARK.outer.stroke} />
      <path d={roundRectPath(MARK.inner)} stroke={STAMP_INK} strokeWidth={MARK.inner.stroke} />
      {MARK.glyph.map((d) => (
        <path key={d} d={d} stroke={STAMP_INK} strokeWidth={MARK.glyphStroke} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function StampOg({ layout, specks }: { layout: StampLayout; specks: ArrayBuffer }) {
  const { w, h } = layout;
  const box: CSSProperties = {
    position: "absolute",
    left: OG_STAMP_CENTRE.x - w / 2,
    top: OG_STAMP_CENTRE.y - h / 2,
    width: w,
    height: h,
    display: "flex",
    transform: `rotate(${STAMP_ROTATION_DEG}deg)`,
    opacity: STAMP_INK_ALPHA,
    color: STAMP_INK,
  };
  const texts: ReactElement[] = [];
  const shapes: string[] = [];
  for (const row of layout.rows) {
    row.items.forEach((item, i) => {
      if (item.kind === "text") {
        texts.push(
          <div
            key={`${row.id}${i}`}
            style={{
              position: "absolute",
              left: px(item.x),
              top: px(row.baseline - ASCENT_EM * row.size),
              fontFamily: row.face === "wide" ? STAMP_FONTS.wide : STAMP_FONTS.condensed,
              fontWeight: row.face === "wide" ? 700 : CONDENSED_WEIGHT,
              fontSize: px(row.size),
              lineHeight: LINE_EM,
              letterSpacing: px(row.letterSpacing),
              whiteSpace: "nowrap",
              display: "flex",
            }}
          >
            {item.text}
          </div>,
        );
      } else if (item.kind === "diamond") {
        shapes.push(diamondPath(item.cx, row.cy, item.r));
      }
    });
  }
  const glyphs = layout.rows.flatMap((row) =>
    row.items.flatMap((item) => (item.kind === "glyph" ? [{ d: glyphPath(item.x, row.cy - item.size / 2, item.size), s: item.stroke }] : [])),
  );
  return (
    <div style={box}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <path d={roundRectPath(layout.outer)} fill="none" stroke={STAMP_INK} strokeWidth={layout.outer.stroke} />
        <path d={roundRectPath(layout.inner)} fill="none" stroke={STAMP_INK} strokeWidth={layout.inner.stroke} />
        <path
          d={`M${px(layout.rule.x1)} ${px(layout.rule.y)}L${px(layout.rule.x2)} ${px(layout.rule.y)}`}
          stroke={STAMP_INK}
          strokeWidth={layout.rule.stroke}
          strokeLinecap="round"
        />
        {glyphs.map((g, i) => (
          <path key={i} d={g.d} fill="none" stroke={STAMP_INK} strokeWidth={g.s} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {shapes.map((d, i) => (
          <path key={`d${i}`} d={d} fill={STAMP_INK} />
        ))}
      </svg>
      {texts}
      {/* Paper specks knock the ink back like a worn rubber stamp. */}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori image, not DOM */}
      <img
        // @ts-expect-error Satori accepts an ArrayBuffer as the image source
        src={specks}
        width={w}
        height={h}
        style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}
      />
    </div>
  );
}

/** Advance widths of newsreader-560.woff for printable ASCII (" " to "~"), in thousandths of an em. */
const SERIF_ASCII =
  "220,274,372,615,615,812,752,196,280,280,407,547,246,336,242,391,615,615,615,615,615,615,615,615,615,615,270,278,547,547,547,474,896,744,686,711,784,679,622,770,838,368,442,780,635,1032,774,798,654,798,712,578,719,788,726,1034,750,718,665,303,391,304,547,410,500,506,580,470,591,489,376,519,594,294,272,580,286,880,602,558,593,578,430,416,382,579,561,796,550,556,474,299,224,299,547"
    .split(",")
    .map(Number);

/** A word space of Newsreader, in em (the first entry of SERIF_ASCII). */
const SERIF_SPACE_EM = 0.22;

/** The building line's width at `size` px, without kerning (so never under the real width). */
export function buildingWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    em += (c >= 32 && c <= 126 ? SERIF_ASCII[c - 32] : 640) / 1000;
  }
  return em * size;
}

/**
 * The building on one line (Satori wraps a little early, so it is never asked to): 52px when it fits
 * 500px (x 64 to 564 stays clear of the rotated stamp at that height), else 44 or 36, else cut with
 * an ellipsis at 36.
 */
export function buildingLine(text: string): { text: string; size: number } {
  const MAX = 500;
  for (const size of [52, 44, 36]) if (buildingWidth(text, size) <= MAX) return { text, size };
  let cut = text;
  while (cut.length > 1 && buildingWidth(`${cut}…`, 36) > MAX) cut = cut.slice(0, -1).trimEnd();
  return { text: `${cut}…`, size: 36 };
}

/**
 * A line of Newsreader set letter by letter. Satori measures a word one glyph at a time, without
 * kerning, but draws the whole word with the font's kerning: a word with strong pairs ("To", "Ay",
 * "we") ends short of its measured box, and the space after it looks twice as wide ("Aykon  City
 * Tower  C"). One span per letter makes the drawing match the measuring; a word space is the font's
 * own (0.22em).
 */
function Letters({ text, size }: { text: string; size: number }) {
  const words = text.split(" ").filter(Boolean);
  return (
    <>
      {words.map((word, i) => (
        <div key={i} style={{ display: "flex", marginRight: i < words.length - 1 ? px(SERIF_SPACE_EM * size) : 0 }}>
          {[...word].map((ch, j) => (
            <span key={j}>{ch}</span>
          ))}
        </div>
      ))}
    </>
  );
}

function OgCard({ check, specks }: { check: CheckView; specks: ArrayBuffer }) {
  const showStamp = !plainNotCovered(check);
  const layout = showStamp ? layoutStamp(stampProps(check), STAMP_WIDTH.og) : null;
  const l = ogLines(check);
  const building = buildingLine(l.building);
  const bSize = building.size;
  const abs = (top: number, extra: CSSProperties = {}): CSSProperties => ({ position: "absolute", left: 64, top, display: "flex", ...extra });
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: PAPER, color: C.ink, fontFamily: SANS }}>
      <div style={abs(64, { alignItems: "center", gap: 12, height: 40 })}>
        <Mark />
        <div style={{ display: "flex", fontFamily: SERIF, fontWeight: SERIF_WEIGHT.brand, fontSize: 32, lineHeight: 1, letterSpacing: -0.32 }}>
          {COPY["og.brand"]}
        </div>
      </div>

      <div
        style={abs(120 + (52 - bSize) / 2, {
          fontFamily: SERIF,
          fontWeight: SERIF_WEIGHT.building,
          fontSize: bSize,
          lineHeight: 1.08,
          letterSpacing: -0.01 * bSize,
          whiteSpace: "nowrap",
        })}
      >
        <Letters text={building.text} size={bSize} />
      </div>
      {/* A long line ("Off-plan 2-bed, about 1,284 sq ft, AED 12,450,000") steps down so it ends left of the stamp's corner. */}
      <div style={abs(184, { fontFamily: SANS_NARROW, fontSize: l.listing.length > 44 ? 22 : l.listing.length > 37 ? 26 : 30, lineHeight: 1.2, color: C.pencil, whiteSpace: "nowrap" })}>{l.listing}</div>

      <div style={abs(248, { flexDirection: "column", fontFamily: SERIF, fontWeight: SERIF_WEIGHT.verdict, fontSize: 48, lineHeight: 1.083, letterSpacing: -0.72 })}>
        <div style={{ display: "flex" }}>
          {l.head.figure ? (
            <div style={{ display: "flex", color: l.head.hue }}>
              <Letters text={l.head.figure} size={48} />
            </div>
          ) : null}
          {l.head.line1 ? (
            <div style={{ display: "flex", marginLeft: l.head.figure ? 12 : 0 }}>
              <Letters text={l.head.line1} size={48} />
            </div>
          ) : null}
        </div>
        {l.head.line2 ? (
          <div style={{ display: "flex" }}>
            <Letters text={l.head.line2} size={48} />
          </div>
        ) : null}
      </div>

      {l.figures ? <div style={abs(380, { width: 460, fontFamily: SANS_NARROW, fontSize: 28, lineHeight: 1.286 })}>{l.figures}</div> : null}
      {l.recent ? <div style={abs(470, { fontFamily: SANS_NARROW, fontSize: 26, lineHeight: 1.23, whiteSpace: "nowrap" })}>{l.recent}</div> : null}
      {l.range ? <div style={abs(488, { fontFamily: SANS_NARROW, fontSize: 26, lineHeight: 1.23, whiteSpace: "nowrap" })}>{l.range}</div> : null}
      <div style={abs(566, { fontSize: 22, lineHeight: 1.27, color: C.pencil, whiteSpace: "nowrap" })}>{l.source}</div>

      {layout ? <StampOg layout={layout} specks={specks} /> : null}
    </div>
  );
}

/** The image of a comparison as people see it (exported for tests). */
export async function ogResponse(check: CheckView): Promise<ImageResponse> {
  const { fonts, specks } = await loadAssets();
  return new ImageResponse(<OgCard check={check} specks={specks} />, {
    ...size,
    fonts,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const env = getEnv();
  const db = getDb();
  const row = await getCheckRowByCode(db, code);
  if (!row) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  // As the /c page shows it: a comparison made before the data loaded gets its first real verdict.
  const { check } = await publicCheckView(db, row, dubaiToday(), env.rules, env.APP_URL);
  try {
    return await ogResponse(check);
  } catch (err) {
    log.error("og_image_failed", { code: check.code, err });
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
