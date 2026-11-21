"use client";

/**
 * The result (RESULT_SPEC sections 3 to 6; it replaces docs/REDESIGN.md section 8.5), as slot content
 * for FlowLayout: one layout from the scene to the result, so the fact line never moves and the stage
 * cell (where the balance was) never remounts. A short document on paper, read top to bottom; no box,
 * no screenshot, no stamped sheet.
 *
 *   notices  stale data, off-plan                                   (fade in at the end of the settle)
 *   head     "In line with registered sales"                        (the focus target)
 *   fact     the fact line with Edit
 *   chart    the market scale and its legend (too few: the tally)   (not covered: nothing)
 *   below    the gap sentence, "Ask what explains the premium" (above), the size note, the listing check
 *            (below), the recent-sales line, the evidence line with "Wrong building?"; on phones "More
 *            ways to share" and the sticky bar [Send on WhatsApp] [Save and track]
 *   stage    desktop only: the share card preview, sticky, with the actions under it
 *   rest     level 2: the sales list (never gated), "Before you make an offer", the cost row,
 *            provenance, How Fairsquare compares, Compare another listing
 *
 * Too few sales: no scale and no stamp; the tally, the sentence, the DLD building, the open list, and
 * Save and track first. Not covered: no scale, no evidence line, no card; "Search covered buildings" and
 * "Request it and track" (not-covered-result.tsx); the desktop stage shows the screenshot unstamped.
 *
 * Nearby registered sales (the last resort, DESIGN.md section 6.18): when the building gives nothing to
 * compare and a range from other buildings nearby shows, the headline is its outcome. Directly under it
 * the page says what the building itself has and that the range comes from other buildings; then the
 * scale, the sentences, the weakness note, the sales used, and the card and actions of a verdict.
 *
 * Edit and "Wrong building?" open the Change a detail sheet (edit-sheet.tsx, rendered by the flow) at
 * its rows or at the building question. A change re-settles the result in place: the pieces keyed by
 * the comparison's code (the verdict, the scale, the sentences, level 2) remount and play the re-settle.
 */
