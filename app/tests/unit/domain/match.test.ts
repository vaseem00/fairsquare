import { describe, expect, it } from "vitest";
import { TEST_ALIAS_ROWS } from "../../fixtures/api-fixtures";
import {
  MATCH_FLOOR,
  STRONG_MATCH,
  findCandidates,
  matchedChars,
  needsAreaCheck,
  needsTowerCheck,
  preselect,
  normalise,
  prepareAliasRows,
  scoreAlias,
  similarity,
  type AliasRow,
  type Candidate,
} from "@/lib/domain";
import { buildingAliases, displayName } from "@/lib/ingest/identity";

const rows = TEST_ALIAS_ROWS;
const names = (c: Candidate[]) => c.map((x) => x.name);
const idOf = (name: string) => rows.find((r) => r.name === name)!.buildingId;

/** Every row scored in full, no pruning: the result the bound-and-prune search must reproduce. */
function fullScan(query: string, rows: readonly AliasRow[], areaHint: string | null): Candidate[] {
  const q = normalise(query.slice(0, 120));
  if (!q) return [];
  const hint = areaHint ? normalise(areaHint) : "";
  const best = new Map<number, { row: AliasRow; raw: number; exact: number }>();
  for (const r of rows) {
    const areaNorm = normalise(r.area);
    const bonus = hint && areaNorm.includes(hint) ? 0.05 : 0;
    const withArea = `${r.aliasNorm} ${areaNorm}`.trim();
    const a = scoreAlias(q, r.aliasNorm);
    const b = scoreAlias(q, withArea);
    const s = Math.max(a, b) + bonus;
    // A numbered sibling of the top match shows from 0.37 (the floor less the number rule's 0.25).
    if (!(s >= MATCH_FLOOR - 0.25)) continue;
    // How exact: the character similarity of the form that scored.
    const exact = Math.max(a >= b ? similarity(q, r.aliasNorm) : 0, b >= a ? similarity(q, withArea) : 0);
    const prev = best.get(r.buildingId);
    if (!prev || s > prev.raw || (s === prev.raw && exact > prev.exact)) best.set(r.buildingId, { row: r, raw: s, exact });
  }
  // Ties: the more exact match first, then the name, then the lower building id.
  const sorted = [...best.values()].sort(
    (x, y) => y.raw - x.raw || y.exact - x.exact || x.row.name.localeCompare(y.row.name) || x.row.buildingId - y.row.buildingId,
  );
  const shown = sorted.filter((x) => x.raw >= MATCH_FLOOR).slice(0, 3);
  // With a number in the query, the best numbered sibling of the top building always shows.
  const key = (name: string) => normalise(name).split(" ").filter((w) => w && !/^\d+$/.test(w)).join(" ");
  const sibling = (x: AliasRow, y: AliasRow) =>
    y.buildingId !== x.buildingId && key(y.name) === key(x.name) && normalise(y.name) !== normalise(x.name);
  const lead = shown[0];
  if (q.split(" ").some((w) => /^\d+$/.test(w)) && lead && key(lead.row.name) && !shown.some((s) => sibling(lead.row, s.row))) {
    const s = sorted.find((x) => sibling(lead.row, x.row));
    if (s) shown.splice(Math.min(shown.length, 2), 1, s);
  }
  return shown.map(({ row, raw }) => ({
    buildingId: row.buildingId,
    name: row.name,
    area: row.area,
    score: Math.round(raw * 1000) / 1000,
    strength: raw >= STRONG_MATCH ? "strong" : "possible",
  }));
}

describe("similarity", () => {
  it("matches difflib ratio", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "x")).toBe(0);
    expect(similarity("x", "")).toBe(0);
    expect(similarity("abcd", "bcde")).toBeCloseTo(0.75, 6);
    expect(matchedChars("mockup crest", "mockup crest 2")).toBe(12);
    expect(matchedChars("abc", "xyz")).toBe(0);
  });

  it("handles a 120-char query without a stack overflow", () => {
    const q = "mockup crest tower ".repeat(10).slice(0, 120);
    expect(similarity(q, "mockup crest tower")).toBeGreaterThan(0);
    expect(findCandidates("Mockup Crest Tower ".repeat(20), rows).length).toBeGreaterThanOrEqual(0);
  });
});

