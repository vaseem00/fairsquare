"use client";

/**
 * "Change a detail" (RESULT_SPEC section 7): a bottom Drawer on phones (at most 85dvh) and a right
 * Sheet 420 wide from 1024px.
 *
 *   Change a detail                                 Close_    type-display-md 24 (the focus target)
 *   [thumb 48x84] Your screenshot      View screenshot_       only with a screenshot
 *   -------------------------------------------------------
 *   Building           Aykon City (2) -Tower C           >    rows 56px: label Archivo 14 pencil,
 *   Bedrooms           2                                 >    value Archivo 16 ink, chevron pencil
 *   Size               812 sq ft                         >
 *   Asking price       AED 1,450,000                     >
 *   Ready or off-plan  Ready                             >
 *   -------------------------------------------------------
 *   Type all the details_                                     the full form: the only place it opens after a read
 *
 * A row swaps the body to that one question (the scene's own controls, section 2.5) with "Back_": the
 * size buttons come from the result's own registered sales. Continue (or a tap on a button) hands the
 * change to the flow, which closes the sheet and re-settles the result in place with a new code. A value
 * left as it was closes the sheet with no new comparison. "Wrong building?" opens the sheet straight at
 * the building question (candidates with their sales, None of these, Search covered buildings), with no
 * Back. Focus: the title when it opens and on each step (the price field, which has no buttons, takes
 * focus itself so the keypad opens); on close it returns to the element that opened it.
 */
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { questionInput, questionNote, QuestionControls, type QuestionContext } from "@/components/scene/scene-question";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { DetailChange, FlowImage, PickedBuilding } from "@/hooks/use-check-flow";
import { basisWord, COPY, sizeText, tList, type CopyKey } from "@/lib/copy";
import type { Answers, Question } from "@/lib/flow/decide-next";
import { formatInt } from "@/lib/format";
import { sizeClusters } from "@/lib/result/scale-model";
import type { CheckView, MatchResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export type EditStep = "rows" | "building" | "bedrooms" | "size" | "price" | "completion";

const STEP_TITLE: Record<EditStep, CopyKey> = {
  rows: "edit.h",
  building: "ask.buildingH",
  bedrooms: "ask.bedsH",
  size: "ask.sizeH",
  price: "ask.priceH",
  completion: "ask.completionH",
};

const STEP_QUESTION: Record<Exclude<EditStep, "rows">, Question> = {
  building: { kind: "building" },
  bedrooms: { kind: "field", field: "bedrooms" },
  size: { kind: "field", field: "sizeSqft" },
  price: { kind: "field", field: "priceAed" },
  completion: { kind: "completion" },
};

const TEXT_BUTTON =
  "inline-flex min-h-11 shrink-0 items-center self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const BED_LABELS = tList("field.bedroomsOptions");
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "2", "Studio" or "7 or more": the bedrooms row's value. */
function bedroomsValue(n: number): string {
  return n === 0 || n >= 7 ? BED_LABELS[Math.min(7, n)] : String(n);
}

/** The five rows: what this result compared, as the person would recognise it. */
function editRows(check: CheckView): { step: Exclude<EditStep, "rows">; label: string; value: string }[] {
  return [
    { step: "building", label: COPY["field.building"], value: check.building?.name ?? check.buildingText },
    { step: "bedrooms", label: COPY["field.bedrooms"], value: bedroomsValue(check.bedrooms) },
    { step: "size", label: COPY["edit.size"], value: `${sizeText(check)} sq ft` },
    { step: "price", label: COPY["edit.price"], value: `AED ${formatInt(check.priceAed)}` },
    { step: "completion", label: COPY["edit.completion"], value: capitalise(basisWord(check.analysis.completionBasis)) },
  ];
}

/** The change an answer makes to this result, or null when the value is the one it already compared. */
export function changeOf(check: CheckView, a: Answers): DetailChange | null {
  if (a.priceAed !== undefined) return a.priceAed === check.priceAed ? null : { field: "priceAed", value: a.priceAed };
  if (a.sizeSqft !== undefined) {
    const source = a.sizeSource ?? "typed";
    const same = a.sizeSqft === check.sizeSqft && (source === "cluster") === (check.sizeSource === "cluster");
    return same ? null : { field: "sizeSqft", value: a.sizeSqft, source };
  }
  if (a.bedrooms !== undefined) return a.bedrooms === check.bedrooms ? null : { field: "bedrooms", value: a.bedrooms };
  if (a.completion) return a.completion === check.analysis.completionBasis ? null : { field: "completion", value: a.completion };
  return null;
}

export interface EditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the sheet opens: the rows (Edit) or the building question (Wrong building?). */
  entry: EditStep;
  check: CheckView;
  image: FlowImage | null;
  /** The building match behind the result (the building question's candidates), when known. */
  match: MatchResponse | null;
  /** A value changed: the flow closes the sheet and re-settles in place. */
  onChange: (change: DetailChange) => void;
  /** "Type all the details": the form. */
  onTypeAll: () => void;
  /** "View screenshot". */
  onViewImage: () => void;
  /** Where focus goes when the sheet closes (default: the element that opened it). */
  finalFocus?: RefObject<HTMLElement | null> | (() => boolean | HTMLElement | null | void);
}

