"use client";

/**
 * The compare flow's state machine (docs/REDESIGN.md section 6).
 *
 *   home ── add, drop or paste ──▶ SCENE ──────────────────────────────▶ RESULT ◀──────────────────────┐
 *                                  reading   POST /api/extract              │                           │
 *                                  (finding) GET /api/buildings/match       ├─ Edit: Change a detail ── one value, Continue:
 *                                  asking    one question at a time         │    re-settles IN PLACE with a new code (Back: the old one)
 *                                  weighing  POST /api/checks               ├─ ... Type all the details ──▶ FORM ── Compare price ──▶ SCENE ──▶ RESULT
 *                                                                           └─ Compare another listing ──▶ home
 *   home ── Type the details ──▶ FORM ── Compare price ──▶ SCENE (weighing) ──▶ RESULT
 *
 * A read never opens the form: after `read/done` the hook asks `decideNext()` (src/lib/flow) what to
 * do, and acts at once: ask one question, run a building match, compare, or show the partial read.
 * Every answer, match and accepted outcome asks again. The scene's stages follow these real events;
 * the only timers are the 8 s "still reading" line, the 4 s "still comparing" (or "still finding the
 * building") line with its way out, the 300 ms before a middle caption shows straight after a read,
 * the 400 ms read hold before the settle, the 28 s read backstop and the 20 s match and compare one.
 *
 * `flowReducer` is pure (unit-tested). `useCheckFlow` wires the side effects: downscale and
 * `api.extract` with an AbortController and the 28 s backstop, `api.match`, `api.createCheck`, the
 * URL steps (`?step=compare`, `?step=details`, `?step=result&code=`, section 6.5), the `?ref=` code
 * (state + sessionStorage), and the object URLs of the person's screenshots (revoked when no longer
 * shown). Only the downscaled copy of a screenshot is sent; the card never carries it.
 *
 * The in-place re-settle (RESULT_SPEC section 7): `changeDetail` (a row of the Change a detail sheet,
 * "Wrong building?", "Search covered buildings" on a not-covered result, the off-plan helper's
 * "Compare with ready sales") pushes `?step=compare` and compares with `compareFrom: "result"`. The
 * result stays on screen (the view keeps the previous comparison, dimmed, with the new value in the fact
 * line); the new comparison replaces it with `resettle: true` and `?step=result&code={new}`, so Back
 * returns to the previous code. Every edit makes a new code.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { usePublicConfig } from "@/components/shell/config-provider";
import { api } from "@/lib/api/client";
import { COPY, readSlowText, staleNote, t, verdictAnnouncement, type CopyKey } from "@/lib/copy";
import { completionBasis } from "@/lib/domain/analyse";
import { parseFields, type ParsedFields } from "@/lib/domain/parse-fields";
import { normaliseCode } from "@/lib/domain/share-code";
import {
  decideNext,
  editedFieldsOf,
  matchQueryKey,
  mergedValues,
  toDetailsValues,
  type Answers,
  type DetailsValues,
  type Next,
  type Question,
  type SubmitPayload,
} from "@/lib/flow/decide-next";
import type { FlowPhase, ReadStage } from "@/lib/flow/scene-stage";
import { bedsLabel, formatInt } from "@/lib/format";
import { downscaleForUpload } from "@/lib/image/downscale";
import { log } from "@/lib/log";
import { prefersReducedMotion, READ_HOLD, SHOW_AFTER } from "@/lib/motion";
import type {
  ApiError,
  CandidateView,
  CheckSource,
  CheckView,
  Completion,
  ErrorCode,
  ExtractedFields,
  ExtractOutcome,
  ExtractResponse,
  MatchResponse,
  PropertyType,
  SizeSource,
} from "@/lib/types";

export {
  editedFieldsOf,
  matchQueryKey,
  type Answers,
  type DetailsValues,
  type FlowPhase,
  type Question,
  type ReadStage,
  type SubmitPayload,
};

// ---------- constants ----------

/** The client gives up on a read after 28 s (the server stops Claude at 24 s), A§0.1. */
export const READ_BACKSTOP_MS = 28_000;
/** "Still reading. This can take up to 20 seconds." after 8 s. */
export const SLOW_AFTER_MS = 8_000;
/** "Still comparing." (or "Still finding the building.") after 4 s, with "Type the details instead". */
export const SLOW_COMPARE_MS = 4_000;
/** A building match or comparison with no answer after 20 s ends in "Couldn't compare just now." */
export const COMPARE_BACKSTOP_MS = 20_000;
/** The balance fades in over 160 ms when the scene starts from the form: the settle waits that long. */
export const SCENE_FADE_MS = 160;
/** `extract_busy` enables "Try again" after this many seconds unless the server says otherwise. */
export const BUSY_RETRY_SEC = 30;
/** sessionStorage key for the `?ref=` share code. */
export const REF_STORAGE_KEY = "mizan.ref";
/** Results kept in this tab for Back and Forward. */
export const RESULTS_KEPT = 5;

// ---------- types ----------

/** The URL steps (section 6.5). */
export type FlowStep = "home" | "compare" | "details" | "result";
/** Recovery actions on a failure in the scene (section 7.6). */
export type ReadAction = "retry" | "type" | "another" | "edit";
export type ReadFailureCode = ErrorCode | "offline" | "timeout";

export interface ReadFailure {
  code: ReadFailureCode;
  /** The full sentence, announced (and the deck's error copy). */
  message: string;
  /** The short serif cause shown as the scene's heading. */
  title: CopyKey;
  /** An optional second line under the title. */
  detail: string | null;
  actions: ReadAction[];
  /** Epoch ms from which "Try again" is enabled (`extract_busy` countdown); null = at once. */
  retryAt: number | null;
  /** What "Try again" repeats: the read (default), the building match, or the comparison. */
  op?: "read" | "match" | "compare";
}

/** The person's screenshot: the original file (for the sheet and the card) and its object URL. */
export interface FlowImage {
  file: Blob;
  url: string;
}

export interface PickedBuilding {
  buildingId: number;
  name: string;
  area: string;
}

/**
 * What a comparison was made from: restored with its result on Back and Forward, so the read line's
 * label, "Edit details" and "Search covered buildings" use that result's values, not the newest one's.
 */
export type ResultContext = Pick<
  FlowState,
  | "source"
  | "compareFrom"
  | "lastPayload"
  | "extracted"
  | "answers"
  | "match"
  | "matchKey"
  | "pickedBuildingId"
  | "searchPick"
  | "completion"
  | "propertyType"
  | "outcome"
  | "outcomeAccepted"
  | "localParse"
  | "readInput"
  | "pastedText"
>;

/** A result shown in this tab, with what it needs to be shown again on Back and Forward. */
export interface KeptResult {
  check: CheckView;
  image: FlowImage | null;
  contactDetailsVisible: boolean;
  context?: ResultContext;
}

/**
 * One value changed in the Change a detail sheet (RESULT_SPEC section 7): the asking price, the size
 * (typed, or a size button: "about 815"), the bedrooms, ready or off-plan, or the building (a row, a
 * searched building, or None of these: `null`).
 */
export type DetailChange =
  | { field: "priceAed"; value: number }
  | { field: "sizeSqft"; value: number; source: "typed" | "cluster" }
  | { field: "bedrooms"; value: number }
  | { field: "completion"; value: "ready" | "off_plan" }
  | { field: "building"; value: PickedBuilding | null };

function contextOf(s: FlowState): ResultContext {
  return {
    source: s.source,
    compareFrom: s.compareFrom,
    lastPayload: s.lastPayload,
    extracted: s.extracted,
    answers: s.answers,
    match: s.match,
    matchKey: s.matchKey,
    pickedBuildingId: s.pickedBuildingId,
    searchPick: s.searchPick,
    completion: s.completion,
    propertyType: s.propertyType,
    outcome: s.outcome,
    outcomeAccepted: s.outcomeAccepted,
    localParse: s.localParse,
    readInput: s.readInput,
    pastedText: s.pastedText,
  };
}

