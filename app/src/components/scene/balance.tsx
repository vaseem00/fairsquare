"use client";

/**
 * The balance (docs/REDESIGN.md sections 7.2 and 7.8): pure SVG, aria-hidden, ink hairlines in
 * `currentColor`. The beam rotates about the pivot from one motion value (`angle`, degrees); the pans
 * follow the beam ends by translation, so they always hang plumb. With no `angle` the balance is
 * drawn at rest, still (the home stage, the How Fairsquare compares figure, reduced motion).
 * The meaning lives in HTML around it (captions, labels, the read line, the result), never here.
 */
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useId } from "react";
import {
  DOT,
  LEFT_END,
  PAN,
  PIVOT,
  RIGHT_END,
  SLIP,
  VIEW,
  dotLayout,
  loadBox,
  panOffsets,
  trayPath,
} from "@/components/scene/balance-geometry";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** What stands on the left pan: the person's screenshot, or a paper slip for text and typed details. */
export type BalanceLoad = { kind: "image"; href: string; width: number; height: number } | { kind: "slip" };

export interface BalanceProps {
  /** The beam angle in degrees (negative tips the left pan down). Omitted: at rest, level. */
  angle?: MotionValue<number>;
  load?: BalanceLoad | null;
  /** Sale dots on the right pan: a count (all filled ink) or one flag per dot (true = hollow, left out). */
  dots?: number | readonly boolean[];
  /** Failure and partial states: every stroke turns pencil. */
  dimmed?: boolean;
  /** The left tray rim dashed (a screenshot dragged over the page). */
  dashedLeft?: boolean;
  /** The right tray rim dashed (a question is open). */
  dashedRight?: boolean;
  /**
   * "stage" (default): the full 4:5 box, so labels can sit under the pans. "figure": cropped to the
   * drawing (a static illustration with no labels, such as the How Fairsquare compares figure).
   */
  frame?: "stage" | "figure";
  /** The load drops onto the left pan and the dots drop onto the right one (off under reduced motion). */
  animated?: boolean;
  className?: string;
}

/** The figure crop: from just above the needle to just below the base. */
const FIGURE_BOX = { y: 100, h: 304 } as const;

/** The paper the documents are printed on, the same in both themes (src/lib/stamp/geometry.ts PAPER). */
const PAPER = "#F6F7F4";

function Pan({ ex, ey, dashed }: { ex: number; ey: number; dashed?: boolean }) {
  const hang = ey + PAN.rod;
  const rim = ey + PAN.rimDy;
  return (
    <g data-slot="balance-pan">
      <line x1={ex} y1={ey} x2={ex} y2={hang} strokeWidth={1.25} />
      <line x1={ex} y1={hang} x2={ex - PAN.rimDx} y2={rim} strokeWidth={1} />
      <line x1={ex} y1={hang} x2={ex + PAN.rimDx} y2={rim} strokeWidth={1} />
      <path d={trayPath(ex, ey)} strokeWidth={1.5} strokeDasharray={dashed ? "3 3" : undefined} data-dashed={dashed || undefined} />
    </g>
  );
}

function PanLoad({
  load,
  ex,
  ey,
  clipId,
  filterId,
  dimmed,
}: {
  load: BalanceLoad;
  ex: number;
  ey: number;
  clipId: string;
  filterId: string;
  /** A failure: the document turns grey and half-faded (static, never animated), so the scene reads as stopped. */
  dimmed: boolean;
}) {
  if (load.kind === "slip") {
    const x = ex - SLIP.width / 2;
    const y = ey + PAN.loadBottom - SLIP.height;
    return (
      <g data-slot="balance-slip" opacity={dimmed ? 0.5 : undefined} data-dimmed={dimmed || undefined}>
        <rect x={x} y={y} width={SLIP.width} height={SLIP.height} rx={2} fill={PAPER} stroke="var(--input)" strokeWidth={1} />
        {[14, 24, 34, 44].map((dy, i) => (
          <line
            key={dy}
            x1={x + 9}
            y1={y + dy}
            x2={x + SLIP.width - (i === 3 ? 22 : 9)}
            y2={y + dy}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
          />
        ))}
      </g>
    );
  }
  const box = loadBox({ width: load.width, height: load.height });
  const x = ex + box.x;
  const y = ey + box.y;
  return (
    <g data-slot="balance-screenshot" opacity={dimmed ? 0.5 : undefined} filter={dimmed ? `url(#${filterId})` : undefined} data-dimmed={dimmed || undefined}>
      <clipPath id={clipId}>
        <rect x={x} y={y} width={box.width} height={box.height} rx={3} />
      </clipPath>
      <rect x={x} y={y} width={box.width} height={box.height} rx={3} fill={PAPER} stroke="none" />
      <image
        href={load.href}
        x={x}
        y={y}
        width={box.width}
        height={box.height}
        preserveAspectRatio="xMidYMin slice"
        clipPath={`url(#${clipId})`}
      />
      <rect x={x} y={y} width={box.width} height={box.height} rx={3} fill="none" stroke="var(--doc-frame)" strokeWidth={1} />
    </g>
  );
}

