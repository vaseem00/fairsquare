/**
 * The result's sentences (RESULT_SPEC sections 2 to 6 and 10), built from the copy deck and
 * `scaleModel()`: the fact line, the scene's status lines, the gap sentence, the recent-sales line,
 * the evidence line and its popover, the scale's title, summary, legend and readout, the sales list's
 * sentences and "Before you make an offer". Pure and client-safe, like copy.ts; every string comes
 * from a deck key, so DESIGN.md section 6 stays the one place the words live.
 */
import { acsRange, basisWord, COPY, nearbyRange, nearbyShown, similarLines, similarRange, t, tList, tPlural, windowMonths } from "@/lib/copy";
import type { IsoDate } from "@/lib/domain/dates";
import { bedsLabel, bedsLabelPlural, formatDate, formatDateNear, formatInt, formatPctNumber } from "@/lib/format";
import { evidenceOf, recentSet, sameSizeOf, type EvidenceTier, type ScaleDot, type ScaleModel } from "@/lib/result/scale-model";
import type { RangeMark, RangeScaleModel } from "@/lib/result/similar-scale";
import type { AcsComparableView, CheckView, Completion, CompletionBasis, NearbyComparableView, SaleView } from "@/lib/types";

// ---------- the fact line (section 2.4) ----------

export interface FactValues {
  /** The listing's own building text (never the DLD name). */
  building: string | null;
  area: string | null;
  /** The listing's completion; "unknown" (or null) leaves the basis out. */
  completion: Completion | null | undefined;
  bedrooms: number | null;
  sizeSqft: number | null;
  /** The size came from a size button: "about 815". */
  sizeAbout?: boolean;
  priceAed: number | null;
}

/** One piece of a fact line: plain text, or a figure that sets in (the building, the size, the price). */
export type FactPart = { text: string; figure?: "building" | "size" | "price" };

const PLACEHOLDER = /\{([^{}]+)\}/g;
const NBSP = " ";

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Splits a filled template into text and figure parts; `{name}` values not in `figures` stay text. */
function partsOf(template: string, vars: Record<string, string>, figures: Record<string, FactPart["figure"]>): FactPart[] {
  const out: FactPart[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: template.slice(last, at) });
    const name = m[1];
    out.push(figures[name] ? { text: vars[name], figure: figures[name] } : { text: vars[name] });
    last = at + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  // "AED" stays with its amount and a size with "sq ft".
  return out.map((p) => (p.figure ? p : { text: p.text.replace(/AED $/, `AED${NBSP}`).replace(/^ sq ft/, `${NBSP}sq${NBSP}ft`) }));
}

/**
 * The fact line's two lines as parts: "{building}, {area}." and "{Basis} {bedType}, {size} sq ft,
 * AED {price}.". What is not known is left out (never a blank): a question shows only what it has.
 * Null for a line with nothing in it.
 */
export function factLines(v: FactValues): { line1: FactPart[] | null; line2: FactPart[] | null } {
  const building = v.building?.trim() || null;
  const area = v.area?.trim() || null;
  const line1 = building
    ? partsOf(COPY[area ? "fact.line1" : "fact.line1NoArea"], { building, area: area ?? "" }, { building: "building" })
    : null;

  const basis = v.completion === "ready" || v.completion === "off_plan" ? capitalise(basisWord(v.completion)) : null;
  const bedType = v.bedrooms !== null ? bedsLabel(v.bedrooms) : null;
  const size = v.sizeSqft !== null ? (v.sizeAbout ? t("fact.sizeAbout", { size: formatInt(v.sizeSqft) }) : formatInt(v.sizeSqft)) : null;
  const price = v.priceAed !== null ? formatInt(v.priceAed) : null;
  const vars: Record<string, string | null> = { basis, bedType: basis ? bedType : bedType && capitalise(bedType), size, price };
  // "{basis} {bedType}, {size} sq ft, AED {price}." by segment: keep the segments whose values are known.
  const template = COPY[basis ? "fact.line2" : "fact.line2NoBasis"].replace(/\.$/, "");
  const segments = template
    .split(", ")
    .map((seg) => {
      const names = [...seg.matchAll(PLACEHOLDER)].map((m) => m[1]);
      const known = names.filter((n) => vars[n] !== null);
      if (known.length === names.length) return seg;
      // "Ready" alone when the bedrooms are not known yet.
      if (names.includes("basis") && known.length === 1 && known[0] === "basis") return "{basis}";
      return null;
    })
    .filter((s): s is string => s !== null);
  const filled: Record<string, string> = Object.fromEntries(Object.entries(vars).map(([k, val]) => [k, val ?? ""]));
  const line2 = segments.length ? partsOf(`${segments.join(", ")}.`, filled, { size: "size", price: "price" }) : null;
  return { line1, line2 };
}