describe("matching at real-data scale (REAL_DATA.md section 5)", () => {
  /** The original recursive Ratcliff–Obershelp, kept here as the reference. */
  function reference(a: string, b: string): number {
    if (!a || !b) return 0;
    let best = 0;
    let ai = 0;
    let bi = 0;
    let prev = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array<number>(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) {
            best = cur[j];
            ai = i - best;
            bi = j - best;
          }
        }
      }
      prev = cur;
    }
    if (best === 0) return 0;
    return best + reference(a.slice(0, ai), b.slice(0, bi)) + reference(a.slice(ai + best), b.slice(bi + best));
  }

  it("matchedChars equals the reference, also for strings longer than its buffers", () => {
    const pairs: Array<[string, string]> = [
      ["mockup crest tower", "mockup crest tower 2"],
      ["abcxabcyabc", "abcabc"],
      ["fake vista res", "fake vista residences jumeirah village circle"],
      ["aaaa", "aa"],
      ["test tower 2b", "test tower b2"],
      ["x".repeat(300), `${"x".repeat(150)}y${"x".repeat(200)}`],
    ];
    for (const [a, b] of pairs) {
      expect(matchedChars(a, b)).toBe(reference(a, b));
      expect(matchedChars(b, a)).toBe(reference(b, a));
    }
  });

  it("skipping hopeless aliases never changes the result", () => {
    // Characters outside a-z, 0-9 and space only occur in hand-made rows; they still count.
    const big: AliasRow[] = [
      ...rows,
      ...Array.from({ length: 400 }, (_, i) => ({
        buildingId: 1000 + i,
        aliasNorm: `zz ${i} qq`,
        name: `Zz ${i} Qq`,
        area: i % 2 ? "Test Area North" : "",
      })),
      { buildingId: 2000, aliasNorm: "mockup-crest", name: "Mockup-Crest", area: "Dubai Marina" },
    ];
    for (const [q, hint] of [
      ["Mockup Crest", "Dubai Marina"],
      ["zz 12 qq", null],
      ["zz 7", "north"],
      ["Fake Vista Res", "JVC"],
      ["Dummyside Hts 2", null],
      ["mockup-crest", null],
    ] as Array<[string, string | null]>) {
      expect(findCandidates(q, big, hint), `${q} | ${hint}`).toEqual(fullScan(q, big, hint));
    }
  });

  it("handles empty input like before: empty strings, an empty alias, no query", () => {
    expect(matchedChars("", "x")).toBe(0);
    expect(matchedChars("x", "")).toBe(0);
    expect(findCandidates("", rows)).toEqual([]);
    expect(findCandidates(null as unknown as string, rows)).toEqual([]);
    expect(findCandidates("---", rows)).toEqual([]);
    // An alias that normalises to nothing is scored on its area only (as before).
    const odd: AliasRow[] = [{ buildingId: 7, aliasNorm: "", name: "Odd", area: "Test Area North" }];
    expect(findCandidates("Test Area North", odd).map((c) => c.buildingId)).toEqual([7]);
    expect(findCandidates("Test Area North", [{ ...odd[0], area: "" }])).toEqual([]);
  });

  it("reads number words as numbers, so 'One' never pre-selects the 'Two' tower (real DLD pattern)", () => {
    const set: AliasRow[] = ["Fake Peninsula Two", "Fake Peninsula Three", "Fake Peninsula One - Tower 1"].map((name, i) => ({
      buildingId: 500 + i,
      aliasNorm: normalise(name),
      name,
      area: "Business Bay",
    }));
    for (const q of ["Fake Peninsula One", "Fake Peninsula 1"]) {
      const c = findCandidates(q, set);
      expect(c[0]?.name, q).toBe("Fake Peninsula One - Tower 1");
      expect(preselect(c), q).not.toBe(500);
      expect(preselect(c), q).not.toBe(501);
    }
    expect(findCandidates("Fake Peninsula Two", set)[0]?.name).toBe("Fake Peninsula Two");
  });

  it("reuses the prepared rows of an alias array and rebuilds them when the array grows", () => {
    const list: AliasRow[] = rows.slice(0, 3).map((r) => ({ ...r }));
    expect(findCandidates("Nowhere Point", list)).toEqual([]);
    list.push({ buildingId: 99, aliasNorm: normalise("Nowhere Point Tower"), name: "Nowhere Point Tower", area: "Dubai Creek Harbour" });
    expect(findCandidates("Nowhere Point", list).map((c) => c.buildingId)).toEqual([99]);
    expect(findCandidates("Nowhere Point", list).map((c) => c.buildingId)).toEqual([99]);
  });

  it("answers one query over 15,000 aliases in well under 50 ms", () => {
    const many: AliasRow[] = Array.from({ length: 15_000 }, (_, i) => {
      const name = `Test ${["Crest", "Vista", "Gate", "Park", "View"][i % 5]} ${["Tower", "Residences", "Heights"][i % 3]} ${i}`;
      return { buildingId: i + 1, aliasNorm: normalise(name), name, area: ["Dubai Marina", "Business Bay", "Al Jaddaf"][i % 3] };
    });
    const target = many[15]; // "Test Crest Tower 15", Dubai Marina
    findCandidates(target.name, many, target.area); // builds the prepared rows once
    const t0 = performance.now();
    const c = findCandidates(target.name, many, target.area);
    const ms = performance.now() - t0;
    expect(c[0]).toMatchObject({ buildingId: target.buildingId, name: "Test Crest Tower 15", strength: "strong" });
    expect(ms).toBeLessThan(50);
  });
});

