"use client";

/**
 * The second tier on a result (DESIGN.md section 6.16; REAL_DATA.md section 15): shown
 * under the unchanged "Too few sales to compare yet" (or "Not covered yet") explanation, and only when
 * the stored comparison carries a shown range. When the rule refuses, this renders nothing and the
 * result is exactly what it was.
 *
 *   A range from more registered sales                  h3 (h2 on /c), type-title
 *   [the range scale]                                   the market scale's axis in a weaker form
 *   AED per sq ft.  o another building, at its median    * a sale in this building
 *   [] the range, AED 1,720 to 1,980
 *   This building has too few ... They point to a median between AED 1,720 and AED 1,980 ...
 *   This asking price, AED 1,890 per sq ft, is within that range.
 *   Narrow range. The range is built from ... Their medians run from ... weaker evidence ... Not a valuation.
 *   See the 12 other buildings                          closed until asked for, never behind an ask
 *
 * Weaker than a same-building result on purpose: no stamp, no percentage, no headline of its own, a
 * range in place of a median, rings in place of sales. "Narrow range" / "Broad range" opens the
 * definitions (a Popover from 1024px, a sheet on phones): the two tiers, what the tests found and what
 * the range leaves out.
 *
 * The scale: one tab stop when it has marks; Left and Right step in price order, Home and End jump to
 * the ends, Esc restores the legend; a tap or drag picks the nearest mark. The drawing is aria-hidden:
 * the hidden title and summary say everything it shows, and the list is the data table.
 */
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { InfoSheet } from "@/components/result/info-sheet";
import { noBreakBeds } from "@/components/result/no-break";
import { SCALE_DESKTOP_QUERY } from "@/components/result/market-scale";
import { SETTLE_AT, SettleIn } from "@/components/scene/use-settle";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/shell/use-media-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { basisWord, COPY, similarLines, similarUsesOthers, t, tPlural } from "@/lib/copy";
import { bedsLabelPlural, formatDate, formatInt, keepFiguresTogether } from "@/lib/format";
import { acsScale } from "@/lib/result/acs-scale";
import { nearbyScale } from "@/lib/result/nearby-scale";
import { nearestMark, RANGE_METRICS, similarScale, type RangeScaleModel } from "@/lib/result/similar-scale";
import { acsRangeLegend, acsRangeReadout, acsRangeSummary, nearbyRangeLegend, nearbyRangeReadout, nearbyRangeSummary, rangeLegend, rangeReadout, rangeSummary, similarDefinitions } from "@/lib/result/words";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The list shows this many rows until "Show all". */
export const SIMILAR_LIST_ROWS = 8;

const TEXT_BUTTON =
  "relative inline rounded-sm text-foreground underline decoration-1 underline-offset-[3px] outline-none after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW_BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-base font-medium text-foreground underline decoration-1 underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Glyph({ kind }: { kind: "own" | "other" | "range" }) {
  if (kind === "range") {
    return (
      <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden="true" className="shrink-0">
        <rect x={0.5} y={0} width={13} height={10} fill="var(--chart-4)" />
        <line x1={0.5} y1={0} x2={0.5} y2={10} stroke="var(--input)" strokeWidth={1} strokeDasharray="2 2" />
        <line x1={13.5} y1={0} x2={13.5} y2={10} stroke="var(--input)" strokeWidth={1} strokeDasharray="2 2" />
      </svg>
    );
  }
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
      {kind === "own" ? <circle cx={4} cy={4} r={3.5} fill="var(--chart-3)" /> : <circle cx={4} cy={4} r={3.1} fill="var(--background)" stroke="var(--input)" strokeWidth={1.25} />}
    </svg>
  );
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: width ?? fallback };
}