/** The fact line as plain text (tests, the announcement). */
export function factText(v: FactValues): string {
  const { line1, line2 } = factLines(v);
  return [line1, line2]
    .filter((l): l is FactPart[] => l !== null)
    .map((l) => l.map((p) => p.text).join(""))
    .join(" ")
    .replace(/ /g, " ");
}

/** The fact values of a comparison (the result's fact line). */
export function factOfCheck(c: Pick<CheckView, "buildingText" | "areaText" | "completion" | "bedrooms" | "sizeSqft" | "sizeSource" | "priceAed">): FactValues {
  return {
    building: c.buildingText,
    area: c.areaText,
    completion: c.completion,
    bedrooms: c.bedrooms,
    sizeSqft: c.sizeSqft,
    sizeAbout: c.sizeSource === "cluster",
    priceAed: c.priceAed,
  };
}

// ---------- the scene's status line (section 2.3) ----------

/** "In DLD records as Aykon City (2) -Tower C, Business Bay." */
export function statusMatch(building: { name: string; area: string }): string {
  return t("scene.statusMatch", { building: building.name, area: building.area });
}

/** "43 registered sales of ready 2-beds in the 12 months to 16 Nov 2026." Null below 2 sales (no plural). */
export function statusSales(count: number, basis: CompletionBasis, bedrooms: number, windowDays: number, through: IsoDate): string | null {
  if (count < 2) return null;
  return t("scene.statusSales", {
    count: formatInt(count),
    basis: basisWord(basis),
    bedTypePlural: bedsLabelPlural(bedrooms),
    months: windowMonths(windowDays),
    to: formatDate(through),
  });
}

// ---------- level 1 sentences (sections 3, 4 and 6) ----------

/** The recent set's "since" and "through" dates. */
function recentDates(m: Pick<ScaleModel, "recent">): { since: string } {
  return { since: formatDateNear(m.recent.since, m.recent.through) };
}

/**
 * The gap sentence: AED per sq ft first, then the % (in line only; the headline carries it otherwise),
 * then the count framing. "The asking price is AED 25 per sq ft above the median (1.4%), and higher
 * than 25 of the 43 sales."
 */
export function gapText(m: ScaleModel): string {
  const g = m.gap;
  const gap = formatInt(g.aed);
  const pctParen = g.withPct ? ` (${formatPctNumber(m.diff)}%)` : "";
  switch (g.kind) {
    case "zero":
      return t("result.gapZero", { k: g.k, n: g.n });
    case "aboveAll":
      return t("result.aboveAll", { gap, pctParen, n: g.n, max: formatInt(g.extreme?.psf ?? m.highest.psf), date: formatDate((g.extreme ?? m.highest).saleDate) });
    case "belowAll":
      return t("result.belowAll", { gap, pctParen, n: g.n, min: formatInt(g.extreme?.psf ?? m.lowest.psf), date: formatDate((g.extreme ?? m.lowest).saleDate) });
    default:
      return t(g.kind === "above" ? "result.gapAbove" : "result.gapBelow", { gap, pctParen, k: g.k, n: g.n });
  }
}

/**
 * The recent-sales line when it triggers (5 or more sales in the last 90 days whose median differs from
 * the 12-month median by more than 5%), else null.
 */
export function recentText(m: ScaleModel): string | null {
  const r = m.recent;
  if (!r.trigger || r.medianPsf === null || r.direction === null || r.askDirection === null) return null;
  return t(r.direction === "lower" ? "result.recentLower" : "result.recentHigher", {
    n: r.count,
    date: recentDates(m).since,
    m: formatInt(r.medianPsf),
    dir: r.askDirection,
    k: r.askK,
  });
}