/**
 * Why the form is open: typed from home, filled from the read ("Type all the details instead", a villa
 * "anyway"), a partial read, Edit on a result, or server field errors.
 */
export type FormReason = "typed" | "read" | "partial" | "edit" | "fix";

export interface FlowState {
  phase: FlowPhase;
  image: FlowImage | null;
  readId: number;
  readStage: ReadStage | null;
  /** What the last read sent ("text" for pasted listing text). */
  readInput: "image" | "text" | null;
  pastedText: string | null;
  /** "Still reading" (8 s) or "Still comparing" (4 s). */
  slow: boolean;
  failure: ReadFailure | null;
  /** Too little was read: the scene offers the form. */
  partial: boolean;
  outcome: ExtractOutcome | null;
  /** "It's for sale, continue" on a rental. */
  outcomeAccepted: boolean;
  source: CheckSource;
  /** The values as read: the baseline for `editedFields`. */
  extracted: ExtractedFields | null;
  /** What the person answered in the scene (merged over `extracted`). */
  answers: Answers;
  /** True when the pasted text was parsed in the browser (Claude off), not by Claude. */
  localParse: boolean;
  propertyType: PropertyType | undefined;
  completion: Completion | undefined;
  contactDetailsVisible: boolean;
  match: MatchResponse | null;
  /** `matchQueryKey()` of the values `match` belongs to. */
  matchKey: string | null;
  question: Question | null;
  /** undefined = not decided; null = None of these. */
  pickedBuildingId: number | null | undefined;
  /** A covered building chosen through "Search covered buildings" in the scene. */
  searchPick: PickedBuilding | null;
  /** The pending match or comparison has been pending for SHOW_AFTER: its caption shows. */
  middleShown: boolean;
  /**
   * Nothing but the reading caption has been on screen since the read started: a match or comparison
   * that follows the read keeps that caption until SHOW_AFTER (no flash for a fast answer). Any
   * question, failure, form or result ends it: the next scene caption then shows at once, so the
   * scene's heading is never empty.
   */
  quiet: boolean;
  /** Where the comparison started: the scene, the form, or a result changed in place ("result"). */
  compareFrom: "scene" | "form" | "result" | null;
  /** The weighing caption's building and the sale dots to drop; `covered: false` when no covered building was chosen. */
  weighing: { building: string | null; sales: number | null; covered?: boolean } | null;
  /** The last comparison sent, for "Try again" and "Search covered buildings". */
  lastPayload: SubmitPayload | null;
  /** The size source sent with `lastPayload` when it was set explicitly (an in-place change). */
  lastSizeSource: SizeSource | null;
  /** When the read answered (READ_HOLD). */
  readDoneAt: number | null;
  /** Bumped whenever the form gets new starting values, so it remounts with them. */
  formKey: number;
  formReason: FormReason | null;
  /** Field errors from the server (validation_failed): the form shows them. */
  serverErrors: Record<string, string> | null;
  check: CheckView | null;
  /** Results shown in this tab (at most RESULTS_KEPT), for Back and Forward. */
  results: Record<string, KeptResult>;
  /** The result just arrived from the scene (the settle plays); false when reached by Back or Forward. */
  fresh: boolean;
  /** The fresh result replaced a result in place (a re-settle: no balance, no stage). */
  resettle: boolean;
  /** Reading was stopped and the screenshot (or the pasted text) kept (home shows Try again). */
  stopped: boolean;
  /**
   * Back left the scene after the read had finished (a question, a comparison, a failed comparison):
   * home keeps the screenshot with "Continue", which returns to the scene with everything read and
   * answered, without reading again.
   */
  resumable: boolean;
  /** Learned from an `extract_unavailable` answer. */
  claudeOff: boolean;
  ref: string | null;
}

export const initialFlowState: FlowState = {
  phase: "idle",
  image: null,
  readId: 0,
  readStage: null,
  readInput: null,
  pastedText: null,
  slow: false,
  failure: null,
  partial: false,
  outcome: null,
  outcomeAccepted: false,
  source: "manual",
  extracted: null,
  answers: {},
  localParse: false,
  propertyType: undefined,
  completion: undefined,
  contactDetailsVisible: false,
  match: null,
  matchKey: null,
  question: null,
  pickedBuildingId: undefined,
  searchPick: null,
  middleShown: false,
  quiet: false,
  compareFrom: null,
  weighing: null,
  lastPayload: null,
  lastSizeSource: null,
  readDoneAt: null,
  formKey: 0,
  formReason: null,
  serverErrors: null,
  check: null,
  results: {},
  fresh: false,
  resettle: false,
  stopped: false,
  resumable: false,
  claudeOff: false,
  ref: null,
};

export type FlowAction =
  | { type: "read/start"; readId: number; input: "image" | "text"; image?: FlowImage | null; text?: string }
  | { type: "read/stage"; readId: number; stage: ReadStage }
  | { type: "read/slow"; readId: number }
  | { type: "read/done"; readId: number; response: ExtractResponse; at: number }
  | { type: "read/fail"; readId: number; failure: ReadFailure }
  | { type: "read/partial" }
  | { type: "read/stop" }
  | { type: "scene/resume" }
  | { type: "text/local"; fields: ParsedFields; text: string; at: number }
  | { type: "details/manual" }
  | { type: "details/fromRead"; reason: "partial" | "read" }
  | { type: "question/ask"; question: Question }
  | { type: "question/answer"; answers: Answers }
  | { type: "question/pick"; buildingId: number | null; building?: PickedBuilding | null }
  | { type: "outcome/accept" }
  | { type: "match/start" }
  | { type: "match/done"; match: MatchResponse; key: string }
  | { type: "middle/show" }
  | {
      type: "compare/start";
      from: "scene" | "form" | "result";
      payload: SubmitPayload;
      weighing: { building: string | null; sales: number | null };
      /** In place ("result"): the changed value as an answer, so the form and later edits start from it. */
      answers?: Answers;
      /** In place: the size source sent (kept for the fact line's "about"). */
      sizeSource?: SizeSource;
      /** In place: the building chosen (a searched one is kept for the form's options). */
      picked?: PickedBuilding | null;
    }
  | { type: "compare/slow" }
  | { type: "compare/done"; check: CheckView }
  | { type: "compare/fail"; failure: ReadFailure }
  | { type: "compare/invalid"; fields: Record<string, string> }
  | { type: "image/set"; image: FlowImage | null }
  /** `stopped`: a read stopped (Try again reads again); `resumable`: a finished read left (Continue). */
  | { type: "nav/home"; stopped?: boolean; resumable?: boolean }
  | { type: "nav/edit" }
  | { type: "nav/details" }
  | { type: "nav/result"; code: string }
  | { type: "reset" }
  | { type: "ref/set"; ref: string | null }
  | { type: "claude/off" };

/** Which URL step a phase belongs to. */
export function stepOf(phase: FlowPhase): FlowStep {
  if (phase === "idle") return "home";
  if (phase === "details") return "details";
  if (phase === "result") return "result";
  return "compare";
}

/** The phases the processing scene draws (the balance, captions, questions and failures). */
export function inScene(phase: FlowPhase): boolean {
  return stepOf(phase) === "compare";
}

const EMPTY_EXTRACTED: ExtractedFields = {
  buildingText: null,
  areaText: null,
  bedrooms: null,
  sizeSqft: null,
  priceAed: null,
};

const failure = (
  code: ReadFailureCode,
  message: string,
  title: CopyKey,
  actions: ReadAction[],
  detail: string | null = null,
  retryAt: number | null = null,
): ReadFailure => ({ code, message, title, detail, actions, retryAt });

