"use client";

/**
 * The one-question interrupt (docs/REDESIGN.md section 7.5): the scene asks only what it must, one
 * question at a time, in the scene's own language: a serif heading in the head slot (the focus
 * target), one quiet note, and the fewest controls that answer it. An answer continues at once.
 *
 * | Question            | Controls                                                             |
 * | Which building?     | up to 3 candidate rows, None of these, Search covered buildings      |
 * | Building name       | one input and Continue (then a building match)                       |
 * | Bedrooms            | 8 buttons; a tap continues                                           |
 * | Size                | the usual DLD sizes as buttons (a tap compares), or type it          |
 * | Price               | one input with its unit, and Continue                                |
 * | Ready or off-plan?  | 2 buttons; a tap continues                                           |
 * | Price per sq ft     | both inputs, filled with what was read, and Continue                 |
 * | Rental, not a listing, villa | the way forward for each                                   |
 *
 * "Type all the details instead" is always the last control and opens the form with everything known.
 * The fact line (what is known so far) sits in its own slot above the controls (RESULT_SPEC 2.5).
 * Candidate rows are buttons: activating one is an explicit command (WCAG 3.2.2), unlike the form's
 * radios. The preselected candidate is listed first, with no tag: the person is being asked to look.
 */
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { BuildingSearch } from "@/components/check/building-search";
import { coverageLine } from "@/components/check/building-picker";
import { ScreenshotThumb } from "@/components/scene/screenshot-dialog";
import { usePublicConfig } from "@/components/shell/config-provider";
import { Button } from "@/components/ui/button";
import type { FlowImage, PickedBuilding } from "@/hooks/use-check-flow";
import { COPY, FIELD_ERRORS, t, tList, type CopyKey } from "@/lib/copy";
import { completionBasis } from "@/lib/domain/analyse";
import { buildingOptions, isConfidentMatch, type Answers, type MergedValues, type Question } from "@/lib/flow/decide-next";
import { bedsLabel, formatInt } from "@/lib/format";
import type { Completion, MatchResponse } from "@/lib/types";
import { LIMITS, toNumberOrUndefined, wholeAed } from "@/lib/validation/fields";
import { cn } from "@/lib/utils";

const OUTCOME_COPY: Record<"rental" | "not_listing" | "not_apartment", { h: CopyKey; body: CopyKey }> = {
  rental: { h: "ask.rentalH", body: "ask.rentalBody" },
  not_listing: { h: "ask.notListingH", body: "ask.notListingBody" },
  not_apartment: { h: "ask.villaH", body: "ask.villaBody" },
};

const FIELD_HEADING: Record<"bedrooms" | "sizeSqft" | "priceAed" | "buildingText", CopyKey> = {
  bedrooms: "ask.bedsH",
  sizeSqft: "ask.sizeH",
  priceAed: "ask.priceH",
  buildingText: "ask.buildingNameH",
};

const BED_LABELS = tList("field.bedroomsOptions");

export interface QuestionContext {
  values: MergedValues;
  match: MatchResponse | null;
  completion: Completion | undefined;
  /** Pasted text says "It isn't in the listing text." */
  fromText: boolean;
  /**
   * The size buttons when the caller knows them (the Change a detail sheet: the result's own sales);
   * undefined: from the match's strong preselect.
   */
  sizes?: { building: string; sizes: { sqft: number; sales: number }[] } | null;
}

/** The question's heading. */
export function questionHeading(q: Question): string {
  if (q.kind === "outcome") return COPY[OUTCOME_COPY[q.outcome].h];
  if (q.kind === "field") return COPY[FIELD_HEADING[q.field]];
  if (q.kind === "psf") return COPY["ask.psfH"];
  if (q.kind === "completion") return COPY["ask.completionH"];
  return COPY["ask.buildingH"];
}