const TIER_KEY: Record<EvidenceTier, "evidence.strong" | "evidence.moderate" | "evidence.limited"> = {
  strong: "evidence.strong",
  moderate: "evidence.moderate",
  limited: "evidence.limited",
};

const MARK = "\u0000";

/**
 * The evidence line, cut where its first words ("Strong evidence") become the popover's button:
 * `{ tier, label: "Strong evidence", rest: ". 43 registered sales of ready 2-beds in ..." }`.
 * Null without a tier (too few sales) or without a covered building.
 */
export function evidenceLine(c: CheckView): { tier: EvidenceTier; label: string; rest: string } | null {
  const ev = evidenceOf(c);
  if (!ev.tier || !c.building) return null;
  const a = c.analysis;
  const latest = [...c.sales, ...c.setAsideSales].reduce<IsoDate | null>((d, s) => (d === null || s.saleDate > d ? s.saleDate : d), null);
  const full = t("evidence.line", {
    strength: MARK,
    n: formatInt(a.count),
    basis: basisWord(a.completionBasis),
    bedTypePlural: bedsLabelPlural(c.bedrooms),
    dld: c.building.name,
    from: formatDate(a.windowStart),
    to: formatDate(a.windowEnd),
    latest: latest ? formatDateNear(latest, a.windowEnd) : formatDate(a.windowEnd),
    setAside: a.outliersDropped > 0 ? tPlural("evidence.setAsideN", a.outliersDropped) : COPY["evidence.setAsideNone"],
  });
  const word = COPY[TIER_KEY[ev.tier]];
  const head = `${MARK} evidence`;
  const at = full.indexOf(head);
  return { tier: ev.tier, label: `${word} evidence`, rest: at < 0 ? full.replace(MARK, word) : full.slice(at + head.length) };
}

/** The evidence popover's lines (section 3.1): the three definitions, this comparison's numbers, the counts note. */
export function evidenceDefinitions(c: CheckView): string[] {
  const ev = evidenceOf(c);
  const here =
    ev.q1 !== null && ev.q3 !== null && ev.spread !== null
      ? t("evidence.defHere", {
          n: formatInt(ev.count),
          recent: ev.recentCount,
          q1: formatInt(ev.q1),
          q3: formatInt(ev.q3),
          spread: (Math.round(ev.spread * 1000) / 10).toFixed(1),
        })
      : null;
  // The Limited floor is the comparison's own minimum (MIN_SALES when it was made), like the tier.
  const limited = t("evidence.defLimited", { minSales: c.rules.minSales });
  return [COPY["evidence.defStrong"], here, COPY["evidence.defModerate"], limited, COPY["evidence.defCounts"]].filter(
    (s): s is string => s !== null,
  );
}

/** "DLD building: Aykon City (2) -Tower C. Not a valuation." (the too-few state), or null when not covered. */
export function thinEvidence(c: Pick<CheckView, "building">): string | null {
  return c.building ? t("evidence.thinLine", { dld: c.building.name }) : null;
}

// ---------- the scale's words (section 4) ----------

export function scaleTitle(m: Pick<ScaleModel, "n">): string {
  return t("scale.title", { n: m.n });
}

/**
 * The chart summary (`aria-describedby`): what each dot is, the range, the median, the asking price and
 * the recent sales. With more than 80 sales each dot stands for about `k` of them (scale.summaryQuantile,
 * scale.summaryRecentQuantile); the counts still use the full set (section 4.3, item 15).
 */
