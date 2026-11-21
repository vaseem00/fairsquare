import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageLine } from "@/components/check/building-picker";
import { listErrors } from "@/components/check/details-form";
import { secondsUntil } from "@/components/scene/compare-scene";
import { evidenceLine, factOfCheck, factText } from "@/lib/result/words";
import {
  BAD_IMAGE_FAILURE,
  TIMEOUT_FAILURE,
  changedPayload,
  compareFailure,
  draftFromState,
  editedFieldsOf,
  failureFromApi,
  flowReducer,
  flowUrl,
  initialFlowState,
  matchForCheck,
  matchQueryKey,
  readUrlStep,
  resultAnnouncement,
  sceneCaption,
  sizeSourceOf,
  stepOf,
  weighingCaption,
  weighingFor,
  type FlowAction,
  type FlowState,
} from "@/hooks/use-check-flow";
import {
  FIXTURE_CHECK_JVC,
  FIXTURE_CHECK_MARINA,
  FIXTURE_CHECK_NONE,
  FIXTURE_EXTRACT_OK,
} from "../../fixtures/api-fixtures";
import { COPY } from "@/lib/copy";
import type { SubmitPayload } from "@/lib/flow/decide-next";
import type { ExtractResponse, MatchResponse } from "@/lib/types";
import { CheckViewSchema } from "@/lib/validation/api";

const IMAGE = { file: new Blob(["x"]), url: "blob:one" };
const run = (actions: FlowAction[], from: FlowState = initialFlowState) => actions.reduce(flowReducer, from);
const start = (readId = 1): FlowAction => ({ type: "read/start", readId, input: "image", image: IMAGE });
const done = (response: ExtractResponse = FIXTURE_EXTRACT_OK, readId = 1): FlowAction => ({ type: "read/done", readId, response, at: 1000 });
const PAYLOAD: SubmitPayload = {
  fields: { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 },
  buildingId: 1,
  editedFields: [],
  completion: "ready",
};
const compareStart = (from: "scene" | "form" = "scene"): FlowAction => ({
  type: "compare/start",
  from,
  payload: PAYLOAD,
  weighing: { building: "Mockup Crest Tower", sales: 11 },
});