import { useCallback, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { NotCoveredBelow } from "@/components/check/not-covered-result";
import { Notice, StaleNote } from "@/components/data/data-notice";
import { ActionBar } from "@/components/flow/action-bar";
import { CostPanel } from "@/components/money/cost-panel";
import { CostRow } from "@/components/money/cost-row";
import { AcsEvidenceLine, AcsLeadText, AcsMedianLine, AcsOtherBedsNote, AcsSalesList, AcsSection, AcsSizeNote } from "@/components/result/acs-section";
import type { EditStep } from "@/components/result/edit-sheet";
import { EvidenceLine, ThinEvidenceLine } from "@/components/result/evidence-line";
import { FactLine } from "@/components/result/fact-line";
import { GapSentence } from "@/components/result/gap-sentence";
import { HowPopover } from "@/components/result/how-popover";
import { ListingCheck } from "@/components/result/listing-check";
import { MarketScale } from "@/components/result/market-scale";
import { NearbyEvidenceLine, NearbyLeadText, NearbyOwnNote, NearbySalesList, NearbyWeakNote } from "@/components/result/nearby-section";
import { noBreakBeds } from "@/components/result/no-break";
import { OFFER_ID, OfferNotes } from "@/components/result/offer-notes";
import { Provenance } from "@/components/result/provenance";
import { RecentLine } from "@/components/result/recent-line";
import { CardPreview, MoreWaysToShare, useCardFile, useCardGetter } from "@/components/result/result-share";
import { SalesList } from "@/components/result/sales-list";
import { RangeScale, SimilarSection } from "@/components/result/similar-section";
import { SizeNote, TallyDots, VerdictHeadline } from "@/components/result/verdict-summary";
import { SaveButton } from "@/components/saved/save-button";
import { ScreenshotSheet } from "@/components/scene/screenshot-dialog";
import { SETTLE_AT, SettleIn, SettleOut } from "@/components/scene/use-settle";
import { ShareButton, WhatsAppButton } from "@/components/share/share-actions";
import { usePublicConfig } from "@/components/shell/config-provider";
import { Button } from "@/components/ui/button";
import type { FlowImage, PickedBuilding } from "@/hooks/use-check-flow";
import { acsLead, acsShown, COPY, nearbyShown, staleNote, t, verdictSentence } from "@/lib/copy";
import { bedsLabel, formatInt, keepFiguresTogether } from "@/lib/format";
import { scrollIntoViewSafe } from "@/lib/motion";
import { scaleModel } from "@/lib/result/scale-model";
import { factOfCheck } from "@/lib/result/words";
import type { CheckView, MatchResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export { useCardGetter };

/**
 * The notices at the top of the result (REAL_DATA.md section 7): the stale-data note when the loaded
 * sales end more than 45 days ago, and the off-plan notice. Nothing at all when neither applies, so
 * the notices cell stays empty and takes no space.
 */
export function ResultNotices({ check }: { check: CheckView }) {
  const { data } = usePublicConfig();
  // Not covered compared nothing, so it never says "Compared with off-plan sales only".
  const offPlan = check.analysis.completionBasis === "off_plan" && (check.analysis.band !== "none" || nearbyShown(check) !== null);
  if (!staleNote(data) && !offPlan) return null;
  return (
    <SettleIn at={SETTLE_AT.rest} className="flex flex-col gap-3">
      <StaleNote />
      {offPlan ? <Notice>{COPY["offplan.notice"]}</Notice> : null}
    </SettleIn>
  );
}

/** The cost row and its Drawer/Sheet, on every result type. */
export function CostSection({ check }: { check: CheckView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CostRow check={check} onOpen={() => setOpen(true)} />
      <CostPanel check={check} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function AnotherLink({ onAnother }: { onAnother: () => void }) {
  return (
    <Button type="button" variant="link" onClick={onAnother} className="self-start">
      {COPY["result.another"]}
    </Button>
  );
}

/**
 * The result's head: the verdict headline (the focus target), with what was in the head just before
 * fading out over it while the settle runs: the scene's last caption, or at a re-settle the weighing
 * caption or the previous verdict. Keyed by the comparison's code, so a re-settle fades the new one in.
 */
export function ResultHead({
  check,
  headingRef,
  lastHead,
}: {
  check: CheckView;
  headingRef: Ref<HTMLHeadingElement>;
  /** What fades out over the verdict (null when the settle does not run). */
  lastHead: ReactNode;
}) {
  return (
    <div className="relative" data-slot="result-head">
      {lastHead ? (
        <SettleOut at={SETTLE_AT.captionOut} className="pointer-events-none absolute inset-x-0 top-0">
          {lastHead}
        </SettleOut>
      ) : null}
      <SettleIn key={check.code} at={SETTLE_AT.verdictIn} duration={0.16} y={6}>
        <VerdictHeadline check={check} headingRef={headingRef} />
      </SettleIn>
    </div>
  );
}

/** The result's own UI state, kept by the flow so it survives re-renders: the offer disclosure and the Change a detail sheet. */
export interface ResultUi {
  /** "Before you make an offer" open (null: its default for this result). */
  offerOpen: { code: string; open: boolean } | null;
  setOfferOpen: (v: { code: string; open: boolean } | null) => void;
  /** The Change a detail sheet: open, and where it opened (the rows, or the building question). */
  edit: { open: boolean; entry: EditStep };
  openEdit: (entry: EditStep) => void;
  closeEdit: () => void;
  /** The control that opened the sheet (Edit or "Wrong building?"): focus returns to it. */
  editOpener: RefObject<HTMLElement | null>;
}

export function useResultUi(): ResultUi {
  const [offerOpen, setOfferOpen] = useState<ResultUi["offerOpen"]>(null);
  const [edit, setEdit] = useState<ResultUi["edit"]>({ open: false, entry: "rows" });
  const editOpener = useRef<HTMLElement | null>(null);
  const openEdit = useCallback((entry: EditStep) => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    editOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setEdit({ open: true, entry });
  }, []);
  const closeEdit = useCallback(() => setEdit((e) => (e.open ? { ...e, open: false } : e)), []);
  return { offerOpen, setOfferOpen, edit, openEdit, closeEdit, editOpener };
}

export interface ResultSlotsInput {
  check: CheckView;
  image: FlowImage | null;
  /** The building match behind it (the off-plan helper's ready count), when known. */
  match: MatchResponse | null;
  /** From 1024px: the card preview and the actions sit in the stage cell; phones get the sticky bar. */
  desktop: boolean;
  getCard: () => Promise<File | null>;
  ui: ResultUi;
  onAnother: () => void;
  /** Another building for the same listing (a row, a searched building, or None of these). */
  onPickBuilding: (b: PickedBuilding | null) => void;
  /** The off-plan mismatch helper's "Compare with ready sales". */
  onCompareReady: () => void;
}

export interface ResultSlots {
  notices: ReactNode;
  fact: ReactNode;
  chart: ReactNode;
  below: ReactNode;
  /** The stage cell's content from 1024px (null: an empty stage). */
  stage: ReactNode;
  rest: ReactNode;
}

const TEXT_BUTTON =
  "inline-flex min-h-11 items-center self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The verdict and too-few actions: in the stage cell from 1024px, the sticky bar on phones. */
function ShareSide({ check, getCard, desktop, thin }: { check: CheckView; getCard: () => Promise<File | null>; desktop: boolean; thin: boolean }) {
  const { file } = useCardFile(getCard);
  const actions = thin ? (
    <>
      <SaveButton check={check} variant="default" />
      <ShareButton check={check} file={file} />
    </>
  ) : (
    <>
      <WhatsAppButton check={check} />
      <SaveButton check={check} />
    </>
  );
  if (desktop) {
    return (
      <div className="flex w-full flex-col items-center pt-8" data-slot="result-share-side">
        <div className="flex w-full max-w-96 flex-col">
          <CardPreview check={check} file={file} />
          <div className="mt-4 flex gap-2 [&>*]:min-h-12 [&>*:first-child]:flex-1" data-slot="result-actions">
            {actions}
          </div>
          {thin ? <p className="mt-2 text-caption text-muted-foreground">{COPY["save.helper"]}</p> : <MoreWaysToShare check={check} file={file} className="mt-2" />}
        </div>
      </div>
    );
  }
  // Phones: the sticky bar (Save first and its note inside the bar when too few, section 6.6).
  return (
    <>
      {thin ? null : <MoreWaysToShare check={check} file={file} />}
      <ActionBar className="gap-2 [&>*]:min-h-13 [&>*:last-child]:flex-none" note={thin ? COPY["save.helper"] : undefined}>
        {actions}
      </ActionBar>
    </>
  );
}

/** The off-plan mismatch helper (section 6.8): this building's ready sales, and a rerun against them. */
function readySalesFor(i: ResultSlotsInput): number | null {
  const id = i.check.building?.id;
  const c = id === undefined ? undefined : i.match?.candidates.find((x) => x.buildingId === id);
  return c?.basisSales?.ready ?? null;
}

/** The result's notices, fact, chart, below, stage and rest slots (the head is `ResultHead`). */
export function resultSlots(i: ResultSlotsInput): ResultSlots {
  const { check, ui } = i;
  const band = check.analysis.band;
  const notices = <ResultNotices check={check} />;
  const fact = <FactLine values={factOfCheck(check)} onEdit={() => ui.openEdit("rows")} />;
  const links = (
    <div className="mt-2 flex flex-col items-start lg:flex-row lg:gap-8" data-slot="result-links">
      <HowPopover check={check} />
      <AnotherLink onAnother={i.onAnother} />
    </div>
  );
  const wrongBuilding = () => ui.openEdit("building");

  // The last resort: a range from registered sales in other buildings nearby. It takes the place of
  // "Too few sales to compare yet" and "Not covered yet", and says at once whose sales it reads.
  if (nearbyShown(check)) {
    return {
      notices,
      fact,
      chart: (
        <SettleIn key={check.code} at={SETTLE_AT.rest} slot="result-nearby-scale">
          <NearbyOwnNote check={check} className="mb-6" />
          <RangeScale check={check} source="nearby" />
        </SettleIn>
      ),
      below: (
        <div className="flex flex-col items-start gap-4 pt-4" data-slot="result-below">
          <SettleIn key={check.code} at={SETTLE_AT.rest} className="flex w-full flex-col items-start gap-4">
            <NearbyLeadText check={check} />
            <NearbyWeakNote check={check} />
            <NearbyEvidenceLine check={check} onWrongBuilding={wrongBuilding} />
          </SettleIn>
          {i.desktop ? null : <ShareSide check={check} getCard={i.getCard} desktop={false} thin={false} />}
        </div>
      ),
      stage: i.desktop ? <ShareSide check={check} getCard={i.getCard} desktop thin={false} /> : null,
      rest: (
        <SettleIn key={check.code} at={SETTLE_AT.rest} className="mt-10 flex flex-col items-stretch gap-6 lg:mt-16 lg:max-w-[792px]">
          <NearbySalesList check={check} />
          {/* The building's own few registered sales stay listed: they are facts, though too few to compare. */}
          {band === "thin" && check.sales.length > 0 ? <SalesList check={check} all /> : null}
          <CostSection check={check} />
          <Provenance check={check} />
          {links}
        </SettleIn>
      ),
    };
  }

  if (band === "none") {
    return {
      notices,
      fact,
      chart: null,
      below: <NotCoveredBelow key={check.code} check={check} onPickBuilding={(b) => i.onPickBuilding(b)} />,
      stage: i.image ? <ScreenshotSheet image={i.image} className="mx-auto w-full lg:max-w-[calc((100dvh-160px)/2)]" /> : <div aria-hidden="true" />,
      rest: (
        <SettleIn key={check.code} at={SETTLE_AT.rest} className="mt-10 flex flex-col items-stretch gap-6 lg:mt-14 lg:max-w-[792px]">
          <CostSection check={check} />
          <Provenance check={check} />
          {links}
        </SettleIn>
      ),
    };
  }

  if (band === "thin") {
    const readySales = check.analysis.completionBasis === "off_plan" ? readySalesFor(i) : null;
    return {
      notices,
      fact,
      chart: (
        <SettleIn key={check.code} at={SETTLE_AT.rest} slot="result-tally">
          <TallyDots count={check.analysis.count} min={check.rules.minSales} />
        </SettleIn>
      ),
      below: (
        <div className="flex flex-col items-start gap-3 pt-4" data-slot="result-below">
          <SettleIn key={check.code} at={SETTLE_AT.rest} className="flex w-full flex-col items-start gap-3">
            <p className="type-lead max-w-[52ch] text-foreground num" data-slot="verdict-sentence">
              {noBreakBeds(keepFiguresTogether(`${verdictSentence(check)} ${COPY["thin.notHighLow"]}`))}
            </p>
            {readySales !== null && readySales >= check.rules.minSales ? (
              <p className="max-w-[52ch] text-[15px] leading-[22px] text-foreground" data-slot="offplan-mismatch">
                {noBreakBeds(t("offplan.mismatch", { n: formatInt(readySales), bedType: bedsLabel(check.bedrooms) }))}{" "}
                {/* Inline in the sentence: its 44px target comes from the hit extension (spec 11). */}
                <button
                  type="button"
                  onClick={i.onCompareReady}
                  className={cn(TEXT_BUTTON, "relative inline min-h-0 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']")}
                  data-slot="compare-ready"
                >
                  {COPY["offplan.compareReady"]}
                </button>
              </p>
            ) : null}
            <ThinEvidenceLine check={check} onWrongBuilding={wrongBuilding} />
            {/* Adjusted registered sales when they give a range (DESIGN.md section 6.17); else the second
                tier, which is nothing at all unless a range shows. */}
            {acsShown(check) ? <AcsSection check={check} settle={false} className="mt-2" /> : <SimilarSection check={check} settle={false} className="mt-2" />}
          </SettleIn>
          {i.desktop ? null : <ShareSide check={check} getCard={i.getCard} desktop={false} thin />}
        </div>
      ),
      stage: i.desktop ? <ShareSide check={check} getCard={i.getCard} desktop thin /> : null,
      rest: (
        <SettleIn key={check.code} at={SETTLE_AT.rest} className="mt-6 flex flex-col items-stretch gap-6 lg:mt-10 lg:max-w-[792px]">
          <SalesList check={check} all />
          <CostSection check={check} />
          <Provenance check={check} />
          {links}
        </SettleIn>
      ),
    };
  }

  // A verdict: above, in line or below. When registered sales adjusted to this listing give a range
  // (DESIGN.md section 6.17), that range leads: its scale, its sentences, the sales used. The
  // same-building median stays on the page as one line.
  const model = scaleModel(check);
  const lead = acsLead(check);
  const above = lead ? lead.verdict === "above" : band === "above";
  const below = lead ? lead.verdict === "below" : band === "below";
  const offerDefault = above || i.desktop;
  const offerOpen = ui.offerOpen && ui.offerOpen.code === check.code ? ui.offerOpen.open : offerDefault;
  const askPremium = () => {
    ui.setOfferOpen({ code: check.code, open: true });
    requestAnimationFrame(() => scrollIntoViewSafe(document.getElementById(OFFER_ID), { block: "start" }));
  };

  return {
    notices,
    fact,
    chart: lead ? (
      <SettleIn key={check.code} at={SETTLE_AT.rest} slot="result-acs-scale">
        <RangeScale check={check} source="acs" />
      </SettleIn>
    ) : model ? (
      <MarketScale key={check.code} check={check} />
    ) : null,
    below: (
      <div className="flex flex-col items-start gap-4 pt-4" data-slot="result-below">
        <SettleIn key={check.code} at={SETTLE_AT.rest} className="flex w-full flex-col items-start gap-4">
          {lead ? (
            <AcsLeadText check={check} />
          ) : model ? (
            <GapSentence model={model} />
          ) : (
            <p className="type-lead max-w-[52ch] text-foreground num" data-slot="verdict-sentence">
              {keepFiguresTogether(verdictSentence(check))}
            </p>
          )}
          {above ? (
            <button type="button" onClick={askPremium} className={cn(TEXT_BUTTON, "-mt-2")} data-slot="premium-link">
              {COPY["result.premiumLink"]}
            </button>
          ) : null}
          {lead ? <AcsSizeNote check={check} /> : <SizeNote check={check} />}
          {lead ? <AcsOtherBedsNote check={check} /> : null}
          {below ? <ListingCheck /> : null}
          {lead ? <AcsMedianLine check={check} /> : model ? <RecentLine model={model} /> : null}
          {lead ? <AcsEvidenceLine check={check} onWrongBuilding={wrongBuilding} /> : <EvidenceLine check={check} onWrongBuilding={wrongBuilding} />}
        </SettleIn>
        {i.desktop ? null : <ShareSide check={check} getCard={i.getCard} desktop={false} thin={false} />}
      </div>
    ),
    stage: i.desktop ? <ShareSide check={check} getCard={i.getCard} desktop thin={false} /> : null,
    rest: (
      <SettleIn key={check.code} at={SETTLE_AT.rest} className="mt-10 flex flex-col items-stretch lg:mt-16 lg:max-w-[792px]">
        {lead ? <AcsSalesList check={check} /> : <SalesList check={check} />}
        <OfferNotes
          className="mt-10 lg:mt-16"
          model={model}
          open={offerOpen}
          onOpenChange={(open) => ui.setOfferOpen({ code: check.code, open })}
        />
        <div className="mt-6">
          <CostSection check={check} />
        </div>
        <Provenance check={check} className="mt-6" />
        {links}
      </SettleIn>
    ),
  };
}
