"use client";

/**
 * "Which building is it?" in the form (DESIGN.md sections 3.3, 5.2 and 7.4; docs/REDESIGN.md section
 * 8.6): a FieldSet with a RadioGroup whose options are rows at least 56px tall between hairlines, no
 * boxes (a 2px ink bar and the accent fill when chosen, an inset focus ring through
 * `has-[:focus-visible]`). Each row shows the name, the area and the sales line for the
 * bedroom count and the listing's completion basis; the pre-selected option gets "Best match" only
 * as caption text, never a pill, and only when it is a strong match (score 0.8 or above) that no other
 * option ties; scores are never shown.
 * "None of these" and "Search covered buildings" are always offered. The look-alike hint shows when
 * the server flags towers that differ only by a number, and the same-name hint when one name is in
 * two areas.
 * Choosing an option never submits or navigates (WCAG 3.2.2).
 */
import { useId, useState, type Ref } from "react";
import { BuildingSearch } from "@/components/check/building-search";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { usePublicConfig } from "@/components/shell/config-provider";
import type { PickedBuilding, PickValue } from "@/hooks/use-check-flow";
import { COPY, basisWord, t, tList, tPlural, windowMonths } from "@/lib/copy";
import type { CompletionBasis, Rules } from "@/lib/domain/analyse";
import type { CandidateView } from "@/lib/types";
import { cn } from "@/lib/utils";

const BED_WORDS = tList("pick.bedWords");

/**
 * The option's sales line, naming the basis the listing is compared with (REAL_DATA.md section 7):
 * "11 ready two-bed sales in 12 months"; below the minimum, "Only 4 ready two-bed sales in 12 months:
 * Fairsquare needs 5 to compare" (or "No ... sales"), so a building that cannot be compared never looks
 * as if it could.
 */
export function coverageLine(
  n: number | null,
  bedrooms: number | undefined,
  basis: CompletionBasis,
  rules: Pick<Rules, "minSales" | "windowDays">,
): string | null {
  if (n === null || bedrooms === undefined) return null;
  const vars = {
    basis: basisWord(basis),
    bedWord: BED_WORDS[bedrooms] ?? BED_WORDS[BED_WORDS.length - 1],
    minSales: rules.minSales,
    months: windowMonths(rules.windowDays),
  };
  if (n >= rules.minSales) return t("pick.coverage", { n, ...vars });
  if (n === 0) return t("pick.coverageZero", vars);
  return tPlural("pick.coverageThin", n, vars);
}

export interface BuildingPickerProps {
  /** Matches (at most 3, strongest first) followed by buildings added through the search. */
  options: CandidateView[];
  /** How many of `options` came from the match (the rest came from the search). */
  matchedCount: number;
  towerCheck: boolean;
  /** Two options share a name in different areas: ask for the area, not the tower number. */
  areaCheck: boolean;
  /** The match's pre-selected building (strong, not tied): the only one marked "Best match". */
  bestId: number | null;
  /** Which sales the options count: off-plan for an off-plan listing, ready otherwise. */
  basis: CompletionBasis;
  bedrooms: number | undefined;
  buildingText: string;
  value: PickValue;
  onChange: (v: PickValue) => void;
  onSearchPick: (b: PickedBuilding) => void;
  matching: boolean;
  error: string | null;
  groupRef?: Ref<HTMLDivElement>;
  className?: string;
}

/**
 * A row between hairlines, no box (docs/REDESIGN.md section 8.6): the chosen one gets a 2px ink bar on
 * the left and the accent fill; focus is a 2px inset ring, distinct from "chosen".
 */
const ROW = cn(
  "relative flex min-h-14 cursor-pointer items-start gap-3 border-b border-border py-3 pr-2 pl-3 text-left transition-colors duration-(--dur-fast)",
  "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent before:content-['']",
  "hover:bg-accent has-data-checked:bg-accent has-data-checked:before:bg-foreground",
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset",
);