export function scaleSummary(c: CheckView, m: ScaleModel): string {
  const a = c.analysis;
  const basis = basisWord(a.completionBasis);
  const quantile = m.geometry.quantile;
  const vars = {
    article: /^[aeiou]/i.test(basis) ? "an" : "a",
    basis,
    bedType: bedsLabel(c.bedrooms),
    dld: c.building?.name ?? c.buildingText,
    from: formatDate(a.windowStart),
    to: formatDate(a.windowEnd),
    min: formatInt(m.lowest.psf),
    max: formatInt(m.highest.psf),
    median: formatInt(m.median),
    asking: formatInt(m.ask),
    dir: m.direction,
    k: m.k,
  };
  const main = quantile ? t("scale.summaryQuantile", { ...vars, per: quantile.k, n: formatInt(m.n) }) : t("scale.summary", vars);
  const r = m.recent;
  if (r.count < 2 || r.medianPsf === null) return main;
  const recent = { n: r.count, date: recentDates(m).since, m: formatInt(r.medianPsf) };
  // In quantile mode the sentence about filled dots holds only when a dot is filled.
  if (quantile && !m.geometry.dots.some((d) => d.recent)) return main;
  return `${main} ${t(quantile ? "scale.summaryRecentQuantile" : "scale.summaryRecent", recent)}`;
}

/**
 * The card's caption under its mini scale (RESULT_SPEC 8.1): "Each dot is one registered sale. Filled:
 * since 18 Aug." With no filled dot the second sentence goes; with more than 80 sales each dot is about
 * `k` of them (card.dotsQuantile).
 */
export function cardDotsText(m: Pick<ScaleModel, "recent" | "geometry">): string {
  const filled = m.geometry.dots.some((d) => d.recent);
  const date = recentDates(m).since;
  const q = m.geometry.quantile;
  if (q) return filled ? t("card.dotsQuantile", { k: q.k, date }) : t("card.dotsQuantileNoRecent", { k: q.k });
  return filled ? t("card.dots", { date }) : COPY["card.dotsNoRecent"];
}

export interface LegendWords {
  unit: string;
  /** "since 18 Aug", or null when no sale is recent. */
  recent: string | null;
  /** "earlier", or null when every sale is recent. */
  older: string | null;
  /** "Each dot is about 3 sales." in quantile mode. */
  quantile: string | null;
  band: string;
}

export function legendWords(c: Pick<CheckView, "analysis" | "rules">, m: ScaleModel): LegendWords {
  const filled = m.geometry.dots.some((d) => d.recent);
  const hollow = m.geometry.dots.some((d) => !d.recent);
  return {
    unit: COPY[c.analysis.completionBasis === "off_plan" ? "scale.unitOffPlan" : "scale.unit"],
    recent: filled ? t("scale.recent", { date: recentDates(m).since }) : null,
    older: hollow ? COPY["scale.older"] : null,
    quantile: m.geometry.quantile ? t("scale.quantile", { k: m.geometry.quantile.k }) : null,
    band: t("scale.band", { bandPct: m.zone.bandPct, lo: formatInt(m.zone.lo), hi: formatInt(m.zone.hi) }),
  };
}

/** The readout for a selected dot: "3 Nov 2026: 817 sq ft, AED 1,200,000, AED 1,470 per sq ft." */
export function readoutText(c: Pick<CheckView, "sales">, dot: ScaleDot, quantile: boolean): string {
  if (quantile || dot.sales.length !== 1) return t("scale.readoutQuantile", { k: dot.sales.length, psf: formatInt(dot.psf) });
  const s = c.sales[dot.sales[0]];
  return t("scale.readout", { date: formatDate(s.saleDate), size: formatInt(s.sizeSqft), price: formatInt(s.priceAed), psf: formatInt(s.psf) });
}

// ---------- level 2 (section 5) ----------

/**
 * "The 3 newest sales of the same size (within 3% of 812 sq ft) registered at AED 1,200,000 to
 * AED 1,260,045." (2 or 3 of them), the one-sale sentence, or null with none.
 */
export function sameSizeText(c: Pick<CheckView, "sales" | "sizeSqft">): string | null {
  const s = sameSizeOf(c);
  const size = formatInt(c.sizeSqft);
  if (s.newest.length === 0) return null;
  if (s.newest.length === 1) {
    const only = s.newest[0];
    return t("list.sameSize1", { size, p: formatInt(only.priceAed), date: formatDate(only.saleDate) });
  }
  const range = s.newestPriceRange as { lo: number; hi: number };
  return t("list.sameSize3", { k: s.newest.length, size, lo: formatInt(range.lo), hi: formatInt(range.hi) });
}

