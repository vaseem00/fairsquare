/**
 * What the compare flow does next after a read, an answer, a match or an accepted outcome
 * (docs/REDESIGN.md section 6.3). Pure: no React, no DOM, no requests. The hook (`useCheckFlow`)
 * acts on the answer: ask one question, run a building match, compare, or show the partial read.
 *
 * "Confident" (auto-compare with no question) is the strictest path, and only that:
 * - the outcome is a sale listing (or the person said it is for sale);
 * - building, bedrooms, size and price are all known (read or answered);
 * - they pass the same `ListingFieldsSchema` the server uses, AED per sq ft 300 to 6,000 included;
 * - the match pre-selects one building (strong, score 0.8 or above, untied) and flags no
 *   look-alike tower (`towerCheck`) and no same name in two areas (`areaCheck`).
 * Anything else asks, one question at a time, in this order: outcome, bedrooms, size, price (and the
 * price per sq ft), the building name, the building, and last "Is it ready or off-plan?" (RESULT_SPEC
 * section 2.5): only when the read did not say and the chosen building has registered sales of both
 * kinds for the bedroom count (`CandidateView.basisSales`). Ready and off-plan sales are never pooled.
 */
import { completionBasis } from "@/lib/domain/analyse";
import type { CandidateView, Completion, ExtractedFields, ExtractOutcome, FieldKey, ListingFields, MatchResponse, SizeSource } from "@/lib/types";
import { LIMITS, ListingFieldsSchema } from "@/lib/validation/fields";

/** The details form's values (numbers stay undefined until typed; never "" → 0). */
export interface DetailsValues {
  buildingText: string;
  areaText: string | null;
  bedrooms?: number;
  sizeSqft?: number;
  priceAed?: number;
}

/** What POST /api/checks gets from the flow (source, propertyType and ref are added by the hook). */
export interface SubmitPayload {
  fields: ListingFields;
  buildingId: number | null;
  editedFields: FieldKey[];
  /** The listing's completion; without one the comparison uses ready sales. */
  completion?: Completion;
}

/**
 * What the person answered in the scene; merged over what was read (answers win). `sizeSource` says how
 * an answered size was given ("cluster": a size button, so the fact line says "about"); `completion`
 * answers "Is it ready or off-plan?".
 */
export type Answers = Partial<{
  buildingText: string;
  areaText: string | null;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  sizeSource: Exclude<SizeSource, "read">;
  completion: Exclude<Completion, "unknown">;
}>;

/** The fields the scene can ask for one at a time. */
export type AskField = "bedrooms" | "sizeSqft" | "priceAed" | "buildingText";

export type Question =
  /** Not a sale listing (rental, not a listing, villa or townhouse). */
  | { kind: "outcome"; outcome: Exclude<ExtractOutcome, "ok"> }
  /** One field: missing, or read but not valid (`invalid`). */
  | { kind: "field"; field: AskField; invalid?: boolean }
  /** Price divided by size is outside 300 to 6,000: ask both. */
  | { kind: "psf" }
  /** Choose among the candidates, None of these, or search. */
  | { kind: "building" }
  /** "Is it ready or off-plan?": the read did not say, and the building has sales of both kinds. */
  | { kind: "completion" };

export type Next =
  | { kind: "ask"; question: Question }
  | { kind: "match"; q: string; area: string | null; beds: number | null; completion: Completion | null; key: string }
  | { kind: "compare"; payload: SubmitPayload }
  | { kind: "partial" };

/** The part of the flow state `decideNext` reads (FlowState satisfies it). */
export interface DecideInput {
  outcome: ExtractOutcome | null;
  outcomeAccepted: boolean;
  extracted: ExtractedFields | null;
  answers: Answers;
  completion: Completion | undefined;
  match: MatchResponse | null;
  /** `matchQueryKey()` of the values `match` belongs to. */
  matchKey: string | null;
  /** undefined: not decided yet; null: None of these. */
  pickedBuildingId: number | null | undefined;
}