/** A read failure for an API error (docs/REDESIGN.md section 7.6). `status` 0 = offline. */
export function failureFromApi(status: number, error: Pick<ApiError, "code" | "message" | "retryAfterSec">, now: number): ReadFailure {
  if (status === 0) return failure("offline", COPY["error.offline"], "fail.offline", ["retry", "type"]);
  const code = error.code;
  switch (code) {
    case "extract_busy":
      return failure(code, COPY["rate.busy"], "fail.busy", ["retry", "type"], null, now + (error.retryAfterSec ?? BUSY_RETRY_SEC) * 1000);
    case "extract_unavailable":
      return failure(code, COPY["claudeOff.notice"], "fail.off", ["type"], COPY["fail.offHint"]);
    case "rate_limited": {
      // The server's text depends on the scope ("Wait {n} minutes" for the burst limit).
      const message = error.message || COPY["rate.spam"];
      return failure(code, message, "fail.limit", ["type"], message);
    }
    case "daily_cap_reached":
      return failure(code, COPY["rate.dailyCap"], "fail.limit", ["type"], COPY["rate.dailyCap"]);
    case "extract_refused":
      return failure(code, COPY["error.refused"], "fail.refused", ["type", "another"]);
    case "extract_unreadable":
      return failure(code, COPY["error.cutShort"], "fail.cutShort", ["retry", "type"]);
    case "extract_timeout":
      return failure(code, COPY["error.timeout"], "fail.timeout", ["retry", "type"]);
    case "unsupported_image":
    case "image_rejected":
      return failure(code, COPY["error.badImage"], "fail.image", ["another", "type"], COPY["fail.imageHint"]);
    case "image_too_large":
      return failure(code, COPY["apiError.image_too_large"], "fail.image", ["another", "type"], COPY["apiError.image_too_large"]);
    case "empty_input":
      return failure(code, COPY["apiError.empty_input"], "fail.image", ["another", "type"], COPY["apiError.empty_input"]);
    default:
      return failure(code, COPY["error.readFailed"], "fail.read", ["retry", "type"]);
  }
}

/** A comparison (or building match) that failed in the scene: "Couldn't compare just now." */
export function compareFailure(status: number, error: Pick<ApiError, "code" | "message">, op: "match" | "compare"): ReadFailure {
  if (status === 0) return { ...failure("offline", COPY["error.offline"], "fail.compare", ["retry", "edit"]), op };
  const detail = error.code === "rate_limited" || error.code === "building_not_found" ? error.message || null : null;
  return { ...failure(error.code, detail ?? COPY["error.compareFailed"], "fail.compare", ["retry", "edit"], detail), op };
}

/** A building match or comparison that got no answer within COMPARE_BACKSTOP_MS: "Couldn't compare just now." */
export function compareTimeout(op: "match" | "compare"): ReadFailure {
  return { ...failure("timeout", COPY["error.compareFailed"], "fail.compare", ["retry", "edit"]), op };
}

/** The client-side 28 s backstop. */
export const TIMEOUT_FAILURE: ReadFailure = failure("timeout", COPY["error.timeout"], "fail.timeout", ["retry", "type"]);

/** The screenshot could not be decoded in the browser (HEIC outside Safari, a corrupt file). */
export const BAD_IMAGE_FAILURE: ReadFailure = failure(
  "unsupported_image",
  COPY["error.badImage"],
  "fail.image",
  ["another", "type"],
  COPY["fail.imageHint"],
);

/** Leaves the scene's transient state for a fresh start (keeps the image and anything compared). */
function clearScene(state: FlowState): FlowState {
  return {
    ...state,
    readStage: null,
    slow: false,
    failure: null,
    partial: false,
    question: null,
    middleShown: false,
    stopped: false,
    resumable: false,
  };
}

/** A fresh read or parse: what was read, nothing answered, nothing chosen. */
function fromRead(
  state: FlowState,
  r: Pick<ExtractResponse, "outcome" | "fields" | "propertyType" | "completion" | "contactDetailsVisible"> & {
    match: MatchResponse | null;
  },
  source: CheckSource,
  localParse: boolean,
  at: number,
): FlowState {
  const f = r.fields;
  return {
    ...clearScene(state),
    // "asking" with no question: the instant before the hook decides (never rendered on its own).
    phase: "asking",
    outcome: r.outcome === "ok" ? null : r.outcome,
    outcomeAccepted: false,
    source,
    extracted: f,
    answers: {},
    localParse,
    propertyType: r.propertyType,
    completion: r.completion,
    contactDetailsVisible: r.contactDetailsVisible,
    match: r.match,
    matchKey: r.match
      ? matchQueryKey({ buildingText: f.buildingText ?? "", areaText: f.areaText, bedrooms: f.bedrooms ?? undefined, completion: r.completion })
      : null,
    pickedBuildingId: undefined,
    searchPick: null,
    compareFrom: null,
    weighing: null,
    lastPayload: null,
    readDoneAt: at,
    formKey: state.formKey + 1,
    formReason: null,
    serverErrors: null,
    check: null,
    fresh: false,
  };
}

