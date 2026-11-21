/**
 * The /c/[code] page body (RESULT_SPEC section 6.10): it mirrors the result, for the person a
 * comparison was sent to. No plate, no stamped sheet, no screenshot.
 *
 * - One h1: a caption span ("Aykon City Tower C, 2-bed. Compared on 18 Nov 2026.", the listing's own
 *   text) and the verdict span in `type-display-lg`, whose figure words alone take the verdict colour.
 * - The fact line (no Edit), then the market scale: its ASKING stamp lands once per code per browser
 *   session, CSS only, with no settle. The gap sentence, the size note, the recent-sales line and the
 *   evidence line (no "Wrong building?": the reader can't change the comparison).
 * - Too few sales: the tally, the sentence and the DLD building. Not covered: why there is no match.
 * - "Today: ..." when today's count or median moved since the comparison.
 * - The sales list, open (never behind an ask), provenance, Save and track (outline), and the sticky
 *   "Compare a listing you're looking at".
 * - Desktop: text and the scale in columns 1 to 6; the share card preview, sticky, in columns 7 to 12.
 * The stale-data note sits on top when the loaded sales end more than 45 days ago (REAL_DATA.md 7).
 * A server component: the interactive parts (the scale, the list, the evidence popover) are client ones.
 */
import Link from "next/link";
import { NotCoveredSentence } from "@/components/check/not-covered-result";
import { Notice, StaleNote } from "@/components/data/data-notice";
import { ActionBar } from "@/components/flow/action-bar";
import { AcsEvidenceLine, AcsLeadText, AcsMedianLine, AcsOtherBedsNote, AcsSalesList, AcsSection, AcsSizeNote } from "@/components/result/acs-section";
import { EvidenceLine, ThinEvidenceLine } from "@/components/result/evidence-line";
import { FactLine } from "@/components/result/fact-line";
import { GapSentence } from "@/components/result/gap-sentence";
import { MarketScale } from "@/components/result/market-scale";
import { NearbyEvidenceLine, NearbyLeadText, NearbyOwnNote, NearbySalesList, NearbyWeakNote } from "@/components/result/nearby-section";
import { noBreakBeds } from "@/components/result/no-break";
import { Provenance } from "@/components/result/provenance";
import { RecentLine } from "@/components/result/recent-line";
import { SharePageCard } from "@/components/result/result-share";
import { SalesList } from "@/components/result/sales-list";
import { RangeScale, SimilarSection } from "@/components/result/similar-section";
import { acsOutcome, nearbyOutcome, SizeNote, TallyDots, todayLine, VerdictWords } from "@/components/result/verdict-summary";
import { SaveButton } from "@/components/saved/save-button";
import { buttonVariants } from "@/components/ui/button";
import { acsLead, acsShown, COPY, nearbyShown, plainNotCovered, t, verdictSentence } from "@/lib/copy";
import { bedsLabel, formatTimestampDate, keepFiguresTogether } from "@/lib/format";
import { scaleModel } from "@/lib/result/scale-model";
import { factOfCheck } from "@/lib/result/words";
import type { AnalysisView, CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The h1's caption: "Aykon City Tower C, 2-bed. Compared on 18 Nov 2026." (the day it was compared, not the window end). */
export function sharePageCaption(check: CheckView): string {
  const what = t("c.h1", { building: check.buildingText, bedType: bedsLabel(check.bedrooms) });
  return `${what}. ${t("c.date", { date: formatTimestampDate(check.createdAt) })}.`;
}

export function SharePageView({ check, current }: { check: CheckView; current: AnalysisView }) {
  const band = check.analysis.band;
  const model = scaleModel(check);
  const today = todayLine(check, current);
  // A not-covered comparison compared nothing: no "Compared with off-plan sales only".
  // The last resort (DESIGN.md section 6.18): a range from registered sales in other buildings nearby,
  // as stored. Its outcome is the headline; the page says at once whose sales it reads.
  const near = nearbyShown(check);
  const offPlan = check.analysis.completionBasis === "off_plan" && (band !== "none" || near !== null);

  // Registered sales adjusted to this listing, as stored (DESIGN.md section 6.17): leading the page
  // when the building had its 5 or more sales, in its own section under "Too few sales" otherwise.
  const lead = acsLead(check);
  const acs = acsShown(check);

  let summary;
  if (near) {
    summary = (
      <>
        <NearbyLeadText check={check} />
        <NearbyWeakNote check={check} />
        <NearbyEvidenceLine check={check} />
      </>
    );
  } else if (lead) {
    summary = (
      <>
        <AcsLeadText check={check} />
        <AcsSizeNote check={check} />
        <AcsOtherBedsNote check={check} />
        <AcsMedianLine check={check} />
        <AcsEvidenceLine check={check} />
      </>
    );
  } else if (model) {
    summary = (
      <>
        <GapSentence model={model} />
        <SizeNote check={check} />
        <RecentLine model={model} />
        <EvidenceLine check={check} />
      </>
    );
  } else if (band === "thin") {
    summary = (
      <>
        <p className="type-lead max-w-[52ch] text-foreground num" data-slot="verdict-sentence">
          {noBreakBeds(keepFiguresTogether(`${verdictSentence(check)} ${COPY["thin.notHighLow"]}`))}
        </p>
        <ThinEvidenceLine check={check} />
      </>
    );
  } else if (band === "none") {
    summary = <NotCoveredSentence check={check} />;
  } else {
    summary = (
      <p className="type-lead max-w-[52ch] text-foreground num" data-slot="verdict-sentence">
        {keepFiguresTogether(verdictSentence(check))}
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-6 pb-12 md:pt-10 lg:pt-14" data-slot="share-page">
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-x-6">
        <div className="flex min-w-0 flex-col lg:col-span-6 lg:col-start-1 lg:row-start-1">
          <StaleNote className="mb-5" />
          {offPlan ? <Notice className="mb-5">{COPY["offplan.notice"]}</Notice> : null}
          <h1 tabIndex={-1} className="flex flex-col gap-3 text-foreground outline-none" data-slot="share-heading">
            <span className="text-[15px] leading-normal font-medium text-foreground num" data-slot="share-caption">
              {sharePageCaption(check)}
            </span>
            <span className="sr-only"> </span>
            <span className="type-display-lg max-w-[14ch]" data-slot="verdict-headline">
              <VerdictWords band={band} diff={check.analysis.diff} acs={acsOutcome(check)} nearby={nearbyOutcome(check)} />
            </span>
          </h1>
          <FactLine values={factOfCheck(check)} className="mt-3 lg:mt-4" />
          {near ? (
            <div className="mt-5 lg:mt-6" data-slot="result-nearby-scale">
              <NearbyOwnNote check={check} className="mb-6" />
              <RangeScale check={check} source="nearby" />
            </div>
          ) : lead ? (
            <RangeScale check={check} source="acs" className="mt-5 lg:mt-6" />
          ) : model ? (
            <MarketScale check={check} landing="session" className="mt-5 lg:mt-6" />
          ) : band === "thin" ? (
            <div className="mt-5 lg:mt-6" data-slot="result-tally">
              <TallyDots count={check.analysis.count} min={check.rules.minSales} />
            </div>
          ) : null}
          <div className="flex flex-col items-start gap-4 pt-4" data-slot="share-summary">
            {summary}
            {today ? (
              <p className="text-body font-semibold text-foreground num" data-slot="today">
                {today}
              </p>
            ) : null}
            {/* The second tier as stored: what the person who sent this saw. Nothing unless a range shows. */}
            {near ? null : band === "thin" && acs ? (
              <AcsSection check={check} headingLevel={2} settle={false} className="mt-2" />
            ) : band === "thin" || band === "none" ? (
              <SimilarSection check={check} headingLevel={2} settle={false} className="mt-2" />
            ) : null}
          </div>
        </div>

        <div className="hidden min-w-0 lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:block">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+32px)] lg:flex lg:justify-center lg:pt-8">
            <div className="w-full max-w-96">
              <SharePageCard check={check} />
            </div>
          </div>
        </div>

        <div className={cn("mt-10 flex min-w-0 flex-col items-stretch gap-6 lg:col-span-12 lg:col-start-1 lg:row-start-3 lg:mt-16 lg:max-w-[792px]")}>
          {/* The page's one h1 is the verdict: the list's heading is an h2 here (the result's is an h3). */}
          {near ? <NearbySalesList check={check} headingLevel={2} /> : null}
          {band === "none" || (near && check.sales.length === 0) ? null : lead ? <AcsSalesList check={check} headingLevel={2} /> : <SalesList check={check} all={band === "thin"} headingLevel={2} />}
          <Provenance check={check} />
          {plainNotCovered(check) ? null : <SaveButton check={check} className="w-full sm:w-auto sm:self-start" />}
          <ActionBar className="w-full lg:w-auto">
            <Link href={`/?ref=${encodeURIComponent(check.code)}`} className={cn(buttonVariants({ size: "lg" }))}>
              {COPY["c.cta"]}
            </Link>
          </ActionBar>
        </div>
      </div>
    </div>
  );
}
