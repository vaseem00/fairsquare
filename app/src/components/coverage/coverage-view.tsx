"use client";

/**
 * The /coverage page body (docs/REDESIGN.md section 8.8, REAL_DATA.md section 11): the headline, the
 * lead and the window the counts cover, the searchable and paged list, and the request form. From
 * 1024px the headline and lead take columns 1 to 7 and the request form columns 9 to 12; on phones
 * the form follows the list.
 */
import Link from "next/link";
import { toast } from "sonner";
import { CoverageList } from "@/components/coverage/coverage-list";
import { RequestBuildingForm, useBuildingRequest } from "@/components/coverage/request-building-form";
import { StaleNote } from "@/components/data/data-notice";
import { COPY, t } from "@/lib/copy";
import { formatDate } from "@/lib/format";
import type { CoverageResponse } from "@/lib/types";

export function CoverageView({ initial, nearby = false }: { initial: CoverageResponse; /** Nearby registered sales is switched on (REAL_DATA.md section 17): say that a building with no usable sales can still be compared. */ nearby?: boolean }) {
  const request = useBuildingRequest();
  return (
    <div className="mx-auto grid w-full max-w-[1264px] gap-x-6 gap-y-10 gutter pt-8 pb-16 md:pt-12 lg:grid-cols-12 lg:gap-y-14 lg:pt-16">
      <header className="flex flex-col gap-4 lg:col-span-7 lg:row-start-1">
        <h1 tabIndex={-1} className="type-display-md text-foreground outline-none">
          {COPY["coverage.h1"]}
        </h1>
        <p className="max-w-[60ch] text-body text-foreground">{COPY["coverage.intro"]}</p>
        {initial.window ? (
          <p className="max-w-[60ch] text-caption text-muted-foreground num" data-slot="coverage-window">
            {t("coverage.window", { from: formatDate(initial.window.start), to: formatDate(initial.window.end) })}
          </p>
        ) : null}
        <p className="max-w-[60ch] text-caption text-muted-foreground" data-slot="coverage-similar">
          {COPY["similar.coverageNote"]}{" "}
          <Link
            href="/how-it-works#too-few"
            className="relative inline rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {COPY["similar.coverageLink"]}
          </Link>
        </p>
        {nearby ? (
          <p className="max-w-[60ch] text-caption text-muted-foreground" data-slot="coverage-nearby">
            {COPY["nearby.coverageNote"]}{" "}
            <Link
              href="/how-it-works#nearby"
              className="relative inline rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {COPY["similar.coverageLink"]}
            </Link>
          </p>
        ) : null}
        <StaleNote />
      </header>
      <div className="min-w-0 lg:col-span-12 lg:row-start-2">
        <CoverageList
          initial={initial}
          onRequest={async (q) => {
            const res = await request.submit(q);
            if (!res.ok) toast.error(res.message);
          }}
          requestBusy={request.busy}
        />
      </div>
      <RequestBuildingForm request={request} className="lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:self-end" />
    </div>
  );
}
