/**
 * The project resolver (src/lib/domain/project.ts, REAL_DATA.md section 15.8): listing words to one DLD
 * project of the data, exact words only, refusing whenever it is not sure.
 * - Real names: the buildings of the snapshot of 16 Nov 2026 (tests/fixtures/similar/projects.json.gz,
 *   frozen), with the shipped area aliases, on listing-style strings: projects that must resolve, and
 *   strings that must not (developers alone, communities, areas, misspellings, one-word names, other
 *   emirates, two projects, a project in another area, a numbered project or building already in the data).
 * - Synthetic: the key, the building guard and the place-name rule, worked out by hand.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { resolveArea } from "@/lib/domain/area";
import { buildingNeedle, buildProjectIndex, projectKey, resolveProject, type ProjectRow } from "@/lib/domain/project";
import { AREA_ALIASES } from "@/lib/similar/model";

const ROWS = (JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), "tests", "fixtures", "similar", "projects.json.gz"))).toString("utf8")) as { rows: ProjectRow[] }).rows;
const INDEX = buildProjectIndex(
  ROWS,
  AREA_ALIASES.map((a) => a.alias),
);

function resolve(buildingText: string, areaText = "") {
  const area = resolveArea(areaText, AREA_ALIASES);
  return resolveProject({ buildingText, areaText, areaDld: area.status === "resolved" ? area.areaDld : null }, INDEX);
}

describe("the project index of the snapshot", () => {
  it("groups numbered phases of one name in one area, and leaves out one-word names and place names", () => {
    expect(ROWS.length).toBe(4348);
    const venice = INDEX.byKey.get("azizi venice");
    expect(venice).toHaveLength(1);
    expect(venice![0]).toMatchObject({ areaDld: "Madinat Al Mataar" });
    expect(venice![0].projectNumbers.length).toBe(16);
    expect(INDEX.byKey.get("azizi riviera")![0].projectNumbers.length).toBe(61);
    expect(INDEX.byKey.get("binghatti flare")![0]).toMatchObject({ name: "Binghatti Flare", areaDld: "Al Barsha South Fifth" });
    for (const k of ["reef", "oxford", "the", "mag", "coventry", "skyvue"]) expect(INDEX.byKey.has(k), k).toBe(false);
    // A key that is also a community is a place, not a project.
    expect(INDEX.byKey.has("madinat jumeirah living")).toBe(false);
  });
});

/** [building text, area text, the DLD area and the key it must resolve to]. */
const RESOLVES: Array<[string, string, string, string]> = [
  ["Azizi Venice 17", "Dubai South", "Madinat Al Mataar", "azizi venice"],
  ["Azizi Venice", "Dubai South, Dubai", "Madinat Al Mataar", "azizi venice"],
  ["AZIZI VENICE 17, Dubai South", "", "Madinat Al Mataar", "azizi venice"],
  ["Binghatti Flare", "", "Al Barsha South Fifth", "binghatti flare"],
  ["Sobha Hartland Greens Phase IV", "Mohammed Bin Rashid City", "Al Merkadh", "sobha hartland greens"],
  ["Damac Lagoons Lagoon Views 14", "Damac Lagoons", "Al Hebiah Fifth", "damac lagoons lagoon views"],
  ["Azizi Riviera 70", "Meydan One", "Al Merkadh", "azizi riviera"],
  ["Azizi Riviera", "Al Merkadh", "Al Merkadh", "azizi riviera"],
  ["Azizi Milan", "", "Wadi Al Safa 4", "azizi milan"],
  ["City Walk Crestlane 6", "City Walk", "Al Wasl", "city walk crestlane"],
  ["South Garden F", "Jebel Ali", "Jabal Ali First", "south garden"],
  ["Hillside Residences 4", "Jebel Ali", "Jabal Ali First", "hillside residences"],
  ["Al Haseen Residence 6", "Dubai Industrial City", "Saih Shuaib 2", "al haseen residence"],
  ["Rise by Athlon 5", "", "Wadi Al Safa 5", "rise by athlon"],
  ["Diamond Views 5", "JVC", "Al Barsha South Fourth", "diamond views"],
  ["Olympic Park 5", "Sports City", "Al Hebiah Fourth", "olympic park"],
  ["Luminar Tower 4", "JVT", "Al Barsha South Fifth", "luminar tower"],
  ["Palm Beach Towers 4", "Palm Jumeirah", "Palm Jumeirah", "palm beach towers"],
  ["Damac Riverside Views Marine 5", "Dubai Investments Park", "Dubai Investment Park Second", "damac riverside views marine"],
  ["Edgewater Residences 4", "Dubai Islands", "Palm Deira", "edgewater residences"],
  ["Avenue Residence 9", "Al Furjan", "Jabal Ali First", "avenue residence"],
  ["Glitz Residence 4", "Dubai Studio City", "Al Hebiah Second", "glitz residence"],
  ["Chelsea Residences by Damac Tower D", "Dubai Maritime City", "Madinat Dubai Almelaheyah", "chelsea residences by damac"],
  // One name in two areas: the listing's area decides.
  ["Golden Wood Views 6", "JVC", "Al Barsha South Fourth", "golden wood views"],
];

