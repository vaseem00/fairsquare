/**
 * Marketing names of DLD buildings (REAL_DATA.md section 5): a short list kept by hand, for buildings
 * that are sold under a name DLD does not register. Each entry names the building exactly as DLD
 * writes it, with its DLD area, the names listings use for it, and the evidence. The open-data load
 * adds every name as an alias of the building (source `import`), next to the aliases made from the
 * DLD names (`buildingAliases`), so the matcher finds the building from a listing's own words.
 *
 * Rules for an entry:
 * - only with evidence that the marketed name is that DLD building, tower for tower (say where it
 *   comes from in `evidence`);
 * - one alias is an exact name: a typed name equal to it selects the building. A name that only hints
 *   at a building ("Marriott Executive Apartments Al Barsha South", a hotel name that property portals
 *   show beside these towers) is NOT listed: the matcher has no "possible only" alias, so it would
 *   select the building outright;
 * - a name that is an alias of two buildings selects neither (the matcher then asks), so a tower
 *   number or letter is always part of the name.
 *
 * Taking effect: `syncMarketNames` (load.ts) runs at every server start, after the snapshot check. It
 * adds what is missing when this list changed since the last start (app_meta `market_names_sha`), also
 * when the snapshot itself is unchanged, and again after every snapshot load. It only adds: a name
 * removed from this list stays in `building_aliases` until it is deleted there by hand.
 */
import { createHash } from "node:crypto";
import { normalise } from "@/lib/domain/normalise";
import { cleanText } from "./fields";
import { dldKey } from "./identity";

export interface MarketName {
  /** The building as DLD writes it, and its DLD area (together: `buildings.dld_key`). */
  building: string;
  areaDld: string;
  /** The names listings use for it. */
  names: readonly string[];
  /** Where the link between the two names comes from. */
  evidence: string;
}

export const MARKET_NAMES: readonly MarketName[] = Object.freeze([
  {
    building: "Three Towers A-1",
    areaDld: "Al Barshaa South Second",
    names: ["Marriott Residences Tower 1", "Marriott Residences 1", "Marriott Residences Tower A"],
    evidence: "Property listings, Nov 2026: DLD's Three Towers A-1 and B-2 in Dubai Science Park are sold as Marriott Residences, towers 1 and 2 (A-1 is Tower 1).",
  },
  {
    building: "Three Towers B-2",
    areaDld: "Al Barshaa South Second",
    names: ["Marriott Residences Tower 2", "Marriott Residences 2", "Marriott Residences Tower B"],
    evidence: "Property listings, Nov 2026: DLD's Three Towers A-1 and B-2 in Dubai Science Park are sold as Marriott Residences, towers 1 and 2 (B-2 is Tower 2).",
  },
]);

export interface MarketAlias {
  dldKey: string;
  raw: string;
  norm: string;
}

/** The aliases of the list: one row per building and distinct normalised name. */
export function marketAliases(list: readonly MarketName[] = MARKET_NAMES): MarketAlias[] {
  const out: MarketAlias[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const key = dldKey(m.building, m.areaDld);
    for (const name of m.names) {
      const raw = cleanText(name);
      const norm = normalise(raw);
      if (!norm || seen.has(`${key}\u0000${norm}`)) continue;
      seen.add(`${key}\u0000${norm}`);
      out.push({ dldKey: key, raw, norm });
    }
  }
  return out;
}

/** What app_meta.market_names_sha holds: the SHA-256 of the aliases of the list. */
export function marketNamesSha(list: readonly MarketName[] = MARKET_NAMES): string {
  return createHash("sha256").update(JSON.stringify(marketAliases(list))).digest("hex");
}
