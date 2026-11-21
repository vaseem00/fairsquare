import { describe, expect, it } from "vitest";
import {
  buildingOptions,
  decideNext,
  isConfidentMatch,
  matchQueryKey,
  mergedValues,
  needsCompletion,
  type DecideInput,
} from "@/lib/flow/decide-next";
import type { ExtractedFields, MatchResponse } from "@/lib/types";

/** Test Tower D, 2-bed, 1,284 sq ft, AED 2,450,000 (AED 1,908 per sq ft). */
const READ: ExtractedFields = { buildingText: "Test Tower D", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

const D = { buildingId: 4, name: "Test Tower D", area: "Dubai Marina", strength: "strong" as const, salesForBedrooms: 11 };
const E = { buildingId: 5, name: "Test Tower E", area: "Dubai Marina", strength: "possible" as const, salesForBedrooms: 0 };

/** A strong, untied pre-selection with no look-alike and no same name: the confident path. */
const CLEAN: MatchResponse = { candidates: [D, E], preselectId: 4, towerCheck: false, areaCheck: false };

const keyOf = (f: ExtractedFields, completion: DecideInput["completion"] = "ready") =>
  matchQueryKey({ buildingText: f.buildingText ?? "", areaText: f.areaText, bedrooms: f.bedrooms ?? undefined, completion });

function input(over: Partial<DecideInput> = {}): DecideInput {
  return {
    outcome: null,
    outcomeAccepted: false,
    extracted: READ,
    answers: {},
    completion: "ready",
    match: CLEAN,
    matchKey: keyOf(READ),
    pickedBuildingId: undefined,
    ...over,
  };
}

describe("decideNext (docs/REDESIGN.md section 6.3), one row per branch", () => {
  it("a sale listing that is not accepted yet asks the outcome first", () => {
    expect(decideNext(input({ outcome: "rental" }))).toEqual({ kind: "ask", question: { kind: "outcome", outcome: "rental" } });
    expect(decideNext(input({ outcome: "not_listing" }))).toEqual({ kind: "ask", question: { kind: "outcome", outcome: "not_listing" } });
    // "It's for sale, continue": the rest of the decision runs.
    expect(decideNext(input({ outcome: "rental", outcomeAccepted: true })).kind).toBe("compare");
  });

  it("3 or more of the 4 details missing: the partial read (the form never opens by itself)", () => {
    const partial: ExtractedFields = { buildingText: null, areaText: null, bedrooms: null, sizeSqft: null, priceAed: 2_450_000 };
    expect(decideNext(input({ extracted: partial, match: null, matchKey: null }))).toEqual({ kind: "partial" });
  });

  it("bedrooms missing: asks bedrooms first (the building options count sales by bedrooms)", () => {
    const r = { ...READ, bedrooms: null, sizeSqft: null };
    expect(decideNext(input({ extracted: r }))).toEqual({ kind: "ask", question: { kind: "field", field: "bedrooms" } });
  });

  it("size missing", () => {
    expect(decideNext(input({ extracted: { ...READ, sizeSqft: null } }))).toEqual({ kind: "ask", question: { kind: "field", field: "sizeSqft" } });
  });

  it("price missing", () => {
    expect(decideNext(input({ extracted: { ...READ, priceAed: null } }))).toEqual({ kind: "ask", question: { kind: "field", field: "priceAed" } });
  });

  it("a value read but not valid asks that field again, marked invalid", () => {
    expect(decideNext(input({ extracted: { ...READ, sizeSqft: 90 } }))).toEqual({
      kind: "ask",
      question: { kind: "field", field: "sizeSqft", invalid: true },
    });
  });

  it("price per sq ft outside 300 to 6,000: asks both", () => {
    expect(decideNext(input({ extracted: { ...READ, priceAed: 245_000_000 } }))).toEqual({ kind: "ask", question: { kind: "psf" } });
  });

  it("building name missing: asks it (the pasted text parsed with reading off)", () => {
    const local: ExtractedFields = { ...READ, buildingText: null, areaText: null };
    expect(decideNext(input({ extracted: local, match: null, matchKey: null, completion: undefined }))).toEqual({
      kind: "ask",
      question: { kind: "field", field: "buildingText" },
    });
  });

  it("a typed building name runs a fresh match for its values (stale match key)", () => {
    const local: ExtractedFields = { ...READ, buildingText: null, areaText: null };
    const next = decideNext(input({ extracted: local, answers: { buildingText: "Test Tower D" }, match: null, matchKey: null, completion: undefined }));
    expect(next).toEqual({
      kind: "match",
      q: "Test Tower D",
      area: null,
      beds: 2,
      completion: null,
      key: matchQueryKey({ buildingText: "Test Tower D", areaText: null, bedrooms: 2 }),
    });
    // The read's match was for other text: a renamed building matches again too.
    expect(decideNext(input({ answers: { buildingText: "Test Tower E" } })).kind).toBe("match");
  });

  it("a confident read compares at once with the pre-selected building", () => {
    expect(isConfidentMatch(CLEAN)).toBe(true);
    expect(decideNext(input())).toEqual({
      kind: "compare",
      payload: {
        fields: { buildingText: "Test Tower D", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 },
        buildingId: 4,
        editedFields: [],
        completion: "ready",
      },
    });
  });

  it("an off-plan read is honoured: its completion goes into the comparison", () => {
    const next = decideNext(input({ completion: "off_plan", matchKey: keyOf(READ, "off_plan") }));
    expect(next.kind === "compare" && next.payload.completion).toBe("off_plan");
  });

  it("a confident read keeps its match after bedrooms are answered (a strong pre-selection does not depend on them)", () => {
    const r = { ...READ, bedrooms: null };
    expect(decideNext(input({ extracted: r, matchKey: keyOf(r), answers: { bedrooms: 2 } })).kind).toBe("compare");
  });

  it("a tie, a look-alike tower or a same name asks which building", () => {
    const ask = { kind: "ask", question: { kind: "building" } };
    expect(decideNext(input({ match: { ...CLEAN, preselectId: null } }))).toEqual(ask);
    expect(decideNext(input({ match: { ...CLEAN, towerCheck: true } }))).toEqual(ask);
    expect(decideNext(input({ match: { ...CLEAN, areaCheck: true } }))).toEqual(ask);
    expect(isConfidentMatch({ ...CLEAN, towerCheck: true })).toBe(false);
  });

  it("bedrooms answered before a building question: a fresh match, so the options count the right sales", () => {
    const r = { ...READ, bedrooms: null };
    const tied = { ...CLEAN, preselectId: null };
    expect(decideNext(input({ extracted: r, matchKey: keyOf(r), match: tied, answers: { bedrooms: 2 } })).kind).toBe("match");
  });

  it("no candidate at all compares with no building (not covered)", () => {
    const empty: MatchResponse = { candidates: [], preselectId: null, towerCheck: false, areaCheck: false };
    const next = decideNext(input({ match: empty }));
    expect(next.kind === "compare" && next.payload.buildingId).toBeNull();
  });

  it("a building chosen in the scene, or None of these, compares with it", () => {
    const tied = { ...CLEAN, preselectId: null };
    const picked = decideNext(input({ match: tied, pickedBuildingId: 5 }));
    expect(picked.kind === "compare" && picked.payload.buildingId).toBe(5);
    const none = decideNext(input({ match: tied, pickedBuildingId: null }));
    expect(none.kind === "compare" && none.payload.buildingId).toBeNull();
  });

  it("editedFields lists the read values the person corrected (a price per sq ft answer)", () => {
    const wrong = { ...READ, priceAed: 245_000_000 };
    const next = decideNext(input({ extracted: wrong, matchKey: keyOf(wrong), answers: { sizeSqft: 1284, priceAed: 2_450_000 } }));
    expect(next.kind).toBe("compare");
    if (next.kind === "compare") {
      expect(next.payload.editedFields).toEqual(["priceAed"]);
      expect(next.payload.fields.priceAed).toBe(2_450_000);
    }
    // A field that was not read is an answer, not an edit.
    const missing = { ...READ, sizeSqft: null };
    const answered = decideNext(input({ extracted: missing, answers: { sizeSqft: 1284 } }));
    expect(answered.kind === "compare" && answered.payload.editedFields).toEqual([]);
  });
});

describe("'Is it ready or off-plan?' (RESULT_SPEC section 2.5)", () => {
  /** Test Tower D with registered 2-bed sales of both kinds. */
  const BOTH: MatchResponse = { ...CLEAN, candidates: [{ ...D, basisSales: { ready: 11, offPlan: 6 } }, E] };

  it("asked last, only when the read did not say and the chosen building has sales of both kinds", () => {
    const unknown = input({ completion: "unknown", match: BOTH, matchKey: keyOf(READ, "unknown") });
    expect(decideNext(unknown)).toEqual({ kind: "ask", question: { kind: "completion" } });
    // Not read at all (pasted text parsed locally): the same question.
    expect(decideNext({ ...unknown, completion: undefined })).toEqual({ kind: "ask", question: { kind: "completion" } });
    // Earlier questions come first: a missing size is asked before it.
    expect(decideNext({ ...unknown, extracted: { ...READ, sizeSqft: null } })).toEqual({ kind: "ask", question: { kind: "field", field: "sizeSqft" } });
  });

  it("not asked when the read said, or when the building has one kind only (that kind is used, unasked)", () => {
    expect(decideNext(input({ completion: "ready", match: BOTH })).kind).toBe("compare");
    expect(decideNext(input({ completion: "off_plan", match: BOTH, matchKey: keyOf(READ, "off_plan") })).kind).toBe("compare");
    const readyOnly: MatchResponse = { ...CLEAN, candidates: [{ ...D, basisSales: { ready: 11, offPlan: 0 } }, E] };
    expect(decideNext(input({ completion: "unknown", match: readyOnly, matchKey: keyOf(READ, "unknown") })).kind).toBe("compare");
    // No counts by basis (no data loaded, or an older match): never asked.
    expect(decideNext(input({ completion: "unknown", matchKey: keyOf(READ, "unknown") })).kind).toBe("compare");
    // None of these: no building, nothing to ask.
    expect(decideNext(input({ completion: "unknown", match: BOTH, matchKey: keyOf(READ, "unknown"), pickedBuildingId: null })).kind).toBe("compare");
  });

  it("the answer is the comparison's completion, with no new building match", () => {
    // The flow reducer sets `completion` from the answer.
    const answered = decideNext(input({ completion: "off_plan", match: BOTH, matchKey: keyOf(READ, "unknown"), answers: { completion: "off_plan" } }));
    expect(answered.kind).toBe("compare");
    if (answered.kind === "compare") expect(answered.payload.completion).toBe("off_plan");
  });

  it("needsCompletion", () => {
    expect(needsCompletion(undefined, { ...D, basisSales: { ready: 1, offPlan: 1 } })).toBe(true);
    expect(needsCompletion("unknown", { ...D, basisSales: { ready: 0, offPlan: 4 } })).toBe(false);
    expect(needsCompletion("ready", { ...D, basisSales: { ready: 5, offPlan: 4 } })).toBe(false);
    expect(needsCompletion("unknown", D)).toBe(false);
    expect(needsCompletion("unknown", undefined)).toBe(false);
  });
});

describe("helpers", () => {
  it("merges answers over the read; blank text counts as missing", () => {
    expect(mergedValues({ ...READ, buildingText: "  " }, { priceAed: 2_400_000 })).toEqual({
      buildingText: null,
      areaText: "Dubai Marina",
      bedrooms: 2,
      sizeSqft: 1284,
      priceAed: 2_400_000,
    });
  });

  it("lists the pre-selected candidate first, at most 3", () => {
    const m: MatchResponse = { candidates: [E, D, { ...E, buildingId: 6 }, { ...E, buildingId: 7 }], preselectId: 4, towerCheck: true, areaCheck: false };
    expect(buildingOptions(m).map((c) => c.buildingId)).toEqual([4, 5, 6]);
  });
});