/** The four details a comparison needs. */
export const REQUIRED = ["buildingText", "bedrooms", "sizeSqft", "priceAed"] as const;
/** Three or more of them missing: the read is "partial" and the scene offers the form. */
export const PARTIAL_AT = 3;

const NUMBER_ORDER = ["bedrooms", "sizeSqft", "priceAed"] as const;
const CHECK_ORDER: AskField[] = ["bedrooms", "sizeSqft", "priceAed", "buildingText"];
/** Stands in for a missing building name while the numbers are checked (never sent). */
const PROBE_NAME = "Building";

export interface MergedValues {
  buildingText: string | null;
  areaText: string | null;
  bedrooms: number | null;
  sizeSqft: number | null;
  priceAed: number | null;
}

const text = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

/** What was read with the answers on top (answers win; blank text counts as missing). */
export function mergedValues(extracted: ExtractedFields | null, answers: Answers): MergedValues {
  const e = extracted;
  const num = (k: "bedrooms" | "sizeSqft" | "priceAed"): number | null => {
    const v = answers[k] !== undefined ? answers[k] : e?.[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    buildingText: text(answers.buildingText !== undefined ? answers.buildingText : e?.buildingText),
    areaText: text(answers.areaText !== undefined ? answers.areaText : e?.areaText),
    bedrooms: num("bedrooms"),
    sizeSqft: num("sizeSqft"),
    priceAed: num("priceAed"),
  };
}

/** The merged values as form values (numbers left out when unknown). */
export function toDetailsValues(v: MergedValues): DetailsValues {
  return {
    buildingText: v.buildingText ?? "",
    areaText: v.areaText,
    ...(v.bedrooms !== null ? { bedrooms: v.bedrooms } : {}),
    ...(v.sizeSqft !== null ? { sizeSqft: v.sizeSqft } : {}),
    ...(v.priceAed !== null ? { priceAed: v.priceAed } : {}),
  };
}

/**
 * What a building match depends on: the name, the area, the bedrooms and the completion basis (the
 * options count off-plan sales for an off-plan listing, ready ones otherwise).
 */
export function matchQueryKey(
  v: Pick<DetailsValues, "buildingText" | "areaText" | "bedrooms"> & { completion?: Completion | null },
): string {
  return JSON.stringify([
    v.buildingText.trim().toLowerCase(),
    (v.areaText ?? "").trim().toLowerCase(),
    v.bedrooms ?? null,
    completionBasis(v.completion),
  ]);
}

/** Fields the person changed after they were read (only fields that were read count). */
export function editedFieldsOf(extracted: ExtractedFields | null, v: DetailsValues): FieldKey[] {
  if (!extracted) return [];
  const out: FieldKey[] = [];
  const t = (s: string | null | undefined) => (s ?? "").trim();
  if (extracted.buildingText !== null && t(extracted.buildingText) !== t(v.buildingText)) out.push("buildingText");
  if (extracted.areaText !== null && t(extracted.areaText) !== t(v.areaText)) out.push("areaText");
  if (extracted.bedrooms !== null && extracted.bedrooms !== v.bedrooms) out.push("bedrooms");
  if (extracted.sizeSqft !== null && extracted.sizeSqft !== v.sizeSqft) out.push("sizeSqft");
  if (extracted.priceAed !== null && extracted.priceAed !== v.priceAed) out.push("priceAed");
  return out;
}

/**
 * A match Fairsquare may act on without asking: one pre-selected building (the server pre-selects only a
 * strong, untied top candidate), no look-alike tower and no same name in two areas.
 */
export function isConfidentMatch(m: MatchResponse): boolean {
  if (m.preselectId === null || m.towerCheck || m.areaCheck) return false;
  const top: CandidateView | undefined = m.candidates.find((c) => c.buildingId === m.preselectId);
  return top !== undefined && top.strength === "strong";
}

/**
 * A fresh match is needed when the building name or area was answered (the read's match was for other
 * text), or when the answers changed the counts of a building question that is about to be asked
 * (bedrooms). A confident read keeps its match: bedrooms do not change a strong pre-selection.
 */
export function needsFreshMatch(s: DecideInput): boolean {
  if (s.pickedBuildingId !== undefined) return false;
  if (s.answers.buildingText !== undefined || s.answers.areaText !== undefined) return true;
  return s.match ? !isConfidentMatch(s.match) : true;
}

/** The candidates the building question offers: the pre-selected one first, then the rest (at most 3). */
export function buildingOptions(m: MatchResponse): CandidateView[] {
  const top = m.candidates.slice(0, 3);
  const pre = top.find((c) => c.buildingId === m.preselectId);
  return pre ? [pre, ...top.filter((c) => c !== pre)] : top;
}

const ask = (question: Question): Next => ({ kind: "ask", question });

export function decideNext(s: DecideInput): Next {
  // 1. Not a sale listing, and not accepted yet.
  if (s.outcome && s.outcome !== "ok" && !s.outcomeAccepted) return ask({ kind: "outcome", outcome: s.outcome });

  const v = mergedValues(s.extracted, s.answers);

  // 2. Too little was read: the scene says so and offers the form (it never opens it by itself).
  const missing = REQUIRED.filter((k) => v[k] === null);
  if (missing.length >= PARTIAL_AT) return { kind: "partial" };

  // 3. One field at a time. Bedrooms first: the building options count sales by bedrooms.
  for (const f of NUMBER_ORDER) if (v[f] === null) return ask({ kind: "field", field: f });

  // 4. Plausibility, with the same schema the server uses.
  const probe = ListingFieldsSchema.safeParse({
    buildingText: v.buildingText ?? PROBE_NAME,
    areaText: v.areaText ? v.areaText.slice(0, LIMITS.areaMax) : null,
    bedrooms: v.bedrooms,
    sizeSqft: v.sizeSqft,
    priceAed: v.priceAed,
  });
  if (!probe.success) {
    const issues = probe.error.issues;
    const bad = CHECK_ORDER.find((f) => issues.some((i) => i.path[0] === f && i.code !== "custom"));
    if (bad) return ask({ kind: "field", field: bad, invalid: true });
    return ask({ kind: "psf" });
  }
  if (v.buildingText === null) return ask({ kind: "field", field: "buildingText" });
  const fields = probe.data;

  // 5. A match for these values: the read's match, or a fresh one after a typed name.
  const key = matchQueryKey({ ...fields, completion: s.completion });
  if (!s.match || (s.matchKey !== key && needsFreshMatch(s))) {
    return {
      kind: "match",
      q: fields.buildingText,
      area: fields.areaText,
      beds: fields.bedrooms,
      completion: s.completion ?? null,
      key,
    };
  }

  // 6. The building.
  const m = s.match;
  let buildingId = s.pickedBuildingId;
  if (buildingId === undefined) {
    if (isConfidentMatch(m)) buildingId = m.preselectId;
    else if (m.candidates.length === 0) buildingId = null; // nothing similar: not covered
    else return ask({ kind: "building" }); // a tie, a look-alike tower, a same name, or no strong match
  }

  // 7. Ready or off-plan, when the read did not say and both kinds of sales exist here.
  if (buildingId !== null && needsCompletion(s.completion, m.candidates.find((c) => c.buildingId === buildingId))) {
    return ask({ kind: "completion" });
  }

  return {
    kind: "compare",
    payload: {
      fields,
      buildingId,
      editedFields: editedFieldsOf(s.extracted, toDetailsValues(v)),
      ...(s.completion ? { completion: s.completion } : {}),
    },
  };
}

/**
 * Ask "Is it ready or off-plan?" only when the listing's completion is not known and the building has
 * registered sales of both kinds for the bedroom count (the match's `basisSales`, on the preselected
 * candidate). With sales of one kind only, the comparison uses that kind (ready by default) unasked.
 */
export function needsCompletion(completion: Completion | undefined, candidate: CandidateView | undefined): boolean {
  if (completion === "ready" || completion === "off_plan") return false;
  const b = candidate?.basisSales;
  return b !== undefined && b.ready > 0 && b.offPlan > 0;
}