describe("flowReducer: a read goes to the scene's decision, never to the form", () => {
  it("reading → the decision point → comparing → result, with URL steps in sync", () => {
    let s = initialFlowState;
    expect(stepOf(s.phase)).toBe("home");

    s = flowReducer(s, start());
    expect(s).toMatchObject({ phase: "reading", readStage: "preparing", image: IMAGE, readInput: "image", slow: false });
    expect(stepOf(s.phase)).toBe("compare");
    s = flowReducer(s, { type: "read/stage", readId: 1, stage: "reading" });
    s = flowReducer(s, { type: "read/slow", readId: 1 });
    expect(s).toMatchObject({ readStage: "reading", slow: true });

    s = flowReducer(s, done());
    // Not the form: the hook decides at once (asking with no question is that instant).
    expect(s).toMatchObject({
      phase: "asking",
      question: null,
      source: "claude",
      extracted: FIXTURE_EXTRACT_OK.fields,
      match: FIXTURE_EXTRACT_OK.match,
      completion: "ready",
      readDoneAt: 1000,
      slow: false,
    });
    expect(s.matchKey).toBe(matchQueryKey({ ...FIXTURE_EXTRACT_OK.fields, buildingText: "Mockup Crest", bedrooms: 2, completion: "ready" }));
    expect(stepOf(s.phase)).toBe("compare");

    s = flowReducer(s, compareStart());
    expect(s).toMatchObject({ phase: "comparing", compareFrom: "scene", lastPayload: PAYLOAD, middleShown: false });
    s = flowReducer(s, { type: "middle/show" });
    expect(s.middleShown).toBe(true);
    s = flowReducer(s, { type: "compare/done", check: FIXTURE_CHECK_MARINA });
    expect(s).toMatchObject({ phase: "result", check: FIXTURE_CHECK_MARINA, fresh: true, middleShown: false });
    expect(s.results[FIXTURE_CHECK_MARINA.code]).toMatchObject({ check: FIXTURE_CHECK_MARINA, image: IMAGE });
    expect(stepOf(s.phase)).toBe("result");
  });

  it("ignores stale read results (another read started, or Stop)", () => {
    let s = run([start(1), start(2)]);
    s = flowReducer(s, done(FIXTURE_EXTRACT_OK, 1));
    expect(s.phase).toBe("reading");
    s = flowReducer(s, { type: "read/stop" });
    expect(s).toMatchObject({ phase: "idle", stopped: true, image: IMAGE });
    expect(flowReducer(s, done(FIXTURE_EXTRACT_OK, 2))).toBe(s);
    expect(flowReducer(s, { type: "read/fail", readId: 2, failure: TIMEOUT_FAILURE })).toBe(s);
  });

  it("each question: ask, answer (merged over the read), the next decision", () => {
    let s = run([start(), done({ ...FIXTURE_EXTRACT_OK, fields: { ...FIXTURE_EXTRACT_OK.fields, priceAed: null } })]);
    s = flowReducer(s, { type: "question/ask", question: { kind: "field", field: "priceAed" } });
    expect(s).toMatchObject({ phase: "asking", question: { kind: "field", field: "priceAed" } });
    s = flowReducer(s, { type: "question/answer", answers: { priceAed: 2_450_000 } });
    expect(s).toMatchObject({ phase: "asking", question: null, answers: { priceAed: 2_450_000 } });
    // The building question: a row or None of these.
    s = flowReducer(s, { type: "question/ask", question: { kind: "building" } });
    s = flowReducer(s, { type: "question/pick", buildingId: 1 });
    expect(s).toMatchObject({ question: null, pickedBuildingId: 1 });
    // A renamed building drops the choice.
    s = flowReducer(s, { type: "question/ask", question: { kind: "field", field: "buildingText" } });
    s = flowReducer(s, { type: "question/answer", answers: { buildingText: "Mockup Crest Tower 2" } });
    expect(s.pickedBuildingId).toBeUndefined();
  });

  it("outcome: a rental asks, and 'It's for sale, continue' is remembered", () => {
    let s = run([start(), done({ ...FIXTURE_EXTRACT_OK, outcome: "rental" })]);
    expect(s).toMatchObject({ outcome: "rental", outcomeAccepted: false });
    s = flowReducer(s, { type: "question/ask", question: { kind: "outcome", outcome: "rental" } });
    s = flowReducer(s, { type: "outcome/accept" });
    expect(s).toMatchObject({ phase: "asking", question: null, outcomeAccepted: true, extracted: FIXTURE_EXTRACT_OK.fields });
  });

  it("a building match runs in the scene, then the decision again", () => {
    let s = run([start(), done(), { type: "match/start" }]);
    expect(s.phase).toBe("matching");
    const match = { ...FIXTURE_EXTRACT_OK.match, towerCheck: false };
    s = flowReducer(s, { type: "match/done", match, key: "k" });
    expect(s).toMatchObject({ phase: "asking", question: null, match, matchKey: "k" });
  });

  it("the partial read and failures stay in the scene", () => {
    let s = run([start(), done(), { type: "read/partial" }]);
    expect(s).toMatchObject({ phase: "readFailed", partial: true, failure: null });
    expect(stepOf(s.phase)).toBe("compare");
    s = run([start(), { type: "read/fail", readId: 1, failure: TIMEOUT_FAILURE }]);
    expect(s).toMatchObject({ phase: "readFailed", failure: TIMEOUT_FAILURE, image: IMAGE, partial: false });
    s = flowReducer(s, start(2));
    expect(s).toMatchObject({ phase: "reading", failure: null, image: IMAGE });
  });

  it("a compare failure keeps the payload for Try again; a match failure resumes at the decision", () => {
    const f = compareFailure(500, { code: "internal", message: "x" }, "compare");
    let s = run([start(), done(), compareStart(), { type: "compare/fail", failure: f }]);
    expect(s).toMatchObject({ phase: "compareFailed", lastPayload: PAYLOAD, failure: { title: "fail.compare", actions: ["retry", "edit"] } });
    s = run([start(), done(), { type: "match/start" }, { type: "compare/fail", failure: compareFailure(0, { code: "internal", message: "" }, "match") }]);
    expect(s.phase).toBe("compareFailed");
    expect(flowReducer(s, { type: "scene/resume" })).toMatchObject({ phase: "asking", question: null, failure: null });
  });

  it("validation_failed from the server opens the form with the field errors", () => {
    const s = run([start(), done(), compareStart(), { type: "compare/invalid", fields: { "fields.sizeSqft": "Enter the size" } }]);
    expect(s).toMatchObject({ phase: "details", formReason: "fix", serverErrors: { "fields.sizeSqft": "Enter the size" } });
  });

  it("the form: typed from home (empty), from the read (partial, Type all the details), and Edit round trip", () => {
    const typed = flowReducer(initialFlowState, { type: "details/manual" });
    expect(typed).toMatchObject({ phase: "details", formReason: "typed", source: "manual", extracted: null });

    const partial = run([start(), done(), { type: "read/partial" }, { type: "details/fromRead", reason: "partial" }]);
    expect(partial).toMatchObject({ phase: "details", formReason: "partial", extracted: FIXTURE_EXTRACT_OK.fields });

    let s = run([start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    const formKey = s.formKey;
    s = flowReducer(s, { type: "nav/edit" });
    expect(s).toMatchObject({ phase: "details", formReason: "edit", check: FIXTURE_CHECK_MARINA, formKey });
    // Compare price from the form: the scene from weighing, then a second result.
    s = flowReducer(s, compareStart("form"));
    expect(s).toMatchObject({ phase: "comparing", compareFrom: "form" });
    s = flowReducer(s, { type: "compare/done", check: FIXTURE_CHECK_JVC });
    expect(Object.keys(s.results)).toEqual([FIXTURE_CHECK_MARINA.code, FIXTURE_CHECK_JVC.code]);
    // Back and Forward show a kept result as it was, without the settle.
    s = flowReducer(s, { type: "nav/result", code: FIXTURE_CHECK_MARINA.code });
    expect(s).toMatchObject({ phase: "result", check: FIXTURE_CHECK_MARINA, fresh: false, image: IMAGE });
    expect(flowReducer(s, { type: "nav/result", code: "NOPE00" })).toBe(s);
  });

  it("pasted text parsed locally enters the scene with the numbers and no building", () => {
    const s = flowReducer(initialFlowState, { type: "text/local", fields: { bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 }, text: "2BR", at: 5 });
    expect(s).toMatchObject({ phase: "asking", source: "text", localParse: true, readInput: "text", image: null, match: null, completion: undefined });
    expect(s.extracted).toEqual({ buildingText: null, areaText: null, bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 });
  });

  it("Claude off: extract_unavailable switches the flow to typing, kept across a reset", () => {
    const s = run([start(), { type: "read/fail", readId: 1, failure: failureFromApi(503, { code: "extract_unavailable", message: "" }, 0) }]);
    expect(s.claudeOff).toBe(true);
    expect(flowReducer(s, { type: "reset" }).claudeOff).toBe(true);
  });

  it("there is no sample path and no outcome phase any more", () => {
    expect(initialFlowState).not.toHaveProperty("sampleId");
    expect(flowReducer(initialFlowState, { type: "sample/start" } as unknown as FlowAction)).toBe(initialFlowState);
    expect(flowReducer(initialFlowState, { type: "outcome/continue" } as unknown as FlowAction)).toBe(initialFlowState);
  });

  it("reset empties the flow but keeps the ref, the reading switch and the kept results", () => {
    const s = run([{ type: "ref/set", ref: "K7Q2MX" }, start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }, { type: "claude/off" }, { type: "reset" }]);
    expect(s).toMatchObject({ phase: "idle", image: null, extracted: null, check: null, ref: "K7Q2MX", claudeOff: true });
    expect(s.results[FIXTURE_CHECK_MARINA.code]).toBeDefined();
  });

  it("removing the image drops the contact-details offer", () => {
    const withContact = run([start(), done({ ...FIXTURE_EXTRACT_OK, contactDetailsVisible: true })]);
    expect(flowReducer(withContact, { type: "image/set", image: null })).toMatchObject({ image: null, contactDetailsVisible: false });
  });
});

describe("failures in the scene's language (docs/REDESIGN.md section 7.6)", () => {
  it("maps every read error to a short title, a detail and a way out", () => {
    const f = (code: Parameters<typeof failureFromApi>[1]["code"], message = "") => failureFromApi(422, { code, message }, 0);
    expect(failureFromApi(0, { code: "internal", message: "" }, 0)).toMatchObject({ code: "offline", title: "fail.offline", message: COPY["error.offline"] });
    expect(f("extract_refused")).toMatchObject({ title: "fail.refused", message: COPY["error.refused"], actions: ["type", "another"] });
    expect(f("extract_unreadable")).toMatchObject({ title: "fail.cutShort", actions: ["retry", "type"] });
    expect(f("extract_timeout")).toMatchObject({ title: "fail.timeout" });
    expect(f("unsupported_image")).toMatchObject({ title: "fail.image", detail: COPY["fail.imageHint"], actions: ["another", "type"] });
    expect(f("image_too_large")).toMatchObject({ title: "fail.image", detail: COPY["apiError.image_too_large"] });
    expect(f("internal")).toMatchObject({ title: "fail.read", message: COPY["error.readFailed"] });
    expect(f("extract_unavailable")).toMatchObject({ title: "fail.off", detail: COPY["fail.offHint"], actions: ["type"] });
    expect(f("daily_cap_reached")).toMatchObject({ title: "fail.limit", detail: COPY["rate.dailyCap"], actions: ["type"] });
    expect(f("rate_limited", "Wait 3 minutes")).toMatchObject({ title: "fail.limit", message: "Wait 3 minutes", detail: "Wait 3 minutes" });
    expect(TIMEOUT_FAILURE).toMatchObject({ title: "fail.timeout", message: COPY["error.timeout"] });
    expect(BAD_IMAGE_FAILURE).toMatchObject({ title: "fail.image", message: COPY["error.badImage"] });
    expect(compareFailure(429, { code: "rate_limited", message: "Too many" }, "compare")).toMatchObject({ title: "fail.compare", detail: "Too many" });
    expect(compareFailure(500, { code: "internal", message: "x" }, "compare")).toMatchObject({ detail: null, message: COPY["error.compareFailed"] });
  });

  it("busy: Try again is enabled 30 s later, or after the server's Retry-After", () => {
    const now = 1_000_000;
    const f = failureFromApi(503, { code: "extract_busy", message: "busy" }, now);
    expect(f).toMatchObject({ title: "fail.busy", message: COPY["rate.busy"], actions: ["retry", "type"], retryAt: now + 30_000 });
    expect(failureFromApi(503, { code: "extract_busy", message: "", retryAfterSec: 12 }, now).retryAt).toBe(now + 12_000);
    expect(secondsUntil(f.retryAt, now + 6_100)).toBe(24);
    expect(secondsUntil(null, now)).toBe(0);
  });
});

describe("the form's draft and the weighing caption", () => {
  it("a confident read's draft: the merged values and the compared building", () => {
    const s = run([start(), done(), { type: "question/ask", question: { kind: "field", field: "priceAed" } }, { type: "question/answer", answers: { priceAed: 2_400_000 } }, compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    const d = draftFromState(s);
    expect(d.values).toEqual({ buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_400_000 });
    expect(d.pick).toBe("b:1");
    expect(d.candidates).toEqual(FIXTURE_EXTRACT_OK.match.candidates);
    expect(d.queryKey).toBe(s.matchKey);
  });

  it("None of these and a searched building come back as the form's choice", () => {
    const base = run([start(), done(), { type: "question/ask", question: { kind: "building" } }]);
    expect(draftFromState(flowReducer(base, { type: "question/pick", buildingId: null })).pick).toBe("none");
    const searched = draftFromState(flowReducer(base, { type: "question/pick", buildingId: 3, building: { buildingId: 3, name: "Fake Vista Residences", area: "JVC" } }));
    expect(searched.pick).toBe("b:3");
    expect(searched.extra.map((e) => e.buildingId)).toEqual([3]);
  });

  it("the weighing caption names the chosen building and its sales count", () => {
    const s = run([start(), done()]);
    expect(weighingFor(s, PAYLOAD)).toEqual({ building: "Mockup Crest Tower", sales: 11 });
    expect(weighingFor(s, { ...PAYLOAD, buildingId: null })).toEqual({ building: "Mockup Crest", sales: null });
  });

  it("editedFields counts only read fields the person changed", () => {
    const ex = FIXTURE_EXTRACT_OK.fields;
    expect(editedFieldsOf(null, { buildingText: "x", areaText: null })).toEqual([]);
    expect(editedFieldsOf(ex, { buildingText: "Mockup Crest ", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 })).toEqual([]);
    expect(editedFieldsOf(ex, { buildingText: "Mockup Crest Tower", areaText: "Marina", bedrooms: 3, sizeSqft: 1300, priceAed: 2_400_000 })).toEqual([
      "buildingText",
      "areaText",
      "bedrooms",
      "sizeSqft",
      "priceAed",
    ]);
  });

  it("lists errors in field order, the psf message once, then the building choice", () => {
    const psf = "That works out to AED 7,000 per sq ft, which looks wrong. Check the size and price.";
    expect(listErrors({ priceAed: psf, sizeSqft: psf, bedrooms: COPY["err.bedrooms"] }, COPY["err.pick"]).map((e) => e.key)).toEqual(["bedrooms", "sizeSqft", "pick"]);
  });

  it("coverage line: names the basis, and below MIN_SALES (0 included) says the building can't be compared", () => {
    const rules = { minSales: 5, windowDays: 365 };
    expect(coverageLine(11, 2, "ready", rules)).toBe("11 ready two-bed sales in 12 months");
    expect(coverageLine(4, 2, "ready", rules)).toBe("Only 4 ready two-bed sales in 12 months: Fairsquare needs 5 to compare");
    expect(coverageLine(0, 3, "ready", rules)).toBe("No ready three-bed sales in 12 months: Fairsquare needs 5 to compare");
    expect(coverageLine(null, 2, "ready", rules)).toBeNull();
  });

  it("a result is announced with the stale-data note, which sits above the focused heading", () => {
    const sentence = resultAnnouncement(FIXTURE_CHECK_MARINA, { stale: false, dataThrough: "2026-11-17" });
    expect(sentence).toMatch(/^14\.0% above registered sales\. Mockup Crest, ready 2-bed, AED 1,908 per sq ft, 14\.0% above the median of 11 registered sales\./);
    expect(resultAnnouncement(FIXTURE_CHECK_MARINA, { stale: true, dataThrough: "2026-09-30" })).toBe(
      `${sentence} Fairsquare's sales data currently runs to 30 Sep 2026. Sales registered after that aren't included yet.`,
    );
    expect(resultAnnouncement(FIXTURE_CHECK_NONE, { stale: false, dataThrough: null })).toBe("We don't cover Nowhere Point Tower yet.");
  });

  it("the owner's listing is announced as RESULT_SPEC 2.7 words it: the verdict, the exact %, and the recent-sales note", () => {
    const aykon = CheckViewSchema.parse(
      (JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "aykon-check.json"), "utf8")) as { check: unknown }).check,
    );
    expect(resultAnnouncement(aykon, { stale: false, dataThrough: "2026-11-16" })).toBe(
      "In line with registered sales. Aykon City Tower C, ready 2-bed, AED 1,786 per sq ft, 1.4% above the median of 43 registered sales. Recent sales are lower.",
    );
  });

  it("a match's counts are dropped once the result's bedrooms or basis no longer match what it was asked with", () => {
    const match: MatchResponse = {
      candidates: [
        { buildingId: 3491, name: "Aykon City (2) -Tower C", area: "Business Bay", strength: "strong", salesForBedrooms: 43, sizes: [{ sqft: 815, sales: 31 }], basisSales: { ready: 43, offPlan: 0 } },
      ],
      preselectId: 3491,
      towerCheck: false,
      areaCheck: false,
    };
    const key = matchQueryKey({ buildingText: "Aykon City Tower C", areaText: "Business Bay", bedrooms: 2, completion: "ready" });
    const two = { bedrooms: 2, analysis: { ...FIXTURE_CHECK_MARINA.analysis, completionBasis: "ready" as const } };
    expect(matchForCheck(match, key, two)).toBe(match);
    // Edit, Bedrooms 3: no 2-bed count beside a 3-bed result.
    const three = matchForCheck(match, key, { ...two, bedrooms: 3 });
    expect(three?.candidates[0]).toEqual({ buildingId: 3491, name: "Aykon City (2) -Tower C", area: "Business Bay", strength: "strong", salesForBedrooms: null });
    // Ready or off-plan changed: the ready and off-plan counts for 2-beds still hold.
    const offPlan = matchForCheck(match, key, { ...two, analysis: { ...two.analysis, completionBasis: "off_plan" } });
    expect(offPlan?.candidates[0]).toMatchObject({ salesForBedrooms: null, basisSales: { ready: 43, offPlan: 0 } });
    expect(offPlan?.candidates[0]).not.toHaveProperty("sizes");
    expect(matchForCheck(null, key, two)).toBeNull();
    expect(matchForCheck(match, null, { ...two, bedrooms: 3 })).toBe(match);
  });
});

