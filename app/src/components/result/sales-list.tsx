"use client";

/**
 * The sales list (RESULT_SPEC section 5): one list, never gated, never behind an ask.
 *
 * - Heading "43 registered sales" (type-title, anchor #sales), the sort pair ("Newest first", "By price
 *   per sq ft": `aria-pressed` buttons), and the same-size sentence: the 3 newest sales within 3% of the
 *   listing's size, by date only, never by closeness to the asking price.
 * - Phones: stacked 64px rows (date and price, then size and price per sq ft), 5 rows, then "Show all
 *   43 sales" expands in place. From 1024px: a table (Registered, Size, Price, AED per sq ft and a note
 *   column), 12 rows, then "Show all".
 * - A 6px dot before the date: filled for the last 90 days, hollow for earlier (as on the scale), named
 *   for screen readers. "same size" and "set aside" are words on the row, never colour. Set-aside sales
 *   are listed (never drawn on the scale); a sale Fairsquare added says so (REAL_DATA.md section 9).
 * - The too-few state (`all`): every row, newest first, no sort and no sentence.
 */
import { useRef, useState } from "react";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { COPY, salesShownNote, t, tPlural } from "@/lib/copy";
import { formatDate, formatDateNear, formatInt, keepFiguresTogether } from "@/lib/format";
import { isSameSize, recentSet } from "@/lib/result/scale-model";
import { sameSizeText } from "@/lib/result/words";
import type { CheckView, SaleView } from "@/lib/types";
import { cn } from "@/lib/utils";

export const SALES_ID = "sales";
/** Rows before "Show all": 5 on phones, 12 in the desktop table. */
export const LIST_ROWS = { phone: 5, desktop: 12 } as const;

export type SalesSort = "newest" | "psf";

interface Row {
  sale: SaleView;
  setAside: boolean;
  recent: boolean;
  sameSize: boolean;
  /** Position in the stored order (newest first), for stable ties. */
  at: number;
}

export function salesRows(check: Pick<CheckView, "sales" | "setAsideSales" | "analysis" | "sizeSqft">, sort: SalesSort): Row[] {
  const since = recentSet(check).since;
  const all: Row[] = [
    ...check.sales.map((sale) => ({ sale, setAside: false })),
    ...check.setAsideSales.map((sale) => ({ sale, setAside: true })),
  ].map((r, at) => ({ ...r, at, recent: r.sale.saleDate >= since, sameSize: !r.setAside && isSameSize(r.sale.sizeSqft, check.sizeSqft) }));
  const byDate = (a: Row, b: Row) => (a.sale.saleDate < b.sale.saleDate ? 1 : a.sale.saleDate > b.sale.saleDate ? -1 : a.at - b.at);
  return all.sort(sort === "newest" ? byDate : (a, b) => a.sale.psf - b.sale.psf || byDate(a, b));
}

