"use client";

/**
 * "Data source" on the Sales data page (REAL_DATA.md section 12): the dataset title (linked), the
 * publisher and licence (linked), the download date, the data range, the rows read and kept, the
 * buildings, when the snapshot was last loaded, what the database holds now and, behind a toggle, the
 * rows the build left out by reason (from the snapshot's manifest). Says so when nothing is loaded,
 * when the snapshot in OPEN_DATA_DIR is newer than the loaded one, and when the loaded data is so old
 * that the public pages show the stale-data note. `null` means the details could not be read; the
 * rest of the page still works.
 */
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { SimpleTable } from "@/components/admin/data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { COPY, t } from "@/lib/copy";
import { formatDate, formatInt, formatTime, formatTimestampDate } from "@/lib/format";
import type { DataSourcePanel as DataSourcePanelData } from "@/lib/validation/admin";

const LINK = "font-medium text-primary underline underline-offset-4";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground num [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function DataSourcePanel({ data }: { data: DataSourcePanelData | null }) {
  const headingId = useId();
  const m = data?.manifest ?? null;
  const excluded = (m?.excluded ?? []).filter((e) => e.count > 0);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border p-4" data-slot="data-source">
      <h2 id={headingId} className="text-title font-semibold wdth-title">
        {COPY["adminUi.ds.h2"]}
      </h2>

      {data === null ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
          {COPY["adminUi.ds.loadFailed"]}
        </p>
      ) : (
        <>
          {data.pending ? (
            <Alert role="status" className="border-input">
              <AlertDescription className="text-sm text-foreground">{COPY["adminUi.ds.pending"]}</AlertDescription>
            </Alert>
          ) : null}
          {/* Refreshing is the owner's job (README): say when the public pages show the stale-data note. */}
          {data.stale && data.dataThrough ? (
            <Alert role="status" className="border-input" data-slot="data-source-stale">
              <AlertDescription className="text-sm text-foreground">
                {t("adminUi.ds.stale", { date: formatDate(data.dataThrough) })}
              </AlertDescription>
            </Alert>
          ) : null}
          {!data.loaded && !m ? <p className="text-sm text-muted-foreground">{COPY["adminUi.ds.none"]}</p> : null}

          {m || data.loaded ? (
            <dl className="grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
              {m ? (
                <>
                  <Row label={COPY["adminUi.ds.dataset"]}>
                    <a href={m.datasetUrl} rel="noopener noreferrer" className={LINK}>
                      {m.datasetTitle}
                    </a>
                  </Row>
                  <Row label={COPY["adminUi.ds.publisher"]}>{m.publisher}</Row>
                  <Row label={COPY["adminUi.ds.licence"]}>
                    <a href={m.licenceUrl} rel="noopener noreferrer" className={LINK}>
                      {m.licence}
                    </a>
                  </Row>
                  <Row label={COPY["adminUi.ds.downloaded"]}>{formatDate(m.downloadedOn)}</Row>
                </>
              ) : null}
              {data.dataFrom && data.dataThrough ? (
                <Row label={COPY["adminUi.ds.range"]}>
                  {t("adminUi.ds.rangeValue", { from: formatDate(data.dataFrom), to: formatDate(data.dataThrough) })}
                </Row>
              ) : null}
              {m ? (
                <>
                  <Row label={COPY["adminUi.ds.rows"]}>{formatInt(m.rows)}</Row>
                  {m.read > 0 ? <Row label={COPY["adminUi.ds.read"]}>{formatInt(m.read)}</Row> : null}
                  <Row label={COPY["adminUi.ds.buildings"]}>{formatInt(m.buildings)}</Row>
                </>
              ) : null}
              {data.loadedAt ? (
                <Row label={COPY["adminUi.ds.loadedAt"]}>
                  {t("adminUi.receivedAt", { date: formatTimestampDate(data.loadedAt), time: formatTime(data.loadedAt) })}
                </Row>
              ) : null}
              <Row label={COPY["adminUi.ds.live"]}>
                {t("adminUi.ds.liveValue", {
                  sales: formatInt(data.live.openDataSales),
                  buildings: formatInt(data.live.dldBuildings),
                })}
              </Row>
              {m ? (
                <Row label={COPY["adminUi.ds.sha"]}>
                  <code className="font-mono text-sm" title={m.snapshotSha256}>
                    {m.snapshotSha256.slice(0, 12)}
                  </code>
                </Row>
              ) : null}
            </dl>
          ) : null}

          {excluded.length > 0 ? (
            <Collapsible className="flex flex-col gap-2">
              <CollapsibleTrigger
                render={<Button type="button" variant="outline" size="sm" className="group/ds w-fit gap-1.5" />}
              >
                {COPY["adminUi.ds.excludedH"]}
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-4 transition-transform group-aria-expanded/ds:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SimpleTable
                  caption={COPY["adminUi.ds.excludedH"]}
                  columns={[COPY["adminUi.ds.colReason"], COPY["adminUi.ds.colRows"]]}
                  numeric={[1]}
                  // Two short columns fit a phone: no stacked "Reason / Rows" pairs.
                  stacked={false}
                  rows={excluded.map((e) => [
                    <span key="r" className="whitespace-normal">
                      {COPY[`adminUi.reason.${e.reason}`]}
                    </span>,
                    formatInt(e.count),
                  ])}
                  className="md:max-w-xl"
                />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      )}
    </section>
  );
}
