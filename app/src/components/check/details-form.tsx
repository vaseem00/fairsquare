"use client";

/**
 * The only form (docs/REDESIGN.md section 8.6): Edit from a result, "Type the details", and a partial
 * read. A read never opens it by itself. "Compare price" enters the scene at weighing, then the result.
 * No boxes, pills or icons in buttons: rows between hairlines, text buttons, a left-ruled error summary.
 * - react-hook-form with `zodResolver(ListingFieldsSchema)` (the same schema as POST /api/checks),
 *   `mode: "onTouched"`, `reValidateMode: "onChange"`: errors show after blur or submit, never
 *   before typing. Numbers go through `toNumberOrUndefined` (never "" → 0 = Studio).
 * - Bedrooms is a Select (Studio, 1–7); size and price are InputGroups with "sq ft" / "AED".
 * - Each field's FieldError and FieldDescription are tied with `aria-describedby`; a field Claude
 *   left empty says "Not in the screenshot. Add it here." (Bedrooms: "Choose one."), a field the
 *   person changed after reading says "Changed by you" (and is sent as `editedFields`).
 * - "Compare price" is never disabled. Submitting with one error focuses that field; with two or
 *   more, a summary (role="alert") with links to each field takes focus. It sends nothing while invalid.
 * - The building options re-match 250 ms after the building, area or bedrooms change, and the match
 *   count is announced. The strong match is pre-selected.
 * - "Off-plan" (a checkbox, ticked when the read found an off-plan listing) decides which sales the
 *   listing is compared with (REAL_DATA.md section 7): off-plan sales only, or ready ones.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import { Controller, useForm, useWatch, type DefaultValues, type FieldErrors } from "react-hook-form";
import type { z } from "zod";
import { useAnnounce } from "@/components/a11y/live-region";
import { BuildingPicker } from "@/components/check/building-picker";
import { ActionBar } from "@/components/flow/action-bar";
import { ScreenshotThumb } from "@/components/scene/screenshot-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  editedFieldsOf,
  matchQueryKey,
  type DetailsDraft,
  type DetailsValues,
  type FlowImage,
  type PickedBuilding,
  type PickValue,
  type SubmitPayload,
  type SubmitResult,
} from "@/hooks/use-check-flow";
import { api } from "@/lib/api/client";
import { COPY, t, tList, tPlural } from "@/lib/copy";
import { completionBasis } from "@/lib/domain/analyse";
import type { CandidateView, CheckSource, Completion, ExtractedFields, FieldKey, ListingFields, MatchResponse } from "@/lib/types";
import { ListingFieldsSchema, toNumberOrUndefined } from "@/lib/validation/fields";

type FormInput = z.input<typeof ListingFieldsSchema>;

export const MATCH_DEBOUNCE_MS = 250;

const FIELD_ORDER: FieldKey[] = ["buildingText", "areaText", "bedrooms", "sizeSqft", "priceAed"];
const FIELD_LABEL: Record<FieldKey, string> = {
  buildingText: COPY["field.building"],
  areaText: COPY["field.area"],
  bedrooms: COPY["field.bedrooms"],
  sizeSqft: COPY["field.size"],
  priceAed: COPY["field.price"],
};
const BED_ITEMS = tList("field.bedroomsOptions").map((label, i) => ({ value: String(i), label }));

const SOURCE_LABEL: Record<CheckSource, string> = {
  claude: COPY["details.source.claude"],
  manual: COPY["details.source.manual"],
  text: COPY["details.source.text"],
};

type ErrorKey = FieldKey | "pick";
interface ListedError {
  key: ErrorKey;
  message: string;
}

/** Errors in field order, the price-per-sq-ft message (on both size and price) counted once. */
export function listErrors(errs: Partial<Record<FieldKey, string | undefined>>, pickError: string | null): ListedError[] {
  const out: ListedError[] = [];
  const seen = new Set<string>();
  for (const key of FIELD_ORDER) {
    const message = errs[key];
    if (message && !seen.has(message)) {
      seen.add(message);
      out.push({ key, message });
    }
  }
  if (pickError) out.push({ key: "pick", message: pickError });
  return out;
}