function Dot({ recent, label }: { recent: boolean; label: string }) {
  return (
    <svg width={6} height={6} viewBox="0 0 6 6" role="img" aria-label={label} className="shrink-0">
      {recent ? <circle cx={3} cy={3} r={3} fill="var(--chart-3)" /> : <circle cx={3} cy={3} r={2.4} fill="var(--background)" stroke="var(--input)" strokeWidth={1.2} />}
    </svg>
  );
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const TEXT_BUTTON =
  "inline-flex min-h-11 items-center self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SalesList({
  check,
  all = false,
  headingLevel = 3,
  className,
}: {
  check: CheckView;
  /** The too-few state: every row, newest first, no sort and no same-size sentence. */
  all?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [sort, setSort] = useState<SalesSort>("newest");
  const [expanded, setExpanded] = useState(all);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = salesRows(check, all ? "newest" : sort);
  if (rows.length === 0) return null;

  const r = recentSet(check);
  const recentLabel = t("scale.recent", { date: formatDateNear(r.since, r.through) });
  const olderLabel = COPY["scale.older"];
  const limit = desktop ? LIST_ROWS.desktop : LIST_ROWS.phone;
  const shown = expanded ? rows : rows.slice(0, limit);
  const sentence = all ? null : sameSizeText(check);
  const truncated = salesShownNote(check);
  const total = Math.max(rows.length, check.analysis.count + check.setAsideSales.length);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = `${SALES_ID}-h`;

  const showAll = () => {
    setExpanded(true);
    // The first newly shown row takes focus, so the person keeps their place.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row="${limit}"]`)?.focus({ preventScroll: true }));
  };

  const tags = (row: Row): string[] =>
    ([row.sameSize ? COPY["list.sameSizeTag"] : null, row.setAside ? COPY["list.setAsideTag"] : null, row.sale.source ? COPY["result.addedByUs"] : null] as (string | null)[]).filter(
      (s): s is string => s !== null,
    );

  return (
    <section id={SALES_ID} aria-labelledby={headingId} className={cn("scroll-mt-(--header-h) border-t border-border pt-6", className)} data-slot="sales-list">
      <Heading id={headingId} className="type-title text-foreground">
        {/* Every sale counts in the title, also when only the newest are stored (the note says so). */}
        {tPlural("list.h", total, { n: formatInt(total) })}
      </Heading>
      {all ? null : (
        <div role="group" aria-label={COPY["list.sortLabel"]} className="mt-1 flex gap-5" data-slot="sales-sort">
          {(["newest", "psf"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
              className={cn(
                "min-h-11 rounded-sm text-[15px] underline underline-offset-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                sort === s ? "font-semibold text-foreground decoration-2" : "text-muted-foreground decoration-border decoration-1 hover:text-foreground",
              )}
            >
              {COPY[s === "newest" ? "list.newest" : "list.byPsf"]}
            </button>
          ))}
        </div>
      )}
      {sentence ? (
        <p className="mt-2 max-w-[62ch] text-[15px] leading-[22px] text-foreground num lg:text-base lg:leading-6" data-slot="same-size-sentence">
          {keepFiguresTogether(sentence)}
        </p>
      ) : null}
      {truncated ? (
        <p className="mt-2 text-[14px] leading-5 text-muted-foreground num" data-slot="sales-shown">
          {truncated}
        </p>
      ) : null}

      <div ref={listRef}>
      {desktop ? (
        <table className="mt-4 w-full border-collapse border-t border-border text-[15px] num" data-slot="sales-table-new">
          <thead>
            <tr className="text-[14px] text-muted-foreground">
              <th scope="col" className="h-11 border-b border-border pr-3 text-left font-medium">
                {COPY["list.colDate"]}
              </th>
              <th scope="col" className="h-11 border-b border-border px-3 text-right font-medium">
                {COPY["result.colSize"]}
              </th>
              <th scope="col" className="h-11 border-b border-border px-3 text-right font-medium">
                {COPY["result.colPrice"]}
              </th>
              <th scope="col" className="h-11 border-b border-border px-3 text-right font-medium">
                {COPY["result.colPsf"]}
              </th>
              <th scope="col" className="h-11 w-36 border-b border-border pl-3 text-left font-medium">
                <span className="sr-only">{COPY["list.colNote"]}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={`${row.sale.saleDate}-${row.at}`} tabIndex={-1} data-row={i} data-recent={row.recent || undefined} className="outline-none focus-visible:bg-accent">
                <td className="h-11 border-b border-border pr-3 text-left whitespace-nowrap">
                  <span className="inline-flex items-center gap-2.5">
                    <Dot recent={row.recent} label={row.recent ? recentLabel : olderLabel} />
                    {formatDate(row.sale.saleDate)}
                  </span>
                </td>
                <td className="h-11 border-b border-border px-3 text-right">{formatInt(row.sale.sizeSqft)}</td>
                <td className="h-11 border-b border-border px-3 text-right">{formatInt(row.sale.priceAed)}</td>
                <td className="h-11 border-b border-border px-3 text-right font-semibold">{formatInt(row.sale.psf)}</td>
                <td className="h-11 border-b border-border pl-3 text-left text-[14px] text-muted-foreground" data-slot="row-note">
                  {tags(row).map(capitalise).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-4 border-t border-border" data-slot="sales-rows">
          {shown.map((row, i) => (
            <li
              key={`${row.sale.saleDate}-${row.at}`}
              tabIndex={-1}
              data-row={i}
              data-recent={row.recent || undefined}
              className="relative flex min-h-16 flex-col justify-center border-b border-border py-2 pl-3.5 outline-none focus-visible:bg-accent"
            >
              <span className="absolute top-[18px] left-0 flex">
                <Dot recent={row.recent} label={row.recent ? recentLabel : olderLabel} />
              </span>
              <span className="flex justify-between gap-3 text-[15px] leading-[22px] text-foreground">
                <span>{formatDate(row.sale.saleDate)}</span>
                <span className="font-medium">{keepFiguresTogether(`${COPY["field.aed"]} ${formatInt(row.sale.priceAed)}`)}</span>
              </span>
              <span className="flex justify-between gap-3 leading-5">
                <span className="text-[14px] text-muted-foreground" data-slot="row-note">
                  {keepFiguresTogether([`${formatInt(row.sale.sizeSqft)} ${COPY["field.sqft"]}`, ...tags(row)].join(", "))}
                </span>
                <span className="text-[15px] font-semibold text-foreground">{keepFiguresTogether(t("result.rowPsf", { psf: formatInt(row.sale.psf) }))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      </div>

      {!expanded && rows.length > limit ? (
        <button type="button" onClick={showAll} className={cn(TEXT_BUTTON, "mt-1")} data-slot="show-all">
          {t("list.showAll", { n: formatInt(rows.length) })}
        </button>
      ) : null}
    </section>
  );
}
