"use client";

/**
 * The home page tool (docs/REDESIGN.md sections 6 to 8): one FlowLayout from home to the result, so
 * the stage cell (the balance, then the stamped sheet) never remounts.
 *
 * - Home (section 8.3): the headline, the lead, one primary action ("Add a screenshot", or "Type the
 *   details" when reading is off) with two text buttons, the privacy line, and "From the data"
 *   (rendered on the server and passed in as `fromTheData`). Desktop: the balance at rest is the drop
 *   target. Dropping or pasting an image anywhere reads it. No auto-run, no scroll on load.
 * - The scene (`?step=compare`, section 7; RESULT_SPEC section 2): the balance works while Fairsquare
 *   reads, finds the building and weighs the listing; captions follow the real requests. The fact line
 *   sets in under the caption once the read is in and never moves after that; the status line under the
 *   balance names the DLD building, then the sales being weighed. One question at a time when it must
 *   ask. Failures, the partial read, slow lines and Stop are drawn in the scene's language.
 * - The result (`?step=result&code=`, RESULT_SPEC sections 3 to 6): verdict first; at the settle the
 *   phone stage collapses and the market scale takes its place (desktop: the card preview), and the
 *   ASKING stamp lands on its pin.
 * - Edit (section 7): the Change a detail sheet. Continue re-settles the result in place: the new value
 *   sets into the fact line and the scale dims at once; after 300ms the heading turns to "Weighing it
 *   against registered sales" ("Still comparing." at 4 s); then the new verdict crossfades in, the dots
 *   re-drop and the stamp lands on its new x. No balance, no stage. Back shows the previous code.
 * - The form (`?step=details`, section 8.6): "Type all the details", "Type the details", the partial read.
 *
 * Focus moves to the scene's caption when it starts, to each question and failure heading, to the
 * verdict at the settle (and after a re-settle) and to the form's heading; after Stop to "Try again";
 * when the Change a detail sheet closes, back to what opened it. Nothing waits for an animation to move
 * focus or to announce.
 */
import { useReducedMotionConfig } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAnnounce } from "@/components/a11y/live-region";
import { DetailsForm } from "@/components/check/details-form";
import { PasteText } from "@/components/check/paste-text";
import { ResultHead, resultSlots, useCardGetter, useResultUi } from "@/components/check/result-view";
import { ChooseButton, KeptScreenshot, useScreenshotDrop } from "@/components/check/upload-card";
import { Notice, StaleNote } from "@/components/data/data-notice";
import { EditSheet } from "@/components/result/edit-sheet";
import { acsOutcome, nearbyOutcome, VerdictHeadline, VerdictWords, type AcsOutcome } from "@/components/result/verdict-summary";
import { angleFor } from "@/components/scene/balance-geometry";
import type { BalanceLoad } from "@/components/scene/balance";
import type { BalanceLabel } from "@/components/scene/balance-labels";
import { FactLine } from "@/components/result/fact-line";
import { FailureActions, PartialActions, ReadSlowNote, SceneCaption, SceneFailure, SceneWaiting } from "@/components/scene/compare-scene";
import { FlowLayout } from "@/components/scene/flow-layout";
import { FlowStage, type StageBalance } from "@/components/scene/flow-stage";
import { listingPsfFigure, QuestionControls, QuestionHead, questionInput, type QuestionContext } from "@/components/scene/scene-question";
import { ScreenshotDialog, ScreenshotSheet } from "@/components/scene/screenshot-dialog";
import { useImageSize } from "@/components/scene/use-image-size";
import { RESETTLE_SHIFT, SettleProvider, useSettle } from "@/components/scene/use-settle";
import { usePublicConfig } from "@/components/shell/config-provider";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Button } from "@/components/ui/button";
import { inScene, matchForCheck, sceneCaption, useCheckFlow, weighingCaption, type FlowState, type ReadAction } from "@/hooks/use-check-flow";
import { acsLead, COPY, nearbyShown, plainNotCovered, t, tPlural, verdictHeadText } from "@/lib/copy";
import { completionBasis } from "@/lib/domain/analyse";
import { isConfidentMatch, mergedValues } from "@/lib/flow/decide-next";
import { isWorking, sceneStage } from "@/lib/flow/scene-stage";
import { formatInt } from "@/lib/format";
import { scrollIntoViewSafe } from "@/lib/motion";
import { statusMatch, statusSales, type FactPart, type FactValues } from "@/lib/result/words";
import type { CheckBand } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "home" | "scene" | "question" | "failure" | "details" | "result";

