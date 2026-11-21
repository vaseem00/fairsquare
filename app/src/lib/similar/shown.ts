/**
 * Whether a stored similar-buildings comparison may be shown (REAL_DATA.md section 15.3). Pure and
 * client-safe. The server's rule decides first (`compareSimilar`); this is the same rule's last line
 * of defence on everything that draws or words a range (the section, the scale, the card, the preview
 * image, the share text), so an entry that should not have been stored as shown still shows nothing:
 * - no range without both ends, an outcome and a tier;
 * - never from other buildings alone: something must come from the building itself;
 * - never from the building's 1 to 4 sales of the 12 months alone: those are the sales the first
 *   tier has just called too few, so "more registered sales" would be untrue.
 * The project route (scenario "project", REAL_DATA.md section 15.8) is the one exception to "something
 * must come from the building itself": the building is not in the data. It shows only with its project
 * named, at least one other building of it, nothing claimed from the building, and constants that have
 * the route (PROJECT_ROUTE_MIN_VERSION).
 */
import { PROJECT_ROUTE_MIN_VERSION } from "@/lib/similar/project-version";
import type { SimilarView } from "@/lib/types";

export type ShownSimilar = SimilarView & {
  shown: true;
  rangeLowPsf: number;
  rangeHighPsf: number;
  verdict: NonNullable<SimilarView["verdict"]>;
  tier: NonNullable<SimilarView["tier"]>;
};

/** True when the range read other buildings (the reference of step 2). */
export function similarReadsOthers(s: Pick<SimilarView, "comparableBuildings" | "level">): boolean {
  return s.comparableBuildings > 0 && s.level !== null;
}

export function shownSimilar(s: SimilarView | null | undefined): ShownSimilar | null {
  if (!s || !s.shown || s.rangeLowPsf === null || s.rangeHighPsf === null || s.verdict === null || s.tier === null) return null;
  const { ownSales, olderSales, otherBedroomSales } = s.evidence;
  if (s.scenario === "project") {
    const ok = s.modelVersion >= PROJECT_ROUTE_MIN_VERSION && s.project !== null && s.project.name.trim() !== "" && s.level === "project" && s.comparableBuildings > 0 && ownSales + olderSales + otherBedroomSales === 0;
    return ok ? (s as ShownSimilar) : null;
  }
  if (ownSales + olderSales + otherBedroomSales <= 0) return null;
  if (ownSales > 0 && olderSales === 0 && otherBedroomSales === 0 && !similarReadsOthers(s)) return null;
  return s as ShownSimilar;
}