/** [building text, area text, what it must say]. */
const REFUSES: Array<[string, string, "nothing" | "community_only" | "other_emirate" | "area_conflict" | "building_in_data" | "ambiguous"]> = [
  // Words out of order, a misspelling, a developer alone: no near match is ever taken.
  ["Venice by Azizi", "Dubai South", "nothing"],
  ["Azizi Venise 17", "Dubai South", "nothing"],
  ["Binghatti", "JVC", "nothing"],
  ["Azizi", "Dubai South", "nothing"],
  ["Emaar Beachfront", "", "nothing"],
  ["", "", "nothing"],
  // One-word project names never resolve.
  ["Reef 1002", "Dubai Land", "nothing"],
  ["Oxford 214", "JVC", "nothing"],
  ["Nourelle Building 4", "Umm Suqeim", "nothing"],
  // A community or an area alone, or a part of a project name.
  ["Sobha Hartland II", "MBR City", "community_only"],
  ["Sobha Hartland", "", "community_only"],
  ["Lagoon Views 14", "Damac Lagoons", "community_only"],
  ["JVC", "Jumeirah Village Circle", "community_only"],
  ["Jumeirah Village Circle", "", "community_only"],
  ["Dubai Hills Estate", "Dubai Hills", "community_only"],
  ["Marina Gate", "Dubai Marina", "community_only"],
  ["The 8", "Palm Jumeirah", "community_only"],
  ["Skyvue Altier", "Sobha Hartland", "community_only"],
  ["Living Legends Phase 8", "Dubailand", "community_only"],
  // Other emirates, whatever else the text says.
  ["Azizi Venice 17", "Sharjah", "other_emirate"],
  ["Marina Square", "Al Reem Island, Abu Dhabi", "other_emirate"],
  ["Aljada Tower", "Sharjah", "other_emirate"],
  ["Al Marjan Island Resort", "Ras Al Khaimah", "other_emirate"],
  ["Yas Island Residences", "Abu Dhabi", "other_emirate"],
  ["Azizi Venice 17", "Fujairah", "other_emirate"],
  ["Damac Lagoons Lagoon Views 14", "Ajman", "other_emirate"],
  ["Sobha Hartland Greens Phase IV", "Umm Al Quwain", "other_emirate"],
  // The listing's area is not the project's: refuse, never choose.
  ["Azizi Venice 17", "Business Bay", "area_conflict"],
  ["Binghatti Flare", "JVC", "area_conflict"],
  ["Azizi Milan 60", "Dubai South", "area_conflict"],
  ["Downtown Views", "Downtown Dubai", "area_conflict"],
  ["Indigo Tower 3", "Al Furjan", "area_conflict"],
  // Two projects, or one name in two areas the text does not settle.
  ["Azizi Venice 17 and Binghatti Flare", "", "ambiguous"],
  ["Platinum Residence 3", "Al Barsha", "ambiguous"],
  ["Luxury Family Residence IV", "", "ambiguous"],
  ["Golden Wood Views 6", "", "ambiguous"],
  // A numbered project or a building that IS in the data: the page could not say "no registered sales".
  ["Azizi Venice 15", "Dubai South", "building_in_data"],
  ["Azizi Venice 3", "Dubai South", "building_in_data"],
  ["Binghatti Flare 01", "", "building_in_data"],
  ["Burj Binghatti Jacob & Co Residences", "Business Bay", "building_in_data"],
  ["Ellington House V", "Dubai Hills Estate", "building_in_data"],
  ["Weybridge Gardens 6", "Dubailand Residence Complex", "building_in_data"],
];

