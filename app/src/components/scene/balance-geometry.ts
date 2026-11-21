/**
 * The balance's geometry (docs/REDESIGN.md section 7.2): a hairline instrument in a 360 x 450 (4:5)
 * viewBox. The beam pivots at (180, 132) with 120 units of arm; the pans hang plumb from the beam
 * ends and are translated, never rotated. The listing (left) pan goes down when its price per sq ft
 * is above the median. Pure numbers: no React, no DOM.
 */

export const VIEW = { w: 360, h: 450 } as const;
export const PIVOT = { x: 180, y: 132 } as const;
export const ARM = 120;
/** Degrees at full tilt. */
export const MAX_TILT = 9;
/** |diff| at which the tilt is full (30%). */
export const FULL_AT = 0.3;
/** Beam ends at rest (the pans hang from these). */
export const LEFT_END = { x: PIVOT.x - ARM, y: PIVOT.y } as const;
export const RIGHT_END = { x: PIVOT.x + ARM, y: PIVOT.y } as const;

/** The pan below a beam end E: rod, strings and tray, as offsets from E. */
export const PAN = {
  rod: 18,
  rimDx: 48,
  rimDy: 150,
  /** The tray's quadratic control point (its lowest point is half way: E.y + 158). */
  bowlDy: 166,
  /** Where a load stands (its bottom edge). */
  loadBottom: 146,
  /** The bottom row of sale dots. */
  dotsBottom: 144,
} as const;

export const DOT = { r: 3.6, spacing: 9.5, rows: [9, 8, 7], max: 24 } as const;
export const LOAD = { width: 60, maxHeight: 110 } as const;
/** The paper slip for pasted text and typed details. */
export const SLIP = { width: 52, height: 68 } as const;

/** Degrees for a comparison. SVG rotation is clockwise-positive, so the listing (left) pan goes down for diff > 0. */
export function angleFor(diff: number | null): number {
  if (diff === null || !Number.isFinite(diff)) return 0;
  return -Math.max(-1, Math.min(1, diff / FULL_AT)) * MAX_TILT;
}

/** Beam end offsets from their rest positions for a beam angle in degrees. */
export function panOffsets(deg: number) {
  const a = (deg * Math.PI) / 180;
  const dx = ARM * (1 - Math.cos(a));
  const dy = ARM * Math.sin(a);
  return { left: { x: dx, y: -dy }, right: { x: -dx, y: dy } };
}

/** The pan's tray as an SVG path for a beam end at (ex, ey). */
export function trayPath(ex: number, ey: number): string {
  const y = ey + PAN.rimDy;
  return `M ${ex - PAN.rimDx} ${y} Q ${ex} ${ey + PAN.bowlDy} ${ex + PAN.rimDx} ${y}`;
}

/**
 * Sale dot centres for `n` dots (capped at 24), relative to the pan's beam end: a pyramid of rows of
 * 9, 8 and 7, filled from the bottom row, each row centred, the bottom row at E.y + 144.
 */
export function dotLayout(n: number): Array<{ x: number; y: number }> {
  const count = Math.max(0, Math.min(DOT.max, Math.floor(n)));
  const step = DOT.spacing * 0.88; // rows nest like stacked coins
  const out: Array<{ x: number; y: number }> = [];
  let left = count;
  DOT.rows.forEach((size, row) => {
    const k = Math.min(size, left);
    left -= k;
    const width = (k - 1) * DOT.spacing;
    for (let i = 0; i < k; i++) out.push({ x: -width / 2 + i * DOT.spacing, y: PAN.dotsBottom - row * step });
  });
  return out;
}

/** The screenshot's box on the left pan: 60 wide, at most 110 tall, standing on the tray. */
export function loadBox(size: { width: number; height: number } | null): { x: number; y: number; width: number; height: number } {
  const ratio = size && size.width > 0 ? size.height / size.width : 2;
  const height = Math.min(LOAD.width * ratio, LOAD.maxHeight);
  return { x: -LOAD.width / 2, y: PAN.loadBottom - height, width: LOAD.width, height };
}
