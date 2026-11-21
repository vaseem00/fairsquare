/**
 * The first constants version with the project route (REAL_DATA.md section 15.8). Client-safe (no
 * JSON imports), so `shownSimilar` can read it. A stored "project" entry of an older version cannot
 * exist; one that claims it is not shown. Entries of versions 2 and 3 stay valid: the route adds a
 * scenario and changes nothing they show.
 */
export const PROJECT_ROUTE_MIN_VERSION = 4;