function messages(errs: FieldErrors<FormInput>): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  for (const k of FIELD_ORDER) {
    const m = errs[k]?.message;
    if (typeof m === "string" && m) out[k] = m;
  }
  return out;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const display = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : numberFormat.format(v));

/** A number typed as text ("2,450,000"): grouped on blur, the form value is a number or undefined. */
function NumberInput({
  value,
  onChange,
  onBlur,
  inputRef,
  ...rest
}: {
  value: number | undefined;
  onChange: (v: number | null) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  id: string;
  name: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [text, setText] = useState(() => display(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    // Changed from outside (a reset): show the new value.
    setLast(value);
    if (toNumberOrUndefined(text) !== value) setText(display(value));
  }
  return (
    <InputGroupInput
      ref={inputRef}
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="go"
      value={text}
      onChange={(e) => {
        const n = toNumberOrUndefined(e.target.value);
        setText(e.target.value);
        setLast(n);
        // An empty field is null in the form: react-hook-form treats undefined as "use the default".
        onChange(n ?? null);
      }}
      onBlur={() => {
        if (value !== undefined) setText(display(value));
        onBlur();
      }}
      className="h-12 num"
    />
  );
}

export interface DetailsFormProps {
  draft: DetailsDraft;
  extracted: ExtractedFields | null;
  source: CheckSource;
  /** Pasted text parsed in the browser: it never reads the building, so no "missing" hints. */
  localParse: boolean;
  image: FlowImage | null;
  /** Screenshot reading is on (Replace is offered). */
  canRead: boolean;
  /** Field errors from the server (validation_failed), shown when the form opens. */
  serverErrors?: Record<string, string> | null;
  onDraft: (d: DetailsDraft) => void;
  onCompare: (p: SubmitPayload) => Promise<SubmitResult>;
  onViewImage: () => void;
  onReplace: () => void;
  onRemove: () => void;
}

export function DetailsForm({
  draft,
  extracted,
  source,
  localParse,
  image,
  canRead,
  serverErrors = null,
  onDraft,
  onCompare,
  onViewImage,
  onReplace,
  onRemove,
}: DetailsFormProps) {
  const announce = useAnnounce();
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;

  const form = useForm<FormInput, unknown, ListingFields>({
    resolver: zodResolver(ListingFieldsSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    shouldFocusError: false,
    defaultValues: draft.values as DefaultValues<FormInput>,
  });
  const { control, register, handleSubmit, setError, setFocus, formState } = form;
  const watched = useWatch({ control });
  const values: DetailsValues = {
    buildingText: watched.buildingText ?? "",
    areaText: watched.areaText ?? null,
    bedrooms: typeof watched.bedrooms === "number" ? watched.bedrooms : undefined,
    sizeSqft: typeof watched.sizeSqft === "number" ? watched.sizeSqft : undefined,
    priceAed: typeof watched.priceAed === "number" ? watched.priceAed : undefined,
  };
  const edited = editedFieldsOf(extracted, values);

  // ----- building options -----
  const [candidates, setCandidates] = useState<CandidateView[]>(draft.candidates);
  const [towerCheck, setTowerCheck] = useState(draft.towerCheck);
  const [areaCheck, setAreaCheck] = useState(draft.areaCheck);
  const [bestId, setBestId] = useState(draft.bestId);
  const [extra, setExtra] = useState<CandidateView[]>(draft.extra);
  const [pick, setPick] = useState<PickValue>(draft.pick);
  const [queryKey, setQueryKey] = useState<string | null>(draft.queryKey);
  const [matching, setMatching] = useState(false);
  // Ready or off-plan decides which sales the listing is compared with (REAL_DATA.md section 7).
  const [completion, setCompletion] = useState<Completion | undefined>(draft.completion);
  const [pickErrorState, setPickError] = useState<string | null>(null);
  // A building chosen (by the person or by a match that arrived later) clears "Choose a building".
  const pickError = pick ? null : pickErrorState;
  const pickedByUser = useRef(draft.pickedByUser);
  const extraRef = useRef(extra);
  useEffect(() => {
    extraRef.current = extra;
  }, [extra]);

  // The options' sale counts follow the completion basis, so ticking "Off-plan" matches again.
  const basis = completionBasis(completion);
  const key = matchQueryKey({ ...values, completion });
  const q = values.buildingText.trim();
  const area = (values.areaText ?? "").trim();
  const beds = values.bedrooms;
  useEffect(() => {
    if (key === queryKey) return;
    let live = true;
    const timer = setTimeout(
      async () => {
        if (!q) {
          setCandidates([]);
          setTowerCheck(false);
          setAreaCheck(false);
          setBestId(null);
          setQueryKey(key);
          setPick((p) => (p === "none" || (pickedByUser.current && extraHas(extraRef.current, p)) ? p : ""));
          return;
        }
        setMatching(true);
        announce(COPY["read.matching"]);
        const res = await api.match(q, area || null, beds ?? null, basis);
        if (!live) return;
        setMatching(false);
        setQueryKey(key);
        if (!res.ok) return;
        const m: MatchResponse = res.data;
        setCandidates(m.candidates);
        setTowerCheck(m.towerCheck);
        setAreaCheck(m.areaCheck);
        setBestId(m.preselectId);
        announce(tPlural("pick.announce", m.candidates.length));
        const ids = new Set([...m.candidates, ...extraRef.current].map((c) => c.buildingId));
        setPick((prev) => {
          if (prev === "none") return prev;
          const still = prev !== "" && ids.has(Number(prev.slice(2)));
          if (pickedByUser.current) {
            if (still) return prev;
            pickedByUser.current = false;
          }
          if (m.preselectId !== null) return `b:${m.preselectId}`;
          return still ? prev : "";
        });
      },
      queryKey === null ? 0 : MATCH_DEBOUNCE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
      setMatching(false);
    };
  }, [key, queryKey, q, area, beds, basis, announce]);

  const options = [
    ...candidates.slice(0, 3),
    ...extra.filter((e) => !candidates.slice(0, 3).some((c) => c.buildingId === e.buildingId)),
  ];
  const matchedCount = Math.min(3, candidates.length);

  const choosePick = (v: PickValue) => {
    pickedByUser.current = true;
    setPick(v);
    setPickError(null);
  };

  const onSearchPick = (b: PickedBuilding) => {
    if (![...candidates, ...extra].some((c) => c.buildingId === b.buildingId)) {
      setExtra((x) => [...x, { ...b, strength: "possible", salesForBedrooms: null }]);
    }
    choosePick(`b:${b.buildingId}`);
  };

  // Keep the draft with the flow, so leaving step 2 and coming back keeps every value.
  useEffect(() => {
    onDraft({
      formKey: draft.formKey,
      values,
      pick,
      pickedByUser: pickedByUser.current,
      extra,
      candidates,
      towerCheck,
      areaCheck,
      bestId,
      queryKey,
      ...(completion ? { completion } : {}),
    });
  });

  // ----- errors and focus -----
  const groupRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryShown, setSummaryShown] = useState(false);
  const [summaryNonce, setSummaryNonce] = useState(0);
  const fieldErrors = messages(formState.errors);
  const currentErrors = listErrors(fieldErrors, pickError);
  const showSummary = summaryShown && currentErrors.length >= 2;

  // The summary can render a commit after the submit (react-hook-form publishes its errors on its
  // own schedule): focus it once per submit, as soon as it is on screen.
  const focusedNonce = useRef(0);
  useEffect(() => {
    if (summaryNonce > focusedNonce.current && showSummary && summaryRef.current) {
      focusedNonce.current = summaryNonce;
      summaryRef.current.focus();
    }
  }, [summaryNonce, showSummary]);

  const focusError = useCallback(
    (k: ErrorKey) => {
      if (k === "pick") {
        const g = groupRef.current;
        const radio =
          g?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? g?.querySelector<HTMLElement>('[role="radio"]');
        radio?.focus();
        return;
      }
      setFocus(k);
    },
    [setFocus],
  );

  const report = (list: ListedError[]) => {
    if (list.length >= 2) {
      setSummaryShown(true);
      setSummaryNonce((n) => n + 1);
    } else if (list.length === 1) {
      setSummaryShown(false);
      focusError(list[0].key);
    }
  };

  // Compare pressed while the building match is still on its way (for example one tap after the
  // details load): wait for the match, which may preselect the building, instead of reporting
  // "Choose a building" for a choice the person never had the chance to see.
  const matchPending = matching || key !== queryKey;
  const submitAfterMatch = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (matchPending || !submitAfterMatch.current) return;
    submitAfterMatch.current = false;
    formRef.current?.requestSubmit();
  }, [matchPending]);

  const onValid = async (v: ListingFields) => {
    if (!pick && matchPending && q) {
      submitAfterMatch.current = true;
      return;
    }
    const pErr = pick ? null : COPY["err.pick"];
    setPickError(pErr);
    if (pErr) {
      report([{ key: "pick", message: pErr }]);
      return;
    }
    setSummaryShown(false);
    const res = await onCompare({
      fields: {
        ...v,
        buildingText: v.buildingText.trim(),
        areaText: v.areaText && v.areaText.trim() ? v.areaText.trim() : null,
      },
      buildingId: pick === "none" ? null : Number(pick.slice(2)),
      editedFields: edited,
      ...(completion ? { completion } : {}),
    });
    if (!res.ok && res.fields) {
      const server: Partial<Record<FieldKey, string>> = {};
      for (const [path, message] of Object.entries(res.fields)) {
        const k = path.split(".").pop() as FieldKey;
        if (FIELD_ORDER.includes(k)) {
          server[k] = message;
          setError(k, { type: "server", message });
        }
      }
      report(listErrors(server, null));
    }
  };

  const onInvalid = (errs: FieldErrors<FormInput>) => {
    // While the building name itself is missing or invalid there is nothing to choose from yet:
    // report the name only, not a second "choose a building" error over an empty list.
    const pErr = pick || errs.buildingText ? null : COPY["err.pick"];
    setPickError(pErr);
    report(listErrors(messages(errs), pErr));
  };

  // The server's field errors (rare: the client runs the same schema), once when the form opens.
  const appliedServer = useRef(false);
  useEffect(() => {
    if (!serverErrors || appliedServer.current) return;
    appliedServer.current = true;
    const server: Partial<Record<FieldKey, string>> = {};
    for (const [path, message] of Object.entries(serverErrors)) {
      const k = path.split(".").pop() as FieldKey;
      if (FIELD_ORDER.includes(k)) {
        server[k] = message;
        setError(k, { type: "server", message });
      }
    }
    report(listErrors(server, null));
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- field descriptions -----
  const showMissing = (source === "claude" || source === "text") && !localParse && extracted !== null;
  const describe = (k: FieldKey): string | null => {
    const v = values[k];
    const empty = v === undefined || v === null || (typeof v === "string" && !v.trim());
    if (showMissing && extracted?.[k] === null && empty) return k === "bedrooms" ? COPY["details.missingBeds"] : COPY["details.missing"];
    if (edited.includes(k)) return COPY["details.source.changed"];
    if (k === "buildingText" && source !== "manual") return SOURCE_LABEL[source];
    return null;
  };
  const describedBy = (k: FieldKey, desc: string | null) =>
    [fieldErrors[k] ? id(`${k}-error`) : null, desc ? id(`${k}-desc`) : null].filter(Boolean).join(" ") || undefined;

  const fieldBits = (k: FieldKey) => {
    const desc = describe(k);
    const error = fieldErrors[k];
    return {
      desc,
      error,
      invalid: error ? true : undefined,
      describedBy: describedBy(k, desc),
      descNode: desc ? (
        <FieldDescription id={id(`${k}-desc`)} className="text-caption">
          {desc}
        </FieldDescription>
      ) : null,
      errorNode: error ? (
        <FieldError id={id(`${k}-error`)} role={undefined} className="flex items-start gap-1.5 text-caption">
          <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </FieldError>
      ) : null,
    };
  };

  const building = fieldBits("buildingText");
  const areaBits = fieldBits("areaText");
  const bedBits = fieldBits("bedrooms");
  const sizeBits = fieldBits("sizeSqft");
  const priceBits = fieldBits("priceAed");
  const bedsOpen = useRef(false);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => void handleSubmit(onValid, onInvalid)(e)}
      className="flex flex-col gap-6"
      data-slot="details-form"
      aria-describedby={showSummary ? id("summary") : undefined}
    >
      {image || source !== "manual" ? (
        <div className="flex items-start gap-3" data-slot="source-line">
          {image ? <ScreenshotThumb image={image} onView={onViewImage} className="h-21 w-12" /> : null}
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <p className="text-caption text-muted-foreground">{SOURCE_LABEL[source]}</p>
            {image ? (
              <div className="flex flex-wrap gap-x-5">
                {canRead ? (
                  <Button type="button" variant="link" onClick={onReplace}>
                    {COPY["read.replace"]}
                  </Button>
                ) : null}
                <Button type="button" variant="link" onClick={onRemove}>
                  {COPY["read.remove"]}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showSummary ? (
        <div
          ref={summaryRef}
          id={id("summary")}
          role="alert"
          tabIndex={-1}
          className="flex flex-col gap-1 border-l-2 border-destructive pl-3 text-body text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          data-slot="error-summary"
        >
          <p className="font-semibold">{t("err.summary", { n: currentErrors.length })}</p>
          <ul className="flex flex-col gap-1">
            {currentErrors.map((e) => (
              <li key={e.key}>
                <a
                  href={`#${e.key === "pick" ? id("pick") : id(e.key)}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    focusError(e.key);
                  }}
                  className="inline-flex min-h-11 items-center text-destructive underline underline-offset-4"
                >
                  {e.key === "pick" ? COPY["pick.legend"] : FIELD_LABEL[e.key]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <Field data-invalid={building.invalid}>
          <FieldLabel htmlFor={id("buildingText")} className="text-caption font-medium">
            {FIELD_LABEL.buildingText}
          </FieldLabel>
          <Input
            id={id("buildingText")}
            {...register("buildingText")}
            autoComplete="off"
            enterKeyHint="go"
            maxLength={120}
            aria-invalid={building.invalid}
            aria-describedby={building.describedBy}
          />
          {building.errorNode}
          {building.descNode}
        </Field>

        <Field data-invalid={areaBits.invalid}>
          <FieldLabel htmlFor={id("areaText")} className="text-caption font-medium">
            {FIELD_LABEL.areaText}
          </FieldLabel>
          <Input
            id={id("areaText")}
            {...register("areaText")}
            autoComplete="off"
            enterKeyHint="go"
            maxLength={80}
            aria-invalid={areaBits.invalid}
            aria-describedby={areaBits.describedBy}
          />
          {areaBits.errorNode}
          {areaBits.descNode}
        </Field>

        <div className="grid grid-cols-2 items-start gap-3">
          <Field data-invalid={bedBits.invalid}>
            <FieldLabel id={id("bedrooms-label")} htmlFor={id("bedrooms")} className="text-caption font-medium">
              {FIELD_LABEL.bedrooms}
            </FieldLabel>
            <Controller
              name="bedrooms"
              control={control}
              render={({ field }) => (
                <Select
                  items={BED_ITEMS}
                  value={field.value === undefined || field.value === null ? null : String(field.value)}
                  onValueChange={(v) => field.onChange(toNumberOrUndefined(v) ?? null)}
                  onOpenChange={(open) => {
                    bedsOpen.current = open;
                    if (!open) field.onBlur();
                  }}
                >
                  <SelectTrigger
                    ref={field.ref}
                    id={id("bedrooms")}
                    aria-labelledby={id("bedrooms-label")}
                    aria-invalid={bedBits.invalid}
                    aria-describedby={bedBits.describedBy}
                    onBlur={() => {
                      if (!bedsOpen.current) field.onBlur();
                    }}
                    // The same 48px, --card fill and 16px text as the inputs beside it (the trigger's own
                    // size variants are attribute selectors, so they are overridden at that level).
                    className="h-12 w-full rounded-lg bg-card text-base data-[size=default]:h-12 md:text-base md:data-[size=default]:h-12 dark:bg-card dark:hover:bg-card focus-visible:border-input focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <SelectValue placeholder={COPY["field.bedroomsPlaceholder"]} />
                  </SelectTrigger>
                  <SelectContent>
                    {BED_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {bedBits.errorNode}
            {bedBits.descNode}
          </Field>

          <Field data-invalid={sizeBits.invalid}>
            <FieldLabel htmlFor={id("sizeSqft")} className="text-caption font-medium">
              {FIELD_LABEL.sizeSqft}
            </FieldLabel>
            <Controller
              name="sizeSqft"
              control={control}
              render={({ field }) => (
                <InputGroup className="h-12 bg-card">
                  <NumberInput
                    id={id("sizeSqft")}
                    name={field.name}
                    inputRef={field.ref}
                    value={typeof field.value === "number" ? field.value : undefined}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={sizeBits.invalid}
                    aria-describedby={sizeBits.describedBy}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText aria-hidden="true">{COPY["field.sqft"]}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              )}
            />
            {sizeBits.errorNode}
            {sizeBits.descNode}
          </Field>
        </div>

        <Field data-invalid={priceBits.invalid}>
          <FieldLabel htmlFor={id("priceAed")} className="text-caption font-medium">
            {FIELD_LABEL.priceAed}
          </FieldLabel>
          <Controller
            name="priceAed"
            control={control}
            render={({ field }) => (
              <InputGroup className="h-12 bg-card">
                <InputGroupAddon align="inline-start">
                  <InputGroupText aria-hidden="true">{COPY["field.aed"]}</InputGroupText>
                </InputGroupAddon>
                <NumberInput
                  id={id("priceAed")}
                  name={field.name}
                  inputRef={field.ref}
                  value={typeof field.value === "number" ? field.value : undefined}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={priceBits.invalid}
                  aria-describedby={priceBits.describedBy}
                />
              </InputGroup>
            )}
          />
          {priceBits.errorNode}
          {priceBits.descNode}
        </Field>

        {/* REAL_DATA.md section 7: off-plan listings are compared with off-plan sales only. */}
        <div className="flex items-start gap-3" data-slot="off-plan">
          <Checkbox
            id={id("offPlan")}
            checked={completion === "off_plan"}
            // Unticking an off-plan listing makes it ready; never back to "not known".
            onCheckedChange={(c) => setCompletion(c === true ? "off_plan" : completion === "off_plan" ? "ready" : completion)}
            aria-labelledby={id("offPlan-label")}
            aria-describedby={id("offPlan-desc")}
            className="mt-0.5 size-5 [&_[data-slot=checkbox-indicator]>svg]:size-4"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <label id={id("offPlan-label")} htmlFor={id("offPlan")} className="cursor-pointer text-body text-foreground">
              {COPY["field.offPlan"]}
            </label>
            <p id={id("offPlan-desc")} className="text-caption text-muted-foreground">
              {COPY["field.offPlanHelp"]}
            </p>
          </div>
        </div>
      </div>

      <div id={id("pick")}>
        <BuildingPicker
          options={options}
          matchedCount={matchedCount}
          towerCheck={towerCheck}
          areaCheck={areaCheck}
          bestId={bestId}
          basis={basis}
          bedrooms={values.bedrooms}
          buildingText={values.buildingText}
          value={pick}
          onChange={choosePick}
          onSearchPick={onSearchPick}
          matching={matching}
          error={pickError}
          groupRef={groupRef}
        />
      </div>

      <ActionBar className="lg:pt-2">
        <Button type="submit" size="lg" className="lg:min-w-48" data-slot="compare-button">
          {COPY["details.cta"]}
        </Button>
      </ActionBar>
    </form>
  );
}

function extraHas(extra: CandidateView[], p: PickValue): boolean {
  return p.startsWith("b:") && extra.some((c) => `b:${c.buildingId}` === p);
}