/** "Before you make an offer": the spread sentence, with the premium count when 3 or more sales are at 1.15x the median or more. */
export function offerText(m: Pick<ScaleModel, "premium" | "n"> | null): string {
  const p = m?.premium;
  if (!p || !p.show || p.lowestPsf === null) return COPY["offer.spread"];
  return `${COPY["offer.spread"]} ${t("offer.premium", { k: p.count, n: m.n, lo: formatInt(p.lowestPsf) })}`;
}

export function offerItems(): string[] {
  return tList("offer.items");
}

/** True when a sale counts as recent (registered on or after the recent set's first day). */
export function isRecentSale(c: Pick<CheckView, "sales" | "analysis">, s: Pick<SaleView, "saleDate">): boolean {
  return s.saleDate >= recentSet(c).since;
}

/** "since 18 Aug" for the list's dot labels. */
export function recentLabel(c: Pick<CheckView, "sales" | "analysis">): string {
  const r = recentSet(c);
  return t("scale.recent", { date: formatDateNear(r.since, r.through) });
}

// ---------- the range scale of the second tier (DESIGN.md section 6.16) ----------

type SimilarCheck = Pick<CheckView, "similar" | "analysis" | "sales" | "bedrooms" | "building" | "buildingText" | "rules">;

/**
 * The range scale's summary (`aria-describedby`): the axis, the range, the asking price against it,
 * then what the rings and the filled dots are. Everything the drawing says, in words.
 */
export function rangeSummary(c: SimilarCheck, m: RangeScaleModel): string {
  const range = similarRange(c);
  if (!range) return "";
  const parts = [t("similar.scaleSummary", { ...range, min: formatInt(m.domain[0]), max: formatInt(m.domain[1]) })];
  if (m.others > 0 && m.othersSpan) parts.push(tPlural("similar.scaleOthers", m.others, { k: formatInt(m.others), lo: formatInt(m.othersSpan.lo), hi: formatInt(m.othersSpan.hi) }));
  if (m.offScale > 0) parts.push(tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }));
  if (m.capped) parts.push(t("similar.scaleCapped", { shown: formatInt(m.capped.shown), k: formatInt(m.capped.of) }));
  if (m.own > 0) parts.push(tPlural("similar.scaleOwn", m.own, { n: m.own }));
  return parts.join(" ");
}

export interface RangeLegend {
  unit: string;
  /** "another building, at its median" (or "up to 3 other buildings"); null with none drawn. */
  other: string | null;
  /** "a sale in this building"; null with none. */
  own: string | null;
  /** "the range, AED 1,720 to 1,980". */
  range: string;
  /** "2 more are off this scale."; null with none. */
  off: string | null;
  /** "Only the 200 with the most sales, of 312, are on this scale."; null when every building is stored. */
  capped: string | null;
}

export function rangeLegend(c: Pick<CheckView, "analysis">, m: RangeScaleModel): RangeLegend {
  return {
    unit: COPY[c.analysis.completionBasis === "off_plan" ? "scale.unitOffPlan" : "scale.unit"],
    other: m.others > 0 ? (m.per > 1 ? t("similar.legendOtherK", { k: m.per }) : COPY["similar.legendOther"]) : null,
    own: m.own > 0 ? COPY["similar.legendOwn"] : null,
    range: t("similar.legendRange", { low: formatInt(m.low), high: formatInt(m.high) }),
    off: m.offScale > 0 ? tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }) : null,
    capped: m.capped ? t("similar.scaleCapped", { shown: formatInt(m.capped.shown), k: formatInt(m.capped.of) }) : null,
  };
}

/** The readout for a selected mark: the building and its registered sales, or this building's sale. */
export function rangeReadout(c: Pick<CheckView, "similar" | "sales">, mark: RangeMark): string {
  if (mark.kind === "own") {
    const s = c.sales[mark.items[0]];
    return t("similar.readoutOwn", { date: formatDate(s.saleDate), size: formatInt(s.sizeSqft), price: formatInt(s.priceAed), psf: formatInt(s.psf) });
  }
  const one = mark.items.length === 1 ? c.similar?.comparables[mark.items[0]] : null;
  if (one) return tPlural("similar.readout", one.sales, { building: one.name, n: formatInt(one.sales), psf: formatInt(one.medianPsf) });
  return t("similar.readoutK", { k: mark.items.length, psf: formatInt(mark.psf) });
}

