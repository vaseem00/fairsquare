import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_CHECK_JVC,
  FIXTURE_CHECK_MARINA,
  FIXTURE_CHECK_NONE,
  FIXTURE_CHECK_OFFPLAN,
  FIXTURE_CHECK_THIN,
  buildFixtureCheck,
} from "../fixtures/api-fixtures";
import {
  COPY,
  ERROR_COPY,
  FIELD_ERRORS,
  OUTCOME_COPY,
  addedSalesNote,
  areaLabel,
  attributionParts,
  attributionText,
  bandLabel,
  basisWord,
  buildingLabel,
  cardAlt,
  consentFor,
  costRow,
  howBody,
  ogAlt,
  ogDescription,
  ogTitle,
  outliersNote,
  placeholders,
  provenanceLine,
  rateLimitMessage,
  readSlowText,
  ruleVars,
  salesAdj,
  salesNoun,
  salesShownNote,
  shareFileName,
  shareText,
  sizeNote,
  sizeText,
  stampProps,
  staleNote,
  t,
  tList,
  tPlural,
  listingType,
  verdictAnnouncement,
  verdictHeadText,
  verdictSentence,
  type CopyKey,
} from "@/lib/copy";
import { analyseWith } from "@/lib/domain/analyse";
import type { CheckView } from "@/lib/types";
import { CheckViewSchema, ERROR_CODES } from "@/lib/validation/api";

/** The text of DESIGN.md section 6, the copy deck that copy.ts mirrors. */
function designDeck(): string {
  const md = readFileSync(path.join(process.cwd(), "docs", "DESIGN.md"), "utf8");
  const start = md.indexOf("## 6. Copy deck");
  const end = md.indexOf("## 7.", start);
  expect(start).toBeGreaterThan(0);
  return md.slice(start, end);
}

