/**
 * The similar-buildings copy (DESIGN.md section 6.16, REAL_DATA.md section 15): the keys, their
 * mirror in DESIGN.md, the words the valuation rules forbid, and the sentences `similarLines` builds
 * from a stored comparison. tests/unit/copy.test.ts checks the whole deck's mirror; this file pins
 * this tier's wording.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardAlt, COPY, ogAlt, ogDescription, shareText, similarLines, similarRange, verdictAnnouncement, verdictHeadText, verdictSentence, type CopyKey } from "@/lib/copy";
import type { CheckView, SimilarView } from "@/lib/types";
import { FIXTURE_CHECK_MARINA, FIXTURE_CHECK_NONE, FIXTURE_CHECK_THIN } from "../fixtures/api-fixtures";

const KEYS = (Object.keys(COPY) as CopyKey[]).filter((k) => k.startsWith("similar.") || k.startsWith("how.similar"));

/** The legal word rules of the second tier. "valuation" passes only as "Not a valuation". */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|bargain|rip-off|·|→|→|·/i;
const clean = (s: string) => !BANNED.test(s) && !/valuation/i.test(s.replace(/Not a valuation/g, "")) && !/\bfair\w*/i.test(s.replace(/Fairsquare/g, ""));

const SIMILAR: SimilarView = {
  v: 1,
  modelVersion: 2,
  scenario: "building",
  shown: true,
  reason: null,
  tier: "close",
  level: "community",
  place: "Jumeirah Village Circle",
  comparableBuildings: 174,
  comparableSales: 2213,
  rangeLowPsf: 1720,
  rangeHighPsf: 1980,
  verdict: "within",
  evidence: { ownSales: 2, olderSales: 7, otherBedroomSales: 1 },
  windowStart: "2025-11-16",
  windowEnd: "2026-11-16",
  area: null,
  areaCandidates: [],
  tested: { heldOf10: 8, heldLaterOf10: 7 },
  comparables: [],
  comparableSpan: { lowPsf: 1040, highPsf: 2310 },
  project: null,
};
const withSimilar = (over: Partial<SimilarView> = {}, base: CheckView = FIXTURE_CHECK_THIN): CheckView => ({ ...base, similar: { ...SIMILAR, ...over } });

