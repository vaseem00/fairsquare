"use client";

/**
 * The market scale (RESULT_SPEC section 4): a one-sided dot plot of the registered sales on a linear
 * AED per sq ft axis, one dot per sale, with the asking price as a small indigo stamp on a pin and the
 * median as a fulcrum under the axis. Every number comes from `scaleModel()`; one SVG unit is one CSS
 * px, and a ResizeObserver sets the width.
 *
 * - Dots: filled ink for the last 90 days, a hollow ring for earlier sales (shape, not colour alone).
 *   One faint band marks the in-line zone; it is the only overlay.
 * - Labels (the median and the ticks) are HTML placed on x(), so they follow text zoom.
 * - The stamp, the SVG and the labels are aria-hidden: the visually hidden title and summary, the
 *   headline and the sentences say everything they say. The sales list is the data table.
 * - Tap or drag anywhere selects the sale nearest by x (ties go to the newest); the legend's first line
 *   becomes the readout, announced politely. One tab stop: Left and Right step in price order, Home and
 *   End jump to the ends, Esc (or a tap outside) restores the legend.
 * - Motion only at the settle (section 2.7): the axis draws out from the median, the dots drop column by
 *   column, the stamp lands; any input jumps to the final frame, and reduced motion never plays it. At a
 *   re-settle after an edit (section 7) the axis keeps its place; the dots re-drop and the stamp lands on
 *   its new x. On /c (`landing="session"`) the stamp lands once per code per browser session, CSS only.
 */
import { animate, motion, useMotionValue } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { SETTLE_AT, SettleIn, settleAnimation, useSettleAt, useSettleEntering, useSettleShift } from "@/components/scene/use-settle";
import { useMediaQuery } from "@/components/shell/use-media-query";
import { useLandOnce } from "@/components/stamp/use-land-once";
import { COPY } from "@/lib/copy";
import { codeSeed } from "@/lib/domain/share-code";
import { formatInt, keepFiguresTogether } from "@/lib/format";
import { STAMP_SPRING } from "@/lib/motion";
import { nearestDot, SCALE_METRICS, scaleModel, type ScaleModel, type ScaleVariant } from "@/lib/result/scale-model";
import { legendWords, readoutText, scaleSummary, scaleTitle } from "@/lib/result/words";
import { layoutCompactStamp, turbulenceSeed } from "@/lib/stamp/geometry";
import type { CheckView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The scale's dots switch to 9px from this viewport width (section 4.3). */
export const SCALE_DESKTOP_QUERY = "(min-width: 768px)";

/** The /c landing: CSS only (it plays on first paint, no JavaScript needed), scale 1.14 to 1, rotate -8 to -4deg. */
const CSS_LANDING =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[1.14] motion-safe:spin-in-[-8deg] motion-safe:duration-220 motion-safe:delay-120 motion-safe:ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-safe:fill-mode-backwards";

/** The compact ASKING stamp (geometry.ts `layoutCompactStamp`): a double border, two rows, indigo at 0.9 with a light speckle. aria-hidden. */
function CompactStamp({ figure, variant, seed }: { figure: string; variant: "phone" | "desktop"; seed: number }) {
  const id = useId().replace(/:/g, "");
  const l = layoutCompactStamp(figure, variant);
  const { w, h } = l;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block overflow-visible" data-slot="scale-stamp-art">
      <defs>
        {/* Half the full stamp's speckle: the grain is cut at 0.15 instead of 0.3 (DESIGN.md section 8.2). */}
        <filter id={`${id}-g`} x={0} y={0} width={w} height={h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency={0.45} numOctaves={2} seed={turbulenceSeed(seed)} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" result="w" />
          <feComponentTransfer in="w">
            <feFuncA type="discrete" tableValues="0 0 0 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1" />
          </feComponentTransfer>
        </filter>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect x={0} y={0} width={w} height={h} fill="#fff" filter={`url(#${id}-g)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`} opacity={0.9} style={{ color: "var(--stamp)" }}>
        <rect x={l.outer.x} y={l.outer.y} width={l.outer.width} height={l.outer.height} rx={l.outer.r} fill="none" stroke="currentColor" strokeWidth={l.outer.stroke} />
        <rect x={l.inner.x} y={l.inner.y} width={l.inner.width} height={l.inner.height} rx={l.inner.r} fill="none" stroke="currentColor" strokeWidth={l.inner.stroke} />
        <text
          x={l.rowA.x}
          y={l.rowA.baseline}
          textAnchor="middle"
          fill="currentColor"
          style={{ fontFamily: "var(--font-stamp-wide)", fontWeight: 700, fontSize: l.rowA.size, letterSpacing: `${l.rowA.letterSpacingEm}em` }}
        >
          {l.rowA.text}
        </text>
        <text
          x={l.rowB.x}
          y={l.rowB.baseline}
          textAnchor="middle"
          fill="currentColor"
          style={{ fontFamily: "var(--font-stamp-condensed)", fontWeight: 780, fontSize: l.rowB.size, fontVariantNumeric: "tabular-nums" }}
        >
          {l.rowB.text}
        </text>
      </g>
    </svg>
  );
}

/** The 8px legend glyphs: a filled dot, a hollow ring, the band swatch. */
function Glyph({ kind }: { kind: "filled" | "hollow" | "band" }) {
  if (kind === "band") {
    return (
      <svg width={14} height={10} viewBox="0 0 14 10" aria-hidden="true" className="shrink-0">
        <rect x={0.5} y={0} width={13} height={10} fill="var(--chart-4)" />
        <line x1={0.5} y1={0} x2={0.5} y2={10} stroke="var(--border)" strokeWidth={1} />
        <line x1={13.5} y1={0} x2={13.5} y2={10} stroke="var(--border)" strokeWidth={1} />
      </svg>
    );
  }
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
      {kind === "filled" ? (
        <circle cx={4} cy={4} r={3.5} fill="var(--chart-3)" />
      ) : (
        <circle cx={4} cy={4} r={3.1} fill="var(--background)" stroke="var(--input)" strokeWidth={1.25} />
      )}
    </svg>
  );
}

