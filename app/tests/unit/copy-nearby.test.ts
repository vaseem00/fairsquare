/**
 * The nearby-registered-sales copy (DESIGN.md section 6.18, REAL_DATA.md section 17): the keys, their
 * mirror in DESIGN.md and the words the valuation rules forbid. tests/unit/copy.test.ts checks the
 * whole deck's mirror; this file pins this answer's wording.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COPY, placeholders, t, tPlural, type CopyKey } from "@/lib/copy";

const KEYS = (Object.keys(COPY) as CopyKey[]).filter((k) => k.startsWith("nearby.") || k.startsWith("how.nearby"));

/** The legal word rules. "valuation" passes only as "Not a valuation". */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|similar|bargain|rip-off|·|→|←|➜/i;
const clean = (s: string) => !BANNED.test(s) && !/valuation/i.test(s.replace(/Not a valuation/g, "")) && !/\bfair\w*/i.test(s.replace(/Fairsquare/g, ""));

describe("the nearby-registered-sales keys", () => {
  it("are all in DESIGN.md section 6.18, string for string", () => {
    const md = readFileSync(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
    const start = md.indexOf("### 6.18 Nearby registered sales");
    expect(start).toBeGreaterThan(0);
    const section = md.slice(start, md.indexOf("## 7.", start));
    const rows = new Map([...section.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map((m) => [m[1], m[2]]));
    expect([...rows.keys()].sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(rows.get(k), k).toBe(COPY[k]);
    expect(KEYS.length).toBe(95);
  });

  it("never use a word the valuation rules forbid, a middle dot or an arrow; 'fair' only inside Fairsquare", () => {
    for (const k of KEYS) expect(clean(COPY[k]), `${k}: ${COPY[k]}`).toBe(true);
    for (const bad of ["an estimated range", "we predict", "what it is worth", "a fair price", "good value", "the average", "similar buildings", "the model says", "a valuation", "a · b", "a → b"]) {
      expect(clean(bad), bad).toBe(false);
    }
    expect(clean("Not a valuation.")).toBe(true);
  });

  it("the headline is the outcome against the range of nearby sales, in two parts, with no percentage", () => {
    expect(COPY["nearby.headWithin"]).toBe("Within the range of nearby sales");
    expect(COPY["nearby.headAbove"]).toBe("Above the range of nearby sales");
    expect(COPY["nearby.headBelow"]).toBe("Below the range of nearby sales");
    for (const k of ["nearby.headWithin", "nearby.headAbove", "nearby.headBelow"] as const) expect(COPY[k].endsWith(` ${COPY["nearby.headRest"]}`), k).toBe(true);
    for (const k of ["nearby.within", "nearby.above", "nearby.below", "nearby.headWithin", "nearby.headAbove", "nearby.headBelow", "nearby.shareIn", "nearby.shareOut"] as const) expect(COPY[k], k).not.toMatch(/%|\{pct\}/);
  });

  it("say plainly what the building itself has, and that the range comes from other buildings in a named place", () => {
    expect(t("nearby.ownNone", { building: "Test Tower", basis: "ready", bedTypePlural: "2-beds", months: 12, to: "10 Nov 2026" })).toBe("Test Tower has no registered sales of ready 2-beds in the 12 months to 10 Nov 2026.");
    expect(tPlural("nearby.ownFew", 1, { building: "Test Tower", count: 1, basis: "ready", bedTypePlural: "2-beds", months: 12, to: "10 Nov 2026", minSales: 5 })).toBe(
      "Test Tower has 1 registered sale of ready 2-beds in the 12 months to 10 Nov 2026. A comparison needs 5.",
    );
    expect(tPlural("nearby.ownFew", 3, { building: "Test Tower", count: 3, basis: "off-plan", bedTypePlural: "studios", months: 12, to: "10 Nov 2026", minSales: 5 })).toBe(
      "Test Tower has 3 registered sales of off-plan studios in the 12 months to 10 Nov 2026. A comparison needs 5.",
    );
    expect(t("nearby.ownOut", { building: "Test House" })).toBe("Fairsquare could not find “Test House” in Dubai Land Department sales data, so there are no registered sales of this building to compare.");
    expect(t("nearby.fromOthers", { place: "Test Park" })).toBe("The range here comes from other buildings in Test Park, not from this one.");
    expect(t("nearby.placeBoth", { community: "Test Park", area: "Test South" })).toBe("Test Park and the rest of Test South");
    // Wherever the range is worded away from the page, the other buildings and the place are named with it.
    for (const k of ["nearby.intro", "nearby.introAge", "nearby.shareIn", "nearby.shareOut", "nearby.ogDescIn", "nearby.ogDescOut", "nearby.ogAlt", "nearby.cardNoteIn", "nearby.cardNoteOut", "nearby.cardSource", "nearby.cardAlt"] as const) {
      expect(COPY[k], k).toMatch(/other buildings in \{place\}/);
    }
    for (const k of ["nearby.ogLine", "nearby.ogFigures", "nearby.cardLabel", "nearby.cardCaption", "nearby.cardCaptionK", "nearby.legendSale", "nearby.legendSaleK", "nearby.scaleSummary"] as const) {
      expect(COPY[k], k).toMatch(/other buildings?|another building/i);
    }
    // What the building itself has is said with the range in the share text, the preview and the card.
    for (const k of ["nearby.shareIn", "nearby.ogDescIn", "nearby.cardNoteIn"] as const) expect(COPY[k], k).toMatch(/too few registered sales/i);
    for (const k of ["nearby.shareOut", "nearby.ogDescOut", "nearby.cardNoteOut", "nearby.weakOut"] as const) expect(COPY[k], k).toMatch(/DLD sales data/);
  });

  it("the weakness note is plain, and the tested share is a placeholder, never a number in the copy", () => {
    expect(COPY["nearby.weak"]).toBe("These sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below this range.");
    expect(placeholders(COPY["nearby.tested"])).toEqual(["held"]);
    expect(t("nearby.tested", { held: 7 })).toBe("In tests, about 7 of 10 later sale prices were inside a range made this way.");
    expect(placeholders(COPY["how.nearbyTested"])).toEqual(["held"]);
    expect(t("how.nearbyTested", { held: 7 })).toContain("About 7 of 10 of those later sale prices were inside the range.");
    for (const k of KEYS) expect(COPY[k], k).not.toMatch(/\b[0-9] of 10\b/);
    expect(COPY["nearby.weakOut"]).toBe("Fairsquare could not find this building in DLD sales data. Its name may be registered differently.");
    expect(COPY["how.nearbyWeak"]).toMatch(/^This is the weakest comparison Fairsquare makes\./);
    expect(COPY["how.nearbyWeak"]).toMatch(/Not a valuation\.$/);
  });

  it("read as registered sales, a range and never one figure; 'Not a valuation' where the range leaves the page", () => {
    for (const k of ["nearby.intro", "nearby.introAge", "nearby.listH", "nearby.listNote", "nearby.shareIn", "nearby.shareOut", "nearby.ogDescIn", "nearby.ogDescOut", "nearby.ogAlt", "nearby.cardLabel", "nearby.cardSource", "nearby.cardAlt", "nearby.stampSales", "how.nearbyBody"] as const) {
      expect(COPY[k], k).toMatch(/registered sale/i);
    }
    expect(COPY["nearby.range"]).toBe("Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft.");
    for (const k of KEYS) {
      const p = placeholders(COPY[k]);
      if (p.includes("low")) expect(p, k).toContain("high");
      expect(p, k).not.toContain("centre");
      expect(p, k).not.toContain("price");
      expect(p, k).not.toContain("gap");
    }
    for (const k of ["nearby.ogDescIn", "nearby.ogDescOut", "nearby.limits", "how.nearbyWeak"] as const) expect(COPY[k], k).toMatch(/Not a valuation\.$/);
    for (const k of ["nearby.cardSource", "nearby.cardAlt"] as const) expect(COPY[k], k).toMatch(/Not a valuation\./);
    expect(COPY["nearby.notValuation"]).toBe("Not a valuation.");
    // The stamp claims no more than nearby registered sales; capitals only there.
    expect(COPY["nearby.stampSales"]).toBe("AED PER SQ FT, NEARBY REGISTERED SALES");
    const bare = (s: string) => s.replace(/\{[^}]+\}/g, "");
    const caps = KEYS.filter((k) => bare(COPY[k]) === bare(COPY[k]).toUpperCase() && /[A-Z]{2}/.test(bare(COPY[k])));
    expect(caps.sort()).toEqual(["nearby.stampDate", "nearby.stampFigure", "nearby.stampSales", "nearby.stampWithin"]);
    expect(t("nearby.stampFigure", { low: "990", high: "1,770" })).toBe("990 TO 1,770");
  });

  it("word the list, the plurals and the Saved line", () => {
    expect(tPlural("nearby.listH", 134, { n: 134 })).toBe("The 134 registered sales used");
    expect(tPlural("nearby.listH", 1, { n: 1 })).toBe("The registered sale used");
    expect(tPlural("nearby.buildingsH", 10, { k: 10 })).toBe("The 10 buildings they are in");
    expect(tPlural("nearby.buildingsH", 1, { k: 1 })).toBe("The building they are in");
    expect(t("nearby.rowRegistered", { date: "3 Nov 2026", size: "1,304", psf: "1,277" })).toBe("3 Nov 2026: 1,304 sq ft at AED 1,277 per sq ft");
    expect(t("nearby.readout", { building: "Test Court 1", date: "3 Nov 2026", size: "1,304", psf: "1,277", adjusted: "1,210" })).toBe("Test Court 1, 3 Nov 2026: 1,304 sq ft at AED 1,277 per sq ft. Adjusted: AED 1,210 per sq ft.");
    expect(t("nearby.saved", { date: "3 Nov 2026", position: "above" })).toBe("Saved 3 Nov 2026: above the range of nearby sales.");
    expect(COPY["nearby.pick"]).toBe("Find the building in DLD data");
  });

  it("the second tier's page no longer says a building that is not in the data gets no comparison at all", () => {
    expect(COPY["how.similarBody"]).toMatch(/gets a range of this kind only in the one case below\.$/);
    expect(COPY["how.similarProject"]).toMatch(/^A building that is not in DLD sales data gets no range of this kind, with one exception\./);
  });
});