function keepResult(results: Record<string, KeptResult>, kept: KeptResult): Record<string, KeptResult> {
  const next = { ...results, [kept.check.code]: kept };
  const codes = Object.keys(next);
  for (const code of codes.slice(0, Math.max(0, codes.length - RESULTS_KEPT))) delete next[code];
  return next;
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "read/start":
      return {
        ...clearScene(state),
        phase: "reading",
        readId: action.readId,
        readStage: action.input === "image" ? "preparing" : "reading",
        readInput: action.input,
        pastedText: action.input === "text" ? (action.text ?? null) : null,
        image: action.input === "image" ? (action.image ?? state.image) : null,
        contactDetailsVisible: action.input === "image" ? state.contactDetailsVisible : false,
        quiet: true,
        compareFrom: null,
        weighing: null,
        check: null,
        fresh: false,
      };
    case "read/stage":
      if (state.phase !== "reading" || action.readId !== state.readId) return state;
      return { ...state, readStage: action.stage };
    case "read/slow":
      if (state.phase !== "reading" || action.readId !== state.readId || state.slow) return state;
      return { ...state, slow: true };
    case "read/done":
      if (state.phase !== "reading" || action.readId !== state.readId) return state;
      return fromRead(state, action.response, state.readInput === "text" ? "text" : "claude", false, action.at);
    case "read/fail":
      if (state.phase !== "reading" || action.readId !== state.readId) return state;
      return {
        ...clearScene(state),
        phase: "readFailed",
        failure: action.failure,
        quiet: false,
        claudeOff: state.claudeOff || action.failure.code === "extract_unavailable",
      };
    case "read/partial":
      return { ...clearScene(state), phase: "readFailed", partial: true, quiet: false };
    case "read/stop":
      if (state.phase !== "reading") return state;
      // The screenshot, or the pasted text, stays on home with Try again.
      return {
        ...clearScene(state),
        phase: "idle",
        quiet: false,
        stopped: state.image !== null || (state.readInput === "text" && state.pastedText !== null),
      };
    case "scene/resume":
      // Try again after a failed match, or Continue on home after Back from a finished read.
      if (state.phase !== "compareFailed" && !(state.phase === "idle" && state.resumable)) return state;
      return { ...clearScene(state), phase: "asking", quiet: false };
    case "text/local":
      return {
        ...fromRead(
          { ...state, image: null, readInput: "text", pastedText: action.text },
          {
            outcome: "ok",
            fields: {
              ...EMPTY_EXTRACTED,
              bedrooms: action.fields.bedrooms ?? null,
              sizeSqft: action.fields.sizeSqft ?? null,
              priceAed: action.fields.priceAed ?? null,
            },
            propertyType: "unknown",
            completion: "unknown",
            contactDetailsVisible: false,
            match: null,
          },
          "text",
          true,
          action.at,
        ),
        propertyType: undefined,
        completion: undefined,
      };
    case "details/manual":
      return {
        ...clearScene(state),
        phase: "details",
        source: "manual",
        outcome: null,
        outcomeAccepted: false,
        extracted: null,
        answers: {},
        localParse: false,
        propertyType: undefined,
        completion: undefined,
        contactDetailsVisible: state.image ? state.contactDetailsVisible : false,
        match: null,
        matchKey: null,
        pickedBuildingId: undefined,
        searchPick: null,
        compareFrom: null,
        lastPayload: null,
        formKey: state.formKey + 1,
        formReason: "typed",
        serverErrors: null,
        quiet: false,
        check: null,
        fresh: false,
      };
    case "details/fromRead":
      if (!inScene(state.phase)) return state;
      return { ...clearScene(state), phase: "details", formReason: action.reason, serverErrors: null, quiet: false, fresh: false };
    case "question/ask":
      if (!inScene(state.phase)) return state;
      return { ...clearScene(state), phase: "asking", question: action.question, quiet: false };
    case "question/answer": {
      if (state.phase !== "asking") return state;
      const renamed = action.answers.buildingText !== undefined || action.answers.areaText !== undefined;
      return {
        ...clearScene(state),
        phase: "asking",
        answers: { ...state.answers, ...action.answers },
        // "Is it ready or off-plan?" answered: the comparison uses that basis.
        ...(action.answers.completion ? { completion: action.answers.completion } : {}),
        ...(renamed ? { pickedBuildingId: undefined, searchPick: null } : {}),
      };
    }
    case "question/pick":
      if (state.phase !== "asking" && state.phase !== "result") return state;
      return {
        ...clearScene(state),
        phase: state.phase === "result" ? state.phase : "asking",
        pickedBuildingId: action.buildingId,
        searchPick: action.building ?? null,
      };
    case "outcome/accept":
      if (state.phase !== "asking") return state;
      return { ...clearScene(state), phase: "asking", outcomeAccepted: true };
    case "match/start":
      if (!inScene(state.phase)) return state;
      // After a question (or any screen but the reading caption) "Finding the building" shows at once.
      return { ...clearScene(state), phase: "matching", middleShown: !state.quiet };
    case "match/done":
      if (state.phase !== "matching") return state;
      return { ...clearScene(state), phase: "asking", match: action.match, matchKey: action.key };
    case "middle/show":
      if (state.phase !== "matching" && state.phase !== "comparing") return state;
      return state.middleShown ? state : { ...state, middleShown: true };
    case "compare/start": {
      if (action.from === "result") {
        // In place (RESULT_SPEC section 7): the result stays on screen (`check` is the previous one) and
        // its heading turns to the weighing caption only after SHOW_AFTER. The change becomes an answer,
        // so "Type all the details" and the next edit start from the values being compared.
        const p = action.payload;
        return {
          ...clearScene(state),
          phase: "comparing",
          middleShown: false,
          quiet: false,
          compareFrom: "result",
          lastPayload: p,
          lastSizeSource: action.sizeSource ?? state.lastSizeSource,
          weighing: action.weighing,
          answers: { ...state.answers, ...action.answers },
          ...(p.completion === "ready" || p.completion === "off_plan" ? { completion: p.completion } : {}),
          pickedBuildingId: p.buildingId,
          searchPick: action.picked !== undefined ? action.picked : state.searchPick,
          formKey: state.formKey + 1,
          formReason: null,
          serverErrors: null,
          fresh: false,
          resettle: false,
        };
      }
      return {
        ...clearScene(state),
        phase: "comparing",
        // From a question, the form or a rerun the weighing caption shows at once (the person acted).
        middleShown: !state.quiet || action.from === "form",
        quiet: state.quiet && action.from !== "form",
        compareFrom: action.from,
        lastPayload: action.payload,
        lastSizeSource: null,
        weighing: action.weighing,
        serverErrors: null,
        fresh: false,
        resettle: false,
      };
    }
    case "compare/slow":
      // "Still comparing." (or "Still finding the building.") with a way forward.
      if ((state.phase !== "comparing" && state.phase !== "matching") || state.slow) return state;
      return { ...state, slow: true };
    case "compare/done":
      if (state.phase !== "comparing") return state;
      return {
        ...clearScene(state),
        phase: "result",
        check: action.check,
        results: keepResult(state.results, {
          check: action.check,
          image: state.image,
          contactDetailsVisible: state.contactDetailsVisible,
          context: contextOf(state),
        }),
        quiet: false,
        fresh: true,
        resettle: state.compareFrom === "result",
      };
    case "compare/fail":
      if (state.phase !== "comparing" && state.phase !== "matching") return state;
      return { ...clearScene(state), phase: "compareFailed", failure: action.failure, quiet: false };
    case "compare/invalid":
      if (state.phase !== "comparing") return state;
      return { ...clearScene(state), phase: "details", formReason: "fix", serverErrors: action.fields, quiet: false };
    case "image/set":
      return {
        ...state,
        image: action.image,
        stopped: action.image ? state.stopped : false,
        resumable: action.image ? state.resumable : false,
        contactDetailsVisible: action.image ? state.contactDetailsVisible : false,
      };
    case "nav/home": {
      if (state.phase === "idle") return state;
      const stopped = (action.stopped ?? false) && (state.image !== null || (state.readInput === "text" && state.pastedText !== null));
      const resumable = !stopped && (action.resumable ?? false) && state.extracted !== null;
      return {
        ...clearScene(state),
        phase: "idle",
        stopped,
        resumable,
        quiet: false,
        fresh: false,
        // Home shows a screenshot only with Try again or Continue; any other way home leaves it, so a
        // later "Type the details" never reuses (or stamps) the previous listing's screenshot.
        ...(stopped || resumable ? {} : { image: null, contactDetailsVisible: false }),
      };
    }
    case "nav/edit":
      if (state.phase !== "result" || !state.check) return state;
      return { ...clearScene(state), phase: "details", formReason: "edit", serverErrors: null, quiet: false, fresh: false };
    case "nav/details":
      if (state.phase === "details" || (state.formKey === 0 && !state.check)) return state;
      return { ...clearScene(state), phase: "details", formReason: state.formReason ?? (state.check ? "edit" : "typed"), quiet: false, fresh: false };
    case "nav/result": {
      const kept = state.results[action.code];
      if (!kept) return state;
      if (state.phase === "result" && state.check?.code === action.code) return state;
      // Back from the form to the result it edits keeps the form's draft; any other result brings back
      // what it was made from (the form then starts from that result's values). Back from an in-place
      // change (pending or failed) restores the result it changed, so the abandoned value goes too.
      const inPlace = state.compareFrom === "result" && (state.phase === "comparing" || state.phase === "compareFailed");
      const same = state.check?.code === action.code && !inPlace;
      return {
        ...clearScene(state),
        ...(same || !kept.context ? {} : { ...kept.context, formKey: state.formKey + 1, formReason: null }),
        phase: "result",
        check: kept.check,
        image: kept.image,
        contactDetailsVisible: kept.contactDetailsVisible,
        weighing: null,
        quiet: false,
        fresh: false,
        resettle: false,
      };
    }
    case "reset":
      return {
        ...initialFlowState,
        claudeOff: state.claudeOff,
        ref: state.ref,
        results: state.results,
        formKey: state.formKey + 1,
      };
    case "ref/set":
      return { ...state, ref: action.ref };
    case "claude/off":
      return state.claudeOff ? state : { ...state, claudeOff: true };
    default:
      return state;
  }
}

// ---------- the form's starting values (shared with DetailsForm) ----------

/** "" (nothing chosen), "none" (None of these) or "b:<buildingId>". */
export type PickValue = "" | "none" | `b:${number}`;

/** Everything the form needs to come back exactly as the person left it. */
export interface DetailsDraft {
  formKey: number;
  values: DetailsValues;
  pick: PickValue;
  pickedByUser: boolean;
  /** Options added through "Search covered buildings". */
  extra: CandidateView[];
  candidates: CandidateView[];
  towerCheck: boolean;
  /** Two candidates share a name in different areas (check the area, not the tower number). */
  areaCheck: boolean;
  /** The match's pre-selected building ("Best match"): strong and not tied; null otherwise. */
  bestId: number | null;
  /** The query the candidates belong to (null: none fetched yet). */
  queryKey: string | null;
  /** Ready or off-plan: from the read when there was one; the person can change it. */
  completion?: Completion;
}

/**
 * What is announced when a result settles or re-settles (RESULT_SPEC 2.7): the verdict announcement
 * ("In line with registered sales. Aykon City Tower C, ready 2-bed, AED 1,786 per sq ft, 1.4% above the
 * median of 43 registered sales. Recent sales are lower."), then the stale-data note when there is one.
 */
