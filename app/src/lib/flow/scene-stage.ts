/**
 * The processing scene's stage (docs/REDESIGN.md sections 6.4 and 7.3): which picture the balance
 * draws and which caption the head slot shows, from the flow's phase and its real progress. Pure.
 *
 * - placing: the screenshot is being prepared (downscaled) and lands on the left pan.
 * - reading: POST /api/extract in flight (the widest sway).
 * - found: the read is in, or a middle request is pending for less than SHOW_AFTER (no new caption).
 * - finding: GET /api/buildings/match pending for longer than SHOW_AFTER ("Finding the building").
 * - asking: one question on screen (the beam level, the right tray dashed).
 * - weighing: POST /api/checks pending for longer than SHOW_AFTER, or from the form (dots drop).
 * - settling: the result is in; the beam springs to the verdict angle and hands over to the sheet.
 * - failed / partial: the beam level, every stroke pencil.
 * - rest: home and the form: still.
 */

/** The flow's phases (docs/REDESIGN.md section 6.2). */
export type FlowPhase =
  | "idle"
  | "reading" // POST /api/extract in flight (readStage preparing | reading)
  | "matching" // GET /api/buildings/match in flight
  | "asking" // one question on screen
  | "comparing" // POST /api/checks in flight (from the scene or the form)
  | "result"
  | "readFailed" // a read failure, or a partial read, shown in the scene
  | "compareFailed" // a compare (or match) failure from the scene
  | "details"; // the form: Edit, Type the details, a partial read

export type ReadStage = "preparing" | "reading";

export type SceneStage =
  | "placing"
  | "reading"
  | "found"
  | "finding"
  | "asking"
  | "weighing"
  | "settling"
  | "failed"
  | "partial"
  | "rest";

export interface SceneStageInput {
  phase: FlowPhase;
  readStage: ReadStage | null;
  /** A question is on screen (asking with no question is the instant between an answer and the next step). */
  question: unknown;
  /** The middle request has been pending for SHOW_AFTER: its caption shows. */
  middleShown: boolean;
  compareFrom: "scene" | "form" | "result" | null;
  partial: boolean;
}

export function sceneStage(s: SceneStageInput): SceneStage {
  switch (s.phase) {
    case "idle":
    case "details":
      return "rest";
    case "reading":
      return s.readStage === "preparing" ? "placing" : "reading";
    case "matching":
      return s.middleShown ? "finding" : "found";
    case "asking":
      return s.question ? "asking" : "found";
    case "comparing":
      return s.middleShown || s.compareFrom === "form" ? "weighing" : "found";
    case "result":
      return "settling";
    case "readFailed":
      return s.partial ? "partial" : "failed";
    case "compareFailed":
      return "failed";
  }
}

/** True for the stages in which Fairsquare is working (the scene container is aria-busy). */
export function isWorking(stage: SceneStage): boolean {
  return stage === "placing" || stage === "reading" || stage === "found" || stage === "finding" || stage === "weighing";
}