function SaleDots({ dots, ex, ey, animated }: { dots: number | readonly boolean[]; ex: number; ey: number; animated: boolean }) {
  const flags = typeof dots === "number" ? Array.from({ length: Math.min(DOT.max, Math.max(0, dots)) }, () => false) : dots.slice(0, DOT.max);
  const at = dotLayout(flags.length);
  // Dots drop in one after another (at most 240ms for the lot); an outlier turns hollow.
  const stagger = Math.min(0.03, 0.24 / Math.max(1, flags.length));
  return (
    <g data-slot="balance-dots">
      {at.map((p, i) => {
        const hollow = flags[i];
        const common = {
          cx: ex + p.x,
          cy: ey + p.y,
          r: DOT.r,
          fill: "currentColor",
          fillOpacity: hollow ? 0 : 1,
          stroke: hollow ? "var(--input)" : "none",
          strokeWidth: 1.25,
          className: "transition-[fill-opacity] duration-160",
          "data-hollow": hollow ? "" : undefined,
        };
        return animated ? (
          <motion.circle
            key={i}
            {...common}
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: [...EASE_OUT], delay: i * stagger }}
          />
        ) : (
          <circle key={i} {...common} />
        );
      })}
    </g>
  );
}

export function Balance({
  angle,
  load = null,
  dots = 0,
  dimmed = false,
  dashedLeft = false,
  dashedRight = false,
  frame = "stage",
  animated = false,
  className,
}: BalanceProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `balance-clip-${rawId}`;
  const filterId = `balance-grey-${rawId}`;
  const still = useMotionValue(0);
  const a = angle ?? still;
  const lx = useTransform(a, (d) => panOffsets(d).left.x);
  const ly = useTransform(a, (d) => panOffsets(d).left.y);
  const rx = useTransform(a, (d) => panOffsets(d).right.x);
  const ry = useTransform(a, (d) => panOffsets(d).right.y);

  return (
    <svg
      viewBox={frame === "figure" ? `0 ${FIGURE_BOX.y} ${VIEW.w} ${FIGURE_BOX.h}` : `0 0 ${VIEW.w} ${VIEW.h}`}
      aria-hidden="true"
      focusable="false"
      data-balance=""
      data-dimmed={dimmed || undefined}
      className={cn(
        "block h-auto w-full text-foreground transition-colors duration-(--dur-base) data-dimmed:text-muted-foreground",
        className,
      )}
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* Post and base */}
        <line x1={PIVOT.x} y1={PIVOT.y + 6} x2={PIVOT.x} y2={396} strokeWidth={1.5} />
        <line x1={132} y1={396} x2={228} y2={396} strokeWidth={2} />

        {/* The pans hang from the beam ends: translated, never rotated. */}
        <motion.g style={{ x: lx, y: ly }}>
          <Pan ex={LEFT_END.x} ey={LEFT_END.y} dashed={dashedLeft} />
          {load ? (
            animated ? (
              // The screenshot (or the slip) drops onto the pan: y −24 to 0, opacity 0 to 1, 280ms.
              <motion.g
                key={load.kind === "image" ? load.href : "slip"}
                initial={{ y: -24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.28, ease: [...EASE_OUT] }}
              >
                <PanLoad load={load} ex={LEFT_END.x} ey={LEFT_END.y} clipId={clipId} filterId={filterId} dimmed={dimmed} />
              </motion.g>
            ) : (
              <PanLoad load={load} ex={LEFT_END.x} ey={LEFT_END.y} clipId={clipId} filterId={filterId} dimmed={dimmed} />
            )
          ) : null}
        </motion.g>
        <motion.g style={{ x: rx, y: ry }}>
          <Pan ex={RIGHT_END.x} ey={RIGHT_END.y} dashed={dashedRight} />
          <SaleDots dots={dots} ex={RIGHT_END.x} ey={RIGHT_END.y} animated={animated} />
        </motion.g>

        {/* The beam: the invisible rect makes the group's box centre the pivot, so it rotates about it. */}
        <motion.g style={{ rotate: a, originX: 0.5, originY: 0.5 }} data-slot="balance-beam">
          <rect x={LEFT_END.x} y={PIVOT.y - 24} width={RIGHT_END.x - LEFT_END.x} height={48} fill="none" stroke="none" />
          <line x1={LEFT_END.x} y1={PIVOT.y} x2={RIGHT_END.x} y2={PIVOT.y} strokeWidth={2} />
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y - 24} strokeWidth={1.25} />
          <circle cx={LEFT_END.x} cy={LEFT_END.y} r={3} className="fill-background" strokeWidth={1.25} />
          <circle cx={RIGHT_END.x} cy={RIGHT_END.y} r={3} className="fill-background" strokeWidth={1.25} />
        </motion.g>
        <circle cx={PIVOT.x} cy={PIVOT.y} r={4} className="fill-background" strokeWidth={1.5} />
      </g>
    </svg>
  );
}