/**
 * REAL_DATA.md section 5: "under 50 ms for one query with 15,000 aliases". A deterministic synthetic
 * set shaped like DLD names (made-up syllable words, the generic suffixes, tower numbers, a "THE"
 * variant for half the buildings, 120 areas), so many aliases share letters and words: the case a
 * character-count bound alone prunes worst.
 */
/** True in `vitest run --coverage`: Vitest's worker state carries the serialised config. */
function coverageOn(): boolean {
  const worker = (globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } }).__vitest_worker__;
  return worker?.config?.coverage?.enabled === true;
}

describe("findCandidates at 15,000 aliases (branch and bound)", () => {
  let seed = 20_261_118;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const SYLLABLES = ["zor", "qua", "vel", "mib", "tarn", "lox", "pre", "dun", "kai", "sef", "ulm", "bry", "nok", "fiv", "gar", "hep", "jol", "wex"];
  const word = () => Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(SYLLABLES)).join("");
  const SUFFIX = ["TOWER", "RESIDENCES", "HEIGHTS", "", "", "BUILDING", "APARTMENTS", "COURT", "VIEW"];
  const AREAS = Array.from({ length: 120 }, () => `Test ${word()} ${pick(["First", "Second", "South", "North", ""])}`.trim());
  const big: AliasRow[] = [];
  for (let id = 1; big.length < 15_000; id++) {
    const base = `${word().toUpperCase()} ${rand() < 0.5 ? word().toUpperCase() : ""}`.trim();
    const name = `${base} ${pick(SUFFIX)}${rand() < 0.3 ? ` ${1 + Math.floor(rand() * 9)}` : ""}`.trim();
    const area = pick(AREAS);
    big.push({ buildingId: id, aliasNorm: normalise(name), name, area });
    if (rand() < 0.5) big.push({ buildingId: id, aliasNorm: normalise(`THE ${name}`), name, area });
  }
  big.length = 15_000;
  // Two buildings with the same name in different areas: equal scores, ordered by name (then kept stable).
  big[200] = { ...big[200], name: big[100].name, aliasNorm: big[100].aliasNorm };

  const queries: Array<[string, string | null]> = [[big[100].name, null], [big[100].name, big[200].area]];
  for (let i = 0; i < 120; i++) {
    const r = pick(big);
    const kind = i % 6;
    const q =
      kind === 0
        ? r.name
        : kind === 1
          ? r.name.slice(0, 6 + Math.floor(rand() * 6))
          : kind === 2
            ? r.name.replace(/[AEIOU]/, "X")
            : kind === 3
              ? r.name.replace(" ", "")
              : kind === 4
                ? `${r.name} ${r.area}`
                : `${word()} ${word()}`;
    queries.push([q, rand() < 0.4 ? r.area : null]);
  }

  it("returns exactly what scoring every alias returns (names, order, scores, strengths)", { timeout: 120_000 }, () => {
    prepareAliasRows(big);
    // The full scan is slow (that is the point): 38 queries, every kind several times.
    for (const [q, hint] of queries.slice(0, 38)) {
      expect(findCandidates(q, big, hint), `${q} | ${hint}`).toEqual(fullScan(q, big, hint));
    }
  });

  it("keeps a building's best alias when a later alias (lower bound) scores higher", () => {
    // "MOCKUP TSERC" has the same letters as the query (bound 1) but scores lower than
    // "MOCKUP CRESTS", which is scored after it; building 1 must move up in the top 3.
    const area = "Test Area";
    const rows: AliasRow[] = [
      { buildingId: 1, aliasNorm: normalise("MOCKUP TSERC"), name: "MOCKUP CRESTS", area },
      { buildingId: 1, aliasNorm: normalise("MOCKUP CRESTS"), name: "MOCKUP CRESTS", area },
      { buildingId: 2, aliasNorm: normalise("MOCKUP CRESTLINE"), name: "MOCKUP CRESTLINE", area },
      { buildingId: 3, aliasNorm: normalise("MOCKUP CRESTING"), name: "MOCKUP CRESTING", area },
      { buildingId: 4, aliasNorm: normalise("MOCKUP CRESTVIEW"), name: "MOCKUP CRESTVIEW", area },
    ];
    const got = findCandidates("Mockup Crest", rows);
    expect(got).toEqual(fullScan("Mockup Crest", rows, null));
    expect(got[0]).toMatchObject({ buildingId: 1, score: Math.round(scoreAlias("mockup crest", "mockup crests") * 1000) / 1000 });
  });

  it("answers each query in under 50 ms once the alias rows are prepared", () => {
    const t0 = performance.now();
    prepareAliasRows(big);
    const prepareMs = performance.now() - t0;
    // The one-off preparation runs when the alias cache loads, never on a person's query.
    expect(prepareMs).toBeLessThan(1000);
    for (const [q, hint] of queries.slice(0, 5)) findCandidates(q, big, hint); // JIT warm-up
    const times = queries.slice(0, 60).map(([q, hint]) => {
      let ms = Infinity;
      for (let k = 0; k < 3; k++) {
        const t = performance.now();
        findCandidates(q, big, hint);
        ms = Math.min(ms, performance.now() - t);
      }
      return ms;
    });
    const sorted = [...times].sort((a, b) => a - b);
    const shown = sorted.map((t) => t.toFixed(1)).join(" ");
    if (coverageOn()) {
      // V8 precise coverage counts every block, which makes this loop about three times slower
      // (median about 24 ms here). Timing is checked at full speed by `npm test`; instrumented,
      // the typical query must still fit the spec's 50 ms.
      expect(sorted[sorted.length >> 1], shown).toBeLessThan(50);
      return;
    }
    expect(sorted[sorted.length >> 1], shown).toBeLessThan(20);
    expect(sorted.at(-1), shown).toBeLessThan(50);
  });
});