/** Keys in the DESIGN.md section 6 tables (lines like "| `nav.compare` | Compare |"). */
function designKeys(): string[] {
  const keys = [...designDeck().matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
  return [...new Set(keys)];
}

/**
 * Keys REAL_DATA.md section 8 removed with the demo: "every 'demo' string in copy.ts", the sample
 * notice and labels, the demo consent, partner, stamp, card and OG labels, the admin demo checkbox
 * and the CSV is_demo column. They are gone from copy.ts and from the DESIGN.md section 6 deck.
 */
const REMOVED_BY_REAL_DATA = [
  "demo.badgeShort",
  "demo.badge",
  "footer.demo",
  "home.demoLine",
  "details.source.sample",
  "result.source.demo",
  "result.salesCaption.demo",
  "sample.notice",
  "lead.partnerDemo",
  "consent.v1demo",
  "lead.sampleOff",
  "coverage.demo",
  "how.dataDemo",
  "c.ogDescDemo",
  "admin.demoNotice",
  "admin.demoSale",
  // The sample chips and the fictional example card (REAL_DATA.md sections 8 and 10).
  "home.samplesLabel",
  "home.samples",
  "home.exampleCaption",
  "home.exampleSentence",
  "home.exampleAlt",
];

/**
 * Keys docs/REDESIGN.md section 9 retired: with the home page (stage A) the numbered "How it works",
 * the scope line, the Kbd drop hint and the label-value list in "From the data"; with the processing
 * scene (stage B) the stepper ("Step 2 of 3"), "Preparing your screenshot" (one caption for the
 * downscale and the read), "Read. Check the details." (no form after a read) and the "Compared with
 * 11 registered sales" heading (the verdict headline replaces it).
 */
const REMOVED_BY_REDESIGN = [
  "home.howH2",
  "home.how1",
  "home.how2",
  "home.how3",
  "home.scope",
  "home.dropHint",
  "home.dataLead",
  "home.dataMedian",
  "home.dataSales",
  "home.dataSalesValue",
  "step.progress",
  "step.names",
  "step.progressLabel",
  "read.preparing",
  "read.done",
  "result.h2",
];

/**
 * Keys the rename to Fairsquare retired (18 Nov 2026): the Arabic name of the old brand in the logo
 * lockup and its footer gloss. The product has an English name only.
 */
const REMOVED_BY_RENAME = ["app.nameAr", "footer.gloss"];

/** The product name as written in sentences, and in capitals on the stamp. */
const BRAND = "Fairsquare";
const BRAND_CAPS = "FAIRSQUARE";

const ADDED_PREFIXES = ["apiError.", "stamp.", "card.", "og.", "adminUi."];
const ADDED_KEYS = [
  "app.name",
  "app.description",
  "err.date",
  "result.colDate",
  "result.colSize",
  "result.colPrice",
  "result.colPsf",
  "result.rowPsf",
  "adminUi.salesTabSelect",
  "thin.bodyZero",
  "none.doneAlone",
  "share.textNone",
  "cost.downLess",
  "cost.downMore",
  "saved.recoveryFailed",
  "saved.recoveryConfirm",
  "saved.recoveryReplace",
  "saved.recoveryKeep",
  "privacy.howLongH2",
  "c.ogTitleThin",
  "c.ogTitleNone",
  "c.ogAltThin",
  "c.ogAltNone",
  // WP8 shell, Saved, Coverage and Privacy (BUILD_PLAN WP8)
  "nav.home",
  "nav.compareLong",
  "ui.close",
  "saved.itemDetail",
  "saved.dataChecks",
  "saved.dataSaved",
  "saved.dataRequests",
  "saved.dataLeads",
  "coverage.colTypes",
  "coverage.colLatest",
  "coverage.colStatus",
  "coverage.latestNone",
  "coverage.noMatchBody",
  "privacy.colData",
  "privacy.colWhy",
  "privacy.why",
  "privacy.keep",
  // WP7 How it works and the share page (BUILD_PLAN WP7)
  "how.tocLabel",
  "how.ruleTerms",
  "how.ruleDetails",
  "c.todayThin",
  // Integration (BUILD_PLAN §6)
  "lead.errDown",
  // WP6 compare flow (BUILD_PLAN WP6)
  "home.kbdCtrl",
  "home.kbdCmd",
  "home.kbdV",
  "read.announce",
  "details.source.text",
  "field.bedroomsPlaceholder",
  "field.aed",
  "field.sqft",
  "pick.typeToMatch",
  "pick.noMatch",
  "pick.bedWords",
  "pick.searchChosen",
  // Real data (REAL_DATA.md sections 7 to 10)
  "result.basis.ready",
  "result.basis.off_plan",
  "result.outliers",
  "result.sizeLarger",
  "result.sizeSmaller",
  "data.stale",
  "data.loading",
  "data.runsTo",
  "data.attribution",
  "data.dataset",
  "data.licence",
  "data.independent",
  "lead.unavailable",
  // Real data, UI stage (REAL_DATA.md sections 6 to 11)
  "area.withDld",
  "home.dataH2",
  "home.dataLink",
  "coverage.window",
  "coverage.searchHelp",
  "coverage.counts",
  "coverage.colReady",
  "coverage.colOffPlan",
  "coverage.showing",
  "coverage.pages",
  "coverage.prev",
  "coverage.next",
  "coverage.loadFailed",
  "how.dataIncluded",
  "how.dataBasis",
  "how.dataDifc",
  "how.dataSizes",
  "how.dataRefresh",
  "privacy.howLongNoPartner",
  "privacy.whoNoPartner",
  "privacy.choicesNoPartner",
  "confirm.delete.bodyNoPartner",
  // Real data, integration (REAL_DATA.md section 6: both area names on the result and /c pages;
  // section 7: the person marks an off-plan listing in step 2)
  "result.building",
  "field.offPlan",
  "field.offPlanHelp",
  // Real data, review fixes: sales Fairsquare added are never credited to the DLD (section 9), and a list
  // that stores the newest SNAPSHOT_MAX of more sales says so.
  "result.addedByUs",
  "result.addedSome",
  "result.addedAll",
  "result.salesShown",
];

const allBuilders = (c: CheckView) => [
  verdictSentence(c),
  verdictSentence(c, 6),
  provenanceLine(c),
  JSON.stringify(stampProps(c)),
  shareText(c),
  ogTitle(c),
  ogDescription(c),
  ogAlt(c),
  cardAlt(c) ?? "",
  verdictHeadText(c),
];
const FIXTURES = [FIXTURE_CHECK_MARINA, FIXTURE_CHECK_JVC, FIXTURE_CHECK_THIN, FIXTURE_CHECK_NONE, FIXTURE_CHECK_OFFPLAN];

describe("copy deck coverage", () => {
  it("has every key in DESIGN.md section 6; the keys REAL_DATA.md removed are in neither", () => {
    const keys = designKeys();
    expect(keys.length).toBeGreaterThan(300);
    expect(keys.filter((k) => !(k in COPY))).toEqual([]);
    expect(REMOVED_BY_REAL_DATA.filter((k) => keys.includes(k))).toEqual([]);
    expect(REMOVED_BY_REAL_DATA.filter((k) => k in COPY)).toEqual([]);
  });

  it("the keys the redesign retired are in neither copy.ts nor DESIGN.md section 6; its new keys are in both (REDESIGN.md section 9)", () => {
    const keys = new Set(designKeys());
    expect(REMOVED_BY_REDESIGN.filter((k) => keys.has(k))).toEqual([]);
    expect(REMOVED_BY_REDESIGN.filter((k) => k in COPY)).toEqual([]);
    const added = ["home.dropScale", "home.pasteKeys", "home.dataSentence", "home.dataRange", "result.headAbove", "how.figCaption"];
    expect(added.filter((k) => !keys.has(k) || !(k in COPY))).toEqual([]);
    expect(COPY["home.h1"]).toBe("Weigh the asking price.");
    expect(COPY["home.choose"]).toBe("Add a screenshot");
    // "Weigh" only in the headline and the weighing caption: buttons, nav and the stamp say compare.
    const weigh = Object.entries(COPY).filter(([, v]) => /\bweigh/i.test(v)).map(([k]) => k);
    expect(weigh.sort()).toEqual(["home.h1", "scene.weighing"]);
  });

  it("DESIGN.md section 6 is an exact mirror: every row's string is the copy.ts value", () => {
    const rows = [...designDeck().matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].map((m) => [m[1], m[2]] as const);
    expect(rows.length).toBeGreaterThan(300);
    const differ = rows.filter(([k, v]) => (COPY as Record<string, string>)[k] !== v).map(([k]) => k);
    expect(differ).toEqual([]);
  });

  it("DESIGN.md section 6 documents the real-data keys", () => {
    const keys = new Set(designKeys());
    const realData = ["data.attribution", "data.independent", "data.stale", "data.loading", "home.dataH2", "area.withDld", "result.building", "field.offPlan", "lead.unavailable", "coverage.window"];
    expect(realData.filter((k) => !keys.has(k))).toEqual([]);
  });

  it("holds no demo, sample or fictional wording, and no fictional building, area label or partner (REAL_DATA.md section 8)", () => {
    for (const [key, value] of Object.entries(COPY)) {
      expect(/\bdemo\b|fictional|made-up|sample/i.test(`${key} ${value}`), key).toBe(false);
      expect(/Marina Crest|Palm Vista|Creekside|Al Jaddaf|Harbour Point|Mortgage Partner|Sara\b/i.test(value), key).toBe(false);
    }
    expect(COPY["home.pastePlaceholder"]).toBe("Building name, 2BR, 1284 sqft, AED 2.45M");
  });

  it("adds only documented keys", () => {
    const design = new Set(designKeys());
    const extra = Object.keys(COPY).filter((k) => !design.has(k));
    const undocumented = extra.filter((k) => !ADDED_KEYS.includes(k) && !ADDED_PREFIXES.some((p) => k.startsWith(p)));
    expect(undocumented).toEqual([]);
  });

  it("has an apiError key for every server-only error code", () => {
    for (const code of ERROR_CODES) expect(ERROR_COPY[code]).toBeTruthy();
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe("the product name: Fairsquare (the rename of 18 Nov 2026)", () => {
  /** A string with every brand token taken out, so what is left can be checked for the word "fair". */
  const withoutBrand = (s: string) => s.replace(/fairsquare/gi, "");
  /** "fair" as a word of its own: fair, fairly, fairness, unfair (but not "affair"). */
  const FAIR_WORD = /\b(un)?fair\w*/i;

  it("the retired Arabic name keys are in neither copy.ts nor DESIGN.md section 6", () => {
    const keys = new Set(designKeys());
    expect(REMOVED_BY_RENAME.filter((k) => keys.has(k))).toEqual([]);
    expect(REMOVED_BY_RENAME.filter((k) => k in COPY)).toEqual([]);
  });

  it("no deck string, builder output or DESIGN.md section 6 row names the old brand or holds Arabic script", () => {
    /** True when `s` holds a character of the Arabic block (U+0600 to U+06FF). */
    const hasArabic = (s: string) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) >= 0x600 && (ch.codePointAt(0) ?? 0) <= 0x6ff);
    expect(hasArabic("ميزان")).toBe(true);
    for (const [key, value] of Object.entries(COPY)) {
      expect(/mizan/i.test(value), `${key}: ${value}`).toBe(false);
      expect(value.includes("ميزان"), key).toBe(false);
      expect(hasArabic(value), key).toBe(false);
    }
    for (const c of FIXTURES) {
      for (const out of allBuilders(c)) {
        expect(out).not.toMatch(/mizan/i);
        expect(hasArabic(out), out).toBe(false);
      }
      expect(shareFileName(c)).not.toMatch(/mizan/i);
    }
    expect(designDeck()).not.toMatch(/mizan/i);
    expect(hasArabic(designDeck())).toBe(false);
  });

  it("'fair' appears only inside the brand name, never about a price, value or deal", () => {
    for (const [key, value] of Object.entries(COPY)) {
      expect(FAIR_WORD.test(withoutBrand(value)), `${key}: ${value}`).toBe(false);
    }
    for (const c of FIXTURES) {
      for (const out of allBuilders(c)) expect(FAIR_WORD.test(withoutBrand(out)), out).toBe(false);
    }
    // The guard itself catches the phrases the valuation rules forbid.
    for (const bad of ["a fair price", "Fairly priced", "fair value", "a fair deal", "fair market value", "unfair"]) {
      expect(FAIR_WORD.test(withoutBrand(bad)), bad).toBe(true);
    }
    expect(FAIR_WORD.test(withoutBrand(`Compared on ${BRAND}`))).toBe(false);
  });

  it("writes the name one way: Fairsquare in sentences, FAIRSQUARE on the stamp, lowercase only in file names", () => {
    expect(COPY["app.name"]).toBe(BRAND);
    expect(COPY["og.brand"]).toBe(BRAND);
    expect(COPY["nav.home"]).toBe(`${BRAND} home`);
    expect(COPY["admin.title"]).toBe(`${BRAND} admin`);
    expect(COPY["stamp.brand"]).toBe(BRAND_CAPS);
    expect(COPY["share.fileName"]).toBe("fairsquare-{building-slug}-{code}.png");
    for (const [key, value] of Object.entries(COPY)) {
      const allowed = key === "stamp.brand" ? [BRAND_CAPS] : key === "share.fileName" ? ["fairsquare"] : [BRAND];
      for (const m of value.match(/fair\s*square/gi) ?? []) expect(allowed, `${key}: "${m}"`).toContain(m);
    }
    // The independence and not-a-valuation lines keep their wording with the new name.
    expect(COPY["data.independent"]).toBe(
      `${BRAND} is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.`,
    );
    expect(COPY["footer.notValuation"]).toBe(
      `${BRAND} compares asking prices with registered sales. It is not a valuation and not financial advice.`,
    );
  });
});

describe("t()", () => {
  it("fills placeholders", () => {
    expect(t("result.headAbove", { pct: "14.3" })).toBe("14.3% above");
    expect(t("home.pasteKeys", { keys: "Ctrl V" })).toBe("or paste it with Ctrl V");
    expect(t("nav.compare")).toBe("Compare");
    expect(placeholders(COPY["share.text"])).toContain("above/below");
  });

  it("throws on a missing placeholder", () => {
    expect(() => t("home.dataRange", { from: "5 Jan 2026" })).toThrow(/missing placeholder \{to\}/);
    expect(() => t("lead.send")).toThrow(/PARTNER_NAME/);
  });

  it("throws on an unknown key", () => {
    expect(() => t("nope.nope" as CopyKey)).toThrow(/unknown key/);
  });

  it("lists and plurals", () => {
    expect(tList("theme.options")).toEqual(["Light", "Dark", "System"]);
    expect(tList("field.bedroomsOptions")).toHaveLength(8);
    expect(tList("how.rules")).toHaveLength(6);
    expect(tPlural("saved.newSales", 1)).toBe("1 new sale");
    expect(tPlural("saved.newSales", 3)).toBe("3 new sales");
    expect(tPlural("nav.compare", 2)).toBe("Compare");
  });
});

describe("never-write words (DESIGN.md section 6)", () => {
  const BANNED = [
    /overpriced/i,
    /underpriced/i,
    /good deal/i,
    /bargain/i,
    /fair price/i,
    /fairly priced/i,
    /rip-off/i,
    /verified/i,
    /\bapproved\b/i,
    /·/,
    /→/,
  ];

  /** The deck's own "For a valuation, ask a RERA-certified valuer." is the one sanctioned use. */
  const scrub = (s: string) => s.replace("For a valuation, ask a RERA-certified valuer.", "");

  it("appear in no deck string", () => {
    for (const [key, value] of Object.entries(COPY)) {
      const s = scrub(value);
      for (const re of BANNED) expect(re.test(s), `${key}: ${re}`).toBe(false);
      expect(/certified/i.test(s), key).toBe(false);
      // "valuation" only as "not a valuation"
      expect(/valuation/i.test(s.replace(/not a valuation/gi, "")), key).toBe(false);
    }
  });

  it("appear in no builder output", () => {
    for (const c of FIXTURES) {
      for (const out of allBuilders(c)) {
        for (const re of BANNED) expect(re.test(out), `${c.code}: ${out}`).toBe(false);
        expect(/checked/i.test(out)).toBe(false);
      }
    }
  });

  it("every comparison speaks of registered sales, never demo or fictional ones (REAL_DATA.md section 9)", () => {
    for (const c of FIXTURES) {
      for (const out of allBuilders(c)) expect(out).not.toMatch(/demo|fictional/i);
      // Not covered has no count: its og:description never reads as "0 registered sales".
      if (c.analysis.band === "none") expect(ogDescription(c)).toBe(COPY["c.ogDescNone"]);
      else expect(ogDescription(c)).toContain("registered sales");
    }
    expect(salesNoun()).toBe("registered sales");
    expect(salesAdj()).toBe("registered");
  });
});

/** RESULT_SPEC section 10: the result section's new keys (all in DESIGN.md section 6.15 too). */
const RESULT_KEYS = [
  "read.slowFallback",
  "share.recent",
  "share.source",
  "fact.line1",
  "fact.line2",
  "fact.line2NoBasis",
  "fact.sizeAbout",
  "fact.edit",
  "fact.editSr",
  "scene.statusMatch",
  "scene.statusSales",
  "result.gapAbove",
  "result.gapBelow",
  "result.gapZero",
  "result.aboveAll",
  "result.belowAll",
  "result.recentLower",
  "result.recentHigher",
  "result.premiumLink",
  "result.listingCheck",
  "result.howToCheck",
  "result.howToCheckSteps",
  "evidence.line",
  "evidence.strong",
  "evidence.moderate",
  "evidence.limited",
  "evidence.defStrong",
  "evidence.defHere",
  "evidence.defModerate",
  "evidence.defLimited",
  "evidence.defCounts",
  "evidence.setAsideNone",
  "evidence.setAsideN",
  "evidence.wrongBuilding",
  "evidence.thinLine",
  "scale.title",
  "scale.summary",
  "scale.summaryRecent",
  "scale.unit",
  "scale.unitOffPlan",
  "scale.recent",
  "scale.older",
  "scale.band",
  "scale.median",
  "scale.stampAsking",
  "scale.readout",
  "scale.readoutQuantile",
  "scale.quantile",
  "list.h",
  "list.newest",
  "list.byPsf",
  "list.colDate",
  "list.sameSize3",
  "list.sameSize1",
  "list.sameSizeTag",
  "list.setAsideTag",
  "list.showAll",
  "offer.h",
  "offer.spread",
  "offer.premium",
  "offer.ask",
  "offer.items",
  "ask.sizeCommon",
  "ask.sizeChip",
  "ask.sizeChipSales",
  "ask.sizeOr",
  "ask.completionH",
  "ask.completionOptions",
  "edit.h",
  "edit.typeAll",
  "share.more",
  "share.image",
  "share.copyText",
  "card.compared",
  "card.asking",
  "card.median",
  "card.recent",
  "card.dots",
  "card.source",
  "card.link",
  "c.ogVerdictAbove",
  "c.ogVerdictBelow",
  "c.ogVerdictInline",
  "c.ogRecentLower",
  "c.ogRecentHigher",
  "offplan.mismatch",
  "offplan.compareReady",
  "provenance.basis",
  "provenance.lag",
] as const;

/** The owner's listing, FYZ79D (tests/fixtures/aykon-check.json, real DLD sales). */
const AYKON: CheckView = CheckViewSchema.parse(
  (JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "aykon-check.json"), "utf8")) as { check: unknown }).check,
);
function aykonAsking(priceAed: number): CheckView {
  const { analysis } = analyseWith(priceAed, AYKON.sizeSqft, AYKON.sales, AYKON.rules);
  return { ...AYKON, priceAed, analysis: { ...AYKON.analysis, ...analysis } };
}