describe("resolveProject on listing-style strings (real names)", () => {
  it("has at least 40 cases, most of them must not resolve", () => {
    expect(RESOLVES.length + REFUSES.length).toBeGreaterThanOrEqual(60);
    expect(REFUSES.length).toBeGreaterThan(RESOLVES.length);
  });

  it.each(RESOLVES)("%s, %s: resolves to %s", (text, area, areaDld, key) => {
    const r = resolve(text, area);
    expect(r.status, JSON.stringify(r)).toBe("resolved");
    if (r.status !== "resolved") return;
    expect(r.group.key).toBe(key);
    expect(r.group.areaDld).toBe(areaDld);
    expect(r.group.projectNumbers.length).toBeGreaterThan(0);
  });

  it.each(REFUSES)("%s, %s: %s", (text, area, want) => {
    const r = resolve(text, area);
    if (want === "ambiguous") {
      expect(r.status, JSON.stringify(r)).toBe("ambiguous");
      if (r.status === "ambiguous") expect(r.candidates.length).toBeGreaterThan(1);
    } else {
      expect(r, JSON.stringify(r)).toEqual({ status: "unresolved", why: want });
    }
  });
});

describe("projectKey, buildingNeedle and the place-name rule (by hand)", () => {
  it("takes off a trailing number, numeral, letter or phase, and needs two words", () => {
    expect(projectKey("AZIZI VENICE 15")).toBe("azizi venice");
    expect(projectKey("DAMAC LAGOONS - LAGOON VIEWS 13")).toBe("damac lagoons lagoon views");
    expect(projectKey("SOBHA HARTLAND GREENS- PHASE I")).toBe("sobha hartland greens");
    expect(projectKey("Hillside Residences 3 - B")).toBe("hillside residences");
    expect(projectKey("Chelsea Residences by Damac")).toBe("chelsea residences by damac");
    expect(projectKey("Burj Binghatti Jacob & Co. Residences")).toBe("burj binghatti jacob and co residences");
    expect(projectKey("Reef 998")).toBeNull();
    expect(projectKey("The 100")).toBeNull();
    expect(projectKey("The Haven III")).toBeNull();
    expect(projectKey("Skyvue")).toBeNull();
    expect(projectKey("")).toBeNull();
  });

  it("finds a building only by a name with two telling words", () => {
    expect(buildingNeedle("Tower 1")).toBeNull();
    expect(buildingNeedle("Building A")).toBeNull();
    expect(buildingNeedle("Block B Residences")).toBeNull();
    expect(buildingNeedle("Binghatti Flare 01")).toBe("binghatti flare 01");
  });

  const rows: ProjectRow[] = [
    { building: "PARK ONE TOWER A", project: "PARK ONE 1", projectNumber: "1", areaDld: "Area X", masterProject: "Green Lakes" },
    { building: "PARK ONE TOWER B", project: "PARK ONE 2", projectNumber: "2", areaDld: "Area X", masterProject: "Green Lakes" },
    { building: "LAKE VIEW 1", project: "Green Lakes 4", projectNumber: "3", areaDld: "Area X", masterProject: "Green Lakes" },
    { building: "SOLO", project: "Solo Tower", projectNumber: "", areaDld: "Area X", masterProject: "" },
  ];
  const idx = buildProjectIndex(rows, ["area x"]);

  it("groups numbered phases, drops a key that is a place, and keeps the most common spelling", () => {
    expect([...idx.byKey.keys()]).toEqual(["park one"]);
    expect(idx.byKey.get("park one")![0]).toMatchObject({ name: "PARK ONE", projectNumbers: ["1", "2"], masterProject: "Green Lakes", projects: ["park one 1", "park one 2"] });
  });

  it("resolves the family, refuses a numbered project or a building of the data, and a place alone", () => {
    expect(resolveProject({ buildingText: "Park One 3" }, idx)).toMatchObject({ status: "resolved", matched: "park one" });
    expect(resolveProject({ buildingText: "Park One 2" }, idx)).toEqual({ status: "unresolved", why: "building_in_data" });
    expect(resolveProject({ buildingText: "Park One Tower B" }, idx)).toEqual({ status: "unresolved", why: "building_in_data" });
    expect(resolveProject({ buildingText: "Park One Tower A, Area X" }, idx)).toEqual({ status: "unresolved", why: "building_in_data" });
    expect(resolveProject({ buildingText: "Green Lakes" }, idx)).toEqual({ status: "unresolved", why: "community_only" });
    expect(resolveProject({ buildingText: "Park One 3", areaDld: "Area Y" }, idx)).toEqual({ status: "unresolved", why: "area_conflict" });
    expect(resolveProject({ buildingText: "Park One 3, Sharjah" }, idx)).toEqual({ status: "unresolved", why: "other_emirate" });
    expect(resolveProject({ buildingText: "Parkone 3" }, idx)).toEqual({ status: "unresolved", why: "nothing" });
  });
});