function Body({
  step,
  setStep,
  props,
  bodyRef,
}: {
  step: EditStep;
  setStep: (s: EditStep) => void;
  props: EditSheetProps;
  bodyRef: RefObject<HTMLDivElement | null>;
}) {
  const { check, image, match } = props;
  const sizes = useMemo(() => {
    const clusters = sizeClusters(check.sales.map((s) => s.sizeSqft));
    return check.building && clusters.length > 0 ? { building: check.building.name, sizes: clusters.map((c) => ({ sqft: c.sqft, sales: c.sales })) } : null;
  }, [check]);

  if (step === "rows") {
    return (
      <div ref={bodyRef} className="flex flex-col" data-slot="edit-rows">
        {image ? (
          <div className="flex items-center gap-3.5 py-2" data-slot="edit-screenshot">
            {/* A local object URL of the person's own screenshot; next/image cannot load it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt="" className="h-21 w-12 shrink-0 rounded-sm bg-muted object-cover object-top shadow-sheet" />
            <span className="min-w-0 flex-1 text-base text-foreground">{COPY["read.thumb"]}</span>
            <button type="button" className={TEXT_BUTTON} onClick={props.onViewImage}>
              {COPY["edit.viewScreenshot"]}
            </button>
          </div>
        ) : null}
        <ul className="mt-2 flex flex-col border-t border-border">
          {editRows(check).map((r) => (
            <li key={r.step}>
              <button
                type="button"
                aria-label={`${r.label}: ${r.value}`}
                onClick={() => setStep(r.step)}
                className={cn(
                  "grid min-h-14 w-full grid-cols-[132px_minmax(0,1fr)_20px] items-center gap-2 border-b border-border py-2 text-left transition-colors duration-(--dur-fast)",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
                data-row={r.step}
              >
                <span className="text-[14px] leading-5 text-muted-foreground">{r.label}</span>
                <span className="text-base break-words text-foreground num">{r.value}</span>
                <ChevronRightIcon aria-hidden="true" strokeWidth={1.75} className="size-5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={cn(TEXT_BUTTON, "mt-2")} onClick={props.onTypeAll} data-slot="edit-type-all">
          {COPY["edit.typeAll"]}
        </button>
      </div>
    );
  }

  const question = STEP_QUESTION[step];
  const ctx: QuestionContext = {
    values: { buildingText: check.buildingText, areaText: check.areaText, bedrooms: check.bedrooms, sizeSqft: check.sizeSqft, priceAed: check.priceAed },
    match,
    completion: check.completion === "unknown" ? undefined : check.completion,
    fromText: false,
    sizes,
  };
  const note = step === "building" ? questionNote(question, ctx) : "";
  const answer = (a: Answers) => {
    const change = changeOf(check, a);
    if (change) props.onChange(change);
    else props.onOpenChange(false);
  };
  const pick = (id: number | null, b?: PickedBuilding) => {
    if (id === (check.building?.id ?? null)) props.onOpenChange(false);
    else props.onChange({ field: "building", value: id === null ? null : (b ?? null) });
  };
  return (
    <div ref={bodyRef} className="flex flex-col" data-slot="edit-question" data-step={step}>
      {note ? <p className="type-lead max-w-[52ch] text-muted-foreground">{note}</p> : null}
      <QuestionControls
        key={step}
        question={question}
        ctx={ctx}
        onAnswer={answer}
        onPick={pick}
        onAccept={() => undefined}
        onAnother={null}
        onType={props.onTypeAll}
        onTypeAll={props.onTypeAll}
        showTypeAll={false}
        className="pt-2 lg:pt-3"
      />
    </div>
  );
}

export function EditSheet(props: EditSheetProps) {
  const { open, onOpenChange, entry } = props;
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [step, setStep] = useState<EditStep>(entry);
  const [openedAt, setOpenedAt] = useState<{ open: boolean; entry: EditStep }>({ open, entry });
  // Each opening starts at its entry step (the rows, or the building question).
  if (openedAt.open !== open || openedAt.entry !== entry) {
    setOpenedAt({ open, entry });
    if (open) setStep(entry);
  }
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);

  // Focus: the title on each new step (the opening is `initialFocus`); a step with no buttons (the
  // price, a size with no usual sizes) focuses its input, as the scene's questions do (RESULT_SPEC 2.5).
  useEffect(() => {
    if (!open) {
      firstStep.current = true;
      return;
    }
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const target = (step === "rows" ? null : questionInput(bodyRef.current)) ?? titleRef.current;
    target?.focus({ preventScroll: true });
  }, [open, step]);

  const title = COPY[STEP_TITLE[step]];
  const back = step !== "rows" && entry === "rows";
  const header = (titleEl: ReactNode) => (
    <div className="flex items-center gap-4" data-slot="edit-head">
      {titleEl}
      {back ? (
        <button type="button" className={TEXT_BUTTON} onClick={() => setStep("rows")} data-slot="edit-back">
          {COPY["step.back"]}
        </button>
      ) : null}
      <button type="button" className={TEXT_BUTTON} onClick={() => onOpenChange(false)} data-slot="edit-close">
        {COPY["ui.close"]}
      </button>
    </div>
  );
  const titleClass = "min-w-0 flex-1 font-display text-[24px] leading-[1.2] font-[480] tracking-[-0.01em] text-foreground outline-none";
  const initialFocus = () => titleRef.current;

  if (desktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          initialFocus={initialFocus}
          finalFocus={props.finalFocus}
          className="w-[420px] gap-0 overflow-y-auto px-7 pt-5 pb-10 sm:max-w-[420px]"
          data-slot="edit-sheet"
        >
          {header(
            <SheetTitle ref={titleRef} tabIndex={-1} className={titleClass}>
              {title}
            </SheetTitle>,
          )}
          <Body step={step} setStep={setStep} props={props} bodyRef={bodyRef} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent initialFocus={initialFocus} finalFocus={props.finalFocus} data-slot="edit-sheet">
        <div className="max-h-[calc(85dvh-12px)] overflow-y-auto px-4 pt-1 pb-[calc(34px+env(safe-area-inset-bottom))]">
          {header(
            <DrawerTitle ref={titleRef} tabIndex={-1} className={titleClass}>
              {title}
            </DrawerTitle>,
          )}
          <Body step={step} setStep={setStep} props={props} bodyRef={bodyRef} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