/**
 * The range scale: the zone, the rings and dots, the pin, the labels and the legend. `source` picks
 * what it draws: the second tier's range ("similar", the default), or the range of adjusted registered
 * sales ("acs", DESIGN.md section 6.17), whose marks are the registered sales at their adjusted figure,
 * or the range of nearby registered sales ("nearby", DESIGN.md section 6.18), whose marks are rings:
 * registered sales in other buildings at their adjusted figure.
 */
export function RangeScale({ check, source = "similar", className }: { check: CheckView; source?: "similar" | "acs" | "nearby"; className?: string }) {
  const acs = source === "acs";
  const nearby = source === "nearby";
  const wide = useMediaQuery(SCALE_DESKTOP_QUERY);
  const variant = wide ? "desktop" : "phone";
  const { ref: blockRef, width } = useWidth(RANGE_METRICS[variant].width);
  const model = useMemo(
    () => (nearby ? nearbyScale(check, width, { variant }) : acs ? acsScale(check, width, { variant }) : similarScale(check, width, { variant })),
    [acs, nearby, check, width, variant],
  );
  const titleId = useId();
  const summaryId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ model: RangeScaleModel; mark: number } | null>(null);
  const selected = picked && picked.model === model ? picked.mark : null;
  const dragging = useRef(false);
  const pinned = useRef(false);
  const select = useCallback((mark: number | null) => setPicked(mark === null || !model ? null : { model, mark }), [model]);

  useEffect(() => {
    if (selected === null) return;
    const onDown = (e: Event) => {
      if (chartRef.current && e.target instanceof Node && chartRef.current.contains(e.target)) return;
      pinned.current = false;
      select(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [selected, select]);

  if (!model) return null;
  const m = RANGE_METRICS[variant];
  const interactive = model.marks.length > 0;

  const pickAt = (clientX: number) => {
    const el = chartRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const k = rect.width > 0 ? model.width / rect.width : 1;
    select(nearestMark(model, (clientX - rect.left) * k));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging.current = true;
    pinned.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and old browsers: dragging still works inside the chart
    }
    pickAt(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current || e.pointerType === "mouse") pickAt(e.clientX);
  };
  const endDrag = () => {
    dragging.current = false;
  };
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && !dragging.current && !pinned.current) select(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = model.order;
    const at = selected === null ? -1 : order.indexOf(selected);
    let next: number | null | undefined;
    if (e.key === "ArrowRight") next = order[at < 0 ? 0 : Math.min(order.length - 1, at + 1)];
    else if (e.key === "ArrowLeft") next = order[at < 0 ? order.length - 1 : Math.max(0, at - 1)];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    else if (e.key === "Escape" && selected !== null) next = null;
    if (next === undefined) return;
    e.preventDefault();
    pinned.current = next !== null;
    select(next);
  };

  const legend = nearby ? nearbyRangeLegend(check, model) : acs ? acsRangeLegend(check, model) : rangeLegend(check, model);
  const mark = selected === null ? null : model.marks[selected];
  const readout = mark ? (nearby ? nearbyRangeReadout(check, mark) : acs ? acsRangeReadout(check, mark) : rangeReadout(check, mark)) : null;
  const ownLegend = legend.own ? (
    <span className="inline-flex items-center gap-1.5">
      <Glyph kind="own" />
      {legend.own}
    </span>
  ) : null;
  const axisLineY = model.axisY + m.axis / 2;
  const half = model.dot.r - 0.625;
  const ds = m.diamond / 2;
  const endLabel = "absolute text-center text-[15px] leading-5 font-semibold text-foreground num";

  return (
    <div ref={blockRef} className={cn("w-full min-w-0", className)} data-slot="range-scale-block">
      <span id={titleId} className="sr-only">
        {COPY[nearby ? "nearby.scaleTitle" : acs ? "acs.scaleTitle" : "similar.scaleTitle"]}
      </span>
      <span id={summaryId} className="sr-only" data-slot="range-summary">
        {keepFiguresTogether(nearby ? nearbyRangeSummary(check, model) : acs ? acsRangeSummary(check, model) : rangeSummary(check, model))}
      </span>
      <div
        ref={chartRef}
        role="group"
        tabIndex={interactive ? 0 : undefined}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        onKeyDown={interactive ? onKeyDown : undefined}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={interactive ? onPointerLeave : undefined}
        className={cn(
          "relative w-full touch-pan-y rounded-sm outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          interactive && "cursor-crosshair",
        )}
        style={{ height: model.height }}
        data-slot="range-scale"
        data-source={source}
        data-variant={variant}
        data-verdict={model.verdict}
        data-selected={selected ?? undefined}
      >
        <svg aria-hidden="true" width={model.width} height={model.height} viewBox={`0 0 ${model.width} ${model.height}`} className="absolute top-0 left-0 overflow-visible">
          {/* The range: a shaded zone with dashed ends (the in-line zone of a same-building result has solid ones). */}
          <g data-slot="range-zone">
            <rect x={model.zone.x0} y={model.zone.y0} width={Math.max(1, model.zone.x1 - model.zone.x0)} height={model.zone.y1 - model.zone.y0} fill="var(--chart-4)" />
            <line x1={model.zone.x0} y1={model.zone.y0} x2={model.zone.x0} y2={model.zone.y1} stroke="var(--input)" strokeWidth={1} strokeDasharray="3 3" />
            <line x1={model.zone.x1} y1={model.zone.y0} x2={model.zone.x1} y2={model.zone.y1} stroke="var(--input)" strokeWidth={1} strokeDasharray="3 3" />
          </g>
          {/* The asking price: a plain pin, behind the marks, with a paper halo. */}
          <g data-slot="range-pin">
            <line x1={model.pin.x} y1={model.pin.y0} x2={model.pin.x} y2={model.pin.y1} stroke="var(--background)" strokeWidth={4.5} />
            <line x1={model.pin.x} y1={model.pin.y0} x2={model.pin.x} y2={model.pin.y1} stroke="var(--stamp)" strokeWidth={1.5} />
          </g>
          {model.marks.map((mk, i) =>
            mk.kind === "own" ? (
              <circle key={i} cx={mk.cx} cy={mk.cy} r={mk.r} fill="var(--chart-3)" data-slot="range-mark" data-kind="own" />
            ) : (
              <circle key={i} cx={mk.cx} cy={mk.cy} r={half} fill="var(--background)" stroke="var(--input)" strokeWidth={1.25} data-slot="range-mark" data-kind="other" />
            ),
          )}
          {mark ? <circle cx={mark.cx} cy={mark.cy} r={mark.r + 3} fill="none" stroke="var(--foreground)" strokeWidth={2} data-slot="range-ring" /> : null}
          <line x1={16} y1={axisLineY} x2={model.width - 16} y2={axisLineY} stroke="var(--foreground)" strokeWidth={m.axis} />
          {[model.low, model.high].map((v, i) => {
            const x = i === 0 ? model.zone.x0 : model.zone.x1;
            return <line key={v} x1={x} y1={model.axisY + m.axis} x2={x} y2={model.axisY + m.axis + 4} stroke="var(--foreground)" strokeWidth={1} />;
          })}
          <path
            d={`M${model.pin.x} ${axisLineY - ds} L${model.pin.x + ds} ${axisLineY} L${model.pin.x} ${axisLineY + ds} L${model.pin.x - ds} ${axisLineY} Z`}
            fill="var(--stamp)"
            data-slot="range-diamond"
          />
        </svg>

        <div aria-hidden="true" className="pointer-events-none absolute inset-0" data-slot="range-labels">
          <span
            className="absolute top-0 text-[14px] leading-5 whitespace-nowrap text-muted-foreground num"
            style={model.askLabel.side === "right" ? { left: model.askLabel.x } : { right: model.width - model.askLabel.x }}
            data-slot="range-asking"
          >
            {COPY["similar.asking"]} <span className="font-semibold text-foreground">{formatInt(model.ask)}</span>
          </span>
          {model.ends.joined ? (
            <span className={endLabel} style={{ left: model.ends.joined.left, width: model.ends.joined.width, top: model.labelTop }} data-slot="range-ends">
              {t("similar.endsJoined", { low: formatInt(model.low), high: formatInt(model.high) })}
            </span>
          ) : (
            <>
              <span className={endLabel} style={{ left: model.ends.low.left, width: model.ends.low.width, top: model.labelTop }} data-slot="range-low">
                {formatInt(model.low)}
              </span>
              <span className={endLabel} style={{ left: model.ends.high.left, width: model.ends.high.width, top: model.labelTop }} data-slot="range-high">
                {formatInt(model.high)}
              </span>
            </>
          )}
          {model.ticks
            .filter((tk) => tk.visible)
            .map((tk) => (
              <span key={tk.value} className="absolute text-center text-[14px] leading-5 text-muted-foreground num" style={{ left: tk.left, width: tk.width, top: model.labelTop }} data-slot="range-tick">
                {formatInt(tk.value)}
              </span>
            ))}
        </div>
      </div>

      <div className="mt-2 text-[14px] leading-5 text-muted-foreground" data-slot="range-legend">
        {/* A building's readout can take two lines on a phone: the room is kept, so the text below does not move. */}
        <p className={cn("flex flex-wrap items-center gap-x-3", acs || nearby ? "min-h-10 content-start" : wide ? "min-h-5" : "min-h-10 content-start")} data-slot="range-legend-1">
          {readout ? (
            <span className="text-foreground num" data-slot="range-readout">
              {keepFiguresTogether(readout)}
            </span>
          ) : (
            <>
              <span>{legend.unit}</span>
              {/* Adjusted registered sales: this building's own type first; the second tier: the other buildings first. */}
              {acs ? ownLegend : null}
              {legend.other ? (
                <span className="inline-flex items-center gap-1.5">
                  <Glyph kind="other" />
                  {legend.other}
                </span>
              ) : null}
              {acs ? null : ownLegend}
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 num" data-slot="range-legend-2">
          <span className="inline-flex items-center gap-1.5">
            <Glyph kind="range" />
            {keepFiguresTogether(legend.range)}
          </span>
          {legend.off ? <span>{legend.off}</span> : null}
          {legend.capped ? <span data-slot="range-capped">{legend.capped}</span> : null}
        </p>
        <span className="sr-only" aria-live="polite" data-slot="range-live">
          {readout ?? ""}
        </span>
      </div>
    </div>
  );
}

function Definitions({ check }: { check: CheckView }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[22px] text-foreground num" data-slot="similar-definitions">
      {similarDefinitions(check).map((line) => (
        <p key={line}>{keepFiguresTogether(line)}</p>
      ))}
    </div>
  );
}

/** The similar buildings behind the range: name, registered sales, their median. Closed until asked for. */
function SimilarList({ check }: { check: CheckView }) {
  const s = check.similar;
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const listId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  if (!s || s.comparables.length === 0) return null;
  const rows = all ? s.comparables : s.comparables.slice(0, SIMILAR_LIST_ROWS);
  const k = s.comparableBuildings;
  const showAll = () => {
    setAll(true);
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLElement>(`[data-row="${SIMILAR_LIST_ROWS}"]`)?.focus({ preventScroll: true }));
  };
  return (
    <div className="flex w-full flex-col items-start" data-slot="similar-list">
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} className={ROW_BUTTON} data-slot="similar-list-toggle">
        {open ? COPY["similar.listHide"] : tPlural("similar.listShow", k, { k: formatInt(k) })}
        <ChevronDownIcon aria-hidden="true" strokeWidth={1.75} className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={listId} hidden={!open} className="w-full">
        {open ? (
          <>
            <p className="max-w-[62ch] text-[14px] leading-5 text-muted-foreground num" data-slot="similar-list-note">
              {noBreakBeds(
                keepFiguresTogether(
                  [
                    t("similar.listNote", { basis: basisWord(check.analysis.completionBasis), bedTypePlural: bedsLabelPlural(check.bedrooms), from: formatDate(s.windowStart), to: formatDate(s.windowEnd) }),
                    s.comparables.length < k ? t("similar.listCapped", { shown: formatInt(s.comparables.length), k: formatInt(k) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" "),
                ),
              )}
            </p>
            <table ref={tableRef} className="mt-2 w-full border-collapse border-t border-border text-[15px] num" data-slot="similar-table">
              <thead>
                <tr className="text-[14px] text-muted-foreground">
                  <th scope="col" className="h-11 border-b border-border pr-3 text-left font-medium">
                    {COPY["similar.colBuilding"]}
                  </th>
                  <th scope="col" className="h-11 border-b border-border px-3 text-right font-medium">
                    {COPY["similar.colSales"]}
                  </th>
                  <th scope="col" className="h-11 border-b border-border pl-3 text-right font-medium whitespace-nowrap">
                    {COPY["similar.colMedian"]}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={`${row.name}-${i}`}
                    tabIndex={-1}
                    data-row={i}
                    className="outline-none focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
                  >
                    <th scope="row" className="h-11 border-b border-border py-2 pr-3 text-left font-normal text-foreground">
                      {row.name}
                    </th>
                    <td className="h-11 border-b border-border px-3 text-right text-foreground">{formatInt(row.sales)}</td>
                    <td className="h-11 border-b border-border pl-3 text-right font-semibold text-foreground">{formatInt(row.medianPsf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!all && s.comparables.length > SIMILAR_LIST_ROWS ? (
              <button type="button" onClick={showAll} className={cn(ROW_BUTTON, "mt-1")} data-slot="similar-list-all">
                {t("similar.listAll", { n: formatInt(s.comparables.length) })}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SimilarSection({
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
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const lines = similarLines(check);
  if (!lines) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const trigger = cn(TEXT_BUTTON, "font-medium");
  const body = (
    <section aria-labelledby={headingId} className={cn("flex w-full flex-col items-start gap-3 border-t border-border pt-5", className)} data-slot="similar-section" data-tier={check.similar?.tier} data-others={similarUsesOthers(check) || undefined}>
      <Heading id={headingId} className="type-title text-foreground">
        {lines.heading}
      </Heading>
      <RangeScale check={check} className="mt-1" />
      <p className="max-w-[58ch] text-body text-foreground num" data-slot="similar-range">
        {noBreakBeds(keepFiguresTogether(`${lines.intro} ${lines.range}`))}
      </p>
      <p className="max-w-[58ch] text-body font-medium text-foreground num" data-slot="similar-verdict">
        {keepFiguresTogether(lines.verdict)}
      </p>
      <p className="max-w-[62ch] text-[14px] leading-5 text-muted-foreground num" data-slot="similar-evidence">
        {desktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<button type="button" className={trigger} data-slot="similar-trigger" />}>{lines.tier}</PopoverTrigger>
            <PopoverContent align="start" aria-label={lines.tier} className="w-[min(380px,calc(100vw-2rem))] gap-3 p-4">
              <Definitions check={check} />
            </PopoverContent>
          </Popover>
        ) : (
          <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={trigger} data-slot="similar-trigger">
            {lines.tier}
          </button>
        )}
        {". "}
        {noBreakBeds(keepFiguresTogether([lines.sources, lines.span, lines.weaker].filter(Boolean).join(" ")))}
      </p>
      {desktop ? null : (
        <InfoSheet open={open} onOpenChange={setOpen} title={lines.tier} slot="similar-sheet">
          <Definitions check={check} />
        </InfoSheet>
      )}
      <SimilarList check={check} />
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
