/**
 * Advance widths of the two static stamp fonts (DESIGN.md section 2.2), read once from
 * `src/assets/fonts/archivo-stamp-{wide,condensed}.woff` (hmtx via cmap, 1000 units per em).
 * The stamp layout measures text with these, so the SVG (server and client), the canvas card and
 * the OG image fit and centre every line identically, before any font has loaded.
 * Client-safe and pure.
 */

export type StampFace = "wide" | "condensed";

/** Font-wide vertical metrics shared by both instances (units per em 1000). */
export const STAMP_FONT_METRICS = { unitsPerEm: 1000, ascender: 878, descender: -210, capHeight: 686 } as const;

const WIDE: Readonly<Record<string, number>> = {
  " ": 313, "%": 1107, "(": 358, ")": 358, "+": 727, ",": 327, "-": 416, ".": 327, "/": 307, ":": 325,
  "0": 769, "1": 683, "2": 765, "3": 772, "4": 754, "5": 772, "6": 774, "7": 705, "8": 786, "9": 774,
  A: 918, B: 903, C: 944, D: 934, E: 865, F: 793, G: 1013, H: 975, I: 357, J: 713, K: 925, L: 730, M: 1126,
  N: 974, O: 1016, P: 858, Q: 1016, R: 925, S: 857, T: 828, U: 954, V: 880, W: 1200, X: 924, Y: 884, Z: 843,
  "−": 727, "&": 955, "'": 246,
};

const CONDENSED: Readonly<Record<string, number>> = {
  " ": 133, "%": 758, "(": 364, ")": 364, "+": 536, ",": 233, "-": 260, ".": 233, "/": 277, ":": 245,
  "0": 465, "1": 415, "2": 459, "3": 464, "4": 455, "5": 466, "6": 465, "7": 428, "8": 456, "9": 465,
  A: 547, B: 535, C: 555, D: 555, E: 503, F: 445, G: 590, H: 561, I: 258, J: 465, K: 555, L: 452, M: 722,
  N: 565, O: 597, P: 518, Q: 597, R: 549, S: 503, T: 500, U: 553, V: 523, W: 758, X: 536, Y: 531, Z: 507,
  "−": 536, "&": 588, "'": 211,
};

const TABLES: Record<StampFace, Readonly<Record<string, number>>> = { wide: WIDE, condensed: CONDENSED };
/** Fallback advance for a character outside the subset (an average capital). */
const FALLBACK: Record<StampFace, number> = { wide: 900, condensed: 540 };

/** Advance of one character in em. Lowercase letters are measured as their capitals. */
export function advanceEm(ch: string, face: StampFace): number {
  const table = TABLES[face];
  const u = table[ch] ?? table[ch.toUpperCase()] ?? FALLBACK[face];
  return u / STAMP_FONT_METRICS.unitsPerEm;
}

/**
 * Width of `text` at `size` px with `letterSpacing` px added after every character but the last
 * (the trailing spacing is not part of the ink, so centring ignores it).
 */
export function measureStampText(text: string, face: StampFace, size: number, letterSpacing = 0): number {
  const chars = [...text];
  let em = 0;
  for (const ch of chars) em += advanceEm(ch, face);
  return em * size + letterSpacing * Math.max(0, chars.length - 1);
}