/**
 * Keys the result section retired (RESULT_SPEC section 10): with the read line; with /c on the market
 * scale, the gap sentence and the sales list; with the stamped sheet, the trim dialog, the old sales
 * strip and table, the plate card and the old OG sentences; and the stamp's COMPARED and READY.
 */
const REMOVED_BY_RESULT = [
  "result.readImage",
  "result.readText",
  "result.readTyped",
  "result.readBody",
  "result.readCompared",
  "read.blank",
  "result.sub",
  "result.salesRange",
  "result.chartBand",
  "result.chartMedian",
  "result.chartListing",
  "result.chartAxis",
  "result.chartSummary",
  "result.chartSummaryNewest",
  "c.sentence",
  "c.sentenceInline",
  "c.salesTrigger",
  "result.expand",
  "result.sheetAlt",
  "result.plateAlt",
  "result.plateStamp",
  "result.plateStampThin",
  "result.plateStampNone",
  "result.contactTip",
  "result.contactAction",
  "result.trimLabel",
  "result.salesH3",
  "result.salesCaption.live",
  "result.thisListing",
  "result.newSale",
  "result.rowDetail",
  "result.caveat",
  "share.preparing",
  "share.title",
  "share.linkLabel",
  "card.plateTitle",
  "card.plateBeds",
  "card.lineVerdict",
  "card.lineInline",
  "card.lineThin",
  "card.line2",
  "card.line2NoMedian",
  "card.line3",
  "card.line4",
  "card.trimLess",
  "card.trimMore",
  "card.trimValue",
  "card.trimDone",
  "og.sentenceVerdict",
  "og.sentenceInline",
  "og.sentenceThin",
  "og.footer",
  "stamp.header",
  "stamp.ready",
];

