/**
 * The adjusted-registered-sales copy (DESIGN.md section 6.17, REAL_DATA.md section 16): the keys,
 * their mirror in DESIGN.md and the words the valuation rules forbid. tests/unit/copy.test.ts checks
 * the whole deck's mirror; this file pins this answer's wording.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COPY, placeholders, t, tPlural, type CopyKey } from "@/lib/copy";

const KEYS = (Object.keys(COPY) as CopyKey[]).filter((k) => k.startsWith("acs.") || k.startsWith("how.acs"));

/** The legal word rules. "valuation" passes only as "Not a valuation". */
const BANNED =
  /estimat|forecast|predict|\bworth\b|\bvalues?\b|\bvalued\b|fair price|overpriced|underpriced|\bdeals?\b|checked|verified|approved|certified|average|outlier|trimmed|percentile|\bmodels?\b|similar|bargain|rip-off|·|→/i;
const clean = (s: string) => !BANNED.test(s) && !/valuation/i.test(s.replace(/Not a valuation/g, "")) && !/\bfair\w*/i.test(s.replace(/Fairsquare/g, ""));

describe("the adjusted-registered-sales keys", () => {
  it("are all in DESIGN.md section 6.17, string for string", () => {
    const md = readFileSync(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
    const start = md.indexOf("### 6.17 Adjusted registered sales");
    expect(start).toBeGreaterThan(0);
    const section = md.slice(start, md.indexOf("### 6.18", start));
    const rows = new Map([...section.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map((m) => [m[1], m[2]]));
    expect([...rows.keys()].sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(rows.get(k), k).toBe(COPY[k]);
    expect(KEYS.length).toBe(102);
  });

  it("never use a word the valuation rules forbid, a middle dot or an arrow; 'fair' only inside Fairsquare", () => {
    for (const k of KEYS) expect(clean(COPY[k]), `${k}: ${COPY[k]}`).toBe(true);
    for (const bad of ["an estimated range", "we predict", "what it is worth", "a fair price", "good value", "the average", "similar sales", "the model says", "a valuation", "a · b", "a → b"]) {
      expect(clean(bad), bad).toBe(false);
    }
    expect(clean("Not a valuation.")).toBe(true);
  });

  it("read as registered sales adjusted to the listing, never as a price Fairsquare states", () => {
    expect(COPY["acs.h"]).toBe("Registered sales, adjusted to this listing");
    for (const k of ["acs.h", "acs.intro", "acs.introProject", "acs.listShow", "acs.listNote", "acs.share", "acs.ogDesc", "acs.ogLine", "acs.ogAlt", "acs.cardLabel", "how.acsH", "how.acsBody"] as const) {
      expect(COPY[k], k).toMatch(/registered sale/i);
    }
    // The range is what the sales point to; no key gives one figure for the listing.
    // It says a range the sales point to, and never "for this listing": that would read as a price for the unit.
    expect(COPY["acs.range"]).toBe("Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft.");
    for (const k of KEYS) {
      const p = placeholders(COPY[k]);
      if (p.includes("low")) expect(p, k).toContain("high");
      expect(p, k).not.toContain("centre");
      expect(p, k).not.toContain("price");
    }
    // The outcome is in words, against the range: no percentage above or below.
    for (const k of ["acs.within", "acs.above", "acs.below", "acs.headWithin", "acs.headAbove", "acs.headBelow"] as const) expect(COPY[k], k).not.toMatch(/%|\{pct\}/);
    // What is and is not adjusted, and the closing line.
    for (const k of ["acs.limits", "how.acsLimits"] as const) {
      // A sale of another bedroom type is adjusted for bedrooms too, and the line says so.
      expect(COPY[k], k).toMatch(/^The adjustments are for date, size and, for a sale of another bedroom type, bedrooms\. Floor, view and condition are not in DLD sales data/);
      expect(COPY[k], k).toMatch(/Not a valuation\.$/);
    }
    for (const k of ["acs.share", "acs.shareProject", "acs.ogDesc"] as const) expect(COPY[k], k).toMatch(/Not a valuation\.$/);
    // No sentence says "date and size" alone for the whole answer, or "tower" for a building.
    for (const k of ["acs.share", "acs.shareProject", "acs.ogDesc", "acs.cardCaption", "acs.cardCaptionK", "acs.cardCaptionRows", "acs.cardAlt", "acs.announce"] as const) {
      expect(COPY[k], k).not.toMatch(/date and size|tower/i);
    }
    // The size relation is not "this building's own sales" alone: it is said as it is done.
    for (const k of ["acs.howSize", "how.acsBody"] as const) {
      expect(COPY[k], k).toMatch(/together with Dubai's registered sales of that type/);
      expect(COPY[k], k).toMatch(/usual step between bedroom types/);
    }
    // Sales of other buildings of the project are named wherever they are used.
    for (const k of ["acs.introProject", "acs.shareProject", "acs.fewLeadProject"] as const) expect(COPY[k], k).toMatch(/and in other buildings of its project/);
    expect(COPY["acs.cardSourceProject"]).toMatch(/^Registered sales in this building and its project, \{from\} to \{to\}, each adjusted to \{date\}\./);
    // The asking price past every adjusted sale: said in figures.
    expect(t("acs.beyondHigh", { n: 12, psf: "1,786" })).toBe("It is higher than all 12 adjusted sales; the highest is AED 1,786 per sq ft.");
    expect(t("acs.beyondLow", { n: 12, psf: "1,716" })).toBe("It is lower than all 12 adjusted sales; the lowest is AED 1,716 per sq ft.");
  });

  it("the interface's keys: the headline splits into hue and ink, the tested share is short and exact, capitals only on the stamp", () => {
    for (const k of ["acs.headWithin", "acs.headAbove", "acs.headBelow"] as const) expect(COPY[k].endsWith(` ${COPY["acs.headRest"]}`), k).toBe(true);
    expect(t("acs.testedShort", { held: 8 })).toBe("In tests, about 8 of 10 later sale prices were inside a range made this way.");
    expect(t("acs.fewLead", { minSales: 5, months: 12 })).toBe(
      "A median needs 5 sales in 12 months, so there is none here. The range below comes from this building's registered sales of three years, each adjusted to this listing.",
    );
    const bare = (s: string) => s.replace(/\{[^}]+\}/g, "");
    const caps = KEYS.filter((k) => bare(COPY[k]) === bare(COPY[k]).toUpperCase() && /[A-Z]{2}/.test(bare(COPY[k])));
    expect(caps.sort()).toEqual(["acs.stampDate", "acs.stampFigure", "acs.stampSales", "acs.stampWithin"]);
    expect(t("acs.stampFigure", { low: "1,550", high: "1,970" })).toBe("1,550 TO 1,970");
    // The size note says what was done and what is less exact; it never says the size is wrong.
    for (const k of ["acs.sizeLarger", "acs.sizeSmaller"] as const) expect(COPY[k]).toMatch(/Each sale was adjusted for size; that adjustment is less exact this far from the usual size\.$/);
    for (const k of ["acs.cardSource", "acs.cardAlt"] as const) expect(COPY[k]).toMatch(/Not a valuation\./);
    expect(tPlural("acs.listH", 12, { n: 12 })).toBe("The 12 registered sales used");
    expect(tPlural("acs.listH", 1, { n: 1 })).toBe("The registered sale used");
  });

  it("word the three kinds of row the same-building list never had", () => {
    expect(t("acs.rowOtherBeds", { bedType: "1-bed" })).toBe("1-bed in this building");
    expect(t("acs.rowProject", { building: "Test Park Tower 1" })).toBe("Test Park Tower 1, same project");
    expect(t("acs.rowBatch", { n: 5 })).toBe("5 apartments registered at one price per sq ft. The size is their median.");
    expect(t("acs.rowSame", { n: 2 })).toBe("2 sales registered with the same date, size and price.");
    expect(tPlural("acs.srcOwn", 1, { n: 1, bedTypePlural: "2-beds" })).toBe("1 sale of 2-beds in this building");
    expect(tPlural("acs.srcOwn", 11, { n: 11, bedTypePlural: "2-beds" })).toBe("11 sales of 2-beds in this building");
    expect(tPlural("acs.srcOtherBeds", 3, { n: 3 })).toBe("3 sales of other bedroom types in this building");
    expect(tPlural("acs.srcProject", 1, { n: 1 })).toBe("1 sale in another building of the project");
    expect(tPlural("acs.listShow", 14, { n: 14 })).toBe("See the 14 registered sales used");
    expect(t("acs.adjUp", { pct: "3.1" })).toBe("up 3.1%");
    expect(t("acs.adjDown", { pct: "0.5" })).toBe("down 0.5%");
  });

  it("state the test as it was run: about {held} of 10 later sale prices inside the range", () => {
    for (const k of ["acs.tested", "how.acsTested"] as const) {
      expect(placeholders(COPY[k]), k).toEqual(["held"]);
      expect(t(k, { held: 8 }), k).toContain("About 8 of 10 of those later sale prices were inside the range.");
    }
    // The one-sided misses after prices fell are said, not hidden (REAL_DATA.md section 16.8).
    expect(COPY["how.acsTested"]).toMatch(/After prices fall, more of the later sales are under the range than over it\.$/);
  });
});
