"use client";

/**
 * The person's mortgage choice per comparison (down payment, rate, term), shared by the result's
 * CostRow and the CostPanel. The row shows the committed choice; the panel commits on close
 * (DESIGN.md section 3.4: "The cost row on the result page updates when the Drawer closes").
 * In memory only: nothing about the estimate is stored unless the person sends a lead.
 */
import { useCallback, useSyncExternalStore } from "react";
import { usePublicConfig } from "@/components/shell/config-provider";
import { estimateMortgage, minDownPct, type MortgageEstimate } from "@/lib/domain/mortgage";
import type { PublicConfig } from "@/lib/types";
import { MORTGAGE_YEARS } from "@/lib/validation/api";

export type TermYears = (typeof MORTGAGE_YEARS)[number];

export interface MortgageChoice {
  downPct: number;
  ratePct: number;
  years: TermYears;
}

/** The down payment slider's range (DESIGN.md section 3.4): from the legal minimum to 50%, step 5. */
export const DOWN_MAX = 50;
export const DOWN_STEP = 5;
export const RATE_MIN = 1;
export const RATE_MAX = 12;

/** The default choice for a price: the configured values, with the down payment at least the minimum. */
export function defaultChoice(priceAed: number, mortgage: PublicConfig["mortgage"]): MortgageChoice {
  const min = minDownPct(priceAed);
  const down = Math.min(DOWN_MAX, Math.max(min, Math.round(mortgage.downPct / DOWN_STEP) * DOWN_STEP));
  const years = (MORTGAGE_YEARS as readonly number[]).includes(mortgage.years) ? (mortgage.years as TermYears) : 25;
  const rate = mortgage.ratePct >= RATE_MIN && mortgage.ratePct <= RATE_MAX ? mortgage.ratePct : 4.25;
  return { downPct: down, ratePct: rate, years };
}

export function estimateFor(priceAed: number, c: MortgageChoice): MortgageEstimate {
  return estimateMortgage({ priceAed, downPct: c.downPct, ratePct: c.ratePct, years: c.years });
}

const choices = new Map<string, MortgageChoice>();
const listeners = new Set<() => void>();

export function getChoice(code: string): MortgageChoice | undefined {
  return choices.get(code);
}

export function setChoice(code: string, c: MortgageChoice): void {
  const prev = choices.get(code);
  if (prev && prev.downPct === c.downPct && prev.ratePct === c.ratePct && prev.years === c.years) return;
  choices.set(code, { ...c });
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The committed choice for a comparison, or its default. */
export function useMortgageChoice(code: string, priceAed: number): MortgageChoice {
  const { mortgage } = usePublicConfig();
  const get = useCallback(() => choices.get(code), [code]);
  const stored = useSyncExternalStore(subscribe, get, get);
  return stored ?? defaultChoice(priceAed, mortgage);
}

/** Tests: forget every choice. */
export function __resetCostChoicesForTests(): void {
  choices.clear();
  for (const l of listeners) l();
}