/** Strings the result needs beyond the section 10 table (DESIGN.md section 6.15, last rows). */
const RESULT_KEYS_EXTRA = [
  "fact.line1NoArea",
  "thin.notHighLow",
  "none.noMatch",
  "share.openCard",
  "result.howToCheckLink",
  "list.sortLabel",
  "list.colNote",
  "edit.size",
  "edit.price",
  "edit.completion",
  "edit.viewScreenshot",
  "share.textCopied",
  "card.listing",
  "card.askingLabel",
  "card.recentLower",
  "card.recentHigher",
  "card.found",
  "card.foundValue",
  "card.thinLine",
  "card.thinZero",
  "card.linkOnly",
  "card.alt",
  "card.altThin",
  "og.listing",
  "og.figures",
  "og.figuresThin",
  "og.recent",
  "og.source",
  "stamp.inLine",
  "stamp.above",
  "stamp.below",
  "stamp.tooFew",
  // Review fixes: the settle announcement, the quantile and no-recent variants of the card caption and
  // the chart summary, the zero-sales share text and the not-covered og:description.
  "result.announce",
  "result.announceSame",
  "scale.summaryQuantile",
  "scale.summaryRecentQuantile",
  "card.dotsNoRecent",
  "card.dotsQuantile",
  "card.dotsQuantileNoRecent",
  "share.textThinZero",
  "c.ogDescNone",
] as const;