/**
 * DLD-scale names: thousands of short "X TOWER" / "X HEIGHTS" names whose distinctive word appears in
 * many queries, the same name in two areas, and numbered sibling towers. Rows are built the way the
 * loader builds them (display name plus the import aliases).
 */
describe("DLD-scale names: short subset names, numbered siblings, one name in two areas", () => {
  function rowsOf(dld: Array<[string, string]>): AliasRow[] {
    const out: AliasRow[] = [];
    dld.forEach(([raw, area], i) => {
      const name = displayName(raw);
      for (const a of buildingAliases([raw], name)) out.push({ buildingId: i + 1, aliasNorm: a.norm, name, area });
    });
    return out;
  }
  const view = (c: Candidate[]) => c.map((x) => [x.name, x.area, x.strength]);

  it("an exact name beats a shorter name whose words are all in the query, and is pre-selected", () => {
    const dld = rowsOf([
      ["GATE TOWER 1", "Test Area B"],
      ["TEST GATE 1", "Test Area A"],
      ["TEST GATE 2", "Test Area A"],
    ]);
    const c = findCandidates("Test Gate 1", dld);
    expect(c[0]).toMatchObject({ buildingId: 2, name: "Test Gate 1", score: 1, strength: "strong" });
    // "Gate Tower 1" shares only "gate" and "1" with the query: no longer a 1.0 match.
    expect(c.find((x) => x.name === "Gate Tower 1")?.strength ?? "absent").not.toBe("strong");
    expect(preselect(c)).toBe(2);
    expect(needsTowerCheck(c)).toBe(true);
    expect(needsAreaCheck(c)).toBe(false);
  });

  it("one-word names (Test Tower, Gate Tower, Test Heights) never crowd out the Test Gate towers", () => {
    const dld = rowsOf([
      ["TEST GATE 1", "Test Area A"],
      ["TEST GATE 2", "Test Area A"],
      ["TEST GATE 3", "Test Area A"],
      ["TEST TOWER", "Test Area B"],
      ["GATE TOWER", "Test Area C"],
      ["TEST HEIGHTS", "Test Area D"],
    ]);
    const all = findCandidates("Test Gate", dld);
    expect(all.map((x) => x.name)).toEqual(["Test Gate 1", "Test Gate 2", "Test Gate 3"]);
    // Three equally good towers: nothing is pre-selected, the tower number decides.
    expect(preselect(all)).toBeNull();
    expect(needsTowerCheck(all)).toBe(true);

    const one = findCandidates("Test Gate 1", dld);
    expect(one[0].name).toBe("Test Gate 1");
    expect(one.map((x) => x.name)).not.toContain("Gate Tower");
    expect(one.map((x) => x.name)).not.toContain("Test Heights");
    expect(preselect(one)).toBe(1);
    expect(needsTowerCheck(one)).toBe(true);

    const two = findCandidates("Test Gate 2 Tower", dld);
    expect(two[0].name).toBe("Test Gate 2");
    expect(preselect(two)).toBe(2);
    expect(needsTowerCheck(two)).toBe(true);
  });

  it("the best numbered sibling of the top building stays in the list when other names score higher", () => {
    const dld = rowsOf([
      ["TEST GATE 1", "Test Area A"],
      ["TEST GATE 1 A", "Test Area A"],
      ["TEST GATE 1 B", "Test Area A"],
      ["TEST GATE 1 C", "Test Area A"],
      ["TEST GATE 2", "Test Area A"],
    ]);
    const c = findCandidates("Test Gate 1", dld);
    expect(c).toHaveLength(3);
    expect(c[0].name).toBe("Test Gate 1");
    expect(c.map((x) => x.name)).toContain("Test Gate 2");
    expect(needsTowerCheck(c)).toBe(true);
    expect(preselect(c)).toBe(1);
  });

  it("equal scores rank the more exact name first and pre-select nothing", () => {
    const dld = rowsOf([
      ["TEST GATE RESIDENCES", "Test Area A"],
      ["TEST GATE TOWER", "Test Area A"],
    ]);
    const c = findCandidates("Test Gate", dld);
    expect(c.map((x) => x.score)).toEqual([1, 1]);
    expect(c.map((x) => x.name)).toEqual(["Test Gate Tower", "Test Gate Residences"]);
    expect(preselect(c)).toBeNull();
  });

  it("the same DLD name in two areas: no pre-selection without the area, an area check rather than a tower check", () => {
    const dld = rowsOf([
      ["TEST RESIDENCE", "Test Area A"],
      ["TEST RESIDENCE", "Test Area B"],
    ]);
    const c = findCandidates("Test Residence", dld);
    expect(view(c)).toEqual([
      ["Test Residence", "Test Area A", "strong"],
      ["Test Residence", "Test Area B", "strong"],
    ]);
    expect(preselect(c)).toBeNull();
    expect(needsTowerCheck(c)).toBe(false);
    expect(needsAreaCheck(c)).toBe(true);

    // The listing's area breaks the tie.
    const b = findCandidates("Test Residence", dld, "Test Area B");
    expect(b[0]).toMatchObject({ buildingId: 2, area: "Test Area B" });
    expect(preselect(b)).toBe(2);
    expect(needsAreaCheck(b)).toBe(true);
  });

  it("needsTowerCheck and needsAreaCheck tell numbered siblings from repeated names", () => {
    const cand = (buildingId: number, name: string, area: string): Candidate => ({ buildingId, name, area, score: 0.9, strength: "strong" });
    const siblings = [cand(1, "Test Tower 1", "A"), cand(2, "Test Tower 2", "A")];
    const repeated = [cand(1, "Test Tower A", "Test Area A"), cand(2, "Test Tower A", "Test Area B")];
    expect(needsTowerCheck(siblings)).toBe(true);
    expect(needsAreaCheck(siblings)).toBe(false);
    expect(needsTowerCheck(repeated)).toBe(false);
    expect(needsAreaCheck(repeated)).toBe(true);
    expect(needsTowerCheck([...repeated, cand(3, "Test Tower A 2", "Test Area A")])).toBe(true);
  });
});