/** The second tier's definitions (the tier's popover): the two tiers, what the tests found, what the range leaves out. */
export function similarDefinitions(c: SimilarCheck): string[] {
  const l = similarLines(c);
  if (!l) return [];
  return [COPY["similar.defClose"], COPY["similar.defBroad"], l.reach, l.tested, l.limits].filter((s): s is string => s !== null);
}

/** The card's caption under its range scale. */
export function cardRangeCaption(c: Pick<CheckView, "similar" | "rules">, m: Pick<RangeScaleModel, "others">): string {
  return m.others > 0 ? COPY["similar.cardCaption"] : t("similar.cardCaptionOwn", { minSales: c.rules.minSales, months: windowMonths(c.rules.windowDays) });
}
// ---------- the scale of adjusted registered sales (DESIGN.md section 6.17) ----------

type AcsScaleWords = Pick<CheckView, "acs" | "analysis" | "building">;

/** The scale's summary (`aria-describedby`): the range, the asking price against it, how many adjusted sales are marked. */
export function acsRangeSummary(c: AcsScaleWords, m: RangeScaleModel): string {
  const range = acsRange(c);
  if (!range) return "";
  const drawn = m.marks.reduce((n, mk) => n + mk.items.length, 0);
  const parts = [t("acs.scaleSummary", { ...range, n: formatInt(drawn) })];
  if (m.offScale > 0) parts.push(tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }));
  if (m.capped) parts.push(t("acs.listCapped", { shown: formatInt(m.capped.shown), n: formatInt(m.capped.of) }));
  return parts.join(" ");
}

/** The legend: the unit, the filled dot (a sale of this bedroom count here), the ring (another bedroom count or building), the range. */
export function acsRangeLegend(c: Pick<CheckView, "analysis">, m: RangeScaleModel): RangeLegend {
  return {
    unit: COPY[c.analysis.completionBasis === "off_plan" ? "scale.unitOffPlan" : "scale.unit"],
    own: m.own > 0 ? (m.per > 1 ? t("acs.legendSaleK", { k: m.per }) : COPY["acs.legendSale"]) : null,
    other: m.others > 0 ? COPY["acs.legendOther"] : null,
    range: t("acs.legendRange", { low: formatInt(m.low), high: formatInt(m.high) }),
    off: m.offScale > 0 ? tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }) : null,
    capped: m.capped ? t("acs.listCapped", { shown: formatInt(m.capped.shown), n: formatInt(m.capped.of) }) : null,
  };
}

/** Where a row comes from when it is not a sale of the listing's bedroom count in its building; else null. */
export function acsRowOrigin(row: AcsComparableView): string | null {
  if (row.ring === 2) return t("acs.rowOtherBeds", { bedType: capitalise(bedsLabel(row.bedrooms)) });
  if (row.ring === 3) return t("acs.rowProject", { building: row.building ?? COPY["acs.groupProject"] });
  return null;
}

/** The readout for a selected mark: the registered sale and its adjusted figure, or how many sales the mark stands for. */
export function acsRangeReadout(c: Pick<CheckView, "acs">, mark: RangeMark): string {
  const row = mark.items.length === 1 ? c.acs?.comparables[mark.items[0]] : null;
  if (!row) return t("acs.readoutK", { k: mark.items.length, psf: formatInt(mark.psf) });
  const text = t(row.ring === 2 ? "acs.readoutBeds" : "acs.readout", { date: formatDate(row.date), size: formatInt(row.sizeSqft), psf: formatInt(row.psf), adjusted: formatInt(row.adjustedPsf) });
  const origin = acsRowOrigin(row);
  return origin ? `${origin}. ${text}` : text;
}

/** "up 4.4%", "down 0.5%" or "no change" for an adjustment given as a fraction (0.044). */
export function acsAdjText(fraction: number): string {
  const pct = (Math.round(Math.abs(fraction) * 1000) / 10).toFixed(1);
  if (pct === "0.0") return COPY["acs.adjNone"];
  return t(fraction > 0 ? "acs.adjUp" : "acs.adjDown", { pct });
}

