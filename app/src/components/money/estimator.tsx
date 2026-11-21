"use client";

/**
 * The monthly cost estimator inside the CostPanel (DESIGN.md sections 3.4 and 6.7).
 * - Output: "About AED 10,618 a month" in an `<output aria-live="polite">`, recomputed 400ms after
 *   the last change; screen readers hear only "Monthly payment about AED 10,618". No animation.
 * - Loan and cash upfront, with the itemised upfront costs in an Accordion.
 * - Down payment: Slider from minDownPct(price) to 50% in steps of 5, aria-valuetext per
 *   `cost.downSr`, with minus and plus buttons as the drag alternative.
 * - Interest rate 1–12 with an inline error; term 15, 20 or 25 years.
 */
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  DOWN_MAX,
  DOWN_STEP,
  RATE_MAX,
  RATE_MIN,
  estimateFor,
  type MortgageChoice,
  type TermYears,
} from "@/components/money/cost-store";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { COPY, t, tList } from "@/lib/copy";
import { minDownPct } from "@/lib/domain/mortgage";
import { formatAed, formatInt } from "@/lib/format";
import { MORTGAGE_YEARS } from "@/lib/validation/api";

/** The output waits this long after the last change (DESIGN.md section 3.4). */
export const OUTPUT_DEBOUNCE_MS = 400;

const TERM_LABELS = tList("cost.termOptions");
const TERM_ITEMS = MORTGAGE_YEARS.map((y, i) => ({ value: y, label: TERM_LABELS[i] }));

/** "4.25" or "4,25" → 4.25; anything else → NaN. */
export function parseRate(text: string): number {
  const s = text.trim().replace(",", ".").replace(/%$/, "").trim();
  if (!/^\d{1,2}(\.\d{0,3})?$/.test(s)) return Number.NaN;
  return Number(s);
}

export function isValidRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= RATE_MIN && rate <= RATE_MAX;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className={strong ? "text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className="text-right text-foreground num">{value}</dd>
    </div>
  );
}

export interface EstimatorProps {
  priceAed: number;
  value: MortgageChoice;
  onChange(next: MortgageChoice): void;
}

export function Estimator({ priceAed, value, onChange }: EstimatorProps) {
  const ids = {
    downLabel: useId(),
    rate: useId(),
    rateHelp: useId(),
    rateErr: useId(),
    termLabel: useId(),
  };
  const minDown = minDownPct(priceAed);
  const [rateText, setRateText] = useState(String(value.ratePct));
  const [rateTouched, setRateTouched] = useState(false);
  const rateNow = parseRate(rateText);
  const rateInvalid = !isValidRate(rateNow);
  const showRateError = rateInvalid && rateTouched;

  // The figures follow the last valid input, 400ms after it stops changing.
  const shown = useDebounced(value, OUTPUT_DEBOUNCE_MS);
  const est = estimateFor(priceAed, shown);
  const live = estimateFor(priceAed, value); // the slider's own label updates at once
  const monthly = formatInt(est.monthlyAed);

  const setDown = (d: number) => {
    const next = Math.min(DOWN_MAX, Math.max(minDown, Math.round(d / DOWN_STEP) * DOWN_STEP));
    if (next !== value.downPct) onChange({ ...value, downPct: next });
  };

  const onRateText = (text: string) => {
    setRateText(text);
    const r = parseRate(text);
    if (isValidRate(r) && r !== value.ratePct) onChange({ ...value, ratePct: r });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <output aria-live="polite" className="block text-display-sm font-[720] text-foreground num wdth-figure">
          <span aria-hidden="true">{t("cost.monthly", { monthly })}</span>
          <span className="sr-only">{t("cost.announce", { monthly })}</span>
        </output>
        <dl className="text-body">
          <Row label={COPY["cost.loan"]} value={formatAed(est.loanAed)} strong />
          <Row label={COPY["cost.upfront"]} value={formatAed(est.upfrontAed)} strong />
        </dl>
        <Accordion>
          <AccordionItem value="upfront" className="border-b-0">
            <AccordionTrigger className="min-h-11 items-center text-body font-medium text-primary hover:underline">
              {COPY["cost.breakdown"]}
            </AccordionTrigger>
            <AccordionContent>
              <dl className="text-body">
                <Row label={COPY["cost.down"]} value={formatAed(est.upfront.down)} />
                <Row label={COPY["cost.dld"]} value={formatAed(est.upfront.dldFee)} />
                <Row label={COPY["cost.reg"]} value={formatAed(est.upfront.mortgageRegistration)} />
                <Row label={COPY["cost.agency"]} value={formatAed(est.upfront.agencyFee + est.upfront.agencyVat)} />
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span id={ids.downLabel} className="text-caption font-medium text-foreground">
            {COPY["cost.down"]}
          </span>
          <span className="text-body text-foreground num">
            {t("cost.downValue", { down: value.downPct, amount: formatInt(live.downAed) })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={COPY["cost.downLess"]}
            disabled={value.downPct <= minDown}
            // At the limit the button stays focusable (aria-disabled): native disabled would drop focus to <body> inside the modal.
            focusableWhenDisabled
            className="data-disabled:opacity-50"
            onClick={() => setDown(value.downPct - DOWN_STEP)}
          >
            <MinusIcon aria-hidden="true" strokeWidth={1.75} />
          </Button>
          <Slider
            className="flex-1"
            min={minDown}
            max={DOWN_MAX}
            step={DOWN_STEP}
            value={value.downPct}
            onValueChange={(v) => setDown(Array.isArray(v) ? v[0] : v)}
            thumbLabelledBy={ids.downLabel}
            getAriaValueText={(_f, v) =>
              t("cost.downSr", { down: v, amount: formatInt((priceAed * v) / 100) })
            }
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={COPY["cost.downMore"]}
            disabled={value.downPct >= DOWN_MAX}
            // At the limit the button stays focusable (aria-disabled): native disabled would drop focus to <body> inside the modal.
            focusableWhenDisabled
            className="data-disabled:opacity-50"
            onClick={() => setDown(value.downPct + DOWN_STEP)}
          >
            <PlusIcon aria-hidden="true" strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.rate} className="text-caption font-medium text-foreground">
          {COPY["cost.rate"]}
        </Label>
        <Input
          id={ids.rate}
          inputMode="decimal"
          autoComplete="off"
          value={rateText}
          onChange={(e) => onRateText(e.target.value)}
          onBlur={() => setRateTouched(true)}
          aria-invalid={showRateError || undefined}
          aria-describedby={showRateError ? `${ids.rateErr} ${ids.rateHelp}` : ids.rateHelp}
          className="max-w-40 num"
        />
        <p id={ids.rateHelp} className="text-caption text-muted-foreground">
          {COPY["cost.rateHelp"]}
        </p>
        {showRateError ? (
          <p id={ids.rateErr} className="text-caption text-destructive">
            {COPY["cost.rateErr"]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span id={ids.termLabel} className="text-caption font-medium text-foreground">
          {COPY["cost.term"]}
        </span>
        <Select
          items={TERM_ITEMS}
          value={value.years}
          onValueChange={(v) => {
            if (v !== null && v !== value.years) onChange({ ...value, years: v as TermYears });
          }}
        >
          <SelectTrigger aria-labelledby={ids.termLabel} className="w-full max-w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TERM_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-caption text-muted-foreground">{COPY["cost.disclosure"]}</p>
    </div>
  );
}