/** A comparison started from a result (the Change a detail sheet) and still in flight: the result stays. */
function changingInPlace(s: FlowState): boolean {
  return s.phase === "comparing" && s.compareFrom === "result" && s.check !== null;
}

function viewOf(s: FlowState): View {
  switch (s.phase) {
    case "idle":
      return "home";
    case "details":
      return "details";
    case "result":
      return s.check ? "result" : "home";
    case "readFailed":
    case "compareFailed":
      return "failure";
    case "asking":
      return s.question ? "question" : "scene";
    case "comparing":
      return changingInPlace(s) ? "result" : "scene";
    default:
      return "scene";
  }
}

/**
 * What the head shows just before a settle, so it can fade out over the verdict: a caption (the scene's,
 * or the weighing caption of a change in place), or the previous verdict (a change faster than 300ms).
 */
type LastHead = { kind: "caption"; text: string } | { kind: "verdict"; text: string; band: CheckBand; diff: number | null; acs: AcsOutcome | null; nearby: AcsOutcome | null };

function lastHeadNode(h: LastHead | null): ReactNode {
  if (!h || !h.text) return null;
  if (h.kind === "caption") return <p className="type-display-md text-foreground">{h.text}</p>;
  return (
    <p className="type-display-lg max-w-[14ch] text-foreground">
      <VerdictWords band={h.band} diff={h.diff} acs={h.acs} nearby={h.nearby} />
    </p>
  );
}

/** The fact line while a change is in flight: the values being compared, with the changed figure setting in. */
function pendingFact(s: FlowState): { values: FactValues; only?: FactPart["figure"] } | null {
  const c = s.check;
  const p = s.lastPayload;
  if (!c || !p) return null;
  const f = p.fields;
  const sizeAbout = (s.lastSizeSource ?? c.sizeSource) === "cluster";
  return {
    values: {
      building: f.buildingText,
      area: f.areaText,
      completion: p.completion ?? c.completion,
      bedrooms: f.bedrooms,
      sizeSqft: f.sizeSqft,
      sizeAbout,
      priceAed: f.priceAed,
    },
    only: f.priceAed !== c.priceAed ? "price" : f.sizeSqft !== c.sizeSqft || sizeAbout !== (c.sizeSource === "cluster") ? "size" : undefined,
  };
}

/**
 * What the fact line states in the scene and the questions: what was read and answered, or the form's
 * values on a rerun from the form. Null before anything is known (the slot stays empty: no blanks).
 */
function sceneFactValues(s: FlowState): FactValues | null {
  if (s.compareFrom === "form" && s.lastPayload && s.phase !== "details") {
    const f = s.lastPayload.fields;
    return {
      building: f.buildingText,
      area: f.areaText,
      completion: s.lastPayload.completion ?? s.completion,
      bedrooms: f.bedrooms,
      sizeSqft: f.sizeSqft,
      sizeAbout: s.answers.sizeSource === "cluster" && s.answers.sizeSqft === f.sizeSqft,
      priceAed: f.priceAed,
    };
  }
  if (!s.extracted) return null;
  const v = mergedValues(s.extracted, s.answers);
  if (v.bedrooms === null && v.sizeSqft === null && v.priceAed === null && v.buildingText === null) return null;
  return {
    building: v.buildingText,
    area: v.areaText,
    completion: s.completion,
    bedrooms: v.bedrooms,
    sizeSqft: v.sizeSqft,
    sizeAbout: s.answers.sizeSource === "cluster" && s.answers.sizeSqft === v.sizeSqft,
    priceAed: v.priceAed,
  };
}

