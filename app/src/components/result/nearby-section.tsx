"use client";

/**
 * Nearby registered sales on a result (DESIGN.md section 6.18; REAL_DATA.md section 17): the last
 * resort, for a listing whose own building gives nothing to compare. Everything here renders nothing
 * unless the stored comparison carries a shown range (`nearbyShown`), so a refusal, the switch
 * (NEARBY_TIER=off) or a comparison stored before it existed leaves the result exactly as it was:
 * "Too few sales to compare yet" or "Not covered yet".
 *
 * When it shows, the headline is its outcome ("Above the range of nearby sales") and the page reads:
 *   NearbyOwnNote      directly under the headline: the building itself has no (or too few) registered
 *                      sales, or is not in DLD data; the range comes from OTHER buildings in a named place
 *   RangeScale         source="nearby": the range, the asking price, a ring per adjusted sale
 *   NearbyLeadText     what was taken and adjusted, the range, the outcome
 *   NearbyWeakNote     always: other buildings; a building priced above or below its neighbours reads
 *                      above or below; the tested share; for a building not in the data, that its name
 *                      may be registered differently
 *   NearbyEvidenceLine the DLD building (when there is one), "Not a valuation.", "How the sales were
 *                      adjusted" and the way to another building
 *   NearbySalesList    the buildings with their share, then every sale used with its adjustments
 *
 * No single figure, no percentage above or below, nothing that reads as a price Fairsquare states.
 */
import { useRef, useState } from "react";
import { Notice } from "@/components/data/data-notice";
import { InfoSheet } from "@/components/result/info-sheet";
import { noBreakBeds } from "@/components/result/no-break";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COPY, nearbyLines, nearbyShown, t, tPlural } from "@/lib/copy";
import { formatDate, formatInt, keepFiguresTogether } from "@/lib/format";
import { acsAdjText, acsSharePct, nearbyRowRegistered } from "@/lib/result/words";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export const NEARBY_LIST_ID = "nearby-sales-used";
/** Rows before "Show all": the buildings, and the sales. */
export const NEARBY_LIST_ROWS = { buildings: 6, phone: 5, desktop: 8 } as const;

const LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW_BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-left text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Directly under the headline: what the building itself has, and that the range comes from other buildings, named. */
export function NearbyOwnNote({ check, className }: { check: CheckView; className?: string }) {
  const l = nearbyLines(check);
  if (!l) return null;
  return (
    <div className={cn("flex max-w-[58ch] flex-col gap-1 border-l-2 border-foreground pl-3 text-body text-foreground num", className)} data-slot="nearby-own">
      <p>{noBreakBeds(keepFiguresTogether(l.own))}</p>
      <p className="font-medium" data-slot="nearby-from">
        {l.fromOthers}
      </p>
    </div>
  );
}

/** What was taken and adjusted and the range, then the outcome. */
export function NearbyLeadText({ check }: { check: CheckView }) {
  const l = nearbyLines(check);
  if (!l) return null;
  return (
    <>
      <p className="type-lead max-w-[52ch] text-foreground num" data-slot="nearby-range">
        {noBreakBeds(keepFiguresTogether(`${l.intro} ${l.range}`))}
      </p>
      <p className="max-w-[58ch] text-body font-medium text-foreground num" data-slot="nearby-verdict">
        {keepFiguresTogether(l.verdict)}
      </p>
    </>
  );
}

/** The weakness note, always on the page when the range is. */
export function NearbyWeakNote({ check }: { check: CheckView }) {
  const l = nearbyLines(check);
  if (!l) return null;
  return <Notice slot="nearby-weak">{[l.weak, l.tested, l.weakOut].filter(Boolean).join(" ")}</Notice>;
}

function Definitions({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[22px] text-foreground num" data-slot="nearby-definitions">
      {lines.map((line) => (
        <p key={line}>{keepFiguresTogether(line)}</p>
      ))}
    </div>
  );
}

/**
 * The evidence line: the DLD building verbatim (when one was chosen) and "Not a valuation."; then, on
 * a line of their own, "How the sales were adjusted" (a Popover from 1024px, a sheet on phones) and
 * the way to another building: "Wrong building?" for a chosen one, "Find the building in DLD data"
 * for one that was not found. Both open the building question of the Change a detail sheet.
 */