describe("the result copy deck (RESULT_SPEC section 10)", () => {
  it("every new key is in copy.ts and DESIGN.md section 6", () => {
    const keys = new Set(designKeys());
    expect(RESULT_KEYS.filter((k) => !(k in COPY))).toEqual([]);
    expect(RESULT_KEYS.filter((k) => !keys.has(k))).toEqual([]);
    expect(RESULT_KEYS_EXTRA.filter((k) => !(k in COPY) || !keys.has(k))).toEqual([]);
  });

  it("the retired keys (the read line, the stamped sheet, the old card, strip and /c sentences) are in neither copy.ts nor DESIGN.md section 6", () => {
    const keys = new Set(designKeys());
    expect(REMOVED_BY_RESULT.filter((k) => keys.has(k))).toEqual([]);
    expect(REMOVED_BY_RESULT.filter((k) => k in COPY)).toEqual([]);
  });

  it("the extra result strings follow the same rules", () => {
    const BANNED = /checked|verified|approved|fair price|\bworth\b|\bvalues?\b|overpriced|\bdeals?\b|estimat|forecast|average|outlier|trimmed|percentile|·|→/i;
    for (const k of RESULT_KEYS_EXTRA) {
      expect(BANNED.test(COPY[k]), `${k}: ${COPY[k]}`).toBe(false);
      expect(/valuation/i.test(COPY[k].replace(/not a valuation/gi, "")), k).toBe(false);
      expect(/\bfair\b/i.test(COPY[k].replace(/fairsquare/gi, "")), k).toBe(false);
    }
    // The card and the OG image keep the source and "Not a valuation" (RESULT_SPEC section 12.4).
    expect(COPY["card.source"]).toContain("DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD.");
    expect(COPY["og.source"]).toBe("DLD open data via Data.Dubai. Data to {date}. Not a valuation.");
  });

  it("the card's text alternative and the verdict as one string", () => {
    expect(cardAlt(AYKON)).toBe(
      "Fairsquare comparison card. Aykon City Tower C, ready 2-bed, 812 sq ft, asking AED 1,450,000. In line with registered sales. Asking AED 1,786 per sq ft, median of 43 sales AED 1,761 per sq ft. Not a valuation.",
    );
    expect(cardAlt(FIXTURE_CHECK_NONE)).toBeNull();
    expect(verdictHeadText(aykonAsking(1_650_000))).toBe("15.4% above registered sales");
    expect(verdictHeadText(FIXTURE_CHECK_THIN)).toBe("Too few sales to compare yet");
    expect(tPlural("card.thinLine", 4, { basis: "ready", bedTypePlural: "3-beds", months: 12 })).toBe(
      "Only 4 registered sales of ready 3-beds in this building in 12 months.",
    );
    expect(tPlural("card.thinLine", 1, { basis: "ready", bedTypePlural: "3-beds", months: 12 })).toBe(
      "Only 1 registered sale of ready 3-beds in this building in 12 months.",
    );
  });

  it("the changed values", () => {
    expect(COPY["result.headRest"]).toBe("registered sales");
    expect(COPY["result.headInlineRest"]).toBe("with registered sales");
    expect(COPY["c.ogTitle"]).toBe("{building} {bedType}: {verdictPhrase}");
    expect(COPY["c.ogDescLive"]).toBe("{count} registered sales in {months} months. {recentShort}Not a valuation.");
    expect(t("read.slow", { s: 9 })).toBe("Still reading. This usually takes about 9 seconds.");
    expect(readSlowText(9.4)).toBe("Still reading. This usually takes about 9 seconds.");
    expect(readSlowText(null)).toBe("Still reading. This can take up to 20 seconds.");
    expect(readSlowText()).toBe(COPY["read.slowFallback"]);
  });

  it("the new keys say registered sales and never use a valuation word", () => {
    // Section 10: never checked, verified, approved, fair price, worth, value, overpriced, deal,
    // estimate, forecast (except "not a valuation or a forecast"), average, outliers, trimmed, percentile.
    const BANNED = /checked|verified|approved|fair price|\bworth\b|\bvalues?\b|overpriced|\bdeals?\b|estimat|forecast|average|outlier|trimmed|percentile|·|→/i;
    for (const k of RESULT_KEYS) {
      const v = COPY[k].replace("It is not a valuation or a forecast.", "");
      expect(BANNED.test(v), `${k}: ${v}`).toBe(false);
      expect(/valuation/i.test(v.replace(/not a valuation/gi, "")), k).toBe(false);
      expect(/\bfair\b/i.test(v.replace(/fairsquare/gi, "")), k).toBe(false);
    }
    expect(COPY["provenance.basis"]).toBe(
      "This compares an asking price with registered sale prices, fees excluded on both. It is not a valuation or a forecast.",
    );
    // The popover's last line avoids "estimate a value" (spec 3.1 wording) and says what the deck allows.
    expect(COPY["evidence.defCounts"]).toBe("Fairsquare counts registered sales. It is not a valuation.");
  });

  it("lists and plurals", () => {
    expect(tList("offer.items")).toHaveLength(5);
    expect(tList("result.howToCheckSteps")).toHaveLength(3);
    expect(tList("ask.completionOptions")).toEqual(["Ready", "Off-plan"]);
    expect(tPlural("list.h", 43)).toBe("43 registered sales");
    expect(tPlural("list.h", 1)).toBe("1 registered sale");
    expect(tPlural("evidence.setAsideN", 1)).toBe("1 unusual sale set aside.");
    expect(tPlural("evidence.setAsideN", 2)).toBe("2 unusual sales set aside.");
  });

  it("the WhatsApp text for the owner's listing is section 8.2 exactly", () => {
    expect(shareText(AYKON)).toBe(
      "Aykon City Tower C, ready 2-bed, 812 sq ft, asking AED 1,450,000 (AED 1,786 per sq ft). Median of 43 registered 2-bed sales in this tower, 12 months to 16 Nov 2026: AED 1,761 per sq ft. Last 90 days: AED 1,602 per sq ft (11 sales). Source: DLD open data via Data.Dubai. Not a valuation. https://fairsquare.example/c/FYZ79D",
    );
    expect(shareText(aykonAsking(1_650_000))).toBe(
      "Aykon City Tower C, ready 2-bed, 812 sq ft, asking AED 1,650,000 (AED 2,032 per sq ft), 15.4% above the median of 43 registered 2-bed sales in this tower, 12 months to 16 Nov 2026: AED 1,761 per sq ft. Last 90 days: AED 1,602 per sq ft (11 sales). Source: DLD open data via Data.Dubai. Not a valuation. https://fairsquare.example/c/FYZ79D",
    );
    const fewer: CheckView = {
      ...AYKON,
      bedrooms: 3,
      sales: AYKON.sales.slice(0, 4),
      analysis: { ...AYKON.analysis, band: "thin", count: 4, diff: null, medianPriceAed: null },
    };
    expect(shareText(fewer)).toContain("only 4 registered 3-bed sales in this tower in 12 months, too few to compare.");
    expect(shareText(fewer)).not.toContain("Last 90 days");
    // A size button's size reads "about".
    const about = aykonAsking(1_450_000);
    expect(shareText({ ...about, sizeSqft: 815, sizeSource: "cluster" })).toContain(", about 815 sq ft, asking AED 1,450,000");
    expect(sizeText({ sizeSqft: 815, sizeSource: "cluster" })).toBe("about 815");
    expect(sizeText({ sizeSqft: 812, sizeSource: "read" })).toBe("812");
  });

  it("the settle announcement for the owner's listing is section 2.7 exactly, with the recent-sales note", () => {
    expect(verdictAnnouncement(AYKON)).toBe(
      "In line with registered sales. Aykon City Tower C, ready 2-bed, AED 1,786 per sq ft, 1.4% above the median of 43 registered sales. Recent sales are lower.",
    );
    expect(verdictAnnouncement(aykonAsking(1_650_000))).toBe(
      "15.4% above registered sales. Aykon City Tower C, ready 2-bed, AED 2,032 per sq ft, 15.4% above the median of 43 registered sales. Recent sales are lower.",
    );
    expect(verdictAnnouncement(aykonAsking(1_300_000))).toBe(
      "9.1% below registered sales. Aykon City Tower C, ready 2-bed, AED 1,601 per sq ft, 9.1% below the median of 43 registered sales. Recent sales are lower.",
    );
    // In line below the median: "below", from the sign of the difference.
    expect(verdictAnnouncement(FIXTURE_CHECK_JVC)).toMatch(
      /^In line with registered sales\. Fake Vista Res\., ready 1-bed, AED 1,166 per sq ft, 1\.7% below the median of 9 registered sales\./,
    );
    // No recent note when the recent-sales line does not show.
    const noDrift: CheckView = { ...AYKON, analysis: { ...AYKON.analysis, medianPsf: 1610 } };
    expect(verdictAnnouncement(noDrift)).not.toContain("Recent sales");
    // At the median.
    const same = aykonAsking(Math.round(AYKON.analysis.medianPsf as number) * AYKON.sizeSqft);
    expect(verdictAnnouncement(same)).toMatch(/^In line with registered sales\. Aykon City Tower C, ready 2-bed, AED 1,761 per sq ft, the same as the median of 43 registered sales\./);
    // Too few and not covered say their sentence.
    expect(verdictAnnouncement(FIXTURE_CHECK_THIN)).toBe(verdictSentence(FIXTURE_CHECK_THIN));
    expect(verdictAnnouncement(FIXTURE_CHECK_NONE)).toBe("We don't cover Nowhere Point Tower yet.");
  });

  it("a listing that didn't say ready or off-plan is never called ready on the card, the OG image, the alt or the share text", () => {
    const unknown: CheckView = { ...AYKON, completion: "unknown" };
    expect(listingType(unknown)).toBe("2-bed");
    expect(listingType(AYKON)).toBe("ready 2-bed");
    expect(listingType({ ...AYKON, completion: "off_plan", analysis: { ...AYKON.analysis, completionBasis: "off_plan" } })).toBe("off-plan 2-bed");
    expect(shareText(unknown)).toMatch(/^Aykon City Tower C, 2-bed, 812 sq ft, asking AED 1,450,000 \(AED 1,786 per sq ft\)\. Median of 43 registered 2-bed sales/);
    expect(cardAlt(unknown)).toContain("Aykon City Tower C, 2-bed, 812 sq ft, asking AED 1,450,000.");
    expect(verdictAnnouncement(unknown)).toContain("Aykon City Tower C, 2-bed, AED 1,786 per sq ft");
    expect(t("og.listing", { listingType: "2-bed", size: "812", price: "1,450,000" })).toBe("2-bed, 812 sq ft, AED 1,450,000");
  });

  it("og:description for a not-covered comparison has no count", () => {
    expect(ogDescription(FIXTURE_CHECK_NONE)).toBe("Not covered yet. Not a valuation.");
    expect(ogDescription(FIXTURE_CHECK_NONE)).not.toMatch(/\b0\b/);
  });

  it("og:title and og:description for the owner's listing (section 8.3)", () => {
    expect(ogTitle(AYKON)).toBe("Aykon City Tower C 2-bed: in line with registered sales (+1.4%)");
    expect(ogTitle(aykonAsking(1_650_000))).toBe("Aykon City Tower C 2-bed: 15.4% above registered sales");
    expect(ogTitle(aykonAsking(1_300_000))).toBe("Aykon City Tower C 2-bed: 9.1% below registered sales");
    expect(ogDescription(AYKON)).toBe("43 registered sales in 12 months. Recent sales lower. Not a valuation.");
    expect(ogDescription(AYKON)).toHaveLength(70);
  });
});