export function resultAnnouncement(check: CheckView, data: Parameters<typeof staleNote>[0]): string {
  return [verdictAnnouncement(check), staleNote(data)].filter(Boolean).join(" ");
}

/**
 * The building match as a result shows it (the off-plan helper, the "Wrong building?" rows). Its sales
 * counts were made for the bedrooms and basis it was asked with (`matchKey`); after an in-place change
 * of either they no longer describe the listing, so they go and the rows stay with no counts. The
 * ready and off-plan counts (`basisSales`) hold across a basis change, not a bedrooms change.
 */
export function matchForCheck(
  match: MatchResponse | null,
  matchKey: string | null,
  check: Pick<CheckView, "bedrooms" | "analysis"> | null,
): MatchResponse | null {
  if (!match || !check || matchKey === null) return match;
  let key: unknown;
  try {
    key = JSON.parse(matchKey);
  } catch {
    return match;
  }
  if (!Array.isArray(key)) return match;
  const sameBeds = key[2] === check.bedrooms;
  const sameBasis = key[3] === check.analysis.completionBasis;
  if (sameBeds && sameBasis) return match;
  return {
    ...match,
    candidates: match.candidates.map((c) => {
      const out: CandidateView = { ...c, salesForBedrooms: null };
      delete out.sizes;
      if (!sameBeds) delete out.basisSales;
      return out;
    }),
  };
}

/** The form's starting draft: what was read, the answers, and the building chosen or compared. */
export function draftFromState(state: FlowState): DetailsDraft {
  const values = toDetailsValues(mergedValues(state.extracted, state.answers));
  const m = state.match;
  const candidates = m?.candidates ?? [];
  // The building of the last comparison wins, then the scene's choice, then the match's pre-selection.
  const chosen: number | null | undefined =
    state.lastPayload !== null ? state.lastPayload.buildingId : state.pickedBuildingId !== undefined ? state.pickedBuildingId : (m?.preselectId ?? undefined);
  const pick: PickValue = chosen === null ? "none" : chosen === undefined ? "" : `b:${chosen}`;
  const extra: CandidateView[] = [];
  if (typeof chosen === "number" && !candidates.some((c) => c.buildingId === chosen)) {
    const known =
      state.searchPick?.buildingId === chosen
        ? state.searchPick
        : state.check?.building?.id === chosen
          ? { buildingId: chosen, name: state.check.building.name, area: state.check.building.area }
          : null;
    if (known) extra.push({ ...known, strength: "possible", salesForBedrooms: null });
  }
  return {
    formKey: state.formKey,
    values,
    pick,
    pickedByUser: state.pickedBuildingId !== undefined || state.lastPayload !== null,
    extra,
    candidates,
    towerCheck: m?.towerCheck ?? false,
    areaCheck: m?.areaCheck ?? false,
    bestId: m?.preselectId ?? null,
    // The read's match counted sales for the read's completion (POST /api/extract).
    queryKey: m ? state.matchKey : null,
    ...(state.completion ? { completion: state.completion } : {}),
  };
}

/** The weighing caption's building and the dots to drop, for a payload. */
export function weighingFor(
  state: Pick<FlowState, "match" | "searchPick" | "check">,
  payload: SubmitPayload,
  more: readonly CandidateView[] = [],
): { building: string; sales: number | null } {
  const id = payload.buildingId;
  if (id === null) return { building: payload.fields.buildingText, sales: null };
  const all: CandidateView[] = [
    ...(state.match?.candidates ?? []),
    ...more,
    ...(state.searchPick ? [{ ...state.searchPick, strength: "possible" as const, salesForBedrooms: null }] : []),
  ];
  const c = all.find((x) => x.buildingId === id && (x.salesForBedrooms !== null || !all.some((y) => y.buildingId === id && y.salesForBedrooms !== null)));
  const name = c?.name ?? (state.check?.building?.id === id ? state.check.building.name : payload.fields.buildingText);
  // The preselected building counts both kinds: the dots follow the basis being compared.
  const byBasis = c?.basisSales ? (completionBasis(payload.completion) === "off_plan" ? c.basisSales.offPlan : c.basisSales.ready) : null;
  return { building: name, sales: byBasis ?? c?.salesForBedrooms ?? null };
}

/**
 * The weighing caption: "Weighing it against registered sales", or "Looking for registered sales" when
 * no covered building was chosen (None of these, or nothing similar), which claims nothing about them.
 * No building name: the read line under it already names it, and the caption keeps to two lines.
 */
export function weighingCaption(w: { covered?: boolean } | null): string {
  return w?.covered === false ? COPY["scene.checking"] : COPY["scene.weighing"];
}

/** The scene's caption for a phase (docs/REDESIGN.md section 7.3); never empty in the scene. */
export function sceneCaption(s: Pick<FlowState, "phase" | "readInput" | "quiet" | "middleShown" | "weighing" | "question">): string {
  const reading = s.readInput === "text" ? COPY["scene.readingText"] : COPY["read.reading"];
  // Straight after a read, a fast match or comparison passes under the reading caption (no flash).
  const middle = s.middleShown || !s.quiet;
  switch (s.phase) {
    case "reading":
      return reading;
    case "matching":
      return middle ? COPY["read.matching"] : reading;
    case "comparing":
      return middle ? weighingCaption(s.weighing) : reading;
    case "asking":
      // The instant between an answer and the next step (never drawn on its own).
      return s.question ? "" : s.quiet ? reading : COPY["scene.weighing"];
    default:
      return "";
  }
}

/**
 * Where a comparison's size came from (RESULT_SPEC section 12.2): a size button ("cluster", the fact
 * line then says "about"), typed (an answer or the form), or read from the listing.
 */
export function sizeSourceOf(s: Pick<FlowState, "answers" | "extracted" | "source">, sizeSqft: number): SizeSource {
  if (s.answers.sizeSqft !== undefined && s.answers.sizeSqft === sizeSqft && s.answers.sizeSource) return s.answers.sizeSource;
  if (s.source !== "manual" && s.extracted?.sizeSqft != null && s.extracted.sizeSqft === sizeSqft) return "read";
  return "typed";
}

/**
 * The comparison a change on a result sends (RESULT_SPEC section 7): the result's own values with the
 * one value changed, its building (or the one chosen), and its completion; the size source carries over
 * unless the size changed. `answers` is the change as an answer (merged into the flow's answers).
 */
export function changedPayload(
  check: CheckView,
  extracted: ExtractedFields | null,
  change: DetailChange,
  /** The size source when the comparison does not carry one (stored before sizes had a source). */
  fallbackSizeSource: SizeSource = "typed",
): { payload: SubmitPayload; sizeSource: SizeSource; answers: Answers; picked?: PickedBuilding | null } {
  const fields = {
    buildingText: check.buildingText,
    areaText: check.areaText,
    bedrooms: check.bedrooms,
    sizeSqft: check.sizeSqft,
    priceAed: check.priceAed,
  };
  let buildingId: number | null = check.building?.id ?? null;
  let completion: Completion | undefined = check.completion === "unknown" ? undefined : check.completion;
  let sizeSource: SizeSource = check.sizeSource ?? fallbackSizeSource;
  let answers: Answers = {};
  let picked: PickedBuilding | null | undefined;
  switch (change.field) {
    case "priceAed":
      fields.priceAed = change.value;
      answers = { priceAed: change.value };
      break;
    case "sizeSqft":
      fields.sizeSqft = change.value;
      sizeSource = change.source;
      answers = { sizeSqft: change.value, sizeSource: change.source };
      break;
    case "bedrooms":
      fields.bedrooms = change.value;
      answers = { bedrooms: change.value };
      break;
    case "completion":
      completion = change.value;
      answers = { completion: change.value };
      break;
    case "building":
      buildingId = change.value?.buildingId ?? null;
      picked = change.value;
      break;
  }
  const payload: SubmitPayload = {
    fields,
    buildingId,
    editedFields: editedFieldsOf(extracted, toDetailsValues(mergedValues(extracted, fields))),
    ...(completion ? { completion } : {}),
  };
  return { payload, sizeSource, answers, ...(picked !== undefined ? { picked } : {}) };
}

// ---------- URL steps ----------