const isAndroidTouch = () =>
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  /Android/i.test(navigator.userAgent) &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** The stamp's landing (STAMP_SPRING, scale 1.14 to 1, rotate -8 to -4 deg), or the final frame. */
function useStampLanding(play: boolean, rotate: number, delay: number) {
  const opacity = useMotionValue(play ? 0 : 1);
  const scale = useMotionValue(play ? 1.14 : 1);
  const turn = useMotionValue(play ? rotate * 2 : rotate);
  useEffect(() => {
    if (!play) {
      opacity.jump(1);
      scale.jump(1);
      turn.jump(rotate);
      return;
    }
    const controls = [
      animate(opacity, 1, { delay, duration: 0.08 }),
      animate(scale, 1, { ...STAMP_SPRING, delay }),
      animate(turn, rotate, { ...STAMP_SPRING, delay }),
    ];
    // One short buzz on Android touch screens as it lands (never on iOS, never under reduced motion).
    const buzz = window.setTimeout(
      () => {
        if (isAndroidTouch() && typeof navigator.vibrate === "function") navigator.vibrate(12);
      },
      Math.round((delay + 0.1) * 1000),
    );
    return () => {
      window.clearTimeout(buzz);
      for (const c of controls) c.stop();
    };
  }, [play, rotate, delay, opacity, scale, turn]);
  return { opacity, scale, rotate: turn };
}

/** The chart width: the container's, measured; the variant's own width until it is known. */
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

export interface MarketScaleProps {
  check: CheckView;
  /** Forces the variant; by default 9px dots from a 768px viewport (desktop), 7px below (phone). */
  variant?: Exclude<ScaleVariant, "card">;
  /** "session": the /c page, where the stamp lands once per code per browser session (CSS only, no settle). */
  landing?: "settle" | "session";
  className?: string;
}

export function MarketScale({ check, variant: forced, landing = "settle", className }: MarketScaleProps) {
  const wide = useMediaQuery(SCALE_DESKTOP_QUERY);
  const variant: "phone" | "desktop" = forced ?? (wide ? "desktop" : "phone");
  const { ref: blockRef, width } = useWidth(SCALE_METRICS[variant].width);
  const model = useMemo(() => scaleModel(check, width, { variant }), [check, width, variant]);
  if (!model) return null;
  return <Scale check={check} model={model} variant={variant} blockRef={blockRef} landing={landing} className={className} />;
}

