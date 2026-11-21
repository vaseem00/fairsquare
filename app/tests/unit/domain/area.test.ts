/**
 * The area resolver (src/lib/domain/area.ts, REAL_DATA.md section 15.5) with the shipped alias table:
 * the 44 verified cases, names as listing sites write them, misspellings, and the rule that it never
 * picks one of several possible areas by itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_MAX_CANDIDATES, normaliseArea, resolveArea, type AreaAlias, type AreaResolution } from "@/lib/domain/area";
import { AREA_ALIASES } from "@/lib/similar/model";

interface GoldenCase {
  input: string;
  expected: { areaDld: string; masterProject: string | null; matched: string[] } | null;
}
const GOLDEN = (JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "similar", "resolver-cases.json"), "utf8")) as { cases: GoldenCase[] }).cases;

const resolve = (text: string | null | undefined) => resolveArea(text, AREA_ALIASES);
const resolved = (r: AreaResolution) => (r.status === "resolved" ? [r.areaDld, r.masterProject] : null);
const candidates = (r: AreaResolution) => (r.status === "ambiguous" ? r.candidates.map((c) => c.areaDld) : null);

describe("the alias table", () => {
  it("has 253 normalised aliases, each once, and every specific one names a DLD area", () => {
    expect(AREA_ALIASES).toHaveLength(253);
    expect(new Set(AREA_ALIASES.map((a) => a.alias)).size).toBe(253);
    for (const a of AREA_ALIASES) {
      expect(normaliseArea(a.alias), a.alias).toBe(a.alias);
      expect(a.alias.length, a.alias).toBeGreaterThan(1);
      if (a.source === "ambiguous") expect([a.areaDld, a.masterProject], a.alias).toEqual([null, null]);
      else expect(a.areaDld, a.alias).toBeTruthy();
    }
    expect(AREA_ALIASES.filter((a) => a.source === "ambiguous")).toHaveLength(21);
  });

  it("every official DLD area name and master project name resolves to itself", () => {
    for (const a of AREA_ALIASES.filter((x) => x.source === "dld_area")) {
      const r = resolve(a.areaDld as string);
      expect(r.status === "resolved" && r.areaDld, a.alias).toBe(a.areaDld);
    }
    for (const a of AREA_ALIASES.filter((x) => x.source === "dld_master")) {
      const r = resolve(a.masterProject as string);
      expect(r.status === "resolved" && r.areaDld, a.alias).toBe(a.areaDld);
    }
  });
});

describe("normaliseArea", () => {
  it("lower case, accents removed, & to and, every run of other characters to one space", () => {
    expect(normaliseArea("  Jumeirah Village Circle (JVC),  Dubai ")).toBe("jumeirah village circle jvc dubai");
    expect(normaliseArea("Café & Résidences")).toBe("cafe and residences");
    expect(normaliseArea("دبي Dubai Marina")).toBe("dubai marina");
    expect(normaliseArea("·→")).toBe("");
  });
});

describe("the 44 verified cases", () => {
  it.each(GOLDEN.map((c) => [c.input, c] as const))("%j", (_input, c) => {
    const r = resolve(c.input);
    if (c.expected === null) expect(r.status).not.toBe("resolved");
    else expect(r).toEqual({ status: "resolved", ...c.expected });
  });
});

describe("names as listing sites write them", () => {
  it.each([
    ["Binghatti Onyx, JVC, Dubai", "Al Barsha South Fourth", "Jumeirah Village Circle"],
    ["Jumeirah Village Circle, District 10", "Al Barsha South Fourth", "Jumeirah Village Circle"],
    ["Jumeirah Village Triangle (JVT)", "Al Barsha South Fifth", "Jumeirah Village Triangle"],
    ["1BR | Marina View | Dubai Marina", "Marsa Dubai", "Dubai Marina"],
    ["Marina Gate 2, Dubai Marina, Dubai", "Marsa Dubai", "Dubai Marina"],
    ["Business Bay - Executive Towers", "Business Bay", "Business Bay"],
    ["Old Town, Downtown", "Burj Khalifa", null],
    ["Jumeirah Lakes Towers (JLT), Cluster D", "Al Thanyah Fifth", null],
    ["Barsha Heights (Tecom)", "Al Thanyah First", null],
    ["Dubai Hills", "Hadaeq Sheikh Mohammed Bin Rashid", "Dubai Hills Estate"],
    ["Silicon Oasis", "Nadd Hessa", null],
    ["Creek Harbour", "Al Khairan First", null],
    ["The Palm Jumeirah", "Palm Jumeirah", null],
    ["District One, MBR City", "Al Merkadh", null],
    ["Liwan, Dubailand", "Wadi Al Safa 2", null],
    ["Al Barsha 1", "Al Barsha First", null],
    ["DUBAI MARINA", "Marsa Dubai", "Dubai Marina"],
  ])("%j resolves to %s", (text, areaDld, master) => {
    const r = resolve(text);
    expect(r.status, JSON.stringify(r)).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.areaDld).toBe(areaDld);
    if (master !== null) expect(r.masterProject).toBe(master);
  });

  it("a longer name wins over a shorter one inside it", () => {
    expect(resolved(resolve("Downtown Jebel Ali"))).not.toEqual(resolved(resolve("Downtown")));
    expect(resolve("International City Phase 3").status).toBe("resolved");
  });
});

describe("it never guesses", () => {
  it("nothing known: unresolved", () => {
    for (const text of ["", "   ", null, undefined, "Dubai", "Somewhere Else", "Sharjah, Al Majaz", "2 bedroom apartment for sale", "·"]) {
      expect(resolve(text), String(text)).toEqual({ status: "unresolved" });
    }
  });

  it("a name that spans several DLD areas is ambiguous, with the areas it could mean and none chosen", () => {
    for (const text of ["Meydan", "MBR City", "Dubailand", "Jebel Ali", "Al Barsha", "Mohammed Bin Rashid City", "Jumeirah"]) {
      const r = resolve(text);
      expect(r.status, text).toBe("ambiguous");
      if (r.status !== "ambiguous") continue;
      expect(r.why, text).toBe("spans_areas");
      expect(r.candidates.length, text).toBeLessThanOrEqual(AREA_MAX_CANDIDATES);
      expect(new Set(r.candidates.map((c) => c.areaDld)).size, text).toBe(r.candidates.length);
    }
    expect(candidates(resolve("Al Barsha"))).toContain("Al Barsha First");
    expect((candidates(resolve("Meydan")) ?? []).length).toBeGreaterThanOrEqual(2);
    // A specific name beside the vague one settles it.
    expect(resolved(resolve("Meydan One, Meydan"))).not.toBeNull();
    expect(resolved(resolve("Majan, Dubailand"))).not.toBeNull();
  });

  it("two different areas in one text: ambiguous, both offered", () => {
    const r = resolve("Marina Residences, Palm Jumeirah");
    expect(r).toMatchObject({ status: "ambiguous", why: "several_areas" });
    expect(candidates(r)?.sort()).toEqual(["Marsa Dubai", "Palm Jumeirah"]);
    expect(candidates(resolve("Business Bay, Downtown Dubai"))?.sort()).toEqual(["Burj Khalifa", "Business Bay"]);
  });

  it("a misspelling is never resolved: the near name is offered as a candidate to confirm", () => {
    for (const [text, areaDld] of [
      ["Jumeriah Village Circle", "Al Barsha South Fourth"],
      ["Buisness Bay", "Business Bay"],
      ["Dubai Marnia", "Marsa Dubai"],
      ["Palm Jumeriah, Dubai", "Palm Jumeirah"],
    ] as const) {
      const r = resolve(text);
      expect(r, text).toMatchObject({ status: "ambiguous", why: "near_name", matched: [] });
      expect(candidates(r)?.[0], text).toBe(areaDld);
    }
    // Too far from any name: nothing is offered.
    expect(resolve("The Views")).toEqual({ status: "unresolved" });
    expect(resolve("Bsns B")).toEqual({ status: "unresolved" });
  });

  it("works on any alias table: whole words only, and the master project only when exactly one is named", () => {
    const table: AreaAlias[] = [
      { alias: "north bay", areaDld: "Area N", masterProject: "North Bay", source: "common" },
      { alias: "north bay towers", areaDld: "Area N", masterProject: "North Bay Towers", source: "common" },
      { alias: "bay", areaDld: "Area B", masterProject: null, source: "common" },
      { alias: "area n", areaDld: "Area N", masterProject: null, source: "dld_area" },
      { alias: "the coast", areaDld: null, masterProject: null, source: "ambiguous" },
      { alias: "the coast east", areaDld: "Area E", masterProject: null, source: "common" },
      { alias: "the coast west", areaDld: "Area W", masterProject: null, source: "common" },
    ];
    expect(resolveArea("North Bay", table)).toEqual({ status: "resolved", areaDld: "Area N", masterProject: "North Bay", matched: ["north bay"] });
    // "bay" lies inside the longer match and is dropped; "northbay" is not the word "north bay".
    expect(resolveArea("North Bay Towers, Area N", table)).toEqual({ status: "resolved", areaDld: "Area N", masterProject: "North Bay Towers", matched: ["area n", "north bay towers"] });
    expect(resolveArea("Northbay", table).status).not.toBe("resolved");
    // Two master projects of one area: the area only.
    expect(resolveArea("North Bay Towers near North Bay", table)).toMatchObject({ status: "resolved", areaDld: "Area N", masterProject: null });
    expect(resolveArea("The Coast", table)).toEqual({
      status: "ambiguous",
      why: "spans_areas",
      candidates: [
        { areaDld: "Area E", masterProject: null, alias: "the coast east" },
        { areaDld: "Area W", masterProject: null, alias: "the coast west" },
      ],
      matched: ["the coast"],
    });
    expect(resolveArea("The Coast West", table)).toMatchObject({ status: "resolved", areaDld: "Area W" });
    expect(resolveArea("x".repeat(5000), table)).toEqual({ status: "unresolved" });
    // Two near names: both offered, the nearer first.
    const near: AreaAlias[] = [
      { alias: "alpha garden", areaDld: "Area G", masterProject: null, source: "common" },
      { alias: "alpha gardens", areaDld: "Area H", masterProject: "Alpha Gardens", source: "common" },
    ];
    expect(resolveArea("Alpha Gardenz", near)).toEqual({
      status: "ambiguous",
      why: "near_name",
      candidates: [
        { areaDld: "Area G", masterProject: null, alias: "alpha garden" },
        { areaDld: "Area H", masterProject: "Alpha Gardens", alias: "alpha gardens" },
      ],
      matched: [],
    });
  });
});