interface UrlStep {
  step: FlowStep;
  code: string | null;
}

export function readUrlStep(href: string = window.location.href): UrlStep {
  const sp = new URL(href).searchParams;
  const step = sp.get("step");
  if (step === "result") return { step: "result", code: normaliseCode(sp.get("code") ?? "") };
  if (step === "details") return { step: "details", code: null };
  if (step === "compare") return { step: "compare", code: null };
  return { step: "home", code: null };
}

export function flowUrl(step: FlowStep, code?: string | null, href: string = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete("step");
  url.searchParams.delete("code");
  if (step === "details" || step === "compare") url.searchParams.set("step", step);
  if (step === "result" && code) {
    url.searchParams.set("step", "result");
    url.searchParams.set("code", code);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

interface HistoryMark {
  mizanStep?: unknown;
  /** True when the flow pushed this entry (Back may then use history.back()). */
  mizanPushed?: unknown;
}

const mark = (): HistoryMark | null => window.history.state as HistoryMark | null;

function pushStep(step: FlowStep, code?: string | null): void {
  window.history.pushState({ ...(mark() ?? {}), mizanStep: step, mizanPushed: true }, "", flowUrl(step, code));
}

/** Replaces this entry's step, keeping whether the flow pushed it. */
function replaceStep(step: FlowStep, code?: string | null): void {
  const pushed = mark()?.mizanPushed === true;
  window.history.replaceState({ ...(mark() ?? {}), mizanStep: step, mizanPushed: pushed }, "", flowUrl(step, code));
}

/** Leaves this entry: history.back() when the flow pushed it, else replace it with `fallback`. */
function leaveStep(fallback: FlowStep, code?: string | null): void {
  if (mark()?.mizanPushed === true) window.history.back();
  else replaceStep(fallback, code);
}

// ---------- the hook ----------

export type SubmitResult = { ok: true } | { ok: false; fields?: Record<string, string>; message?: string };

export interface CheckFlow {
  state: FlowState;
  step: FlowStep;
  claudeOff: boolean;
  /** A screenshot was chosen, dropped or pasted: read it at once. */
  readFile(file: File): void;
  /** "Read text" (Claude), or the local parser when reading is off. */
  readText(text: string): void;
  /** "Try again": the read, the match or the comparison that failed (or was stopped). */
  retry(): void;
  stopRead(): void;
  /** "Type the details": the empty form. */
  typeDetails(): void;
  /** The form filled with what is known (partial read, villa "anyway", "Type all the details instead"). */
  typeFromRead(): void;
  /** One question answered. */
  answer(a: Answers): void;
  /** "Which building is this?": a row, None of these (null), or a searched building. */
  pick(buildingId: number | null, building?: PickedBuilding): void;
  /** "It's for sale, continue". */
  acceptOutcome(): void;
  removeImage(): void;
  /** "Compare price" in the form: the scene from weighing, then the result. */
  compareFromForm(p: SubmitPayload): Promise<SubmitResult>;
  /** "Type all the details" (the Change a detail sheet): the form with every value of the result. */
  edit(): void;
  /** The form's Back: to the result when one exists, else home. */
  backFromDetails(): void;
  /**
   * One value changed on a result (the Change a detail sheet, RESULT_SPEC section 7): it re-settles in
   * place with a new code; Back returns to the previous one. Ignored while a change is in flight.
   */
  changeDetail(change: DetailChange): void;
  /**
   * Another building for the same listing: "Search covered buildings" on a not-covered result, or a row
   * (or None of these, `null`) of "Wrong building?". Re-settles in place.
   */
  compareWithBuilding(b: PickedBuilding | null): void;
  /** The off-plan mismatch helper's "Compare with ready sales": the same listing against ready sales, in place. */
  compareAsReady(): void;
  /** "Compare another listing": empty state, home. */
  reset(): void;
  /** The form keeps its draft here (no re-render), so leaving and coming back keeps every value. */
  saveDraft(d: DetailsDraft): void;
  getDraft(): DetailsDraft;
}

export function useCheckFlow({ initialRef = null }: { initialRef?: string | null } = {}): CheckFlow {
  const config = usePublicConfig();
  const announce = useAnnounce();
  const router = useRouter();
  const [state, dispatch] = useReducer(flowReducer, initialRef, (ref) => ({ ...initialFlowState, ref }));

  // The latest state, updated with each action as it is sent (the reducer is pure), so the async
  // steps and `decideNext` always read what the next render will show.
  const stateRef = useRef(state);
  const send = useCallback((a: FlowAction) => {
    stateRef.current = flowReducer(stateRef.current, a);
    dispatch(a);
  }, []);

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const draftRef = useRef<DetailsDraft | null>(null);
  const urlsRef = useRef(new Set<string>());
  const advanceRef = useRef<(o?: { announceRead?: boolean }) => void>(() => undefined);

  const claudeOff = !config.extractEnabled || state.claudeOff;

  // ----- object URLs: revoke every URL no longer shown (the current image and kept results stay) -----
  useEffect(() => {
    const live = new Set<string>();
    if (state.image) live.add(state.image.url);
    for (const r of Object.values(state.results)) if (r.image) live.add(r.image.url);
    for (const u of urlsRef.current) {
      if (!live.has(u)) {
        URL.revokeObjectURL(u);
        urlsRef.current.delete(u);
      }
    }
  }, [state.image, state.results]);

  const makeImage = useCallback((file: Blob): FlowImage => {
    const url = URL.createObjectURL(file);
    urlsRef.current.add(url);
    return { file, url };
  }, []);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current = [];
  }, []);

  /** Stops whatever is in flight (read, match or comparison); its late answer is ignored. */
  const cancelAll = useCallback(() => {
    seqRef.current += 1;
    clearTimers();
    const ctrl = abortRef.current;
    abortRef.current = null;
    ctrl?.abort();
  }, [clearTimers]);

  // Leaving the page (cacheComponents hides it with <Activity>, which runs this cleanup; the state is
  // kept for the way back): nothing goes on in the hidden page, so no request finishes there, no URL
  // is rewritten on another page and nothing is announced. A read in flight becomes a stopped read
  // (Try again on return), a match or comparison a resumable one (Continue). The object URLs are not
  // revoked here: the kept screenshot and results show them again when the page comes back.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      cancelAll();
      if (s.phase === "reading") send({ type: "read/stop" });
      else if (s.phase === "matching" || s.phase === "comparing") send({ type: "nav/home", resumable: true });
    };
  }, [cancelAll, send]);

  /** Puts the URL on ?step=compare when the scene starts (pushed from home or a result, replaced otherwise). */
  const enterCompareUrl = useCallback(() => {
    const step = readUrlStep().step;
    if (step === "home" || step === "result") pushStep("compare");
    else if (step === "details") replaceStep("compare");
  }, []);

  // Mount: keep ?ref, and a reload of a step URL never shows an empty step.
  useEffect(() => {
    let ref = initialRef;
    try {
      if (ref) window.sessionStorage.setItem(REF_STORAGE_KEY, ref);
      else ref = normaliseCode(window.sessionStorage.getItem(REF_STORAGE_KEY) ?? "");
    } catch {
      // storage blocked: the ref still lives in state for this page
    }
    if (ref && ref !== stateRef.current.ref) send({ type: "ref/set", ref });

    const { step, code } = readUrlStep();
    if (step === "result" && code) router.replace(`/c/${code}`);
    else if (step !== "home") window.history.replaceState({ mizanStep: "home", mizanPushed: false }, "", flowUrl("home"));
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- the building match and the comparison -----

  /**
   * The timers a building match or a comparison shares: its caption after SHOW_AFTER (only when it is
   * not on screen yet; the flow announces caption changes), the slow line after SLOW_COMPARE_MS, and
   * the COMPARE_BACKSTOP_MS backstop that aborts the request.
   */
  const startPending = useCallback(
    (phase: "matching" | "comparing", stale: () => boolean, onTimeout: () => void) => {
      const pending = () => !stale() && stateRef.current.phase === phase;
      timersRef.current.push(
        setTimeout(() => {
          if (pending() && !stateRef.current.middleShown) send({ type: "middle/show" });
        }, SHOW_AFTER),
        setTimeout(() => {
          if (!pending()) return;
          send({ type: "compare/slow" });
          announce(phase === "matching" ? COPY["scene.slowMatch"] : COPY["scene.slowCompare"]);
        }, SLOW_COMPARE_MS),
        setTimeout(() => {
          if (pending()) onTimeout();
        }, COMPARE_BACKSTOP_MS),
      );
    },
    [announce, send],
  );

  const runMatch = useCallback(
    async (next: Extract<Next, { kind: "match" }>) => {
      cancelAll();
      const seq = seqRef.current;
      const stale = () => seqRef.current !== seq;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let timedOut = false;
      send({ type: "match/start" });
      startPending("matching", stale, () => {
        timedOut = true;
        ctrl.abort();
      });
      let res: Awaited<ReturnType<typeof api.match>>;
      try {
        res = await api.match(next.q, next.area, next.beds, completionBasis(next.completion), ctrl.signal);
      } catch {
        res = { ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } };
      }
      if (stale()) return;
      clearTimers();
      if (abortRef.current === ctrl) abortRef.current = null;
      if (!res.ok) {
        const f = timedOut ? compareTimeout("match") : compareFailure(res.status, res.error, "match");
        send({ type: "compare/fail", failure: f });
        announce(f.message);
        return;
      }
      send({ type: "match/done", match: res.data, key: next.key });
      advanceRef.current();
    },
    [announce, cancelAll, clearTimers, send, startPending],
  );

  const runCompare = useCallback(
    async (
      payload: SubmitPayload,
      from: "scene" | "form" | "result",
      more: readonly CandidateView[] = [],
      inPlace: { answers?: Answers; sizeSource?: SizeSource; picked?: PickedBuilding | null } = {},
    ) => {
      cancelAll();
      const seq = seqRef.current;
      const stale = () => seqRef.current !== seq;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let timedOut = false;
      const before = stateRef.current;
      const weighing = { ...weighingFor(before, payload, more), covered: payload.buildingId !== null };
      send({ type: "compare/start", from, payload, weighing, ...inPlace });
      startPending("comparing", stale, () => {
        timedOut = true;
        ctrl.abort();
      });
      const started = Date.now();
      const s = stateRef.current;
      const completion = payload.completion;
      const sizeSource = inPlace.sizeSource ?? (from === "result" && s.lastSizeSource ? s.lastSizeSource : sizeSourceOf(s, payload.fields.sizeSqft));
      let res: Awaited<ReturnType<typeof api.createCheck>>;
      try {
        res = await api.createCheck(
          {
            fields: payload.fields,
            buildingId: payload.buildingId,
            source: s.source,
            editedFields: payload.editedFields,
            ...(s.propertyType ? { propertyType: s.propertyType } : {}),
            ...(completion ? { completion } : {}),
            sizeSource,
            ...(s.ref ? { ref: s.ref } : {}),
          },
          ctrl.signal,
        );
      } catch {
        res = { ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } };
      }
      if (stale()) return;
      if (abortRef.current === ctrl) abortRef.current = null;
      if (timedOut) {
        clearTimers();
        const f = compareTimeout("compare");
        send({ type: "compare/fail", failure: f });
        announce(f.message);
        return;
      }
      if (res.ok) {
        const check = res.data.check;
        // The answer is in: the pending timers stop now, not at the end of the read hold, so a
        // comparison faster than SHOW_AFTER never turns the caption to "Weighing" (nor drops the dots or
        // swaps the status line) while the read figures are still being held (RESULT_SPEC 2.3).
        clearTimers();
        // No artificial waiting: the request fired at once. The settle only waits for the read hold
        // (the read figures are seen) and for the balance to fade in on the form path; a change in
        // place has no balance and re-settles as soon as the answer is in.
        const holdUntil =
          prefersReducedMotion() || from === "result"
            ? 0
            : Math.max(from === "scene" && s.readDoneAt !== null ? s.readDoneAt + READ_HOLD : 0, started + SCENE_FADE_MS);
        const finish = () => {
          if (stale()) return;
          clearTimers();
          send({ type: "compare/done", check });
          replaceStep("result", check.code);
          // The stale-data note sits above the heading that takes focus: it is announced with the verdict.
          announce(resultAnnouncement(check, configRef.current.data));
        };
        const wait = holdUntil - Date.now();
        if (wait > 0) timersRef.current.push(setTimeout(finish, wait));
        else finish();
        return;
      }
      clearTimers();
      if (res.error.code === "validation_failed" && res.error.fields) {
        // Rare: the client ran the same schema. The form opens with the server's field errors.
        send({ type: "compare/invalid", fields: res.error.fields });
        replaceStep("details");
        return;
      }
      const f = compareFailure(res.status, res.error, "compare");
      send({ type: "compare/fail", failure: f });
      announce(f.message);
    },
    [announce, cancelAll, clearTimers, send, startPending],
  );

  /** Acts on `decideNext()`: one question, a match, a comparison, or the partial read. */
  const advance = useCallback(
    (o?: { announceRead?: boolean }) => {
      const s = stateRef.current;
      if (!inScene(s.phase)) return;
      const next = decideNext(s);
      if (o?.announceRead && (next.kind === "compare" || next.kind === "match")) {
        // A question's heading takes focus and speaks for itself; otherwise say what was read.
        const v = mergedValues(s.extracted, s.answers);
        if (v.bedrooms !== null && v.sizeSqft !== null && v.priceAed !== null) {
          announce(t("scene.read", { bedType: bedsLabel(v.bedrooms), size: formatInt(v.sizeSqft), price: formatInt(v.priceAed) }));
        }
      }
      switch (next.kind) {
        case "ask":
          send({ type: "question/ask", question: next.question });
          return;
        case "partial":
          send({ type: "read/partial" });
          announce(COPY["scene.partialH"]);
          return;
        case "match":
          void runMatch(next);
          return;
        case "compare":
          void runCompare(next.payload, "scene");
          return;
      }
    },
    [announce, runCompare, runMatch, send],
  );
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  // ----- reading -----
  const runRead = useCallback(
    async (input: { image?: FlowImage; text?: string }) => {
      cancelAll();
      const readId = ++seqRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let timedOut = false;
      const stale = () => seqRef.current !== readId;

      send({ type: "read/start", readId, input: input.image ? "image" : "text", image: input.image ?? null, text: input.text });
      announce(input.image ? COPY["read.announce"] : COPY["scene.readingText"]);
      timersRef.current.push(
        setTimeout(() => {
          if (stale()) return;
          send({ type: "read/slow", readId });
          announce(readSlowText(configRef.current.readP50Sec));
        }, SLOW_AFTER_MS),
        setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, READ_BACKSTOP_MS),
      );

      const finish = () => {
        if (stale()) return;
        clearTimers();
        abortRef.current = null;
      };

      let blob: Blob | undefined;
      if (input.image) {
        try {
          blob = (await downscaleForUpload(input.image.file)).blob;
        } catch (err) {
          if (stale()) return;
          log.warn("read_downscale_failed", { err });
          finish();
          send({ type: "read/fail", readId, failure: BAD_IMAGE_FAILURE });
          announce(BAD_IMAGE_FAILURE.message);
          return;
        }
        if (stale()) return;
        if (timedOut) {
          finish();
          send({ type: "read/fail", readId, failure: TIMEOUT_FAILURE });
          announce(TIMEOUT_FAILURE.message);
          return;
        }
        // The downscale shares the "Reading the listing" caption: one visual stage, one announcement.
        send({ type: "read/stage", readId, stage: "reading" });
      }

      let res: Awaited<ReturnType<typeof api.extract>>;
      try {
        res = await api.extract(blob ? { image: blob } : { text: input.text ?? "" }, ctrl.signal);
      } catch {
        // Aborted: by Stop or by leaving the page (both ignored, the flow already moved on), or by
        // the 28 s backstop. Anything else never leaves the scene waiting with no way out.
        if (stale()) return;
        finish();
        const f = timedOut ? TIMEOUT_FAILURE : failureFromApi(0, { code: "internal", message: "" }, Date.now());
        send({ type: "read/fail", readId, failure: f });
        announce(f.message);
        return;
      }
      if (stale()) return;
      finish();
      if (res.ok) {
        send({ type: "read/done", readId, response: res.data, at: Date.now() });
        advanceRef.current({ announceRead: true });
      } else {
        const f = failureFromApi(res.status, res.error, Date.now());
        send({ type: "read/fail", readId, failure: f });
        announce(f.message);
      }
    },
    [announce, cancelAll, clearTimers, send],
  );

  const readFile = useCallback(
    (file: File) => {
      const image = makeImage(file);
      enterCompareUrl();
      void runRead({ image });
    },
    [enterCompareUrl, makeImage, runRead],
  );

  const readText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      enterCompareUrl();
      if (!configRef.current.extractEnabled || stateRef.current.claudeOff) {
        // Reading is off: the local parser, no request. It never reads a building, so the scene asks.
        cancelAll();
        send({ type: "text/local", fields: parseFields(trimmed), text: trimmed, at: Date.now() });
        advanceRef.current({ announceRead: true });
        return;
      }
      void runRead({ text: trimmed });
    },
    [cancelAll, enterCompareUrl, runRead, send],
  );

  const retry = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "idle" && s.resumable) {
      // "Continue" on home after Back from a finished read: the scene again, nothing read twice.
      enterCompareUrl();
      send({ type: "scene/resume" });
      advanceRef.current();
      return;
    }
    if (s.phase === "compareFailed") {
      if (s.failure?.op === "compare" && s.lastPayload) void runCompare(s.lastPayload, s.compareFrom ?? "scene");
      else {
        // The building match failed: back to the decision point, which runs it again.
        send({ type: "scene/resume" });
        advanceRef.current();
      }
      return;
    }
    if (s.readInput === "text" && s.pastedText) {
      enterCompareUrl();
      if (!configRef.current.extractEnabled || s.claudeOff) readText(s.pastedText);
      else void runRead({ text: s.pastedText });
    } else if (s.image) {
      enterCompareUrl();
      void runRead({ image: s.image });
    }
  }, [enterCompareUrl, readText, runCompare, runRead, send]);

  const stopRead = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "reading") return;
    cancelAll();
    send({ type: "read/stop" });
    announce(s.readInput === "text" ? COPY["read.stoppedText"] : COPY["read.stopped"]);
    if (readUrlStep().step === "compare") leaveStep("home");
  }, [announce, cancelAll, send]);

  const typeDetails = useCallback(() => {
    cancelAll();
    send({ type: "details/manual" });
    const step = readUrlStep().step;
    if (step === "home" || step === "result") pushStep("details");
    else if (step === "compare") replaceStep("details");
  }, [cancelAll, send]);

  const typeFromRead = useCallback(() => {
    cancelAll();
    const s = stateRef.current;
    send({ type: "details/fromRead", reason: s.partial ? "partial" : "read" });
    if (readUrlStep().step === "compare") replaceStep("details");
    else if (readUrlStep().step !== "details") pushStep("details");
  }, [cancelAll, send]);

  const answer = useCallback(
    (a: Answers) => {
      send({ type: "question/answer", answers: a });
      advanceRef.current();
    },
    [send],
  );

  const pick = useCallback(
    (buildingId: number | null, building?: PickedBuilding) => {
      send({ type: "question/pick", buildingId, building: building ?? null });
      advanceRef.current();
    },
    [send],
  );

  const acceptOutcome = useCallback(() => {
    send({ type: "outcome/accept" });
    advanceRef.current();
  }, [send]);

  const removeImage = useCallback(() => {
    if (stateRef.current.phase === "reading") cancelAll();
    send({ type: "image/set", image: null });
  }, [cancelAll, send]);

  const compareFromForm = useCallback(
    async (p: SubmitPayload): Promise<SubmitResult> => {
      const s = stateRef.current;
      if (s.phase !== "details") return { ok: false };
      const d = draftRef.current;
      const more = d && d.formKey === s.formKey ? [...d.candidates, ...d.extra] : [];
      replaceStep("compare");
      void runCompare(p, "form", more);
      return { ok: true };
    },
    [runCompare],
  );

  const edit = useCallback(() => {
    if (stateRef.current.phase !== "result") return;
    send({ type: "nav/edit" });
    pushStep("details");
  }, [send]);

  const backFromDetails = useCallback(() => {
    cancelAll();
    const s = stateRef.current;
    if (s.check && s.results[s.check.code]) {
      send({ type: "nav/result", code: s.check.code });
      leaveStep("result", s.check.code);
    } else {
      send({ type: "nav/home" });
      leaveStep("home");
    }
  }, [cancelAll, send]);

  const changeDetail = useCallback(
    (change: DetailChange) => {
      const s = stateRef.current;
      if (s.phase !== "result" || !s.check) return;
      const { payload, sizeSource, answers, picked } = changedPayload(s.check, s.extracted, change, sizeSourceOf(s, s.check.sizeSqft));
      // `?step=compare` is pushed, then replaced by the new result's code: Back shows the previous one.
      pushStep("compare");
      void runCompare(payload, "result", [], { answers, sizeSource, ...(picked !== undefined ? { picked } : {}) });
    },
    [runCompare],
  );

  const compareWithBuilding = useCallback((b: PickedBuilding | null) => changeDetail({ field: "building", value: b }), [changeDetail]);

  const compareAsReady = useCallback(() => changeDetail({ field: "completion", value: "ready" }), [changeDetail]);

  const reset = useCallback(() => {
    cancelAll();
    draftRef.current = null;
    send({ type: "reset" });
    if (readUrlStep().step !== "home") replaceStep("home");
  }, [cancelAll, send]);

  const saveDraft = useCallback((d: DetailsDraft) => {
    draftRef.current = d;
  }, []);

  // Browser Back and Forward (section 6.5).
  useEffect(() => {
    const onPop = () => {
      const s = stateRef.current;
      const { step, code } = readUrlStep();
      if (step === "home") {
        if (s.phase === "idle") return;
        // Back while reading works like Stop (and after a failed read, Try again reads again): the
        // screenshot or the text stays. Back after the read had finished (a question, a comparison,
        // a failed comparison) keeps what was read and answered: Continue goes on without reading
        // again. Back from a result or the form goes home with nothing kept.
        const reading = s.phase === "reading";
        const readStopped = reading || (s.phase === "readFailed" && !s.partial);
        const resumable = !readStopped && inScene(s.phase) && s.extracted !== null;
        cancelAll();
        send({ type: "nav/home", stopped: readStopped, resumable });
        if (reading) announce(s.readInput === "text" ? COPY["read.stoppedText"] : COPY["read.stopped"]);
        return;
      }
      if (step === "compare") {
        if (inScene(s.phase)) return;
        // Forward into a scene that has ended: there is nothing to resume.
        replaceStep("home");
        send({ type: "nav/home" });
        return;
      }
      if (step === "details") {
        if (s.phase === "details") return;
        if (s.formKey > 0 || s.check) {
          cancelAll();
          send({ type: "nav/details" });
        } else {
          replaceStep("home");
          send({ type: "nav/home" });
        }
        return;
      }
      if (code && s.results[code]) {
        cancelAll();
        send({ type: "nav/result", code });
      } else if (code) router.replace(`/c/${code}`);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [announce, cancelAll, router, send]);

  // Called while rendering the form, so it reads this render's state (not the ref, which may be ahead).
  const getDraft = (): DetailsDraft =>
    draftRef.current && draftRef.current.formKey === state.formKey ? draftRef.current : draftFromState(state);

  return {
    state,
    step: stepOf(state.phase),
    claudeOff,
    readFile,
    readText,
    retry,
    stopRead,
    typeDetails,
    typeFromRead,
    answer,
    pick,
    acceptOutcome,
    removeImage,
    compareFromForm,
    edit,
    backFromDetails,
    changeDetail,
    compareWithBuilding,
    compareAsReady,
    reset,
    saveDraft,
    getDraft,
  };
}
