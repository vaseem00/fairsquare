/**
 * "From the data" (REAL_DATA.md section 10, docs/REDESIGN.md section 8.3): one sentence built from the
 * loaded sales only, under a hairline below the home actions. It names the building with the most
 * ready 2-bed sales in the comparison window, how many there are and their median AED per sq ft; a
 * caption gives the area (with the DLD area name) and the sales' date range; then a link to /coverage
 * and "Sales data runs to {date}." Never a listing or an asking price. Before the first load it says
 * the data is being loaded. Type on paper: no box, no table, no icon.
 * No hooks: the home page renders it on the server (computed there, kept for an hour).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { areaLabel, COPY, outliersNote, t, windowMonths } from "@/lib/copy";
import { diffDays } from "@/lib/domain/dates";
import { bedsLabel, formatDate, formatInt, keepFiguresTogether } from "@/lib/format";
import type { DataStatusView, FromTheData } from "@/lib/types";
import { cn } from "@/lib/utils";

const HEADING_ID = "from-the-data-h";
const MARK = "\u0000";
const BED_MARK = "\u0001";

function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-slot="from-the-data"
      className={cn("flex flex-col gap-4 border-t border-border pt-6", className)}
    >
      <h2 id={HEADING_ID} className="type-label text-muted-foreground">
        {COPY["home.dataH2"]}
      </h2>
      {children}
    </section>
  );
}

/**
 * The sentence, with the building name set apart (it is the sentence's subject and a findable name)
 * and the bed type kept on one line ("2-bed" never breaks at its hyphen).
 */
function DataSentence({ data }: { data: FromTheData }) {
  const filled = t("home.dataSentence", {
    building: MARK,
    bedType: BED_MARK,
    months: windowMonths(diffDays(data.window.start, data.window.end)),
    to: formatDate(data.window.end),
    count: formatInt(data.count),
    median: formatInt(data.medianPsf),
  });
  const [before, rest = ""] = filled.split(MARK);
  const [middle, after = ""] = rest.split(BED_MARK);
  return (
    <p className="type-statement max-w-[52ch] text-foreground" data-slot="from-the-data-sentence">
      {before}
      <span data-slot="from-the-data-building">{data.building.name}</span>
      {keepFiguresTogether(middle)}
      <span className="whitespace-nowrap">{bedsLabel(data.bedrooms)}</span>
      {keepFiguresTogether(after)}
    </p>
  );
}

export function FromTheDataPanel({
  data,
  status,
  className,
}: {
  /** The panel's numbers; null when nothing is loaded or no ready 2-bed sale is in the window. */
  data: FromTheData | null;
  status: DataStatusView;
  className?: string;
}) {
  if (!status.loaded || !status.dataThrough) {
    return (
      <Shell className={className}>
        <p className="type-lead text-foreground" data-slot="data-loading">
          {COPY["data.loading"]}
        </p>
      </Shell>
    );
  }

  const outliers = data ? outliersNote(data) : null;
  return (
    <Shell className={className}>
      {data ? (
        <div className="flex flex-col gap-2">
          <DataSentence data={data} />
          <p className="text-caption text-muted-foreground num">
            <span>{areaLabel(data.building.area, data.building.areaDld)}</span>
            {". "}
            {t("home.dataRange", { from: formatDate(data.firstSaleDate), to: formatDate(data.lastSaleDate) })}
          </p>
          {outliers ? <p className="text-caption text-muted-foreground num">{outliers}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <Link
          href="/coverage"
          className="-ml-px inline-flex min-h-11 w-fit items-center rounded-sm text-body font-medium text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          {COPY["home.dataLink"]}
        </Link>
        <p className="text-caption text-muted-foreground num" data-slot="data-runs-to">
          {t("data.runsTo", { date: formatDate(status.dataThrough) })}
        </p>
      </div>
    </Shell>
  );
}

/** While the panel's numbers load (the hero never waits for them): three still lines, no pulse. */
export function FromTheDataSkeleton({ className }: { className?: string }) {
  return (
    <Shell className={className}>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-6 w-full max-w-[44ch]" />
        <Skeleton className="h-6 w-4/5 max-w-[36ch]" />
        <Skeleton className="h-4 w-1/2 max-w-[28ch]" />
      </div>
    </Shell>
  );
}
