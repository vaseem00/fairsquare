"use client";

/**
 * The stage cell's content (docs/REDESIGN.md sections 7.1 to 7.3): the balance, and the document that
 * replaces it, in the same cell from home to the result.
 * - Home (desktop): the balance at rest, the drop target. A screenshot dragged over the window tips
 *   the beam 2.5° toward the left pan and dashes its rim; the hint under it says how to drop or paste.
 * - The scene: the balance at work, driven by the scene stage (use-balance.ts), with the screenshot
 *   (or a paper slip) on the left pan, sale dots on the right one, and the two labels under the pans.
 * - A question: the beam level, the right tray dashed (desktop; phones collapse the stage). A building
 *   question shows the person's screenshot instead, unstamped, so the tower number can be checked.
 * - The result: the stamped sheet crossfades in over the balance (the settle).
 * The balance is aria-hidden decoration: the captions, the read line and the result carry the meaning.
 * Under reduced motion the still balance mounts instead (no time source, no springs, nothing drops).
 */
import { animate, motion, useReducedMotionConfig } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { isApple } from "@/components/check/upload-card";
import { Balance, type BalanceLoad } from "@/components/scene/balance";
import { BalanceLabels, type BalanceLabel } from "@/components/scene/balance-labels";
import { beamTarget, useStillBeam, useSwayingBeam } from "@/components/scene/use-balance";
import { SETTLE_AT, SettleIn, useSettleRunning } from "@/components/scene/use-settle";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { COPY, t } from "@/lib/copy";
import type { SceneStage } from "@/lib/flow/scene-stage";
import { DRAG_TIP_DEG, EASE_IN, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface StageBalance {
  stage: SceneStage;
  load: BalanceLoad | null;
  dots: number | readonly boolean[];
  dimmed: boolean;
  dashedRight: boolean;
  verdictAngle: number | null;
  labels: { left: BalanceLabel | null; right: BalanceLabel | null };
}

interface DriveProps extends StageBalance {
  dragging: boolean;
}

function SwayingBalance({ stage, verdictAngle, dragging, load, dots, dimmed, dashedRight }: DriveProps) {
  const angle = useSwayingBeam(beamTarget(stage, verdictAngle, dragging));
  return <Balance angle={angle} load={load} dots={dots} dimmed={dimmed} dashedLeft={stage === "rest" && dragging} dashedRight={dashedRight} animated />;
}

function StillBalance({ stage, dragging, load, dots, dimmed, dashedRight }: DriveProps) {
  const angle = useStillBeam(stage === "rest" && dragging ? DRAG_TIP_DEG : 0);
  return <Balance angle={angle} load={load} dots={dots} dimmed={dimmed} dashedLeft={stage === "rest" && dragging} dashedRight={dashedRight} />;
}

/** "Drop a screenshot on the scale / or paste it with Ctrl V": fine pointers only, home only. */
function DropHint({ dragging }: { dragging: boolean }) {
  const keys = `${isApple() ? COPY["home.kbdCmd"] : COPY["home.kbdCtrl"]} ${COPY["home.kbdV"]}`;
  return (
    <div className="-mt-6 flex min-h-12 flex-col items-center text-center" data-slot="drop-hint">
      {dragging ? (
        <p className="text-[15px] font-medium text-foreground">{COPY["home.dropActive"]}</p>
      ) : (
        <>
          <p className="text-[15px] text-foreground">{COPY["home.dropScale"]}</p>
          <p className="text-caption text-muted-foreground">{t("home.pasteKeys", { keys })}</p>
        </>
      )}
    </div>
  );
}

export function FlowStage({
  mode,
  balance,
  dragging,
  canDrop,
  sheet,
  collapseOnPhone = false,
}: {
  mode: "rest" | "scene" | "question" | "details" | "result";
  balance: StageBalance;
  dragging: boolean;
  /** Home with screenshot reading on: the drop hint shows (fine pointers). */
  canDrop: boolean;
  /** The document in the stage (the stamped sheet, or the screenshot unstamped); null: the balance. */
  sheet: ReactNode | null;
  /**
   * A result with no stage on phones (not covered), while the settle runs: below 1024px the balance
   * fades out in place, then the stage's height closes over 200ms, so nothing under it jumps.
   */
  collapseOnPhone?: boolean;
}) {
  const reduce = useReducedMotionConfig() === true;
  const running = useSettleRunning();
  const finePointer = useMediaQuery("(pointer: fine)");
  const wide = useMediaQuery(DESKTOP_QUERY);
  const tipped = mode === "rest" && dragging && canDrop;
  const drive: DriveProps = { ...balance, dragging: tipped };
  const collapsing = collapseOnPhone && running && !wide && !reduce;
  // The balance stays in the flow while it is the stage's content, or while a phone stage collapses.
  const inFlow = sheet === null || collapsing;
  const visible = sheet === null;

  // The phone collapse: the stage cell drops its 20px top margin for the settle (FlowLayout), the same
  // 20px becomes padding here, and after the balance has faded the height and padding close to 0.
  const wrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !collapsing) return;
    el.style.overflow = "hidden";
    el.style.paddingTop = "20px";
    el.style.height = `${el.offsetHeight}px`;
    const controls = animate(el, { height: 0, paddingTop: 0 }, { delay: SETTLE_AT.collapse, duration: 0.16, ease: [...EASE_OUT] });
    return () => {
      controls.stop();
      el.style.overflow = "";
      el.style.paddingTop = "";
      el.style.height = "";
    };
  }, [collapsing]);

  return (
    <div ref={wrapRef} data-slot="stage-wrap">
      <div className="relative mx-auto flex w-full flex-col items-center" data-slot="stage" data-mode={mode} data-stage={balance.stage} data-dragging={tipped || undefined}>
        <motion.div
          aria-hidden="true"
          data-stage-balance=""
          className={cn(
            // Phones: the 358 x 448 stage sits at a fixed y under the fact slot (RESULT_SPEC 2.3).
            "w-full lg:w-[min(420px,calc((100dvh-160px)*0.8))] lg:min-w-[300px]",
            // Centred with margins, not a translate (motion owns the transform while it fades).
            inFlow ? "relative" : "pointer-events-none invisible absolute inset-x-0 top-0 mx-auto",
            running && !inFlow && "visible",
          )}
          initial={false}
          animate={{ opacity: visible ? 1 : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : !visible && running
                ? { delay: SETTLE_AT.balanceOut, duration: 0.14, ease: [...EASE_IN] }
                : { duration: visible ? 0.2 : 0 }
          }
        >
          <div className="relative w-full">
            {reduce ? <StillBalance {...drive} /> : <SwayingBalance {...drive} />}
            <BalanceLabels left={balance.labels.left} right={balance.labels.right} animated={!reduce} />
          </div>
        </motion.div>
        {sheet && !collapsing ? (
          <SettleIn at={SETTLE_AT.sheetIn} duration={0.14} className="w-full" slot="stage-sheet">
            {sheet}
          </SettleIn>
        ) : null}
        {mode === "rest" && canDrop && finePointer ? <DropHint dragging={tipped} /> : null}
      </div>
    </div>
  );
}
