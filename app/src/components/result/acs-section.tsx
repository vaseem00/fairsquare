"use client";

/**
 * Adjusted registered sales on a result (DESIGN.md section 6.17; REAL_DATA.md section 16): the first
 * answer for a building in the data. Everything here renders nothing unless the stored comparison
 * carries a shown range (`acsShown`), so a refusal, an entry of another version, the switch
 * (ACS_TIER=off) or a comparison stored before it existed leaves the result exactly as it was.
 *
 * Two places:
 * - The building had its 5 or more sales (`acsLead`): the range leads. The headline is its outcome,
 *   the chart slot holds `RangeScale source="acs"`, and below it come `AcsLeadText` (what was taken
 *   and adjusted, the range, the outcome), `AcsSizeNote`, `AcsMedianLine` (the same-building median
 *   beside it), `AcsEvidenceLine` and, at level 2, `AcsSalesList` open.
 * - Too few sales: `AcsSection` under the unchanged too-few explanation, in the second tier's place:
 *   a hairline, the heading, why three years are read, the scale, the same sentences, and the list
 *   closed until asked for.
 *
 * It must read as registered sales adjusted to this listing, never as a price Fairsquare states: the
 * list names every sale used with its registered figure, the change for its date, the change for its
 * size, the adjusted figure and how much it counts, grouped by where it comes from. No stamp of its
 * own, no percentage above or below, no middle figure.
 */
