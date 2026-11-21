import { describe, expect, it } from "vitest";
import { isWorking, sceneStage, type SceneStageInput } from "@/lib/flow/scene-stage";

const base: SceneStageInput = { phase: "idle", readStage: null, question: null, middleShown: false, compareFrom: null, partial: false };
const at = (over: Partial<SceneStageInput>) => sceneStage({ ...base, ...over });

describe("sceneStage (docs/REDESIGN.md section 6.4): a row per phase, and the SHOW_AFTER flag", () => {
  it.each([
    [{ phase: "idle" }, "rest"],
    [{ phase: "details" }, "rest"],
    [{ phase: "reading", readStage: "preparing" }, "placing"],
    [{ phase: "reading", readStage: "reading" }, "reading"],
    // A match or comparison pending for less than 300ms passes without a caption of its own.
    [{ phase: "matching" }, "found"],
    [{ phase: "matching", middleShown: true }, "finding"],
    [{ phase: "comparing", compareFrom: "scene" }, "found"],
    [{ phase: "comparing", compareFrom: "scene", middleShown: true }, "weighing"],
    // From the form the scene starts at weighing (the slip is already on the pan).
    [{ phase: "comparing", compareFrom: "form" }, "weighing"],
    [{ phase: "asking", question: { kind: "building" } }, "asking"],
    // "asking" with no question: the instant between an answer and the next step.
    [{ phase: "asking", question: null }, "found"],
    [{ phase: "result" }, "settling"],
    [{ phase: "readFailed" }, "failed"],
    [{ phase: "readFailed", partial: true }, "partial"],
    [{ phase: "compareFailed" }, "failed"],
  ] as const)("%o is %s", (over, stage) => {
    expect(at(over as Partial<SceneStageInput>)).toBe(stage);
  });

  it("is busy only while Fairsquare works", () => {
    expect(["placing", "reading", "found", "finding", "weighing"].every((s) => isWorking(s as never))).toBe(true);
    expect(["asking", "settling", "failed", "partial", "rest"].some((s) => isWorking(s as never))).toBe(false);
  });
});