export function BuildingPicker({
  options,
  matchedCount,
  towerCheck,
  areaCheck,
  bestId,
  basis,
  bedrooms,
  buildingText,
  value,
  onChange,
  onSearchPick,
  matching,
  error,
  groupRef,
  className,
}: BuildingPickerProps) {
  const { rules } = usePublicConfig();
  const ids = { legend: useId(), error: useId(), status: useId(), none: useId(), noneSub: useId() };
  const prefix = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const typed = buildingText.trim().length > 0;
  const noneText = buildingText.trim();

  return (
    <FieldSet
      aria-describedby={error ? ids.error : undefined}
      className={cn("gap-3", className)}
      data-slot="building-picker"
    >
      <FieldLegend id={ids.legend} className="mb-1 text-lead font-semibold text-foreground">
        {COPY["pick.legend"]}
      </FieldLegend>

      {matching ? (
        <p id={ids.status} className="text-caption text-muted-foreground">
          {COPY["read.matching"]}
        </p>
      ) : !typed ? (
        <p className="text-caption text-muted-foreground">{COPY["pick.typeToMatch"]}</p>
      ) : matchedCount === 0 ? (
        <p className="text-caption text-muted-foreground">{COPY["pick.noMatch"]}</p>
      ) : null}

      <RadioGroup
        ref={groupRef}
        value={value}
        onValueChange={(v) => onChange(v as PickValue)}
        aria-labelledby={ids.legend}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.error : undefined}
        className="gap-0 border-t border-border"
      >
        {options.map((o, i) => {
          const v: PickValue = `b:${o.buildingId}`;
          const nameId = `${prefix}-n${o.buildingId}`;
          const detailId = `${prefix}-d${o.buildingId}`;
          const best = i < matchedCount && o.buildingId === bestId && o.strength === "strong";
          const line = coverageLine(o.salesForBedrooms, bedrooms, basis, rules);
          return (
            <label key={v} className={ROW} data-option={o.buildingId}>
              <RadioGroupItem value={v} aria-labelledby={nameId} aria-describedby={detailId} className="mt-1 size-5" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span id={nameId} className="type-title break-words text-foreground">
                    {o.name}
                  </span>
                  {best ? (
                    <span className="text-caption text-muted-foreground" data-slot="best-match">
                      {COPY["pick.best"]}
                    </span>
                  ) : null}
                </span>
                <span id={detailId} className="flex flex-col text-caption text-muted-foreground">
                  <span>{o.area}</span>
                  {line ? <span className="num">{line}</span> : null}
                </span>
              </span>
            </label>
          );
        })}

        {towerCheck ? (
          <span className="border-b border-border py-2 text-caption text-foreground" data-slot="lookalike">
            {COPY["pick.lookalike"]}
          </span>
        ) : null}
        {areaCheck ? (
          <span className="border-b border-border py-2 text-caption text-foreground" data-slot="same-name">
            {COPY["pick.sameName"]}
          </span>
        ) : null}

        <label className={ROW} data-option="none">
          <RadioGroupItem
            value="none"
            aria-labelledby={ids.none}
            aria-describedby={typed ? ids.noneSub : undefined}
            className="mt-1 size-5"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={ids.none} className="type-title text-foreground">
              {COPY["pick.none"]}
            </span>
            {typed ? (
              <span id={ids.noneSub} className="text-caption break-words text-muted-foreground">
                {t("pick.noneSub", { text: noneText })}
              </span>
            ) : null}
          </span>
        </label>
      </RadioGroup>

      {error ? (
        <FieldError id={ids.error} role={undefined} className="text-caption">
          {error}
        </FieldError>
      ) : null}

      <Button type="button" variant="link" className="self-start" onClick={() => setSearchOpen(true)}>
        {COPY["pick.search"]}
      </Button>
      <BuildingSearch open={searchOpen} onOpenChange={setSearchOpen} onPick={onSearchPick} />
    </FieldSet>
  );
}