export function NearbyEvidenceLine({ check, onWrongBuilding, className }: { check: CheckView; onWrongBuilding?: () => void; className?: string }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const l = nearbyLines(check);
  const n = nearbyShown(check);
  if (!l || !n) return null;
  const label = COPY["nearby.howLabel"];
  const trigger = cn(LINK_BUTTON, "font-medium");
  return (
    <>
      <div className={cn("flex max-w-[62ch] flex-col text-[14px] leading-5 text-muted-foreground num", className)} data-slot="evidence-line" data-tier="nearby">
        <p>{[l.dld, l.notValuation].filter(Boolean).join(" ")}</p>
        <p className="flex flex-wrap items-center gap-x-6" data-slot="nearby-links">
          {desktop ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger render={<button type="button" className={trigger} data-slot="nearby-trigger" />}>{label}</PopoverTrigger>
              <PopoverContent align="start" aria-label={label} className="w-[min(400px,calc(100vw-2rem))] gap-3 p-4">
                <Definitions lines={l.definitions} />
              </PopoverContent>
            </Popover>
          ) : (
            <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={trigger} data-slot="nearby-trigger">
              {label}
            </button>
          )}
          {onWrongBuilding ? (
            <button type="button" onClick={onWrongBuilding} className={cn(LINK_BUTTON, "whitespace-nowrap")} data-slot="wrong-building">
              {COPY[n.kind === "out" ? "nearby.pick" : "evidence.wrongBuilding"]}
            </button>
          ) : null}
        </p>
      </div>
      {desktop ? null : (
        <InfoSheet open={open} onOpenChange={setOpen} title={label} slot="nearby-sheet">
          <Definitions lines={l.definitions} />
        </InfoSheet>
      )}
    </>
  );
}

/**
 * "The 134 registered sales used": first the buildings they are in with how much each counts, then
 * every sale with its building, its registered figure, the changes for its date, its size and (when
 * one is made) its building's age, the adjusted figure and how much it counts. Most weight first.
 * Open, never behind an ask.
 */