describe("scoreAlias", () => {
  it("applies the number rule", () => {
    expect(scoreAlias("dummyside heights 1", "dummyside heights 2")).toBeLessThan(0.8);
    expect(scoreAlias("mockup crest", "mockup crest 2")).toBeCloseTo(24 / 26 - 0.15, 6);
    expect(scoreAlias("", "x")).toBe(0);
    expect(scoreAlias("tower", "tower")).toBe(1); // only generic words: compare against all of A
  });
});

describe("findCandidates (seeded aliases)", () => {
  it('"Mockup Crest", Dubai Marina', () => {
    const c = findCandidates("Mockup Crest", rows, "Dubai Marina");
    expect(names(c)).toEqual(["Mockup Crest Tower", "Mockup Crest Tower 2"]);
    expect(c[0].score).toBeCloseTo(1.05, 3);
    expect(c[1].score).toBeCloseTo(0.823, 3);
    expect(c[0].strength).toBe("strong");
    expect(preselect(c)).toBe(idOf("Mockup Crest Tower"));
    expect(needsTowerCheck(c)).toBe(true);
  });

  it.each(["Mockup Crest II", "Mockup Crest 2"])('"%s" gives Mockup Crest Tower 2', (q) => {
    const c = findCandidates(q, rows);
    expect(names(c)).toEqual(["Mockup Crest Tower 2", "Mockup Crest Tower"]);
    expect(c[0].score).toBeCloseTo(1.0, 3);
    expect(c[1].score).toBeCloseTo(0.85, 3);
    expect(preselect(c)).toBe(idOf("Mockup Crest Tower 2"));
    expect(needsTowerCheck(c)).toBe(true);
  });

  it('"Fake Vista Res.", JVC', () => {
    const c = findCandidates("Fake Vista Res.", rows, "JVC");
    expect(names(c)).toEqual(["Fake Vista Residences", "Fake Vista Residences 2"]);
    expect(c[0].score).toBeCloseTo(1.05, 3);
    expect(c[1].score).toBeCloseTo(0.855, 3);
    expect(preselect(c)).toBe(idOf("Fake Vista Residences"));
    expect(needsTowerCheck(c)).toBe(true);
  });

  it('"Dummyside Hts 2", Al Jaddaf', () => {
    const c = findCandidates("Dummyside Hts 2", rows, "Al Jaddaf");
    expect(names(c)).toEqual(["Dummyside Heights 2", "Dummyside Heights 1"]);
    expect(c[0].score).toBeCloseTo(1.05, 3);
    expect(c[1].score).toBeCloseTo(0.747, 3);
    expect(preselect(c)).toBe(idOf("Dummyside Heights 2"));
    expect(needsTowerCheck(c)).toBe(true);
  });

  it('"Dummyside Heights": both 0.794, nothing preselected, ties sorted by name', () => {
    const c = findCandidates("Dummyside Heights", rows);
    expect(names(c)).toEqual(["Dummyside Heights 1", "Dummyside Heights 2"]);
    expect(c.map((x) => x.score)).toEqual([0.794, 0.794]);
    expect(c.every((x) => x.strength === "possible")).toBe(true);
    expect(preselect(c)).toBeNull();
    expect(needsTowerCheck(c)).toBe(true);
  });

  it('"Nowhere Point Tower", Dubai Creek Harbour → none', () => {
    const c = findCandidates("Nowhere Point Tower", rows, "Dubai Creek Harbour");
    expect(c).toEqual([]);
    expect(preselect(c)).toBeNull();
    expect(needsTowerCheck(c)).toBe(false);
  });

  it('"Tower" (generic word only) → none', () => {
    expect(findCandidates("Tower", rows)).toEqual([]);
  });

  it('"Dubai Mockup Tower" → Mockup Crest Tower 0.667 only', () => {
    const c = findCandidates("Dubai Mockup Tower", rows);
    expect(names(c)).toEqual(["Mockup Crest Tower"]);
    expect(c[0].score).toBeCloseTo(0.667, 3);
    expect(preselect(c)).toBeNull();
    expect(needsTowerCheck(c)).toBe(false);
  });

  it('"Mockup Crest Twr 1"', () => {
    const c = findCandidates("Mockup Crest Twr 1", rows);
    expect(names(c)).toEqual(["Mockup Crest Tower", "Mockup Crest Tower 2"]);
    expect(c[0].score).toBeCloseTo(0.85, 3);
    expect(c[1].score).toBeCloseTo(0.7, 3);
    expect(preselect(c)).toBe(idOf("Mockup Crest Tower"));
    expect(needsTowerCheck(c)).toBe(true);
  });

  it("returns nothing for an empty query and at most 3 candidates", () => {
    expect(findCandidates("", rows)).toEqual([]);
    expect(findCandidates("   ", rows)).toEqual([]);
    expect(findCandidates("Fake Vista", rows, null).length).toBeLessThanOrEqual(3);
    expect(preselect([])).toBeNull();
  });

  it("thresholds", () => {
    expect(MATCH_FLOOR).toBe(0.62);
    expect(STRONG_MATCH).toBe(0.8);
  });
});

describe("a distinctive word that does not agree", () => {
  const q = normalise("Marriott Residences Tower 2");
  it("is never a strong match through generic words alone", () => {
    expect(scoreAlias(q, normalise("May Residence Tower 2"))).toBeLessThan(STRONG_MATCH);
    const c = findCandidates("Marriott Residences Tower 2", [{ buildingId: 1, name: "May Residence Tower 2", area: "JVC", aliasNorm: normalise("May Residence Tower 2") }], "Dubai Science Park");
    expect(preselect(c)).toBeNull();
  });
  it("still accepts a typo of the distinctive word", () => {
    expect(scoreAlias(normalise("Mariott Residences Tower 2"), normalise("Marriott Residences Tower 2"))).toBeGreaterThanOrEqual(STRONG_MATCH);
  });
});