import { ChevronDownIcon } from "lucide-react";
import { Fragment, useId, useRef, useState, type ReactNode } from "react";
import { Notice } from "@/components/data/data-notice";
import { InfoSheet } from "@/components/result/info-sheet";
import { noBreakBeds } from "@/components/result/no-break";
import { RangeScale } from "@/components/result/similar-section";
import { SETTLE_AT, SettleIn } from "@/components/scene/use-settle";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { acsLines, acsShown, acsSizeNote, COPY, t, tPlural } from "@/lib/copy";
import { bedsLabelPlural, formatDate, formatInt, keepFiguresTogether } from "@/lib/format";
import { acsAdjText, acsRowNote, acsRowOrigin, acsSharePct } from "@/lib/result/words";
import type { AcsComparableView, CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export const ACS_LIST_ID = "sales-used";
/** Rows before "Show all": the first group (this building, same bedrooms) and each group after it. */
export const ACS_LIST_ROWS = { phone: { first: 5, rest: 3 }, desktop: { first: 8, rest: 3 } } as const;

/** A link on the evidence line's own row of links: a 44px target of its own, so the two never meet. */
const LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW_BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-left text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// ---------- the sentences ----------

/** What was taken and adjusted and the range (Newsreader lead), then the outcome (Archivo body 500). */
export function AcsLeadText({ check, lead = true }: { check: CheckView; lead?: boolean }) {
  const l = acsLines(check);
  if (!l) return null;
  return (
    <>
      <p className={cn(lead ? "type-lead max-w-[52ch]" : "max-w-[58ch] text-body", "text-foreground num")} data-slot="acs-range">
        {noBreakBeds(keepFiguresTogether(`${l.intro} ${l.range}`))}
      </p>
      <p className="max-w-[58ch] text-body font-medium text-foreground num" data-slot="acs-verdict">
        {keepFiguresTogether(l.verdict)}
      </p>
      {/* The asking price past every adjusted sale used: said in plain figures, whatever the outcome. */}
      {l.beyond ? (
        <p className="max-w-[58ch] text-body text-foreground num" data-slot="acs-beyond">
          {keepFiguresTogether([l.beyond, l.beyondWhy].filter(Boolean).join(" "))}
        </p>
      ) : null}
    </>
  );
}

/** Sales of other bedroom types count for more of the range than the building's own sales of this type: say so. */
export function AcsOtherBedsNote({ check }: { check: CheckView }) {
  const l = acsLines(check);
  return l?.otherBeds ? <Notice slot="acs-other-beds">{noBreakBeds(l.otherBeds)}</Notice> : null;
}

/** The size note of a shown range: the listing is far from the building's usual size for its bedroom count. */
export function AcsSizeNote({ check }: { check: CheckView }) {
  const note = acsSizeNote(check);
  return note ? <Notice slot="size-note">{noBreakBeds(keepFiguresTogether(note))}</Notice> : null;
}

/** "With no adjustment, the median of the 11 sales of the last 12 months is AED 1,669 per sq ft." */
export function AcsMedianLine({ check }: { check: CheckView }) {
  const l = acsLines(check);
  if (!l?.median) return null;
  return (
    <p className="max-w-[58ch] text-[15px] leading-[22px] text-foreground num" data-slot="acs-median">
      {keepFiguresTogether(l.median)}
    </p>
  );
}

function Definitions({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[22px] text-foreground num" data-slot="acs-definitions">
      {lines.map((line) => (
        <p key={line}>{keepFiguresTogether(line)}</p>
      ))}
    </div>
  );
}

/**
 * The evidence line of a shown range, Archivo 14/20 in pencil: what the range is built from, the
 * tested share ("about 8 of 10"), the DLD building verbatim, what is and is not adjusted and "Not a
 * valuation."; then, on a line of their own and apart, "How the sales were adjusted" (a Popover from
 * 1024px, a sheet on phones) and "Wrong building?" on the result.
 */
export function AcsEvidenceLine({
  check,
  onWrongBuilding,
  inSection = false,
  className,
}: {
  check: CheckView;
  onWrongBuilding?: () => void;
  /** Under "Too few sales": the too-few evidence line above already names the DLD building. */
  inSection?: boolean;
  className?: string;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const l = acsLines(check);
  if (!l) return null;
  const label = COPY["acs.howLabel"];
  const trigger = cn(LINK_BUTTON, "font-medium");
  return (
    <>
      <div className={cn("flex max-w-[62ch] flex-col text-[14px] leading-5 text-muted-foreground num", className)} data-slot={inSection ? "acs-evidence" : "evidence-line"} data-tier="acs">
        <p>{noBreakBeds(keepFiguresTogether([l.sources, l.testedShort, inSection ? null : l.dld, l.limits].filter(Boolean).join(" ")))}</p>
        {/* The two links on a line of their own, apart, each a 44px target: they never read as one underlined phrase and never overlap. */}
        <p className="flex flex-wrap items-center gap-x-6" data-slot="acs-links">
          {desktop ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger render={<button type="button" className={trigger} data-slot="acs-trigger" />}>{label}</PopoverTrigger>
              <PopoverContent align="start" aria-label={label} className="w-[min(400px,calc(100vw-2rem))] gap-3 p-4">
                <Definitions lines={l.definitions} />
              </PopoverContent>
            </Popover>
          ) : (
            <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={trigger} data-slot="acs-trigger">
              {label}
            </button>
          )}
          {onWrongBuilding ? (
            <button type="button" onClick={onWrongBuilding} className={cn(LINK_BUTTON, "whitespace-nowrap")} data-slot="wrong-building">
              {COPY["evidence.wrongBuilding"]}
            </button>
          ) : null}
        </p>
      </div>
      {desktop ? null : (
        <InfoSheet open={open} onOpenChange={setOpen} title={label} slot="acs-sheet">
          <Definitions lines={l.definitions} />
        </InfoSheet>
      )}
    </>
  );
}
// ---------- the sales used ----------

interface ListRow {
  row: AcsComparableView;
  /** Position in the list as shown (group by group), for focus and keys. */
  at: number;
}
interface Group {
  ring: 1 | 2 | 3;
  label: string;
  rows: ListRow[];
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The rows by where they come from: this building and bedroom count, other bedroom counts here, other buildings of the project. Stored order (most counted first) inside a group. */
export function acsGroups(check: Pick<CheckView, "acs" | "analysis" | "building" | "bedrooms">): Group[] {
  const a = acsShown(check);
  if (!a) return [];
  const labels: Record<1 | 2 | 3, string> = {
    1: t("acs.groupOwn", { bedTypePlural: bedsLabelPlural(check.bedrooms) }),
    2: COPY["acs.groupOtherBeds"],
    3: COPY["acs.groupProject"],
  };
  let at = 0;
  return ([1, 2, 3] as const)
    .map((ring) => ({ ring, label: labels[ring], rows: a.comparables.filter((r) => r.ring === ring) }))
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ ...g, rows: g.rows.map((row) => ({ row, at: at++ })) }));
}

/** The origin (another bedroom type, another building) and the several-sales note of a row, as one line; null for a plain sale. */
function rowExtra(row: AcsComparableView): string | null {
  const parts = [acsRowOrigin(row), acsRowNote(row)].filter((s): s is string => s !== null);
  return parts.length ? parts.join(". ").replace(/\.\.$/, ".") : null;
}