function Scale({
  check,
  model,
  variant,
  blockRef,
  landing,
  className,
}: {
  check: CheckView;
  model: ScaleModel;
  variant: "phone" | "desktop";
  blockRef: RefObject<HTMLDivElement | null>;
  landing: "settle" | "session";
  className?: string;
}) {
  const g = model.geometry;
  const titleId = useId();
  const summaryId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const play = useSettleEntering() && landing === "settle";
  // A re-settle (after an edit) starts earlier and keeps the axis where it is.
  const at = useSettleAt();
  const resettle = useSettleShift() > 0;
  const stampMotion = useStampLanding(play, g.stamp?.rotate ?? -4, at(SETTLE_AT.stamp));
  const session = useLandOnce(check.code, landing === "session");
  const cssLanding = landing === "session" && (session === "ssr" || session === "land");

  // The selection belongs to this geometry: a new width or comparison starts with the legend.
  const [picked, setPicked] = useState<{ geometry: typeof g; dot: number } | null>(null);
  const selected = picked && picked.geometry === g ? picked.dot : null;
  const pinned = useRef(false);
  const dragging = useRef(false);
  const select = useCallback((dot: number | null) => setPicked(dot === null ? null : { geometry: g, dot }), [g]);

  // A tap outside the chart restores the legend.
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

  const pickAt = (clientX: number) => {
    const el = chartRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = rect.width > 0 ? g.width / rect.width : 1;
    select(nearestDot(g, (clientX - rect.left) * scale));
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
    // A mouse that only hovered leaves the legend as it was.
    if (e.pointerType === "mouse" && !dragging.current && !pinned.current) select(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = g.order;
    if (order.length === 0) return;
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

  const legend = legendWords(check, model);
  const dot = selected === null ? null : g.dots[selected];
  const readout = dot ? readoutText(check, dot, g.quantile !== null) : null;

  // The settle's pieces (section 2.7): inline CSS animations while it plays, nothing after. At a
  // re-settle the axis, the zone, the fulcrum and the labels keep their place (no fade, no draw).
  const fade = (t: number, ms: number) => settleAnimation(play, "mz-fade", at(t), ms);
  const axisFade = (t: number, ms: number) => settleAnimation(play && !resettle, "mz-fade", at(t), ms);
  const colCount = g.columns.length;
  const colDelay = (ci: number) => at(SETTLE_AT.dots) + (colCount > 1 ? (ci / (colCount - 1)) * 0.08 : 0);
  const half = g.dot.r - 0.625;
  const m = SCALE_METRICS[variant];
  const tickTop = g.labelTop + m.labelLane - 18;
  const axisLineY = g.axisY + m.axis / 2;
  const xMin = 16.5;
  const xMax = g.width - 16.5;
  const ds = g.diamond.size / 2;
  const f = g.fulcrum;

  return (
    <div ref={blockRef} className={cn("w-full min-w-0", className)} data-slot="market-scale-block">
      <span id={titleId} className="sr-only">
        {scaleTitle(model)}
      </span>
      <span id={summaryId} className="sr-only">
        {keepFiguresTogether(scaleSummary(check, model))}
      </span>
      <div
        ref={chartRef}
        role="group"
        tabIndex={0}
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        className="relative w-full cursor-crosshair touch-pan-y rounded-sm outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        style={{ height: g.height }}
        data-slot="market-scale"
        data-variant={variant}
        data-selected={selected ?? undefined}
      >
        <svg
          aria-hidden="true"
          width={g.width}
          height={g.height}
          viewBox={`0 0 ${g.width} ${g.height}`}
          className="absolute top-0 left-0 overflow-visible"
          data-slot="scale-svg"
        >
          <g style={settleAnimation(play, "mz-impact", at(0.74), 140, "ease-out")}>
            {/* The in-line zone: drawn first, the only overlay. */}
            <g style={axisFade(SETTLE_AT.axis, 160)} data-slot="scale-zone">
              <rect x={g.zone.x0} y={g.zone.y0} width={g.zone.x1 - g.zone.x0} height={g.zone.y1 - g.zone.y0} fill="var(--chart-4)" />
              <line x1={g.zone.x0} y1={g.zone.y0} x2={g.zone.x0} y2={g.zone.y1} stroke="var(--border)" strokeWidth={1} />
              <line x1={g.zone.x1} y1={g.zone.y0} x2={g.zone.x1} y2={g.zone.y1} stroke="var(--border)" strokeWidth={1} />
            </g>
            {/* The pin, behind the dots, with a paper halo. */}
            <g style={fade(SETTLE_AT.stamp, 100)} data-slot="scale-pin">
              <line x1={g.pin.x} y1={g.pin.y0} x2={g.pin.x} y2={g.pin.y1} stroke="var(--background)" strokeWidth={4.5} />
              <line x1={g.pin.x} y1={g.pin.y0} x2={g.pin.x} y2={g.pin.y1} stroke="var(--stamp)" strokeWidth={1.5} />
            </g>
            {g.columns.map((col, ci) => (
              <g key={`${col.side}${col.k}`} style={settleAnimation(play, "mz-drop", colDelay(ci), 120)} data-slot="scale-column">
                {col.dots.map((di) => {
                  const d = g.dots[di];
                  return d.recent ? (
                    <circle key={di} cx={d.cx} cy={d.cy} r={d.r} fill="var(--chart-3)" data-slot="scale-dot" data-recent="" />
                  ) : (
                    <circle
                      key={di}
                      cx={d.cx}
                      cy={d.cy}
                      r={half}
                      fill="var(--background)"
                      stroke="var(--input)"
                      strokeWidth={1.25}
                      data-slot="scale-dot"
                    />
                  );
                })}
              </g>
            ))}
            {dot ? (
              <circle cx={dot.cx} cy={dot.cy} r={dot.r + 3} fill="none" stroke="var(--foreground)" strokeWidth={2} data-slot="scale-ring" />
            ) : null}
            {/* The axis draws outward from the median. */}
            <g
              style={{
                transformOrigin: `${g.median.x}px ${axisLineY}px`,
                transformBox: "view-box",
                ...settleAnimation(play && !resettle, "mz-draw", at(SETTLE_AT.axis), 200),
              }}
              data-slot="scale-axis"
            >
              <line x1={16} y1={axisLineY} x2={g.width - 16} y2={axisLineY} stroke="var(--foreground)" strokeWidth={m.axis} />
              {g.ticks.map((tk) => {
                const x = Math.min(xMax, Math.max(xMin, tk.x));
                return <line key={tk.value} x1={x} y1={g.axisY + m.axis} x2={x} y2={g.axisY + m.axis + 4} stroke="var(--foreground)" strokeWidth={1} />;
              })}
            </g>
            <path
              d={`M${f.x} ${f.y} L${f.x + f.w / 2} ${f.y + f.h} L${f.x - f.w / 2} ${f.y + f.h} Z`}
              fill="var(--foreground)"
              style={axisFade(SETTLE_AT.axis, 160)}
              data-slot="scale-fulcrum"
            />
            <path
              d={`M${g.diamond.x} ${g.diamond.y - ds} L${g.diamond.x + ds} ${g.diamond.y} L${g.diamond.x} ${g.diamond.y + ds} L${g.diamond.x - ds} ${g.diamond.y} Z`}
              fill="var(--stamp)"
              style={fade(SETTLE_AT.stamp, 100)}
              data-slot="scale-diamond"
            />
          </g>
        </svg>

        {g.stamp ? (
          <motion.div
            aria-hidden="true"
            className={cn("pointer-events-none absolute", cssLanding && CSS_LANDING)}
            style={{
              left: g.stamp.cx - g.stamp.w / 2,
              top: g.stamp.cy - g.stamp.h / 2,
              width: g.stamp.w,
              height: g.stamp.h,
              opacity: stampMotion.opacity,
              scale: stampMotion.scale,
              rotate: stampMotion.rotate,
            }}
            data-slot="scale-stamp"
          >
            <CompactStamp figure={formatInt(model.ask)} variant={variant} seed={codeSeed(check.code)} />
          </motion.div>
        ) : null}

        {/* The label lane: HTML on x(), so it follows text zoom. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={axisFade(SETTLE_AT.axis, 160)} data-slot="scale-labels">
          <div
            className="absolute flex items-baseline justify-center gap-1.5 whitespace-nowrap"
            style={{ left: g.medianLabel.left, width: g.medianLabel.width, top: g.labelTop + 2 }}
            data-slot="scale-median-label"
          >
            <span className={cn("text-[14px] font-medium text-muted-foreground", variant === "desktop" ? "leading-7" : "leading-6")}>
              {COPY["scale.median"]}
            </span>
            <span className={cn("font-semibold text-foreground num", variant === "desktop" ? "text-[28px] leading-7" : "text-[24px] leading-6")}>
              {formatInt(model.median)}
            </span>
          </div>
          {g.ticks
            .filter((tk) => tk.visible)
            .map((tk) => (
              <span
                key={tk.value}
                className={cn("absolute text-[14px] leading-[14px] text-muted-foreground num", tk.label.align === "right" ? "text-right" : "text-center")}
                style={{ left: tk.label.left, width: tk.label.width, top: tickTop }}
                data-slot="scale-tick-label"
              >
                {formatInt(tk.value)}
              </span>
            ))}
        </div>
      </div>

      <SettleIn at={SETTLE_AT.rest} className="mt-2 text-[14px] leading-5 text-muted-foreground" slot="scale-legend">
        <p className="flex min-h-5 flex-wrap items-center gap-x-3" data-slot="scale-legend-1">
          {readout ? (
            <span className="text-foreground num" data-slot="scale-readout">
              {keepFiguresTogether(readout)}
            </span>
          ) : (
            <>
              <span>{keepFiguresTogether(legend.unit)}</span>
              {legend.recent ? (
                <span className="inline-flex items-center gap-1.5">
                  <Glyph kind="filled" />
                  {legend.recent}
                </span>
              ) : null}
              {legend.older ? (
                <span className="inline-flex items-center gap-1.5">
                  <Glyph kind="hollow" />
                  {legend.older}
                </span>
              ) : null}
              {legend.quantile ? <span>{legend.quantile}</span> : null}
            </>
          )}
        </p>
        <p className="flex items-center gap-1.5 num" data-slot="scale-legend-2">
          <Glyph kind="band" />
          <span>{keepFiguresTogether(legend.band)}</span>
        </p>
        <span className="sr-only" aria-live="polite" data-slot="scale-live">
          {readout ?? ""}
        </span>
      </SettleIn>
    </div>
  );
}