describe("builders: the A§2.10 table", () => {
  it("verdictSentence", () => {
    expect(verdictSentence(FIXTURE_CHECK_MARINA)).toBe(
      "This listing asks AED 1,908 per sq ft, 14.0% above the median of 11 registered sales of ready 2-bed apartments in Mockup Crest Tower (AED 1,674 per sq ft).",
    );
    expect(verdictSentence(FIXTURE_CHECK_JVC)).toBe(
      "This listing asks AED 1,166 per sq ft, within 5% of the median of 9 registered sales of ready 1-bed apartments in Fake Vista Residences (AED 1,186 per sq ft).",
    );
    expect(verdictSentence(FIXTURE_CHECK_THIN)).toBe(
      "Only 2 registered sales of ready 3-bed apartments in Dummyside Heights 2 in the 12 months to 17 Nov 2026. Fairsquare needs at least 5 to compare.",
    );
    expect(verdictSentence(FIXTURE_CHECK_NONE, 40)).toBe(
      "Fairsquare covers 40 buildings. Request this one and track it under Saved.",
    );
    expect(verdictSentence(FIXTURE_CHECK_NONE)).toBe("We don't cover Nowhere Point Tower yet.");
  });

  it("says the completion basis: off-plan listings are compared with off-plan sales (REAL_DATA.md section 7)", () => {
    expect(basisWord("ready")).toBe("ready");
    expect(basisWord("off_plan")).toBe("off-plan");
    expect(verdictSentence(FIXTURE_CHECK_OFFPLAN)).toBe(
      "No registered sales of off-plan 2-bed apartments in Mockup Crest Tower in the 12 months to 17 Nov 2026. Fairsquare needs at least 5 to compare.",
    );
    const offPlanVerdict: CheckView = { ...FIXTURE_CHECK_MARINA, analysis: { ...FIXTURE_CHECK_MARINA.analysis, completionBasis: "off_plan" } };
    expect(verdictSentence(offPlanVerdict)).toContain("the median of 11 registered sales of off-plan 2-bed apartments in");
    expect(provenanceLine(offPlanVerdict)).toContain("same building, off-plan 2-bed apartments, per sq ft.");
    expect(shareText(offPlanVerdict)).toContain("Mockup Crest, off-plan 2-bed, 1,284 sq ft,");
    expect(stampProps(offPlanVerdict).lines.d.at(-1)).toBe("OFF-PLAN");
  });

  it("the window's real end date, not 'the last 12 months', when the data is older than today", () => {
    const old: CheckView = {
      ...FIXTURE_CHECK_THIN,
      analysis: { ...FIXTURE_CHECK_THIN.analysis, windowStart: "2025-09-30", windowEnd: "2026-09-30", dataThrough: "2026-09-30" },
    };
    expect(verdictSentence(old)).toContain("in the 12 months to 30 Sep 2026");
    expect(provenanceLine(old)).toBe("Sales from 30 Sep 2025 to 30 Sep 2026, same building, ready 3-bed apartments, per sq ft.");
    expect(stampProps(old).lines.d[1]).toBe("12 MONTHS TO 30 SEP 2026");
  });

  it("notes: outliers left out, the size check and stale data", () => {
    expect(outliersNote({ outliersDropped: 0 })).toBeNull();
    expect(outliersNote({ outliersDropped: 1 })).toBe("1 unusual sale left out");
    expect(outliersNote({ outliersDropped: 3 })).toBe("3 unusual sales left out");

    const sized = (sizeSqft: number, medianSizeSqft: number | null): Pick<CheckView, "sizeSqft" | "analysis"> => ({
      sizeSqft,
      analysis: { ...FIXTURE_CHECK_MARINA.analysis, medianSizeSqft },
    });
    expect(sizeNote(sized(1240, 1000))).toBe(
      "This listing is 24% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies.",
    );
    expect(sizeNote(sized(700, 1000))).toBe(
      "This listing is 30% smaller than the typical sale here. DLD sizes may be measured differently, for example with or without balconies.",
    );
    expect(sizeNote(sized(1200, 1000))).toBeNull();
    expect(sizeNote(sized(1240, null))).toBeNull();
    expect(sizeNote(FIXTURE_CHECK_MARINA)).toBeNull();

    expect(staleNote({ stale: true, dataThrough: "2026-09-30" })).toBe(
      "Fairsquare's sales data currently runs to 30 Sep 2026. Sales registered after that aren't included yet.",
    );
    expect(staleNote({ stale: false, dataThrough: "2026-11-17" })).toBeNull();
    expect(staleNote({ stale: true, dataThrough: null })).toBeNull();
    expect(COPY["data.loading"]).toBe("Sales data is being loaded. Try again in a few minutes.");
    expect(t("data.runsTo", { date: "17 Nov 2026" })).toBe("Sales data runs to 17 Nov 2026.");
  });

  it("attribution and independence (REAL_DATA.md section 9)", () => {
    expect(attributionText()).toBe(
      "Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence.",
    );
    expect(COPY["data.independent"]).toBe(
      "Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.",
    );
    // The linked names are parts of the sentence.
    expect(attributionText()).toContain(COPY["data.dataset"]);
    expect(attributionText()).toContain(COPY["data.licence"]);
    const p = attributionParts();
    expect(p).toEqual({
      before: "Source: ",
      dataset: "Dubai Land Department sales transactions",
      between: ", published as open data on Data.Dubai and used under the ",
      licence: "Dubai Open Data Licence",
      after: ".",
    });
    expect(`${p.before}${p.dataset}${p.between}${p.licence}${p.after}`).toBe(attributionText());
  });

  it("areaLabel: the shown area with the DLD area name when they differ (REAL_DATA.md section 6)", () => {
    expect(areaLabel("Dubai Marina", "Marsa Dubai")).toBe("Dubai Marina (DLD area: Marsa Dubai)");
    expect(areaLabel("Business Bay", "Business Bay")).toBe("Business Bay");
    expect(areaLabel("Business Bay", "BUSINESS BAY ")).toBe("Business Bay");
    expect(areaLabel("Al Barsha", null)).toBe("Al Barsha");
    expect(areaLabel("Al Barsha", "")).toBe("Al Barsha");
  });

  it("verdictSentence below, one sale and zero sales", () => {
    const below = buildFixtureCheck({
      code: "B2L4WX",
      buildingName: "Mockup Crest Tower",
      buildingText: "Mockup Crest",
      areaText: null,
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 1_900_000,
    });
    expect(below.analysis.band).toBe("below");
    expect(verdictSentence(below)).toMatch(
      /^This listing asks AED 1,480 per sq ft, 11\.6% below the median of 11 registered sales of ready 2-bed apartments/,
    );
    expect(shareText(below)).toContain("11.6% below the median of 11 registered 2-bed sales in this tower");
    const one: CheckView = { ...FIXTURE_CHECK_THIN, analysis: { ...FIXTURE_CHECK_THIN.analysis, count: 1 } };
    expect(verdictSentence(one)).toContain("Only 1 registered sale of ready 3-bed apartments in");
    const zero = buildFixtureCheck({
      code: "Z3R8AB",
      buildingName: "Mockup Crest Tower",
      buildingText: "Mockup Crest",
      areaText: null,
      bedrooms: 1,
      sizeSqft: 800,
      priceAed: 1_200_000,
    });
    // RESULT_SPEC 6.6, zero case: the minimum is said as for any too-few result.
    expect(verdictSentence(zero)).toBe(
      "No registered sales of ready 1-bed apartments in Mockup Crest Tower in the 12 months to 17 Nov 2026. Fairsquare needs at least 5 to compare.",
    );
    // The WhatsApp text never says "only 0 registered sales".
    expect(shareText(zero)).toContain("Mockup Crest, ready 1-bed, 800 sq ft, asking AED 1,200,000: no registered 1-bed sales in this tower in 12 months, too few to compare.");
    expect(shareText(zero)).not.toMatch(/only 0/);
  });

  it("sentences use the rules stored with the comparison, not fixed 5% / 3 / 12 months", () => {
    const rules = { minSales: 4, windowDays: 182, bandPct: 10 };
    const inline: CheckView = { ...FIXTURE_CHECK_JVC, rules: { ...FIXTURE_CHECK_JVC.rules, ...rules } };
    expect(verdictSentence(inline)).toContain("within 10% of the median");
    expect(shareText(inline)).toContain("Median of 9 registered 1-bed sales in this tower, 6 months to 17 Nov 2026");
    expect(ogDescription(inline)).toBe("9 registered sales in 6 months. Not a valuation.");
    const thin: CheckView = { ...FIXTURE_CHECK_THIN, rules: { ...FIXTURE_CHECK_THIN.rules, ...rules } };
    expect(verdictSentence(thin)).toBe(
      "Only 2 registered sales of ready 3-bed apartments in Dummyside Heights 2 in the 6 months to 17 Nov 2026. Fairsquare needs at least 4 to compare.",
    );
    expect(shareText(thin)).toContain("in this tower in 6 months, too few");
    expect(howBody(inline)).toBe(
      "Fairsquare takes the median price per sq ft of same-bedroom sales in this building over the 6 months to 17 Nov 2026. Within 10% either way counts as in line. With fewer than 4 sales it doesn't compare.",
    );
    expect(t("thin.progress", { count: 2, minSales: 4 })).toBe("2 of the 4 sales needed");
    // The defaults read exactly as the deck.
    expect(t("result.howBody", { ...ruleVars({ minSales: 3, windowDays: 365, bandPct: 5 }), to: "17 Nov 2026" })).toContain(
      "over the 12 months to 17 Nov 2026. Within 5% either way counts as in line. With fewer than 3 sales",
    );
    // The method names the window's real end, never "the last 12 months", when the data is older.
    const old: CheckView = { ...FIXTURE_CHECK_JVC, analysis: { ...FIXTURE_CHECK_JVC.analysis, windowEnd: "2026-09-30" } };
    expect(howBody(old)).toContain("over the 12 months to 30 Sep 2026.");
  });

  it("stampProps: row A's verdict word, the figure, VS MEDIAN, and row D with OFF-PLAN only when off-plan (RESULT_SPEC 8.1)", () => {
    const s = stampProps(FIXTURE_CHECK_MARINA);
    expect(s).toMatchObject({
      header: "ABOVE",
      figure: "+14.0%",
      lines: { c: "VS MEDIAN OF 11 REGISTERED SALES", d: ["2-BED", "12 MONTHS TO 17 NOV 2026"] },
      date: "2026-11-17",
    });
    expect(s).not.toHaveProperty("isDemo");
    expect(Number.isInteger(s.seed)).toBe(true);
    expect(stampProps(FIXTURE_CHECK_THIN)).toMatchObject({ header: "TOO FEW", figure: "2 OF 5", lines: { c: "SALES NEEDED TO COMPARE" } });
    expect(stampProps(FIXTURE_CHECK_OFFPLAN)).toMatchObject({ header: "TOO FEW", figure: "0 OF 5" });
    expect(stampProps(FIXTURE_CHECK_OFFPLAN).lines.d.at(-1)).toBe("OFF-PLAN");
    expect(stampProps(FIXTURE_CHECK_JVC)).toMatchObject({ header: "IN LINE", figure: "−1.7%" });
    expect(stampProps(aykonAsking(1_300_000))).toMatchObject({ header: "BELOW", figure: "−9.1%" });
    expect(stampProps(FIXTURE_CHECK_NONE)).toMatchObject({ header: "", figure: "NOT COVERED", lines: { c: "" } });
    for (const c of FIXTURES) expect(JSON.stringify(stampProps(c))).not.toMatch(/CHECKED|COMPARED|READY/);
  });

  it("shareText (RESULT_SPEC section 8.2): the listing's own building text, the size, both prices, the source and the link", () => {
    expect(shareText(FIXTURE_CHECK_MARINA)).toBe(
      "Mockup Crest, ready 2-bed, 1,284 sq ft, asking AED 2,450,000 (AED 1,908 per sq ft), 14.0% above the median of 11 registered 2-bed sales in this tower, 12 months to 17 Nov 2026: AED 1,674 per sq ft. Source: DLD open data via Data.Dubai. Not a valuation. http://localhost:3000/c/K7Q2MX",
    );
    expect(shareText(FIXTURE_CHECK_JVC)).toBe(
      "Fake Vista Res., ready 1-bed, 742 sq ft, asking AED 865,000 (AED 1,166 per sq ft). Median of 9 registered 1-bed sales in this tower, 12 months to 17 Nov 2026: AED 1,186 per sq ft. Source: DLD open data via Data.Dubai. Not a valuation. http://localhost:3000/c/P4VR8N",
    );
    expect(shareText(FIXTURE_CHECK_THIN)).toBe(
      "Dummyside Hts 2, ready 3-bed, 1,905 sq ft, asking AED 3,600,000: only 2 registered 3-bed sales in this tower in 12 months, too few to compare. Source: DLD open data via Data.Dubai. Not a valuation. http://localhost:3000/c/C2HT3B",
    );
    expect(shareText(FIXTURE_CHECK_NONE)).toBe(
      "Nowhere Point Tower 2-bed at AED 2,300,000: Fairsquare doesn't cover this building yet. See it on Fairsquare: http://localhost:3000/c/H8PT5W",
    );
  });

  it("ogTitle, ogDescription, ogAlt", () => {
    expect(ogTitle(FIXTURE_CHECK_MARINA)).toBe("Mockup Crest 2-bed: 14.0% above registered sales");
    expect(ogTitle(FIXTURE_CHECK_JVC)).toBe("Fake Vista Res. 1-bed: in line with registered sales (−1.7%)");
    expect(ogTitle(FIXTURE_CHECK_THIN)).toBe("Too few sales to compare: Dummyside Heights 2 3-bed");
    expect(ogTitle(FIXTURE_CHECK_NONE)).toBe("Not covered yet: Nowhere Point Tower 2-bed");
    expect(ogDescription(FIXTURE_CHECK_MARINA)).toBe("11 registered sales in 12 months. Not a valuation.");
    expect(ogDescription(FIXTURE_CHECK_THIN)).toBe("2 registered sales in 12 months. Not a valuation.");
    // RESULT_SPEC section 8.3: what the image shows, in words.
    expect(ogAlt(FIXTURE_CHECK_MARINA)).toBe("Fairsquare comparison: asking AED 1,908 per sq ft, median AED 1,674 of 11 registered sales.");
    expect(ogAlt(AYKON)).toBe("Fairsquare comparison: asking AED 1,786 per sq ft, median AED 1,761 of 43 registered sales.");
    // The minimum is the one stored with the comparison, never a fixed 3.
    expect(ogAlt(FIXTURE_CHECK_THIN)).toBe("Fairsquare comparison: asking AED 1,890 per sq ft, 2 of the 5 registered sales needed to compare.");
    expect(ogAlt(FIXTURE_CHECK_NONE)).toBe("Fairsquare: Nowhere Point Tower 2-bed is not covered yet");
  });

  it("a list that keeps the newest of more sales says so (never a silent cut)", () => {
    const newest = [...FIXTURE_CHECK_MARINA.sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate)).slice(0, 8);
    const cut: CheckView = { ...FIXTURE_CHECK_MARINA, sales: newest };
    expect(salesShownNote(cut)).toBe("Showing the newest 8 of 11 sales.");
    expect(salesShownNote(FIXTURE_CHECK_MARINA)).toBeNull();
    expect(salesShownNote(FIXTURE_CHECK_NONE)).toBeNull();
  });

  it("sales Fairsquare added (admin or import) are said to be added by Fairsquare, not DLD open data (REAL_DATA.md section 9)", () => {
    const open = FIXTURE_CHECK_MARINA.sales;
    expect(addedSalesNote(open)).toBeNull();
    expect(addedSalesNote([{ ...open[0], source: "admin" }, ...open.slice(1)])).toBe(
      "1 of these sales was added by Fairsquare, not taken from the DLD open data.",
    );
    expect(addedSalesNote([{ ...open[0], source: "admin" }, { ...open[1], source: "import" }, ...open.slice(2)])).toBe(
      "2 of these sales were added by Fairsquare, not taken from the DLD open data.",
    );
    expect(addedSalesNote(open.map((s) => ({ ...s, source: "admin" as const })))).toBe(
      "These sales were added by Fairsquare, not taken from the DLD open data.",
    );
  });

  it("provenanceLine", () => {
    expect(provenanceLine(FIXTURE_CHECK_MARINA)).toBe(
      "Sales from 17 Nov 2025 to 17 Nov 2026, same building, ready 2-bed apartments, per sq ft.",
    );
  });

  it("consentFor: optin-v1 only (the demo variant is gone)", () => {
    expect(consentFor("P")).toEqual({
      version: "optin-v1",
      text: "Share my name, phone number and this listing with P, a licensed mortgage broker, so an adviser can contact me about financing. I can withdraw this at any time.",
    });
  });

  it("small helpers", () => {
    expect(bandLabel("above")).toBe("Above recent sales");
    expect(bandLabel("none")).toBe("Not covered yet");
    expect(buildingLabel(FIXTURE_CHECK_NONE)).toBe("Nowhere Point Tower");
    // The listing's own text, as the card's title (RESULT_SPEC section 8.1).
    expect(shareFileName(FIXTURE_CHECK_MARINA)).toBe("fairsquare-mockup-crest-K7Q2MX.png");
    expect(shareFileName(AYKON)).toBe("fairsquare-aykon-city-tower-c-FYZ79D.png");
    expect(costRow(10_618.07, 20)).toBe("About AED 10,618 a month with 20% down");
  });
});

