/**
 * The provenance on every result and on /c (RESULT_SPEC section 5; REAL_DATA.md sections 7 and 9), one
 * paragraph in Archivo 14/20 pencil: the attribution ("Source: Dubai Land Department sales
 * transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence.", the
 * dataset and licence names linked to the manifest's URLs), how far the data runs ("Data to 16 Nov 2026;
 * the latest weeks may be incomplete."), the independence line ("Fairsquare is independent. ...") and
 * what the comparison is ("This compares an asking price with registered sale prices, fees excluded on
 * both. It is not a valuation or a forecast.").
 *
 * Sales the admin registered or imported are not DLD open data: a line says how many were added by
 * Fairsquare, and when every compared sale was, the DLD / Data.Dubai attribution is left out (crediting
 * the licensor with data it never published would be misleading, REAL_DATA.md section 9). A
 * not-covered comparison has no sales but is still a reading of the data: it is credited.
 */
import { Attribution } from "@/components/data/attribution";
import { addedSalesNote, COPY, t } from "@/lib/copy";
import { formatDate } from "@/lib/format";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Provenance({ check, className }: { check: CheckView; className?: string }) {
  const added = addedSalesNote(check.sales);
  const credited = check.sales.length === 0 || check.sales.some((s) => !s.source);
  const through = check.analysis.dataThrough;
  return (
    <div data-slot="provenance" className={cn("flex flex-col items-start gap-1", className)}>
      <p className="max-w-[65ch] text-caption text-muted-foreground num">
        {credited ? (
          <>
            <Attribution />{" "}
          </>
        ) : null}
        {through ? `${t("provenance.lag", { date: formatDate(through) })} ` : null}
        <span data-slot="independence">{COPY["data.independent"]}</span> {COPY["provenance.basis"]}
      </p>
      {added ? (
        <p className="max-w-[65ch] text-caption text-muted-foreground num" data-slot="added-sales">
          {added}
        </p>
      ) : null}
    </div>
  );
}
