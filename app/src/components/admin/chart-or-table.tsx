"use client";

/**
 * A chart with a "Show as table" toggle (DESIGN.md section 3.8). The toggle is a pressed-state button;
 * the table holds the same numbers, so nothing is chart-only.
 */
import { TableIcon, ChartLineIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/copy";

export function ChartOrTable({
  title,
  chart,
  table,
  summary,
}: {
  title: string;
  chart: ReactNode;
  table: ReactNode;
  /** One-sentence text alternative read with the chart. */
  summary?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="text-title font-semibold wdth-title">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          aria-controls={`${id}-body`}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <ChartLineIcon aria-hidden="true" /> : <TableIcon aria-hidden="true" />}
          {asTable ? COPY["adminUi.showChart"] : COPY["admin.showTable"]}
        </Button>
      </div>
      <div id={`${id}-body`}>
        {asTable ? (
          table
        ) : (
          <figure className="m-0 flex flex-col gap-2">
            {chart}
            {summary ? <figcaption className="text-caption text-muted-foreground">{summary}</figcaption> : null}
          </figure>
        )}
      </div>
    </section>
  );
}