/** "13" for a row's share of the total (0.132), "0.4" under 1%. */
export function acsSharePct(share: number): string {
  const pct = share * 100;
  return pct >= 1 ? String(Math.round(pct)) : (Math.round(pct * 10) / 10).toFixed(1);
}

/** A row's note when it stands for several registered sales; null for one sale. */
export function acsRowNote(row: AcsComparableView): string | null {
  if (row.batch) return t("acs.rowBatch", { n: formatInt(row.count) });
  return row.count > 1 ? t("acs.rowSame", { n: formatInt(row.count) }) : null;
}

/** The card's caption under its scale of adjusted registered sales. */
export function cardAcsCaption(m: Pick<RangeScaleModel, "per">, several = false): string {
  if (m.per > 1) return t("acs.cardCaptionK", { k: m.per });
  return COPY[several ? "acs.cardCaptionRows" : "acs.cardCaption"];
}

/** True when a row used stands for several registered sales (a one-price batch, or the same date, size and price). */
export function acsSeveral(a: { comparables: readonly Pick<AcsComparableView, "count">[] }): boolean {
  return a.comparables.some((r) => r.count > 1);
}

// ---------- the scale of nearby registered sales (DESIGN.md section 6.18) ----------

type NearbyScaleWords = Pick<CheckView, "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>;

/** The scale's summary (`aria-describedby`): the range, the asking price against it, how many adjusted sales in other buildings are marked. */
export function nearbyRangeSummary(c: NearbyScaleWords, m: RangeScaleModel): string {
  const range = nearbyRange(c);
  if (!range) return "";
  const drawn = m.marks.reduce((n, mk) => n + mk.items.length, 0);
  const parts = [t("nearby.scaleSummary", { ...range, n: formatInt(drawn) })];
  if (m.offScale > 0) parts.push(tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }));
  if (m.capped) parts.push(t("nearby.listCapped", { shown: formatInt(m.capped.shown), n: formatInt(m.capped.of) }));
  return parts.join(" ");
}

/** The legend: the unit, the ring (a registered sale in another building, adjusted), the range. No filled dot: nothing is this building's. */
export function nearbyRangeLegend(c: Pick<CheckView, "analysis">, m: RangeScaleModel): RangeLegend {
  return {
    unit: COPY[c.analysis.completionBasis === "off_plan" ? "scale.unitOffPlan" : "scale.unit"],
    own: null,
    other: m.others > 0 ? (m.per > 1 ? t("nearby.legendSaleK", { k: m.per }) : COPY["nearby.legendSale"]) : null,
    range: t("nearby.legendRange", { low: formatInt(m.low), high: formatInt(m.high) }),
    off: m.offScale > 0 ? tPlural("similar.legendOff", m.offScale, { n: formatInt(m.offScale) }) : null,
    capped: m.capped ? t("nearby.listCapped", { shown: formatInt(m.capped.shown), n: formatInt(m.capped.of) }) : null,
  };
}

/** The readout for a selected ring: the building, its registered sale and the adjusted figure, or how many sales the ring stands for. */
export function nearbyRangeReadout(c: NearbyScaleWords, mark: RangeMark): string {
  const row = mark.items.length === 1 ? nearbyShown(c)?.comparables[mark.items[0]] : null;
  if (!row) return t("nearby.readoutK", { k: mark.items.length, psf: formatInt(mark.psf) });
  return t("nearby.readout", { building: row.building, date: formatDate(row.date), size: formatInt(row.sizeSqft), psf: formatInt(row.psf), adjusted: formatInt(row.adjustedPsf) });
}

/** The card's caption under its scale of nearby registered sales. */
export function cardNearbyCaption(m: Pick<RangeScaleModel, "per">): string {
  return m.per > 1 ? t("nearby.cardCaptionK", { k: m.per }) : COPY["nearby.cardCaption"];
}

/** A row's registered facts in one line (the phone list): "3 Nov 2026: 1,304 sq ft at AED 1,277 per sq ft". */
export function nearbyRowRegistered(row: NearbyComparableView): string {
  return t("nearby.rowRegistered", { date: formatDate(row.date), size: formatInt(row.sizeSqft), psf: formatInt(row.psf) });
}