describe("the similar-buildings keys", () => {
  it("are all in DESIGN.md section 6.16, string for string", () => {
    const md = readFileSync(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
    const start = md.indexOf("### 6.16 Similar buildings");
    expect(start).toBeGreaterThan(0);
    const section = md.slice(start, md.indexOf("### 6.17", start));
    const rows = new Map([...section.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map((m) => [m[1], m[2]]));
    expect([...rows.keys()].sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(rows.get(k), k).toBe(COPY[k]);
    expect(KEYS.length).toBe(81);
  });

  it("never use a valuation word, a middle dot or an arrow; 'fair' only inside Fairsquare", () => {
    for (const k of KEYS) expect(clean(COPY[k]), `${k}: ${COPY[k]}`).toBe(true);
    // The guard itself catches what it must.
    for (const bad of ["an estimated range", "we predict", "what it is worth", "a fair price", "good value", "the average", "verified", "the model says", "a valuation", "a · b", "a → b"]) {
      expect(clean(bad), bad).toBe(false);
    }
    expect(clean("Not a valuation.")).toBe(true);
  });

  it("say registered sales, state the weaker evidence, and end on Not a valuation", () => {
    expect(COPY["similar.h"]).toBe("A range from more registered sales");
    expect(COPY["similar.weaker"]).toBe("Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.");
    // Buildings matched on area, bedrooms and basis only are never called similar (review of 19 Nov 2026).
    for (const k of KEYS) expect(COPY[k], k).not.toMatch(/similar/i);
    expect(COPY["similar.weakerOwn"]).toMatch(/weaker evidence .* Not a valuation\.$/);
    for (const k of ["similar.intro", "similar.srcOwn", "similar.srcRef", "similar.tested"] as const) expect(COPY[k], k).toContain("registered sale");
    // The outcome is in words: no percentage and no single figure for the building.
    for (const k of ["similar.within", "similar.above", "similar.below", "similar.headWithin", "similar.headAbove", "similar.headBelow"] as const) {
      expect(COPY[k], k).not.toMatch(/%|\{pct\}|\{median\}/);
    }
    expect(COPY["similar.range"]).toContain("between AED {low} and AED {high} per sq ft");
  });
});

describe("similarLines", () => {
  it("null unless a shown second tier is stored: the page then stays as it is", () => {
    expect(similarLines(FIXTURE_CHECK_THIN)).toBeNull();
    expect(similarLines({ ...FIXTURE_CHECK_THIN, similar: null })).toBeNull();
    expect(similarLines(FIXTURE_CHECK_MARINA)).toBeNull();
    expect(similarLines(withSimilar({ shown: false, reason: "range_too_wide", tier: null, rangeLowPsf: null, rangeHighPsf: null, verdict: null, tested: null }))).toBeNull();
    expect(similarLines(withSimilar({ shown: false, reason: "area_unresolved", scenario: "area" }, FIXTURE_CHECK_NONE))).toBeNull();
    // A shown entry without its range is not shown either.
    expect(similarLines(withSimilar({ rangeLowPsf: null }))).toBeNull();
  });

  it("the full set of sentences for a building with own sales, older sales, other bedrooms and a community", () => {
    const c = withSimilar();
    expect(similarLines(c)).toEqual({
      heading: "A range from more registered sales",
      head: "Within the range",
      tier: "Narrow range",
      intro: "This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales.",
      range: "They point to a median between AED 1,720 and AED 1,980 per sq ft for ready 3-beds in Dummyside Heights 2, in the 12 months to 16 Nov 2026.",
      verdict: "This asking price, AED 1,890 per sq ft, is within that range.",
      sources:
        "The range is built from 2 registered sales in this building in those 12 months, 7 earlier sales of the same type here, back to 17 Nov 2023, 1 sale of other bedroom types here and 2,213 registered sales of ready 3-beds in 174 other buildings in Jumeirah Village Circle.",
      span: "Their medians run from AED 1,040 to AED 2,310 per sq ft.",
      weaker: "Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.",
      tested:
        "In tests on buildings with many registered sales, a range built this way held the building's own median in about 8 of 10 cases, and in about 7 of 10 against the six months that followed.",
      limits: "The range takes no account of size, floor, view or condition.",
      reach: null,
      announce:
        "This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales. They point to a median between AED 1,720 and AED 1,980 per sq ft for ready 3-beds in Dummyside Heights 2, in the 12 months to 16 Nov 2026. This asking price, AED 1,890 per sq ft, is within that range.",
    });
    // The first tier's own headline and sentence are unchanged beside it.
    expect(verdictHeadText(c)).toBe(verdictHeadText(FIXTURE_CHECK_THIN));
    expect(verdictSentence(c)).toBe(verdictSentence(FIXTURE_CHECK_THIN));
  });

  it("above and below, broad, singulars, the project level and an unnamed area", () => {
    const above = similarLines(withSimilar({ verdict: "above", tier: "broad" }))!;
    expect([above.head, above.tier, above.verdict]).toEqual(["Above the range", "Broad range", "This asking price, AED 1,890 per sq ft, is above that range."]);
    const below = similarLines(withSimilar({ verdict: "below" }))!;
    expect([below.head, below.verdict]).toEqual(["Below the range", "This asking price, AED 1,890 per sq ft, is below that range."]);
    const one = similarLines(withSimilar({ level: "project", place: null, comparableBuildings: 1, comparableSales: 3, evidence: { ownSales: 1, olderSales: 1, otherBedroomSales: 0 } }))!;
    expect(one.sources).toBe(
      "The range is built from 1 registered sale in this building in those 12 months, 1 earlier sale of the same type here, back to 17 Nov 2023 and 3 registered sales of ready 3-beds in 1 other building of the same project.",
    );
    // One other building has no span to state.
    expect(one.span).toBeNull();
    const area = similarLines(withSimilar({ level: "area", place: null, evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 4 } }))!;
    expect(area.sources).toBe("The range is built from 4 sales of other bedroom types here and 2,213 registered sales of ready 3-beds in 174 other buildings in the same area.");
    const named = similarLines(withSimilar({ level: "area", place: "Dubai Marina", evidence: { ownSales: 3, olderSales: 0, otherBedroomSales: 0 } }))!;
    expect(named.sources).toContain("3 registered sales in this building in those 12 months and 2,213 registered sales of ready 3-beds in 174 other buildings in Dubai Marina.");
    // An entry stored before the span existed states none.
    expect(similarLines(withSimilar({ comparableSpan: null }))!.span).toBeNull();
  });

  it("no other building in the range: its own last line, no span, and never the words 'other buildings'", () => {
    const noOthers = { level: null, place: null, comparableBuildings: 0, comparableSales: 0, comparableSpan: null, tier: "broad" } as const;
    const own = similarLines(withSimilar({ ...noOthers, evidence: { ownSales: 1, olderSales: 2, otherBedroomSales: 0 } }))!;
    expect(own.heading).toBe("A range from more registered sales");
    expect(own.sources).toBe("The range is built from 1 registered sale in this building in those 12 months and 2 earlier sales of the same type here, back to 17 Nov 2023.");
    expect(own.span).toBeNull();
    expect(own.weaker).toBe("A few sales are weaker evidence than 5 or more in 12 months. Not a valuation.");
    for (const s of Object.values(own)) if (s) expect(s).not.toMatch(/other building/i);
  });

  it("nothing but the 12 months' own sales, or nothing from the building: no sentence at all, whatever the entry says", () => {
    // The first tier has just called those sales too few: \"more registered sales\" would be untrue.
    const noOthers = { level: null, place: null, comparableBuildings: 0, comparableSales: 0, comparableSpan: null } as const;
    for (const ownSales of [1, 2, 4]) {
      const c = withSimilar({ ...noOthers, evidence: { ownSales, olderSales: 0, otherBedroomSales: 0 } });
      expect(similarLines(c), String(ownSales)).toBeNull();
      expect(similarRange(c), String(ownSales)).toBeNull();
      expect(shareText(c)).toBe(shareText({ ...c, similar: null }));
      expect(ogDescription(c)).toBe(ogDescription({ ...c, similar: null }));
      expect(ogAlt(c)).toBe(ogAlt({ ...c, similar: null }));
      expect(cardAlt(c)).toBe(cardAlt({ ...c, similar: null }));
      expect(verdictAnnouncement(c)).toBe(verdictAnnouncement({ ...c, similar: null }));
    }
    // Other buildings alone are never worded either.
    expect(similarLines(withSimilar({ evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 } }))).toBeNull();
    // With other buildings, own sales are enough beside them.
    expect(similarLines(withSimilar({ evidence: { ownSales: 2, olderSales: 0, otherBedroomSales: 0 } }))).not.toBeNull();
  });

  it("the share text names where the other buildings are", () => {
    expect(shareText(withSimilar())).toContain(
      "More registered sales, in this tower and in other buildings in Jumeirah Village Circle, point to a median between AED 1,720 and AED 1,980 per sq ft; the asking price, AED 1,890 per sq ft, is within that range. Weaker evidence than 5 or more sales in the tower.",
    );
    expect(shareText(withSimilar({ level: "project", place: null }))).toContain("in this tower and in other buildings of the same project, point to");
    expect(shareText(withSimilar({ level: null, place: null, comparableBuildings: 0, comparableSales: 0 }))).toContain("More registered sales, in this tower over three years, point to");
  });

  it("off-plan and studios read correctly, and an entry stored without its test numbers has no test sentence", () => {
    const c: CheckView = { ...withSimilar({ tested: null }), bedrooms: 0, analysis: { ...FIXTURE_CHECK_THIN.analysis, completionBasis: "off_plan" } };
    const l = similarLines(c)!;
    expect(l.range).toContain("for off-plan studios in Dummyside Heights 2");
    expect(l.sources).toContain("registered sales of off-plan studios in 174 other buildings");
    expect(l.tested).toBeNull();
  });

  it("no sentence it builds uses a forbidden word, whatever the entry", () => {
    const variants: Array<Partial<SimilarView>> = [
      {},
      { verdict: "above", tier: "broad" },
      { verdict: "below", level: "project", place: null },
      { level: null, comparableBuildings: 0, comparableSales: 0 },
      { level: "area", place: "Dubai Marina" },
      { tested: null },
    ];
    for (const v of variants) {
      const l = similarLines(withSimilar(v))!;
      for (const [k, s] of Object.entries(l)) if (s) expect(clean(s), `${k}: ${s}`).toBe(true);
      // The range is always two figures; the outcome never carries a percentage.
      expect(l.range).toMatch(/between AED [\d,]+ and AED [\d,]+ per sq ft/);
      expect(`${l.head} ${l.verdict}`).not.toContain("%");
      expect(l.weaker).toMatch(/Not a valuation\.$/);
    }
  });
});

describe("the project route (a building that is not in the data, REAL_DATA.md section 15.8)", () => {
  const PROJECT: Partial<SimilarView> = {
    modelVersion: 4,
    scenario: "project",
    tier: "broad",
    level: "project",
    place: null,
    comparableBuildings: 4,
    comparableSales: 212,
    rangeLowPsf: 1650,
    rangeHighPsf: 2070,
    evidence: { ownSales: 0, olderSales: 0, otherBedroomSales: 0 },
    tested: { heldOf10: 7, heldLaterOf10: 7 },
    comparableSpan: { lowPsf: 1640, highPsf: 1745 },
    project: { name: "Dummyside Lagoon", areaDld: "Al Hebiah Fifth" },
  };
  const none = (over: Partial<SimilarView> = {}): CheckView => ({
    ...withSimilar({ ...PROJECT, ...over }, FIXTURE_CHECK_NONE),
    analysis: { ...FIXTURE_CHECK_NONE.analysis, completionBasis: "off_plan" },
  });

  it("names the project, says the building has no registered sales in the data, never 'similar', and ends on Not a valuation", () => {
    const l = similarLines(none())!;
    expect(l.heading).toBe("A range from other buildings in the Dummyside Lagoon project");
    expect(l.intro).toBe("This building has no registered sales in the data, so Fairsquare looked at registered sales in other buildings in the Dummyside Lagoon project.");
    expect(l.range).toMatch(/^They point to a median between AED 1,650 and AED 2,070 per sq ft for off-plan [\w-]+ in a new building of this project, from sales in the 12 months to 16 Nov 2026\.$/);
    expect(l.sources).toMatch(/^The range is built from 212 registered sales of off-plan [\w-]+ in 4 other buildings in the Dummyside Lagoon project\.$/);
    expect(l.span).toBe("Their medians run from AED 1,640 to AED 1,745 per sq ft.");
    expect(l.weaker).toBe(
      "The building itself has no registered sales in the data. Other buildings are not matched on size or price level, and are weaker evidence than sales in the building itself. Not a valuation.",
    );
    expect(l.tested).toBe(
      "In tests on buildings as they first appeared in the data, using only the sales registered before them, a range built this way held the median of their first six months of registered sales in about 7 of 10 cases.",
    );
    expect(l.reach).toBe(COPY["similar.projectReach"]);
    for (const [k, s] of Object.entries(l)) {
      if (!s) continue;
      expect(clean(s), `${k}: ${s}`).toBe(true);
      expect(s, k).not.toMatch(/similar/i);
    }
    // One other building: singular, no span.
    const one = similarLines(none({ comparableBuildings: 1, comparableSales: 9 }))!;
    expect(one.sources).toMatch(/in 1 other building in the Dummyside Lagoon project\.$/);
    expect(one.span).toBeNull();
  });

  it("every project key says 'other buildings in the {project} project' or says the building has no sales, and never uses a banned word", () => {
    const keys = KEYS.filter((k) => k.startsWith("similar.project") || k.startsWith("how.similarProject"));
    expect(keys.length).toBe(13);
    for (const k of keys) expect(clean(COPY[k]), k).toBe(true);
    for (const k of ["similar.projectH", "similar.projectIntro", "similar.projectShare", "similar.projectOgDesc", "similar.projectOgAlt"] as const) {
      expect(COPY[k], k).toMatch(/other buildings in the \{project\} project/i);
    }
    for (const k of ["similar.projectIntro", "similar.projectWeaker", "similar.projectShare"] as const) expect(COPY[k], k).toMatch(/has no registered sales in the data/);
    for (const k of ["similar.projectWeaker", "similar.projectShare", "similar.projectOgDesc"] as const) expect(COPY[k], k).toMatch(/Not a valuation\.$/);
    expect(COPY["how.similarProject"]).toMatch(/An area or a community alone never gives a range of this kind, and a ready building never gets one this way\./);
  });

  it("the share text, the preview and its alt text carry the project range; the not-covered parts stay", () => {
    const c = none();
    const plain = { ...c, similar: null };
    expect(shareText(c)).toBe(
      `Registered sales in other buildings in the Dummyside Lagoon project point to a median between AED 1,650 and AED 2,070 per sq ft; the asking price, AED ${c.analysis.askingPsf.toLocaleString("en-US", { maximumFractionDigits: 0 })} per sq ft, is within that range. The building itself has no registered sales in the data. Weaker evidence. Not a valuation. ${shareText(plain)}`,
    );
    expect(ogDescription(c)).toBe(
      "No registered sales for this building in the data. Other buildings in the Dummyside Lagoon project point to a median between AED 1,650 and AED 2,070 per sq ft. Weaker evidence. Not a valuation.",
    );
    expect(ogAlt(c)).toContain("A range from other buildings in the Dummyside Lagoon project runs from AED 1,650 to AED 2,070 per sq ft; the asking price is within it.");
    // A not-covered result has no card, with or without the range.
    expect(cardAlt(c)).toBeNull();
    expect(verdictSentence(c)).toBe(verdictSentence(plain));
    expect(verdictAnnouncement(c)).toContain("This building has no registered sales in the data");
  });

  it("is not shown without its project, from older constants, with own evidence claimed, or with no other building", () => {
    expect(similarLines(none({ project: null }))).toBeNull();
    expect(similarLines(none({ modelVersion: 3 }))).toBeNull();
    expect(similarLines(none({ evidence: { ownSales: 1, olderSales: 0, otherBedroomSales: 0 } }))).toBeNull();
    expect(similarLines(none({ comparableBuildings: 0 }))).toBeNull();
    expect(similarLines(none({ level: "community" }))).toBeNull();
    expect(similarLines(none({ project: { name: " ", areaDld: "x" } }))).toBeNull();
    expect(shareText(none({ project: null }))).toBe(shareText({ ...none(), similar: null }));
  });
});