export function NearbySalesList({ check, headingLevel = 3, className }: { check: CheckView; headingLevel?: 2 | 3; className?: string }) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [allBuildings, setAllBuildings] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const n = nearbyShown(check);
  if (!n) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const Sub = headingLevel === 2 ? "h3" : "h4";
  const headingId = `${NEARBY_LIST_ID}-h`;
  const total = n.comparablesTotal;
  const k = n.buildingsTotal;
  const buildings = allBuildings ? n.buildings : n.buildings.slice(0, NEARBY_LIST_ROWS.buildings);
  const limit = desktop ? NEARBY_LIST_ROWS.desktop : NEARBY_LIST_ROWS.phone;
  const rows = allRows ? n.comparables : n.comparables.slice(0, limit);
  const age = n.ageAdjusted;
  const showBuildings = () => {
    setAllBuildings(true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-building="${NEARBY_LIST_ROWS.buildings}"]`)?.focus({ preventScroll: true }));
  };
  const showRows = () => {
    setAllRows(true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-row="${limit}"]`)?.focus({ preventScroll: true }));
  };
  const buildingsCapped = n.buildings.length < k ? t("nearby.buildingsCapped", { shown: formatInt(n.buildings.length), k: formatInt(k) }) : null;
  const rowsCapped = n.comparables.length < total ? t("nearby.listCapped", { shown: formatInt(n.comparables.length), n: formatInt(total) }) : null;
  const th = "h-11 border-b border-border px-2 text-right align-bottom font-medium";
  const td = "border-b border-border px-2 py-2 text-right align-top";
  const focusRow = "outline-none focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground";

  return (
    <section ref={ref} id={NEARBY_LIST_ID} aria-labelledby={headingId} className={cn("scroll-mt-(--header-h) border-t border-border pt-6", className)} data-slot="nearby-list">
      <Heading id={headingId} className="type-title text-foreground">
        {tPlural("nearby.listH", total, { n: formatInt(total) })}
      </Heading>

      <Sub className="mt-5 text-[15px] leading-[22px] font-semibold text-foreground" data-slot="nearby-buildings-h">
        {tPlural("nearby.buildingsH", k, { k: formatInt(k) })}
      </Sub>
      <p className="mt-1 max-w-[62ch] text-[14px] leading-5 text-muted-foreground num" data-slot="nearby-buildings-note">
        {[COPY["nearby.buildingsNote"], buildingsCapped].filter(Boolean).join(" ")}
      </p>
      <table className="mt-2 w-full border-collapse border-t border-border text-[15px] num" data-slot="nearby-buildings">
        <thead>
          <tr className="text-[14px] leading-5 text-muted-foreground">
            <th scope="col" className="h-11 border-b border-border pr-2 text-left align-bottom font-medium">
              {COPY["nearby.colBuilding"]}
            </th>
            <th scope="col" className={th}>
              {COPY["nearby.colSales"]}
            </th>
            <th scope="col" className="h-11 border-b border-border pl-2 text-right align-bottom font-medium whitespace-nowrap">
              {COPY["nearby.colWeight"]}
            </th>
          </tr>
        </thead>
        <tbody>
          {buildings.map((b, i) => (
            <tr key={`${b.name}-${i}`} tabIndex={-1} data-building={i} className={focusRow}>
              <th scope="row" className="border-b border-border py-2 pr-2 text-left align-top font-normal text-foreground">
                {b.name}
              </th>
              <td className={td}>{formatInt(b.sales)}</td>
              <td className="border-b border-border py-2 pl-2 text-right align-top font-semibold text-foreground">{acsSharePct(b.weightShare)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!allBuildings && n.buildings.length > NEARBY_LIST_ROWS.buildings ? (
        <button type="button" onClick={showBuildings} className={cn(ROW_BUTTON, "mt-1")} data-slot="nearby-buildings-all">
          {t("nearby.buildingsAll", { k: formatInt(n.buildings.length) })}
        </button>
      ) : null}

      <Sub className="mt-6 text-[15px] leading-[22px] font-semibold text-foreground" data-slot="nearby-rows-h">
        {COPY["nearby.rowsH"]}
      </Sub>
      <p className="mt-1 max-w-[62ch] text-[14px] leading-5 text-muted-foreground num" data-slot="nearby-list-note">
        {[COPY["nearby.listNote"], rowsCapped].filter(Boolean).join(" ")}
      </p>
      {desktop ? (
        <table className="mt-2 w-full border-collapse border-t border-border text-[15px] num" data-slot="nearby-table">
          <thead>
            <tr className="text-[14px] leading-5 text-muted-foreground">
              <th scope="col" className="h-11 border-b border-border pr-2 text-left align-bottom font-medium">
                {COPY["nearby.colBuilding"]}
              </th>
              <th scope="col" className={th}>
                {COPY["nearby.colDate"]}
              </th>
              <th scope="col" className={th}>
                {COPY["nearby.colSize"]}
              </th>
              <th scope="col" className={th}>
                {COPY["nearby.colPsf"]}
              </th>
              <th scope="col" className={th}>
                {COPY["nearby.colDateAdj"]}
              </th>
              <th scope="col" className={th}>
                {COPY["nearby.colSizeAdj"]}
              </th>
              {age ? (
                <th scope="col" className={th}>
                  {COPY["nearby.colAgeAdj"]}
                </th>
              ) : null}
              <th scope="col" className={th}>
                {COPY["nearby.colAdjusted"]}
              </th>
              <th scope="col" className="h-11 border-b border-border pl-2 text-right align-bottom font-medium">
                {COPY["nearby.colWeight"]}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} tabIndex={-1} data-row={i} className={focusRow}>
                <th scope="row" className="max-w-[22ch] border-b border-border py-2 pr-2 text-left align-top font-normal text-foreground">
                  {row.building}
                </th>
                <td className={cn(td, "whitespace-nowrap")}>{formatDate(row.date)}</td>
                <td className={td}>{formatInt(row.sizeSqft)}</td>
                <td className={td}>{formatInt(row.psf)}</td>
                <td className={cn(td, "whitespace-nowrap")}>{acsAdjText(row.timeAdj)}</td>
                <td className={cn(td, "whitespace-nowrap")}>{acsAdjText(row.sizeAdj)}</td>
                {age ? <td className={cn(td, "whitespace-nowrap")}>{acsAdjText(row.ageAdj)}</td> : null}
                <td className={cn(td, "font-semibold")}>{formatInt(row.adjustedPsf)}</td>
                <td className="border-b border-border py-2 pl-2 text-right align-top text-muted-foreground">{acsSharePct(row.weightShare)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-1 flex flex-col border-t border-border" data-slot="nearby-rows">
          {rows.map((row, i) => {
            const adj = [
              `${COPY["nearby.colDateAdj"]}: ${acsAdjText(row.timeAdj)}.`,
              `${COPY["nearby.colSizeAdj"]}: ${acsAdjText(row.sizeAdj)}.`,
              age ? `${COPY["nearby.colAgeAdj"]}: ${acsAdjText(row.ageAdj)}.` : null,
              `${t("nearby.rowCounts", { pct: acsSharePct(row.weightShare) })}.`,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={i} tabIndex={-1} data-row={i} className={cn("flex min-h-16 flex-col justify-center gap-0.5 border-b border-border py-2.5", focusRow)}>
                <span className="flex items-baseline justify-between gap-3 text-[15px] leading-[22px] text-foreground">
                  <span>{row.building}</span>
                  <span className="shrink-0 text-right font-semibold" data-slot="nearby-row-adjusted">
                    {keepFiguresTogether(t("nearby.rowAdjusted", { psf: formatInt(row.adjustedPsf) }))}
                  </span>
                </span>
                <span className="text-[14px] leading-5 text-foreground">{keepFiguresTogether(nearbyRowRegistered(row))}</span>
                <span className="text-[14px] leading-5 text-muted-foreground">{adj}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!allRows && n.comparables.length > limit ? (
        <button type="button" onClick={showRows} className={cn(ROW_BUTTON, "mt-1")} data-slot="nearby-list-all">
          {t("nearby.listAll", { n: formatInt(n.comparables.length) })}
        </button>
      ) : null}
    </section>
  );
}