function ListBody({ check, headingLevel, stacked = false }: { check: CheckView; headingLevel: 3 | 4; stacked?: boolean }) {
  // The table needs the wide column of a leading range; in the narrow too-few section the stacked rows are used at every width.
  const desktop = useMediaQuery(DESKTOP_QUERY) && !stacked;
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const a = acsShown(check);
  const groups = acsGroups(check);
  if (!a || groups.length === 0) return null;
  const limits = desktop ? ACS_LIST_ROWS.desktop : ACS_LIST_ROWS.phone;
  const shown = groups.map((g, i) => ({ ...g, visible: expanded ? g.rows : g.rows.slice(0, i === 0 ? limits.first : limits.rest) }));
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const cut = shown.find((g) => g.visible.length < g.rows.length);
  const firstHidden = cut ? cut.rows[cut.visible.length].at : undefined;
  const bedCol = groups.some((g) => g.ring === 2);
  const GroupHeading = headingLevel === 3 ? "h3" : "h4";
  const showAll = () => {
    setExpanded(true);
    // The first newly shown row takes focus, so the person keeps their place.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-row="${firstHidden}"]`)?.focus({ preventScroll: true }));
  };
  const capped = a.comparables.length < a.comparablesTotal ? t("acs.listCapped", { shown: formatInt(a.comparables.length), n: formatInt(a.comparablesTotal) }) : null;
  const th = "h-11 border-b border-border px-2 text-right align-bottom font-medium";
  const td = "border-b border-border px-2 py-2 text-right align-top";

  return (
    <div ref={ref} className="w-full">
      <p className="max-w-[62ch] text-[14px] leading-5 text-muted-foreground num" data-slot="acs-list-note">
        {[COPY["acs.listNote"], capped].filter(Boolean).join(" ")}
      </p>
      {desktop ? (
        <table className="mt-3 w-full border-collapse border-t border-border text-[15px] num" data-slot="acs-table">
          <thead>
            <tr className="text-[14px] leading-5 text-muted-foreground">
              <th scope="col" className="h-11 border-b border-border pr-2 text-left align-bottom font-medium">
                {COPY["acs.colDate"]}
              </th>
              <th scope="col" className={th}>
                {COPY["acs.colSize"]}
              </th>
              <th scope="col" className={th}>
                {COPY["acs.colPsf"]}
              </th>
              <th scope="col" className={th}>
                {COPY["acs.colDateAdj"]}
              </th>
              <th scope="col" className={th}>
                {COPY["acs.colSizeAdj"]}
              </th>
              {bedCol ? (
                <th scope="col" className={th}>
                  {COPY["acs.colBedAdj"]}
                </th>
              ) : null}
              <th scope="col" className={th}>
                {COPY["acs.colAdjusted"]}
              </th>
              <th scope="col" className="h-11 border-b border-border pl-2 text-right align-bottom font-medium">
                {COPY["acs.colWeight"]}
              </th>
            </tr>
          </thead>
          {shown.map((g) => (
            <tbody key={g.ring} data-slot="acs-group" data-ring={g.ring}>
              <tr>
                <th scope="rowgroup" colSpan={bedCol ? 8 : 7} className="border-b border-border pt-5 pb-2 text-left text-[15px] font-semibold text-foreground">
                  {capitalise(g.label)}
                </th>
              </tr>
              {g.visible.map(({ row, at }) => {
                const extra = rowExtra(row);
                return (
                  <tr key={at} tabIndex={-1} data-row={at} className="outline-none focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground">
                    <th scope="row" className="border-b border-border py-2 pr-2 text-left align-top font-normal text-foreground">
                      <span className="whitespace-nowrap">{formatDate(row.date)}</span>
                      {extra ? (
                        <span className="block max-w-[30ch] text-[14px] leading-5 text-muted-foreground" data-slot="acs-row-note">
                          {extra}
                        </span>
                      ) : null}
                    </th>
                    <td className={td}>{formatInt(row.sizeSqft)}</td>
                    <td className={td}>{formatInt(row.psf)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{acsAdjText(row.timeAdj)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{acsAdjText(row.sizeAdj)}</td>
                    {bedCol ? <td className={cn(td, "whitespace-nowrap")}>{row.ring === 2 ? acsAdjText(row.bedroomAdj) : ""}</td> : null}
                    <td className={cn(td, "font-semibold")}>{formatInt(row.adjustedPsf)}</td>
                    <td className="border-b border-border py-2 pl-2 text-right align-top text-muted-foreground">{acsSharePct(row.weightShare)}%</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      ) : (
        <div className="mt-1 flex flex-col" data-slot="acs-rows">
          {shown.map((g) => (
            <Fragment key={g.ring}>
              <GroupHeading className="mt-4 border-b border-border pb-2 text-[15px] leading-[22px] font-semibold text-foreground" data-slot="acs-group-h">
                {capitalise(g.label)}
              </GroupHeading>
              <ul data-slot="acs-group" data-ring={g.ring}>
                {g.visible.map(({ row, at }) => {
                  const extra = rowExtra(row);
                  const adj = [
                    `${COPY["acs.colDateAdj"]}: ${acsAdjText(row.timeAdj)}.`,
                    `${COPY["acs.colSizeAdj"]}: ${acsAdjText(row.sizeAdj)}.`,
                    row.ring === 2 ? `${COPY["acs.colBedAdj"]}: ${acsAdjText(row.bedroomAdj)}.` : null,
                    `${t("acs.rowCounts", { pct: acsSharePct(row.weightShare) })}.`,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <li key={at} tabIndex={-1} data-row={at} className="flex min-h-16 flex-col justify-center gap-0.5 border-b border-border py-2.5 outline-none focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground">
                      <span className="flex items-baseline justify-between gap-3 text-[15px] leading-[22px] text-foreground">
                        <span>{formatDate(row.date)}</span>
                        <span className="text-right font-semibold" data-slot="acs-row-adjusted">
                          {keepFiguresTogether(t("acs.rowAdjusted", { psf: formatInt(row.adjustedPsf) }))}
                        </span>
                      </span>
                      <span className="text-[14px] leading-5 text-foreground">{keepFiguresTogether(t("acs.rowRegistered", { size: formatInt(row.sizeSqft), psf: formatInt(row.psf) }))}</span>
                      <span className="text-[14px] leading-5 text-muted-foreground">{adj}</span>
                      {extra ? (
                        <span className="text-[14px] leading-5 text-muted-foreground" data-slot="acs-row-note">
                          {extra}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </div>
      )}
      {!expanded && firstHidden !== undefined ? (
        <button type="button" onClick={showAll} className={cn(ROW_BUTTON, "mt-1")} data-slot="acs-list-all">
          {t("acs.listAll", { n: formatInt(total) })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * "The 12 registered sales used": every registered sale behind the range and how it was adjusted,
 * grouped by where it comes from. Open with its own heading when the range leads; `collapsible` (the
 * too-few section) keeps it closed behind "See the 12 registered sales used", never behind an ask.
 */
export function AcsSalesList({
  check,
  headingLevel = 3,
  collapsible = false,
  className,
}: {
  check: CheckView;
  headingLevel?: 2 | 3;
  collapsible?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const headingId = `${ACS_LIST_ID}-h`;
  const a = acsShown(check);
  if (!a || a.comparables.length === 0) return null;
  const n = a.evidence.sales;
  if (collapsible) {
    return (
      <div className={cn("flex w-full flex-col items-start", className)} data-slot="acs-list">
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className={ROW_BUTTON} data-slot="acs-list-toggle">
          {open ? COPY["acs.listHide"] : tPlural("acs.listShow", n, { n: formatInt(n) })}
          <ChevronDownIcon aria-hidden="true" strokeWidth={1.75} className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <div id={listId} hidden={!open} className="w-full">
          {open ? <ListBody check={check} headingLevel={headingLevel === 2 ? 3 : 4} stacked /> : null}
        </div>
      </div>
    );
  }
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id={ACS_LIST_ID} aria-labelledby={headingId} className={cn("scroll-mt-(--header-h) border-t border-border pt-6", className)} data-slot="acs-list">
      <Heading id={headingId} className="type-title text-foreground">
        {tPlural("acs.listH", n, { n: formatInt(n) })}
      </Heading>
      <div className="mt-2">
        <ListBody check={check} headingLevel={headingLevel === 2 ? 3 : 4} />
      </div>
    </section>
  );
}

// ---------- the section under "Too few sales" ----------

/**
 * The range of adjusted registered sales under the unchanged too-few result, in the second tier's
 * place (the second tier stays stored, and shows when this answer does not). Nothing when the range
 * leads the result, or when there is none.
 */
export function AcsSection({
  check,
  headingLevel = 3,
  settle = true,
  className,
}: {
  check: CheckView;
  headingLevel?: 2 | 3;
  /** False on /c: no settle there. */
  settle?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const l = acsLines(check);
  // With a verdict of its own the range leads the result: no section.
  if (!l || !l.fewLead) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const body: ReactNode = (
    <section aria-labelledby={headingId} className={cn("flex w-full flex-col items-start gap-3 border-t border-border pt-5", className)} data-slot="acs-section" data-verdict={check.acs?.verdict ?? undefined}>
      <Heading id={headingId} className="type-title text-foreground">
        {l.heading}
      </Heading>
      <p className="max-w-[58ch] text-body text-foreground num" data-slot="acs-few">
        {keepFiguresTogether(l.fewLead)}
      </p>
      <RangeScale check={check} source="acs" className="mt-1" />
      <AcsLeadText check={check} lead={false} />
      <AcsSizeNote check={check} />
      <AcsOtherBedsNote check={check} />
      <AcsEvidenceLine check={check} inSection />
      <AcsSalesList check={check} headingLevel={headingLevel} collapsible />
    </section>
  );
  return settle ? (
    <SettleIn at={SETTLE_AT.rest} className="w-full">
      {body}
    </SettleIn>
  ) : (
    body
  );
}