export function CompareFlow({
  initialRef = null,
  fromTheData = null,
}: {
  initialRef?: string | null;
  /** The "From the data" panel for the home page (server-rendered by the page). */
  fromTheData?: ReactNode;
}) {
  const flow = useCheckFlow({ initialRef });
  const { state, step, claudeOff } = flow;
  const config = usePublicConfig();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const resultUi = useResultUi();
  const reduce = useReducedMotionConfig() === true;
  const announce = useAnnounce();
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const h1Id = useId();
  const [viewOpen, setViewOpen] = useState(false);

  const openPicker = () => fileRef.current?.click();
  // Drop or paste a screenshot anywhere on the home page (never while reading is off).
  const dragging = useScreenshotDrop(flow.readFile, step === "home" && !claudeOff);

  const view = viewOf(state);
  const stage = sceneStage(state);
  const values = mergedValues(state.extracted, state.answers);
  const check = state.check;
  const pendingInPlace = changingInPlace(state);
  // The match's counts only while they describe the result's bedrooms and basis (an in-place edit of
  // either drops them: no 2-bed count beside a 3-bed result).
  const resultMatch = matchForCheck(state.match, state.matchKey, check);

  // The settle runs once per fresh result (not after Back or Forward, never under reduced motion). After
  // a change in place it is a re-settle: no balance, no stage, every piece RESETTLE_SHIFT earlier.
  const settleKey = view === "result" && state.fresh && check && !reduce ? check.code : null;
  const settling = useSettle(settleKey);
  const resettling = settling && state.resettle;

  // The scene's caption, and what was in the head just before the result (it fades out over the verdict
  // at the settle): the scene's caption, or during a change in place the weighing caption or the
  // previous verdict. Any other screen clears it, so an old caption never reappears over a new verdict.
  const caption = sceneCaption(state);
  const [lastHead, setLastHead] = useState<LastHead | null>(null);
  const headNow: LastHead | null =
    view === "scene"
      ? { kind: "caption", text: caption }
      : pendingInPlace && check
        ? state.middleShown
          ? { kind: "caption", text: weighingCaption(state.weighing) }
          : { kind: "verdict", text: verdictHeadText(check), band: check.analysis.band, diff: check.analysis.diff, acs: acsOutcome(check), nearby: nearbyOutcome(check) }
        : null;
  const keptHead = view === "scene" || pendingInPlace ? headNow : view === "result" ? lastHead : null;
  if ((keptHead?.kind ?? "") !== (lastHead?.kind ?? "") || (keptHead?.text ?? "") !== (lastHead?.text ?? "")) setLastHead(keptHead);

  // The weighing caption of a change in place is announced once when it shows.
  const pendingCaption = pendingInPlace && state.middleShown ? weighingCaption(state.weighing) : null;
  useEffect(() => {
    if (pendingCaption) announce(pendingCaption);
  }, [pendingCaption, announce]);

  // The Change a detail sheet returns focus to what opened it (Edit, or "Wrong building?"). After a
  // change it does so only while the comparison is in flight: once the new result is in, focus is on
  // its verdict and stays there.
  const changedRef = useRef(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pendingInPlace;
  });
  const editOpener = resultUi.editOpener;
  const editFinalFocus = useCallback(() => {
    if (!changedRef.current) return editOpener.current ?? true;
    changedRef.current = false;
    return pendingRef.current ? (editOpener.current ?? true) : false;
  }, [editOpener]);

  // A caption that changes within the scene is announced once; the first one is spoken by the
  // focus move to the heading (or, for a read, by the hook's "Reading your screenshot").
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "scene") {
      spokenRef.current = null;
      return;
    }
    if (spokenRef.current === null) {
      spokenRef.current = caption;
      return;
    }
    if (caption && caption !== spokenRef.current) {
      spokenRef.current = caption;
      announce(caption);
    }
  }, [view, caption, announce]);

  const getCard = useCardGetter(check);
  const imageSize = useImageSize(state.image?.url ?? null);

  // ----- focus: the heading of each new view (and the top of the flow into view when scrolled past) -----
  const kept = state.stopped || state.resumable;
  const focusKey =
    view === "home"
      ? `home:${state.stopped ? "stopped" : state.resumable ? "resumable" : "idle"}`
      : view === "question" && state.question
        ? `q:${state.question.kind}:${state.question.kind === "field" ? state.question.field : ""}`
        : view === "failure"
          ? `fail:${state.partial ? "partial" : (state.failure?.code ?? "")}:${state.failure?.retryAt ?? ""}`
          : view === "result"
            ? `result:${check?.code ?? ""}`
            : view === "details"
              ? `details:${state.formKey}:${state.formReason ?? ""}`
              : "scene";
  const shownKey = useRef(focusKey);
  useEffect(() => {
    if (shownKey.current === focusKey) return;
    const prev = shownKey.current;
    shownKey.current = focusKey;
    let target: HTMLElement | null = null;
    if (view === "home") {
      // After Stop or Back from the scene: Try again (or Continue) on the kept screenshot or text.
      target = kept
        ? topRef.current?.querySelector<HTMLElement>('[data-slot="kept-screenshot"] [data-action="retry"], [data-slot="paste-text"] [data-action="retry"]') ?? h1Ref.current
        : prev.startsWith("home") && state.image === null
          ? topRef.current?.querySelector<HTMLElement>('[data-slot="choose-screenshot"]') ?? h1Ref.current
          : h1Ref.current;
    } else {
      // A question with no buttons (the price, a size with no usual sizes, the building name, the price
      // per sq ft) focuses its input, so the keypad opens at once; with buttons the heading takes focus,
      // so the keypad does not cover them (RESULT_SPEC 2.5 and 11).
      target = (view === "question" ? questionInput(topRef.current) : null) ?? headingRef.current;
    }
    target?.focus({ preventScroll: true });
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) scrollIntoViewSafe(top, { block: "start" });
  }, [focusKey, view, kept, state.image]);

  // Esc stops reading while focus is in the flow (not inside a dialog, which closes on Esc itself).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || state.phase !== "reading") return;
    if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    flow.stopRead();
  };

  const fileInput = claudeOff ? null : (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      data-slot="file-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) flow.readFile(file);
      }}
    />
  );
  const another = claudeOff ? null : openPicker;

  // ----- the stage: the balance and the document -----
  const load: BalanceLoad | null =
    state.image && (view !== "home" || kept)
      ? imageSize
        ? { kind: "image", href: state.image.url, ...imageSize }
        : null
      : view !== "home" && (state.readInput === "text" || state.source === "manual" || check !== null)
        ? { kind: "slip" }
        : null;

  const listingFigure = check && view === "result" ? `AED ${formatInt(check.analysis.askingPsf)}` : listingPsfFigure(values);
  const left: BalanceLabel | null = view !== "home" && view !== "details" && listingFigure ? { figure: listingFigure, caption: COPY["scene.labelListing"] } : null;
  let right: BalanceLabel | null = null;
  let dots: number | boolean[] = 0;
  if (view === "result" && check) {
    const a = check.analysis;
    const near = nearbyShown(check);
    if (near) {
      // The last resort: the right pan carries the range of nearby registered sales.
      right = {
        figure: t("nearby.cardRangeValue", { low: formatInt(near.rangeLowPsf), high: formatInt(near.rangeHighPsf) }),
        caption: t("nearby.sceneLabel", { n: formatInt(near.comparablesTotal) }),
      };
    } else if (a.band === "thin") {
      dots = Array.from({ length: check.rules.minSales }, (_, i) => i >= a.count);
      right = { figure: formatInt(a.count), caption: t("thin.progress", { count: a.count, minSales: check.rules.minSales }) };
    } else if (a.band === "none") {
      right = { figure: "", caption: COPY["band.none"] };
    } else {
      const total = Math.min(24, a.count + a.outliersDropped);
      dots = Array.from({ length: total }, (_, i) => i >= total - Math.min(a.outliersDropped, total));
      right = a.medianPsf !== null ? { figure: `AED ${formatInt(a.medianPsf)}`, caption: t("scene.labelMedian", { count: a.count }) } : null;
      // A leading range of adjusted registered sales: the right pan carries the range, not the median.
      const lead = acsLead(check);
      if (lead) {
        right = {
          figure: t("acs.cardRangeValue", { low: formatInt(lead.rangeLowPsf), high: formatInt(lead.rangeHighPsf) }),
          caption: t("acs.sceneLabel", { n: formatInt(lead.evidence.sales) }),
        };
      }
    }
  } else if (stage === "weighing" && state.weighing?.sales != null) {
    const n = state.weighing.sales;
    dots = Math.min(24, n);
    right = { figure: formatInt(n), caption: tPlural("scene.labelSales", n) };
  }
  // With a leading range the beam is level inside it and tilts by how far the asking price is past its end.
  const acsNow = check && view === "result" ? (nearbyShown(check) ?? acsLead(check)) : null;
  const acsDiff =
    check && acsNow
      ? acsNow.verdict === "above"
        ? check.analysis.askingPsf / acsNow.rangeHighPsf - 1
        : acsNow.verdict === "below"
          ? check.analysis.askingPsf / acsNow.rangeLowPsf - 1
          : 0
      : null;
  const verdictAngle =
    check && view === "result" && (acsNow !== null || check.analysis.band === "above" || check.analysis.band === "below" || check.analysis.band === "inline")
      ? angleFor(acsDiff ?? check.analysis.diff)
      : 0;
  const balance: StageBalance = {
    stage,
    load,
    dots,
    dimmed: view === "failure",
    dashedRight: view === "question",
    verdictAngle,
    labels: { left, right },
  };

  const questionCtx: QuestionContext = {
    values,
    match: state.match,
    completion: state.completion,
    fromText: state.readInput === "text",
  };

  // The fact line in the scene and the questions (from the moment something was read), and the status
  // line under the balance: the DLD building as DLD names it, then the sales being weighed.
  const factValues = sceneFactValues(state);
  const sceneFact = factValues ? <FactLine values={factValues} ink={view === "scene"} /> : null;
  let status: string | null = null;
  if (view === "scene") {
    const w = state.weighing;
    const beds = state.lastPayload?.fields.bedrooms ?? values.bedrooms;
    const through = config.data.dataThrough;
    if (stage === "weighing" && w && w.covered !== false && w.sales !== null && beds !== null && through) {
      status = statusSales(w.sales, completionBasis(state.lastPayload?.completion ?? state.completion), beds, config.rules.windowDays, through);
    }
    const m = state.match;
    if (status === null && m && isConfidentMatch(m) && state.pickedBuildingId === undefined) {
      const pre = m.candidates.find((c) => c.buildingId === m.preselectId);
      if (pre) status = statusMatch(pre);
    }
  }

  let notices: ReactNode = null;
  let head: ReactNode = null;
  let fact: ReactNode = null;
  let chart: ReactNode = null;
  let below: ReactNode = null;
  let rest: ReactNode = null;
  let sheet: ReactNode = null;
  let stagePhone: "show" | "hide" | "collapse" = "hide";
  let reserveHead: false | "phone" | "scene" = false;
  let headCollapse = false;
  let reserveFact = false;
  let restWide = false;

  if (view === "home") {
    const typeButton = (primary: boolean) => (
      <Button
        type="button"
        variant={primary ? "default" : "link"}
        size={primary ? "lg" : "default"}
        onClick={flow.typeDetails}
        className={primary ? "w-full sm:w-auto" : undefined}
        data-slot="type-details"
      >
        {COPY["home.type"]}
      </Button>
    );
    // After Stop (or Back from the scene) the kept screenshot takes the primary slot: Try again (or
    // Continue), Replace, Remove. Stopped text waits in the open paste box instead, with Try again.
    const keptImage = !claudeOff && state.image !== null && kept;
    const keptText = !state.image && state.readInput === "text" && state.pastedText !== null;
    const primary = claudeOff ? typeButton(true) : keptImage ? null : <ChooseButton onChoose={openPicker} />;
    head = (
      <section aria-labelledby={h1Id} className="flex min-w-0 flex-col pt-4 md:pt-2 lg:pt-12">
        <h1 id={h1Id} ref={h1Ref} tabIndex={-1} className="type-display-xl max-w-[11ch] text-foreground outline-none">
          {COPY["home.h1"]}
        </h1>
        <p className="mt-4 type-lead max-w-[34ch] text-foreground lg:mt-6 lg:max-w-[30ch]">{COPY["home.lead"]}</p>
      </section>
    );
    below = (
      <div className="mt-6 flex flex-col gap-4 lg:mt-8">
        {claudeOff ? <Notice slot="claude-off">{COPY["claudeOff.notice"]}</Notice> : null}
        <StaleNote />
        <div data-slot="upload-card" data-dragging={dragging || undefined} className="flex flex-col gap-4">
          {keptImage && state.image ? (
            <KeptScreenshot image={state.image} resumable={state.resumable} onChoose={openPicker} onRetry={flow.retry} onRemove={flow.removeImage} />
          ) : null}
          {keptText && state.resumable ? <KeptScreenshot image={null} resumable onRetry={flow.retry} onRemove={flow.removeImage} /> : null}
          <PasteText
            key={keptText && state.stopped ? "stopped" : "fresh"}
            onRead={flow.readText}
            lead={primary}
            after={claudeOff ? null : typeButton(false)}
            stopped={keptText && state.stopped ? (state.pastedText ?? "") : null}
          />
        </div>
        {/* The line is about reading a screenshot: with reading off there is no screenshot to read. */}
        {claudeOff ? null : (
          <p className="max-w-[52ch] text-caption text-muted-foreground">
            {COPY["home.privacy"]}{" "}
            <Link
              href="/privacy"
              className="rounded-sm font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              {COPY["home.privacyLink"]}
            </Link>
          </p>
        )}
      </div>
    );
    rest = fromTheData ? <div className="mt-14 min-w-0 lg:mt-18">{fromTheData}</div> : null;
  } else if (view === "scene") {
    reserveHead = "scene";
    reserveFact = true;
    stagePhone = "show";
    const reading = state.phase === "reading";
    // While reading, the slot the fact line will take holds "Still reading" after 8 s.
    fact = sceneFact ?? (reading && state.slow ? <ReadSlowNote onTypeInstead={flow.typeDetails} /> : null);
    head = (
      <SceneCaption
        caption={caption}
        headingRef={headingRef}
        onStop={reading ? flow.stopRead : undefined}
        hint={reduce && reading ? COPY["scene.reducedHint"] : null}
      />
    );
    below = (
      <SceneWaiting
        status={status}
        slowMatch={state.phase === "matching" && state.slow}
        slowCompare={state.phase === "comparing" && state.slow}
        onEditInstead={flow.typeFromRead}
      />
    );
  } else if (view === "question" && state.question) {
    const q = state.question;
    head = <QuestionHead question={q} ctx={questionCtx} headingRef={headingRef} image={state.image} onViewImage={() => setViewOpen(true)} />;
    fact = q.kind === "outcome" ? null : sceneFact;
    reserveFact = q.kind !== "outcome";
    reserveHead = "phone";
    below = (
      <QuestionControls
        key={`${q.kind}:${q.kind === "field" ? q.field : ""}`}
        question={q}
        ctx={questionCtx}
        onAnswer={flow.answer}
        onPick={flow.pick}
        onAccept={flow.acceptOutcome}
        onAnother={another}
        onType={flow.typeDetails}
        onTypeAll={flow.typeFromRead}
      />
    );
    if (q.kind === "building" && state.image) sheet = <ScreenshotSheet image={state.image} className="mx-auto w-full lg:max-w-[calc((100dvh-160px)/2)]" />;
  } else if (view === "failure") {
    reserveHead = "phone";
    stagePhone = "show";
    fact = sceneFact;
    reserveFact = sceneFact !== null;
    if (state.partial || !state.failure) {
      head = <SceneFailure title={COPY["scene.partialH"]} detail={COPY["scene.partialBody"]} headingRef={headingRef} />;
      below = <PartialActions onType={flow.typeFromRead} onAnother={another} />;
    } else {
      const f = state.failure;
      const handlers: Record<ReadAction, (() => void) | null> = {
        retry: flow.retry,
        type: f.op === "compare" || f.op === "match" ? flow.typeFromRead : flow.typeDetails,
        another,
        edit: flow.typeFromRead,
      };
      head = <SceneFailure title={COPY[f.title]} detail={f.detail} headingRef={headingRef} />;
      below = <FailureActions key={`${f.code}:${f.retryAt ?? ""}`} failure={f} handlers={handlers} />;
    }
  } else if (view === "details") {
    const typed = state.formReason === "typed";
    const backLabel = check ? COPY["details.back"] : COPY["step.back"];
    head = (
      <div className="flex flex-col items-start gap-2" data-slot="details-head">
        <Button type="button" variant="link" onClick={flow.backFromDetails} className="-ml-0.5" data-slot="details-back">
          {backLabel}
        </Button>
        <h2 ref={headingRef} tabIndex={-1} className="type-display-md text-foreground outline-none">
          {typed ? COPY["details.h2Typed"] : COPY["details.h2"]}
        </h2>
        {state.formReason === "partial" ? <p className="type-lead max-w-[52ch] text-muted-foreground">{COPY["scene.partialBody"]}</p> : null}
      </div>
    );
    below = (
      <div className="pt-6 lg:max-w-[480px]">
        <DetailsForm
          key={state.formKey}
          draft={flow.getDraft()}
          extracted={state.extracted}
          source={state.source}
          localParse={state.localParse}
          image={state.image}
          canRead={!claudeOff}
          serverErrors={state.serverErrors}
          onDraft={flow.saveDraft}
          onCompare={flow.compareFromForm}
          onViewImage={() => setViewOpen(true)}
          onReplace={openPicker}
          onRemove={flow.removeImage}
        />
      </div>
    );
    if (state.image) sheet = <ScreenshotSheet image={state.image} className="mx-auto w-full lg:max-w-[calc((100dvh-160px)/2)]" />;
  } else if (view === "result" && check) {
    const slots = resultSlots({
      check,
      image: state.image,
      match: resultMatch,
      desktop,
      getCard,
      // While a change is in flight the result stays as it was: Edit opens nothing new.
      ui: pendingInPlace ? { ...resultUi, openEdit: () => undefined } : resultUi,
      onAnother: flow.reset,
      onPickBuilding: flow.compareWithBuilding,
      onCompareReady: flow.compareAsReady,
    });
    notices = slots.notices;
    if (pendingCaption) {
      // A change in place pending for more than 300ms: the heading crossfades to the weighing caption.
      // The previous verdict keeps its box (invisible), so nothing under the head moves.
      head = (
        <div className="relative" data-slot="result-head">
          <div aria-hidden="true" className="invisible">
            <VerdictHeadline check={check} as="p" />
          </div>
          <div className="absolute inset-x-0 top-0">
            <p className="type-display-md text-foreground motion-safe:animate-[mz-fade_160ms_var(--ease-out)_both]" data-slot="resettle-caption">
              {pendingCaption}
            </p>
            {state.slow ? (
              <p className="mt-0.5 text-[14px] leading-5 text-muted-foreground" data-slot="resettle-slow">
                {COPY["scene.slowCompare"]}
              </p>
            ) : null}
          </div>
        </div>
      );
    } else {
      head = <ResultHead check={check} headingRef={headingRef} lastHead={settling ? lastHeadNode(lastHead) : null} />;
    }
    const pf = pendingInPlace ? pendingFact(state) : null;
    fact = pf ? <FactLine values={pf.values} onEdit={() => undefined} ink={pf.only !== undefined} only={pf.only} /> : slots.fact;
    // The scale dims while the change is weighed (section 7); it redraws with the new comparison.
    chart = slots.chart ? (
      <div className={cn("transition-opacity duration-150", pendingInPlace && "opacity-40")} data-slot="result-chart" data-pending={pendingInPlace || undefined}>
        {slots.chart}
      </div>
    ) : null;
    below = slots.below;
    rest = slots.rest;
    // Desktop: the card preview (or the screenshot) replaces the balance. Phones: the stage collapses
    // while the settle runs (the balance fades out first) and the market scale takes its place; a
    // re-settle has no stage to collapse.
    sheet = slots.stage ?? <div aria-hidden="true" />;
    stagePhone = settling && !resettling ? "collapse" : "hide";
    reserveFact = true;
    restWide = true;
    // The head keeps the caption's two lines under a two-line verdict. Not covered ("Not covered yet",
    // one line) lets them close with the collapsing phone stage.
    const none = plainNotCovered(check);
    reserveHead = none ? false : "phone";
    headCollapse = none && stagePhone === "collapse";
  }

  const stageMode = view === "home" ? "rest" : view === "failure" ? "scene" : view;

  return (
    <div
      ref={topRef}
      className={cn("mx-auto w-full max-w-[1264px] scroll-mt-(--header-h) gutter pb-10", view === "home" ? "pt-6 md:pt-10 lg:pt-12" : "pt-5 md:pt-8 lg:pt-12")}
      onKeyDown={onKeyDown}
      data-slot="compare-flow"
      data-step={step}
      data-phase={state.phase}
      data-view={view}
    >
      {fileInput}
      {view !== "home" ? <h1 className="sr-only">{COPY["home.h1"]}</h1> : null}
      <SettleProvider running={settling} shift={resettling ? RESETTLE_SHIFT : 0}>
        <FlowLayout
          mode={view}
          notices={notices}
          head={head}
          fact={fact}
          stage={
            <FlowStage mode={stageMode} balance={balance} dragging={dragging} canDrop={!claudeOff} sheet={sheet} collapseOnPhone={stagePhone === "collapse"} />
          }
          chart={chart}
          below={below}
          rest={rest}
          stagePhone={stagePhone}
          reserveHead={reserveHead}
          reserveFact={reserveFact}
          restWide={restWide}
          headCollapse={headCollapse}
          busy={(view === "scene" && isWorking(stage) && inScene(state.phase)) || pendingInPlace}
        />
      </SettleProvider>
      {view === "result" && check ? (
        <EditSheet
          open={resultUi.edit.open && !pendingInPlace}
          entry={resultUi.edit.entry}
          onOpenChange={(open) => {
            if (!open) resultUi.closeEdit();
          }}
          check={check}
          image={state.image}
          match={resultMatch}
          onChange={(change) => {
            changedRef.current = true;
            pendingRef.current = true;
            resultUi.closeEdit();
            flow.changeDetail(change);
          }}
          onTypeAll={() => {
            resultUi.closeEdit();
            flow.edit();
          }}
          onViewImage={() => {
            resultUi.closeEdit();
            setViewOpen(true);
          }}
          finalFocus={editFinalFocus}
        />
      ) : null}
      <ScreenshotDialog image={state.image} open={viewOpen} onOpenChange={setViewOpen} />
    </div>
  );
}