/** The question's note (type-lead, pencil). */
export function questionNote(q: Question, ctx: QuestionContext): string {
  if (q.kind === "outcome") return COPY[OUTCOME_COPY[q.outcome].body];
  if (q.kind === "field") {
    if (q.invalid) return q.field === "buildingText" ? FIELD_ERRORS.buildingText : FIELD_ERRORS[q.field];
    return COPY[ctx.fromText ? "ask.notInText" : "ask.notIn"];
  }
  if (q.kind === "psf") {
    const { sizeSqft, priceAed } = ctx.values;
    return sizeSqft && priceAed ? FIELD_ERRORS.psf(priceAed / sizeSqft) : COPY["ask.psfH"];
  }
  if (q.kind === "completion") return COPY[ctx.fromText ? "ask.notInText" : "ask.notIn"];
  const says = ctx.values.buildingText ? t("ask.buildingSays", { text: ctx.values.buildingText }) : "";
  const flag = ctx.match?.towerCheck ? COPY["pick.lookalike"] : ctx.match?.areaCheck ? COPY["pick.sameName"] : "";
  return [says, flag].filter(Boolean).join(" ");
}

export function QuestionHead({
  question,
  ctx,
  headingRef,
  image,
  onViewImage,
}: {
  question: Question;
  ctx: QuestionContext;
  headingRef: Ref<HTMLHeadingElement>;
  image: FlowImage | null;
  onViewImage: () => void;
}) {
  return (
    <div className="relative" data-slot="scene-question" data-question={question.kind === "field" ? question.field : question.kind}>
      {/* Phones: the stage is collapsed, so the screenshot sits beside the heading and its note, inside
          the head's 88px, and the fact line under them stays where it was (desktop shows it in the stage). */}
      {image ? <ScreenshotThumb image={image} onView={onViewImage} className="absolute top-0 right-0 h-22 lg:hidden" /> : null}
      <h2 ref={headingRef} tabIndex={-1} data-scene-caption="" className={cn("type-display-md max-w-[18ch] text-foreground outline-none", image && "max-lg:pr-18")}>
        {questionHeading(question)}
      </h2>
      <p className={cn("mt-1.5 type-lead max-w-[52ch] text-muted-foreground", image && "max-lg:pr-18")} data-slot="question-note">
        {questionNote(question, ctx)}
      </p>
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-caption text-destructive" data-slot="answer-error">
      <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A 56px number input with its unit, Archivo 22 tabular. */
function NumberAnswer({
  id,
  label,
  prefix,
  suffix,
  value,
  onChange,
  errorId,
  invalid,
}: {
  id: string;
  label: string;
  prefix?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  errorId?: string;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="type-label text-foreground">
        {label}
      </label>
      <div
        className={cn(
          "flex h-14 w-full max-w-[22rem] items-center gap-2 rounded-md border bg-card px-4 transition-colors duration-(--dur-fast)",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          invalid ? "border-destructive" : "border-input",
        )}
      >
        {prefix ? (
          <span aria-hidden="true" className="text-body text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const n = toNumberOrUndefined(value);
            if (n !== undefined) onChange(numberFormat.format(n));
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent font-sans text-[22px] text-foreground outline-none num"
        />
        {suffix ? (
          <span aria-hidden="true" className="text-body text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const fmt = (n: number | null) => (n === null ? "" : numberFormat.format(n));

function sizeError(n: number | undefined): string | null {
  return n === undefined || !(n > LIMITS.sizeMin) || n > LIMITS.sizeMax ? FIELD_ERRORS.sizeSqft : null;
}
function priceError(n: number | undefined): string | null {
  return n === undefined || !(n > LIMITS.priceMin) || n > LIMITS.priceMax ? FIELD_ERRORS.priceAed : null;
}

/**
 * The usual sizes of this bedroom count in the preselected building (RESULT_SPEC section 2.5): only
 * with a strong preselect whose registered sales give size clusters. Null otherwise.
 */
export function sizeChoices(ctx: Pick<QuestionContext, "match" | "sizes">): { building: string; sizes: { sqft: number; sales: number }[] } | null {
  if (ctx.sizes !== undefined) return ctx.sizes && ctx.sizes.sizes.length > 0 ? ctx.sizes : null;
  const m = ctx.match;
  if (!m || !isConfidentMatch(m)) return null;
  const pre = m.candidates.find((c) => c.buildingId === m.preselectId);
  return pre?.sizes && pre.sizes.length > 0 ? { building: pre.name, sizes: pre.sizes } : null;
}

/** Full-width 56px buttons: "About 815 sq ft" and "31 sales". A tap is an explicit command: it compares at once. */
function SizeButtons({ ctx, onAnswer }: { ctx: QuestionContext; onAnswer: (a: Answers) => void }) {
  const legend = useId();
  const choices = sizeChoices(ctx);
  if (!choices || ctx.values.bedrooms === null) return null;
  return (
    <div role="group" aria-labelledby={legend} className="flex flex-col gap-1" data-slot="size-buttons">
      <p id={legend} className="text-[14px] leading-5 text-muted-foreground">
        {t("ask.sizeCommon", { bedType: bedsLabel(ctx.values.bedrooms), building: choices.building })}
      </p>
      <div className="flex max-w-[28rem] flex-col gap-2">
        {choices.sizes.map((s) => {
          const label = t("ask.sizeChip", { size: formatInt(s.sqft) });
          const sales = t("ask.sizeChipSales", { n: formatInt(s.sales) });
          return (
            <button
              key={s.sqft}
              type="button"
              aria-label={`${label}, ${sales}`}
              onClick={() => onAnswer({ sizeSqft: s.sqft, sizeSource: "cluster" })}
              className={cn(
                "flex min-h-14 items-center justify-between gap-3 rounded-md border border-input bg-transparent px-4 text-left transition-colors duration-(--dur-fast)",
                "hover:bg-accent active:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              )}
              data-size={s.sqft}
            >
              <span className="text-base font-medium text-foreground num">{label.replace(" sq ft", " sq ft")}</span>
              <span className="text-[14px] text-muted-foreground num">{sales}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumbersForm({ question, ctx, onAnswer }: { question: Question; ctx: QuestionContext; onAnswer: (a: Answers) => void }) {
  const ids = { size: useId(), price: useId(), error: useId() };
  const askSize = question.kind === "psf" || (question.kind === "field" && question.field === "sizeSqft");
  const sizeButtons = question.kind === "field" && question.field === "sizeSqft" && !question.invalid && sizeChoices(ctx) !== null;
  const askPrice = question.kind === "psf" || (question.kind === "field" && question.field === "priceAed");
  const [size, setSize] = useState(() => fmt(ctx.values.sizeSqft));
  const [price, setPrice] = useState(() => fmt(ctx.values.priceAed));
  const [error, setError] = useState<{ on: "size" | "price" | "both"; message: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = askSize ? toNumberOrUndefined(size) : (ctx.values.sizeSqft ?? undefined);
    const p = askPrice ? toNumberOrUndefined(price) : (ctx.values.priceAed ?? undefined);
    const se = askSize ? sizeError(s) : null;
    const pe = askPrice ? priceError(p) : null;
    if (se || pe) {
      setError({ on: se ? "size" : "price", message: (se ?? pe) as string });
      document.getElementById(se ? ids.size : ids.price)?.focus();
      return;
    }
    if (question.kind === "psf" && s !== undefined && p !== undefined) {
      const psf = wholeAed(p) / s;
      if (psf < LIMITS.psfMin || psf > LIMITS.psfMax) {
        setError({ on: "both", message: FIELD_ERRORS.psf(psf) });
        document.getElementById(ids.size)?.focus();
        return;
      }
    }
    setError(null);
    onAnswer({
      ...(askSize && s !== undefined ? { sizeSqft: s, sizeSource: "typed" as const } : {}),
      ...(askPrice && p !== undefined ? { priceAed: wholeAed(p) } : {}),
    });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-slot="answer-form">
      {sizeButtons ? <SizeButtons ctx={ctx} onAnswer={onAnswer} /> : null}
      {askSize ? (
        <NumberAnswer
          id={ids.size}
          label={sizeButtons ? COPY["ask.sizeOr"] : COPY["field.size"]}
          suffix={COPY["field.sqft"]}
          value={size}
          onChange={setSize}
          errorId={ids.error}
          invalid={error !== null && error.on !== "price"}
        />
      ) : null}
      {askPrice ? (
        <NumberAnswer
          id={ids.price}
          label={COPY["field.price"]}
          prefix={COPY["field.aed"]}
          value={price}
          onChange={setPrice}
          errorId={ids.error}
          invalid={error !== null && error.on !== "size"}
        />
      ) : null}
      {error ? <FieldError id={ids.error}>{error.message}</FieldError> : null}
      <Button type="submit" size="lg" className="w-full sm:w-fit">
        {COPY["ask.continue"]}
      </Button>
    </form>
  );
}

function BuildingNameForm({ ctx, onAnswer }: { ctx: QuestionContext; onAnswer: (a: Answers) => void }) {
  const ids = { input: useId(), error: useId() };
  const [name, setName] = useState(() => ctx.values.buildingText ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (v.length < 2 || v.length > LIMITS.buildingMax) {
      setError(FIELD_ERRORS.buildingText);
      document.getElementById(ids.input)?.focus();
      return;
    }
    setError(null);
    onAnswer({ buildingText: v });
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-slot="answer-form">
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.input} className="type-label text-foreground">
          {COPY["field.building"]}
        </label>
        <input
          id={ids.input}
          type="text"
          autoComplete="off"
          enterKeyHint="go"
          maxLength={LIMITS.buildingMax}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          className={cn(
            "h-12 w-full max-w-[28rem] rounded-md border bg-card px-4 text-base text-foreground outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            error ? "border-destructive" : "border-input",
          )}
        />
      </div>
      {error ? <FieldError id={ids.error}>{error}</FieldError> : null}
      <Button type="submit" size="lg" className="w-full sm:w-fit">
        {COPY["ask.continue"]}
      </Button>
    </form>
  );
}

function BedroomButtons({ onAnswer }: { onAnswer: (a: Answers) => void }) {
  const legend = useId();
  return (
    <div role="group" aria-labelledby={legend} className="flex flex-col gap-2" data-slot="bedroom-buttons">
      <span id={legend} className="type-label text-foreground">
        {COPY["field.bedrooms"]}
      </span>
      <div className="grid max-w-[28rem] grid-cols-4 gap-2">
        {BED_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => onAnswer({ bedrooms: i })}
            className={cn(
              "min-h-12 rounded-md border border-input bg-transparent px-1 text-[15px] font-medium text-foreground transition-colors duration-(--dur-fast)",
              "hover:bg-accent active:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ROW = cn(
  "group/row flex min-h-16 w-full items-center gap-3 border-b border-border py-3 pr-1 text-left transition-colors duration-(--dur-fast)",
  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
);

/** The building question's rows (also the "Wrong building?" sheet on a result). */
export function BuildingRows({
  ctx,
  onPick,
}: {
  ctx: QuestionContext;
  onPick: (id: number | null, b?: PickedBuilding) => void;
}) {
  const { rules } = usePublicConfig();
  const [searchOpen, setSearchOpen] = useState(false);
  const options = ctx.match ? buildingOptions(ctx.match) : [];
  const basis = completionBasis(ctx.completion);
  const beds = ctx.values.bedrooms ?? undefined;
  const typed = ctx.values.buildingText ?? "";
  return (
    <div className="flex flex-col gap-2" data-slot="building-rows">
      <ul className="flex flex-col border-t border-border">
        {options.map((o) => {
          const line = coverageLine(o.salesForBedrooms, beds, basis, rules);
          const name = [o.name, o.area, line].filter(Boolean).join(", ");
          return (
            <li key={o.buildingId}>
              <button
                type="button"
                className={ROW}
                aria-label={name}
                data-option={o.buildingId}
                onClick={() => onPick(o.buildingId, { buildingId: o.buildingId, name: o.name, area: o.area })}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="type-title break-words text-foreground">{o.name}</span>
                  <span className="text-caption text-muted-foreground">{o.area}</span>
                  {line ? <span className="text-caption text-muted-foreground num">{line}</span> : null}
                </span>
                <ChevronRightIcon aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className={ROW} data-option="none" onClick={() => onPick(null)}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-title text-foreground">{COPY["pick.none"]}</span>
              {typed ? <span className="text-caption break-words text-muted-foreground">{t("pick.noneSub", { text: typed })}</span> : null}
            </span>
            <ChevronRightIcon aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0 text-muted-foreground" />
          </button>
        </li>
      </ul>
      <Button type="button" variant="link" className="self-start" onClick={() => setSearchOpen(true)}>
        {COPY["pick.search"]}
      </Button>
      <BuildingSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={(b) => onPick(b.buildingId, { buildingId: b.buildingId, name: b.name, area: b.area })}
      />
    </div>
  );
}

/** "Is it ready or off-plan?": two buttons; a tap continues. */
function CompletionButtons({ onAnswer }: { onAnswer: (a: Answers) => void }) {
  const legend = useId();
  const [ready, offPlan] = tList("ask.completionOptions");
  return (
    <div role="group" aria-labelledby={legend} className="flex flex-col gap-2" data-slot="completion-buttons">
      <span id={legend} className="sr-only">
        {COPY["ask.completionH"]}
      </span>
      <div className="grid max-w-[28rem] grid-cols-2 gap-2">
        {([["ready", ready], ["off_plan", offPlan]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onAnswer({ completion: value })}
            className={cn(
              "min-h-14 rounded-md border border-input bg-transparent px-3 text-base font-medium text-foreground transition-colors duration-(--dur-fast)",
              "hover:bg-accent active:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            )}
            data-completion={value}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface QuestionControlsProps {
  question: Question;
  ctx: QuestionContext;
  onAnswer: (a: Answers) => void;
  onPick: (id: number | null, b?: PickedBuilding) => void;
  /** "It's for sale, continue". */
  onAccept: () => void;
  /** "Try another screenshot" (null when reading is off). */
  onAnother: (() => void) | null;
  /** "Type the details": the empty form (not a listing). */
  onType: () => void;
  /** The form with everything known ("Type all the details instead", "Type the details anyway"). */
  onTypeAll: () => void;
  /** Show "Type all the details instead" under the controls (the Change a detail sheet has its own). */
  showTypeAll?: boolean;
  className?: string;
}

export function QuestionControls({ question, ctx, onAnswer, onPick, onAccept, onAnother, onType, onTypeAll, showTypeAll = true, className }: QuestionControlsProps) {
  let controls: ReactNode;
  let typeAll = showTypeAll;
  if (question.kind === "outcome") {
    typeAll = false;
    const another = onAnother ? (
      <Button type="button" size="lg" variant={question.outcome === "not_listing" ? "default" : "outline"} onClick={onAnother}>
        {COPY["alert.tryAnother"]}
      </Button>
    ) : null;
    controls =
      question.outcome === "rental" ? (
        <>
          <Button type="button" size="lg" onClick={onAccept}>
            {COPY["alert.rentalContinue"]}
          </Button>
          {another}
          <Button type="button" variant="link" onClick={onTypeAll}>
            {COPY["home.type"]}
          </Button>
        </>
      ) : question.outcome === "not_listing" ? (
        <>
          {another}
          <Button type="button" variant={onAnother ? "link" : "default"} size={onAnother ? "default" : "lg"} onClick={onType}>
            {COPY["home.type"]}
          </Button>
        </>
      ) : (
        <>
          <Button type="button" size="lg" onClick={onTypeAll}>
            {COPY["alert.anyway"]}
          </Button>
          {another}
        </>
      );
    controls = <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">{controls}</div>;
  } else if (question.kind === "building") {
    controls = <BuildingRows ctx={ctx} onPick={onPick} />;
  } else if (question.kind === "completion") {
    controls = <CompletionButtons onAnswer={onAnswer} />;
  } else if (question.kind === "field" && question.field === "bedrooms") {
    controls = <BedroomButtons onAnswer={onAnswer} />;
  } else if (question.kind === "field" && question.field === "buildingText") {
    controls = <BuildingNameForm ctx={ctx} onAnswer={onAnswer} />;
  } else {
    controls = <NumbersForm question={question} ctx={ctx} onAnswer={onAnswer} />;
  }

  return (
    <div className={cn("flex flex-col gap-6 pt-4 lg:pt-6", className)} data-slot="question-controls">
      {controls}
      {typeAll ? (
        <Button type="button" variant="link" className="self-start" onClick={onTypeAll} data-slot="type-all">
          {COPY["ask.typeAll"]}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The first input of a question that has no buttons (an answer form with no size buttons: the price, a
 * size with no usual sizes, the building name, the price per sq ft), or null. Such a question focuses
 * its input, so the keypad opens at once; a question with buttons focuses its heading (RESULT_SPEC 2.5).
 */
export function questionInput(root: ParentNode | null | undefined): HTMLInputElement | null {
  const form = root?.querySelector<HTMLElement>('[data-slot="question-controls"] [data-slot="answer-form"]');
  if (!form || form.querySelector('[data-slot="size-buttons"]')) return null;
  return form.querySelector<HTMLInputElement>("input");
}

/** "AED 1,908" for the balance's left label, or null when the price per sq ft is not known yet. */
export function listingPsfFigure(v: Pick<MergedValues, "priceAed" | "sizeSqft">): string | null {
  return v.priceAed !== null && v.sizeSqft !== null && v.sizeSqft > 0 ? `AED ${formatInt(v.priceAed / v.sizeSqft)}` : null;
}