describe("URL steps (docs/REDESIGN.md section 6.5)", () => {
  it("reads and writes ?step=compare, ?step=details and ?step=result&code=, keeping other params", () => {
    const base = "http://localhost:3000/?ref=K7Q2MX";
    expect(flowUrl("compare", null, base)).toBe("/?ref=K7Q2MX&step=compare");
    expect(flowUrl("details", null, base)).toBe("/?ref=K7Q2MX&step=details");
    expect(flowUrl("result", "H8PT5W", "http://localhost:3000/?ref=K7Q2MX&step=compare")).toBe("/?ref=K7Q2MX&step=result&code=H8PT5W");
    expect(flowUrl("home", null, "http://localhost:3000/?step=result&code=H8PT5W")).toBe("/");
    expect(readUrlStep("http://localhost:3000/?step=result&code=h8pt5w")).toEqual({ step: "result", code: "H8PT5W" });
    expect(readUrlStep("http://localhost:3000/?step=compare")).toEqual({ step: "compare", code: null });
    expect(readUrlStep("http://localhost:3000/?step=details")).toEqual({ step: "details", code: null });
    expect(readUrlStep("http://localhost:3000/")).toEqual({ step: "home", code: null });
  });
});

describe("review fixes: Back, Continue, kept results, captions and the read line", () => {
  it("Back from a result goes home without the screenshot (Forward still has it); Back from a question keeps it for Continue", () => {
    const result = run([start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    const home = flowReducer(result, { type: "nav/home" });
    expect(home).toMatchObject({ phase: "idle", image: null, stopped: false, resumable: false });
    expect(flowReducer(home, { type: "nav/result", code: FIXTURE_CHECK_MARINA.code })).toMatchObject({ phase: "result", image: IMAGE });

    let s = run([start(), done(), { type: "question/ask", question: { kind: "building" } }]);
    s = flowReducer(s, { type: "nav/home", resumable: true });
    expect(s).toMatchObject({ phase: "idle", image: IMAGE, stopped: false, resumable: true, question: null });
    s = flowReducer(s, { type: "scene/resume" });
    expect(s).toMatchObject({ phase: "asking", question: null, resumable: false, extracted: FIXTURE_EXTRACT_OK.fields });
    // Nothing was read: there is nothing to resume.
    expect(flowReducer(flowReducer(initialFlowState, { type: "details/manual" }), { type: "nav/home", resumable: true })).toMatchObject({ resumable: false });
  });

  it("Stop on pasted text keeps the text for Try again", () => {
    const s = run([{ type: "read/start", readId: 1, input: "text", text: "2BR Mockup Crest" }, { type: "read/stop" }]);
    expect(s).toMatchObject({ phase: "idle", stopped: true, pastedText: "2BR Mockup Crest", readInput: "text", image: null });
  });

  it("a kept result comes back with what it was made from", () => {
    let s = run([start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    s = flowReducer(s, { type: "nav/edit" });
    const edited: SubmitPayload = { ...PAYLOAD, fields: { ...PAYLOAD.fields, priceAed: 1_000_000 }, editedFields: ["priceAed"] };
    s = flowReducer(s, { type: "compare/start", from: "form", payload: edited, weighing: { building: null, sales: null } });
    s = flowReducer(s, { type: "compare/done", check: FIXTURE_CHECK_JVC });
    expect(s).toMatchObject({ compareFrom: "form", lastPayload: edited, resettle: false });
    const back = flowReducer(s, { type: "nav/result", code: FIXTURE_CHECK_MARINA.code });
    expect(back).toMatchObject({ check: FIXTURE_CHECK_MARINA, compareFrom: "scene", lastPayload: PAYLOAD, source: "claude" });
    // The form starts again from that result's values.
    expect(back.formKey).toBeGreaterThan(s.formKey);
  });

  it("a change in place (RESULT_SPEC section 7): the result stays, the change becomes an answer, the new result re-settles; Back restores the old one", () => {
    let s = run([start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    const formKey = s.formKey;
    const { payload, sizeSource, answers } = changedPayload(FIXTURE_CHECK_MARINA, s.extracted, { field: "priceAed", value: 2_100_000 });
    expect(payload).toMatchObject({ fields: { ...PAYLOAD.fields, priceAed: 2_100_000 }, buildingId: FIXTURE_CHECK_MARINA.building?.id, editedFields: ["priceAed"] });
    expect(answers).toEqual({ priceAed: 2_100_000 });
    s = flowReducer(s, { type: "compare/start", from: "result", payload, weighing: { building: null, sales: null }, answers, sizeSource });
    // Pending: still the old check on screen (the view stays the result), no caption until SHOW_AFTER.
    expect(s).toMatchObject({ phase: "comparing", compareFrom: "result", check: FIXTURE_CHECK_MARINA, middleShown: false, lastPayload: payload });
    expect(s.answers.priceAed).toBe(2_100_000);
    expect(s.formKey).toBeGreaterThan(formKey);
    s = flowReducer(s, { type: "compare/done", check: FIXTURE_CHECK_JVC });
    expect(s).toMatchObject({ phase: "result", check: FIXTURE_CHECK_JVC, fresh: true, resettle: true });
    // Back to the first code brings back what it was made from (the change goes with it).
    const back = flowReducer(s, { type: "nav/result", code: FIXTURE_CHECK_MARINA.code });
    expect(back).toMatchObject({ check: FIXTURE_CHECK_MARINA, fresh: false, resettle: false, lastPayload: PAYLOAD });
    expect(back.answers.priceAed).toBeUndefined();

    // Back while the change is still in flight restores the result it changed too.
    let p = run([start(), done(), compareStart(), { type: "compare/done", check: FIXTURE_CHECK_MARINA }]);
    p = flowReducer(p, { type: "compare/start", from: "result", payload, weighing: { building: null, sales: null }, answers, sizeSource });
    const left = flowReducer(p, { type: "nav/result", code: FIXTURE_CHECK_MARINA.code });
    expect(left).toMatchObject({ phase: "result", check: FIXTURE_CHECK_MARINA, lastPayload: PAYLOAD });
  });

  it("changedPayload: a size button keeps 'about'; a building change picks it (or None of these); completion", () => {
    const c = FIXTURE_CHECK_MARINA;
    const size = changedPayload(c, null, { field: "sizeSqft", value: 1290, source: "cluster" });
    expect(size).toMatchObject({ sizeSource: "cluster", answers: { sizeSqft: 1290, sizeSource: "cluster" }, payload: { fields: { sizeSqft: 1290 } } });
    const none = changedPayload(c, null, { field: "building", value: null });
    expect(none.payload.buildingId).toBeNull();
    expect(none.picked).toBeNull();
    const other = changedPayload(c, null, { field: "building", value: { buildingId: 3, name: "Fake Vista Residences", area: "JVC" } });
    expect(other.payload.buildingId).toBe(3);
    expect(changedPayload(c, null, { field: "completion", value: "off_plan" }).payload.completion).toBe("off_plan");
    expect(changedPayload(c, null, { field: "bedrooms", value: 3 }).payload.fields.bedrooms).toBe(3);
  });

  it("the scene's caption is never empty: straight after a read it waits; after a question the next one shows at once", () => {
    expect(sceneCaption(run([start(), done(), compareStart()]))).toBe(COPY["read.reading"]);
    const picked = run([start(), done(), { type: "question/ask", question: { kind: "building" } }, { type: "question/pick", buildingId: 1 }, compareStart()]);
    expect(picked.middleShown).toBe(true);
    expect(sceneCaption(picked)).toBe(COPY["scene.weighing"]);
    const named = run([
      start(),
      done(),
      { type: "question/ask", question: { kind: "field", field: "buildingText" } },
      { type: "question/answer", answers: { buildingText: "Mockup Crest Tower" } },
      { type: "match/start" },
    ]);
    expect(sceneCaption(named)).toBe(COPY["read.matching"]);
    // No covered building chosen: the caption claims nothing about its sales, and names no building.
    expect(weighingCaption({ covered: false })).toBe(COPY["scene.checking"]);
    expect(COPY["scene.weighing"]).not.toContain("{");
  });

  it("the fact line states the listing's own text; the evidence line names the DLD building (the read line's 'Compared with' is gone)", () => {
    const c = { ...FIXTURE_CHECK_MARINA, buildingText: "Mockup Crest", areaText: "Dubai Marina" };
    expect(factText(factOfCheck(c))).toBe("Mockup Crest, Dubai Marina. Ready 2-bed, 1,284 sq ft, AED 2,450,000.");
    expect(evidenceLine(c)?.rest).toContain(" in Mockup Crest Tower, ");
    expect(evidenceLine(FIXTURE_CHECK_NONE)).toBeNull();
  });

  it("the size source sent with a comparison: read, typed, or a size button (RESULT_SPEC section 12.2)", () => {
    const fields = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };
    const base: FlowState = { ...initialFlowState, source: "claude", extracted: fields };
    expect(sizeSourceOf(base, 1284)).toBe("read");
    expect(sizeSourceOf({ ...base, answers: { sizeSqft: 1285, sizeSource: "cluster" } }, 1285)).toBe("cluster");
    expect(sizeSourceOf({ ...base, answers: { sizeSqft: 1300, sizeSource: "typed" } }, 1300)).toBe("typed");
    // Changed in the form, or typed from home.
    expect(sizeSourceOf(base, 1300)).toBe("typed");
    expect(sizeSourceOf({ ...base, source: "manual", extracted: null }, 1284)).toBe("typed");
  });

  it("answering 'Is it ready or off-plan?' sets the completion; the weighing dots follow that basis", () => {
    let s: FlowState = { ...initialFlowState, phase: "asking", completion: "unknown" };
    s = flowReducer(s, { type: "question/answer", answers: { completion: "off_plan" } });
    expect(s.completion).toBe("off_plan");
    expect(s.answers.completion).toBe("off_plan");
    const match = {
      candidates: [{ buildingId: 1, name: "Mockup Crest Tower", area: "Dubai Marina", strength: "strong" as const, salesForBedrooms: 11, basisSales: { ready: 11, offPlan: 6 } }],
      preselectId: 1,
      towerCheck: false,
      areaCheck: false,
    };
    const fields = { buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };
    const payload = { fields, buildingId: 1, editedFields: [], completion: "off_plan" as const };
    expect(weighingFor({ match, searchPick: null, check: null }, payload).sales).toBe(6);
    expect(weighingFor({ match, searchPick: null, check: null }, { ...payload, completion: undefined }).sales).toBe(11);
  });
});