describe("errors and fields", () => {
  it("maps error codes onto deck strings", () => {
    expect(ERROR_COPY.extract_refused).toBe(COPY["error.refused"]);
    expect(ERROR_COPY.extract_unavailable).toBe(COPY["claudeOff.notice"]);
    expect(ERROR_COPY.not_found).toBe("This comparison link doesn't work");
    expect(ERROR_COPY.bad_credentials).toBe("That password is wrong.");
    expect(ERROR_COPY.consent_required).toBe("Tick the box to agree before sending your details.");
    expect(ERROR_COPY.leads_unavailable).toBe("Talking to a mortgage adviser through Fairsquare isn't available yet.");
    expect(ERROR_COPY).not.toHaveProperty("sample_not_allowed");
  });

  it("rate-limit messages depend on the scope", () => {
    expect(rateLimitMessage("extract_burst", 540)).toBe(
      "You've read a lot of screenshots in a short time. Wait 9 minutes, or type the details.",
    );
    expect(rateLimitMessage("extract_burst")).toContain("Wait 1 minutes");
    expect(rateLimitMessage("extract_daily")).toBe(COPY["rate.daily"]);
    expect(rateLimitMessage("spam")).toBe(COPY["rate.spam"]);
    expect(rateLimitMessage("admin_login")).toBe("Too many tries. Wait 15 minutes.");
  });

  it("outcome copy", () => {
    expect(OUTCOME_COPY.rental).toEqual({
      message: "This looks like a rental listing. Fairsquare compares sale prices only.",
      actions: ["It's for sale, continue", "Try another screenshot"],
    });
    expect(OUTCOME_COPY.not_listing.actions).toEqual(["Try another screenshot", "Type the details"]);
    expect(OUTCOME_COPY.not_apartment.actions).toEqual(["Type the details anyway", "Try another screenshot"]);
  });

  it("FIELD_ERRORS is a view over deck keys", () => {
    expect(FIELD_ERRORS.bedrooms).toBe(COPY["err.bedrooms"]);
    expect(FIELD_ERRORS.notFound).toBe(COPY["details.missing"]);
    expect(FIELD_ERRORS.psf(7000)).toBe(
      "That works out to AED 7,000 per sq ft, which looks wrong. Check the size and price.",
    );
  });
});
