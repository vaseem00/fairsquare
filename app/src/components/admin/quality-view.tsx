"use client";

/**
 * Quality (`/admin/quality`, DESIGN.md section 3.8): fields people changed after reading
 * (`editedFieldRate`), read failures by code (`extractFailByCode`), the median read time
 * (`medianReadMs`) and data freshness per building and bedroom count (`freshness`). Plain tables, with
 * the same 7 / 30 / 90-day range control as the Overview.
 */
import type { ReactNode } from "react";
import { SimpleTable } from "@/components/admin/data-table";
import { RangeToggle } from "@/components/admin/range-toggle";
import { COPY, ERROR_COPY, t } from "@/lib/copy";
import { bedsOption, formatDate, formatInt } from "@/lib/format";
import type { ErrorCode, FieldKey } from "@/lib/types";
import type { AdminStats } from "@/lib/validation/admin";
import { FIELD_KEYS } from "@/lib/validation/api";

const FIELD_LABEL: Record<FieldKey, string> = {
  buildingText: COPY["field.building"],
  areaText: COPY["field.area"],
  bedrooms: COPY["field.bedrooms"],
  sizeSqft: COPY["field.size"],
  priceAed: COPY["field.price"],
};

const pct = (r: number) => `${Math.round(r * 100)}%`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 id={id} className="text-title font-semibold wdth-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function QualityView({ stats }: { stats: AdminStats }) {
  const failures = (Object.entries(stats.extractFailByCode) as Array<[ErrorCode, number]>).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display-sm font-[720] wdth-heading">{COPY["adminUi.qualityH1"]}</h1>
        <RangeToggle range={stats.range} />
      </div>

      <p className="text-lead font-medium">
        {stats.medianReadMs === null
          ? COPY["adminUi.qualityMedianNone"]
          : t("admin.qualityMedian", { s: (stats.medianReadMs / 1000).toFixed(1) })}
      </p>

      <Section id="q-edited" title={COPY["admin.qualityEdited"]}>
        {stats.editedFieldBase === 0 ? (
          <p className="text-sm text-muted-foreground">{COPY["adminUi.qualityNoChecks"]}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("adminUi.qualityBase", { n: formatInt(stats.editedFieldBase) })}</p>
            <SimpleTable
              caption={COPY["admin.qualityEdited"]}
              columns={[COPY["adminUi.colField"], COPY["adminUi.colChanged"]]}
              numeric={[1]}
              rows={FIELD_KEYS.map((f) => [FIELD_LABEL[f], pct(stats.editedFieldRate[f])])}
              className="md:max-w-md"
            />
          </>
        )}
      </Section>

      <Section id="q-failures" title={COPY["admin.qualityFailures"]}>
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{COPY["adminUi.qualityNoFailures"]}</p>
        ) : (
          <SimpleTable
            caption={COPY["admin.qualityFailures"]}
            columns={[COPY["adminUi.colCode"], COPY["adminUi.colProblem"], COPY["adminUi.colCount"]]}
            numeric={[2]}
            rows={failures.map(([code, n]) => [
              <code key="c" className="font-mono text-sm">
                {code}
              </code>,
              <span key="p" className="whitespace-normal">
                {ERROR_COPY[code]}
              </span>,
              formatInt(n),
            ])}
          />
        )}
      </Section>

      <Section id="q-fresh" title={COPY["admin.freshness"]}>
        {stats.freshness.length === 0 ? (
          <p className="text-sm text-muted-foreground">{COPY["adminUi.freshnessEmpty"]}</p>
        ) : (
          <SimpleTable
            caption={COPY["admin.freshness"]}
            columns={[
              COPY["adminUi.colBuilding"],
              COPY["adminUi.colBedrooms"],
              COPY["adminUi.colLatestSale"],
              COPY["adminUi.colSales12m"],
            ]}
            numeric={[3]}
            rows={stats.freshness.map((r) => [
              r.name,
              bedsOption(r.bedrooms),
              r.latestSaleDate ? formatDate(r.latestSaleDate) : COPY["adminUi.none"],
              formatInt(r.sales12m),
            ])}
          />
        )}
      </Section>
    </div>
  );
}
