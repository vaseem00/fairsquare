/**
 * The marketing names kept by hand (src/lib/ingest/market-names.ts, REAL_DATA.md section 5): what the
 * list holds, how its aliases are made, and that the matcher selects the DLD building from a listing's
 * own words once they are aliases. The load that adds them is in tests/db/nearby.test.ts.
 */
import { describe, expect, it } from "vitest";
import { findCandidates, preselect, type AliasRow } from "@/lib/domain/match";
import { normalise } from "@/lib/domain/normalise";
import { buildingAliases, displayArea, displayName, dldKey } from "@/lib/ingest/identity";
import { MARKET_NAMES, marketAliases, marketNamesSha } from "@/lib/ingest/market-names";

describe("market names", () => {
  it("lists the Marriott Residences towers of Dubai Science Park under their DLD names, tower for tower", () => {
    const byBuilding = new Map(MARKET_NAMES.map((m) => [m.building, m]));
    expect(byBuilding.get("Three Towers A-1")).toMatchObject({ areaDld: "Al Barshaa South Second", names: ["Marriott Residences Tower 1", "Marriott Residences 1", "Marriott Residences Tower A"] });
    expect(byBuilding.get("Three Towers B-2")).toMatchObject({ areaDld: "Al Barshaa South Second", names: ["Marriott Residences Tower 2", "Marriott Residences 2", "Marriott Residences Tower B"] });
    // Every entry says where the link comes from, and names a tower: no name is an alias of two buildings.
    for (const m of MARKET_NAMES) expect(m.evidence.length, m.building).toBeGreaterThan(20);
    const norms = marketAliases().map((a) => a.norm);
    expect(new Set(norms).size).toBe(norms.length);
    // The hotel name that portals show beside these towers is a hint, not a name of one tower: not listed.
    expect(norms.some((n) => n.includes("executive"))).toBe(false);
  });

  it("makes one alias per building and normalised name, keyed by dld_key", () => {
    const list = [{ building: "TEST TOWER A-1", areaDld: "Test Area", names: ["Test Grand Tower 1", "test  grand tower 1", "Test Grand 1", ""], evidence: "test" }];
    expect(marketAliases(list)).toEqual([
      { dldKey: dldKey("TEST TOWER A-1", "Test Area"), raw: "Test Grand Tower 1", norm: normalise("Test Grand Tower 1") },
      { dldKey: dldKey("TEST TOWER A-1", "Test Area"), raw: "Test Grand 1", norm: normalise("Test Grand 1") },
    ]);
    expect(marketNamesSha(list)).toMatch(/^[0-9a-f]{64}$/);
    expect(marketNamesSha(list)).not.toBe(marketNamesSha([{ ...list[0], names: ["Test Grand Tower 2"] }]));
    expect(marketNamesSha()).toBe(marketNamesSha(MARKET_NAMES));
  });

  it("with the aliases, 'Marriott Residences Tower 2' selects Three Towers B-2 and never May Residence Tower 2", () => {
    const rows: AliasRow[] = [];
    const add = (id: number, raw: string, areaDld: string, extra: string[] = []) => {
      const name = displayName(raw);
      for (const a of buildingAliases([raw], name)) rows.push({ buildingId: id, aliasNorm: a.norm, name, area: displayArea(areaDld) });
      for (const e of extra) rows.push({ buildingId: id, aliasNorm: normalise(e), name, area: displayArea(areaDld) });
    };
    const names = (b: string) => MARKET_NAMES.find((m) => m.building === b)?.names ?? [];
    add(1, "Three Towers A-1", "Al Barshaa South Second", [...names("Three Towers A-1")]);
    add(2, "Three Towers B-2", "Al Barshaa South Second", [...names("Three Towers B-2")]);
    add(3, "May Residence Tower 1", "Al Barsha South Fourth");
    add(4, "May Residence Tower 2", "Al Barsha South Fourth");
    for (const [typed, id] of [["Marriott Residences Tower 2", 2], ["Marriott Residences 2", 2], ["Marriott Residences Tower B", 2], ["Marriott Residences Tower 1", 1], ["marriott residences tower a", 1]] as const) {
      const cands = findCandidates(typed, rows, "Dubai Science Park");
      expect(cands[0], typed).toMatchObject({ buildingId: id, strength: "strong" });
      expect(preselect(cands), typed).toBe(id);
    }
    // Without the aliases nothing is selected: the name has a distinctive word no DLD name has.
    const bare = rows.filter((r) => !r.aliasNorm.includes("marriott"));
    expect(preselect(findCandidates("Marriott Residences Tower 2", bare, "Dubai Science Park"))).toBeNull();
    // A name with no tower names neither building for sure.
    expect(preselect(findCandidates("Marriott Residences", rows, "Dubai Science Park"))).toBeNull();
  });
});
