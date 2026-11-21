import { describe, expect, it } from "vitest";
import { normalise } from "@/lib/domain/normalise";
import { AREA_MAP, buildingAliases, cleanAliasName, displayArea, displayName, dldKey } from "@/lib/ingest/identity";

describe("dldKey (REAL_DATA.md section 4)", () => {
  it("is normalise(building) | normalise(area_dld)", () => {
    expect(dldKey("TEST TOWER A", "Marsa Dubai")).toBe("test tower a|marsa dubai");
    expect(dldKey("  test  tower a ", "MARSA DUBAI")).toBe(dldKey("TEST TOWER A", "Marsa Dubai"));
    expect(dldKey("TEST TOWER A", "Al Barsha South Fourth")).not.toBe(dldKey("TEST TOWER A", "Marsa Dubai"));
    // The normaliser's own rules apply: Roman numerals, "TWR", a leading "THE".
    expect(dldKey("THE TEST TWR II", "x")).toBe(dldKey("Test Tower 2", "x"));
  });
});

describe("displayName (REAL_DATA.md section 5)", () => {
  it.each([
    ["TEST TOWER A", "Test Tower A"],
    ["TEST GATE 1", "Test Gate 1"],
    ["JLT CLUSTER X TOWER II", "JLT Cluster X Tower II"],
    ["TEST JVC RESIDENCE III", "Test JVC Residence III"],
    ["DIFC TEST TOWER IV", "DIFC Test Tower IV"],
    ["MBR CITY TEST VILLAS", "MBR City Test Villas"],
    ["THE RESIDENCES AT TEST GATE 1", "The Residences at Test Gate 1"],
    ["TEST TOWER OF THE BAY", "Test Tower of the Bay"],
    ["AL-TEST TOWER", "Al-Test Tower"],
    ["TEST'S TOWER", "Test's Tower"],
    ["TEST TOWER 2B", "Test Tower 2B"],
    ["TEST BLOCK B2", "Test Block B2"],
    ["test tower (phase ii)", "Test Tower (Phase II)"],
    ["  TEST   TOWER  ", "Test Tower"],
    ["TEST TOWER XIV", "Test Tower XIV"],
  ])("%j → %j", (raw, shown) => {
    expect(displayName(raw)).toBe(shown);
  });

  it("keeps the normalised form, so the display name matches like the raw name", () => {
    for (const raw of ["JLT CLUSTER X TOWER II", "THE RESIDENCES AT TEST GATE 1", "TEST TOWER 2B"]) {
      expect(normalise(displayName(raw))).toBe(normalise(raw));
    }
  });
});

describe("cleanAliasName (REAL_DATA.md section 5)", () => {
  it.each([
    ["The Residences at Test Gate 1", "Test Gate 1"],
    ["Residences at Test Gate", "Test Gate"],
    ["The Test Gate", "Test Gate"],
    ["Test Crest Tower 2", "Test Crest 2"],
    ["Test Crest Twr 2", "Test Crest 2"],
    ["Test Towers B", "Test B"],
    ["Tower 2 Test Gate", "2 Test Gate"],
    ["Test Tower A", "Test A"],
  ])("%j → %j", (name, cleaned) => {
    expect(cleanAliasName(name)).toBe(cleaned);
  });

  it("never removes a tower number or letter, and returns null when nothing changes or only a mark would be left", () => {
    expect(cleanAliasName("Test Gate 1")).toBeNull();
    expect(cleanAliasName("Tower 2")).toBeNull();
    expect(cleanAliasName("The Tower")).toBeNull();
    expect(cleanAliasName("Twr B")).toBeNull();
    expect(cleanAliasName("Tower II")).toBeNull();
    expect(cleanAliasName("The Residences at 3")).toBeNull();
    expect(cleanAliasName("")).toBeNull();
    for (const name of ["Test Tower 12", "The Test Tower 3B", "Test Twr IV", "Residences at Test Tower 7"]) {
      const digitsOrMarks = (s: string) => s.split(" ").filter((w) => /\d|^(I|II|III|IV|V)$/i.test(w));
      expect(digitsOrMarks(cleanAliasName(name) ?? "")).toEqual(digitsOrMarks(name));
    }
  });
});

describe("buildingAliases", () => {
  it("adds every raw name and the cleaned display name, de-duplicated by normalised form", () => {
    expect(buildingAliases(["THE RESIDENCES AT TEST GATE 1", "the residences at test gate 1 "], "The Residences at Test Gate 1")).toEqual([
      { raw: "THE RESIDENCES AT TEST GATE 1", norm: "residences at test gate 1" },
      { raw: "Test Gate 1", norm: "test gate 1" },
    ]);
    expect(buildingAliases(["TEST GATE 1"], "Test Gate 1")).toEqual([{ raw: "TEST GATE 1", norm: "test gate 1" }]);
    expect(buildingAliases(["TEST TOWER A", "TEST TWR A"], "Test Tower A")).toEqual([
      { raw: "TEST TOWER A", norm: "test tower a" },
      { raw: "Test A", norm: "test a" },
    ]);
    expect(buildingAliases(["---"], "---")).toEqual([]);
  });
});

describe("displayArea (REAL_DATA.md section 6)", () => {
  it("maps exactly the evidenced DLD area names", () => {
    expect(AREA_MAP).toEqual({
      "Marsa Dubai": "Dubai Marina",
      "Burj Khalifa": "Downtown Dubai",
      "Business Bay": "Business Bay",
      "Palm Jumeirah": "Palm Jumeirah",
      "Al Barsha South Fourth": "Jumeirah Village Circle (JVC)",
      "Al Thanyah Fifth": "Jumeirah Lake Towers (JLT)",
      "Al Khairan First": "Dubai Creek Harbour",
      "Hadaeq Sheikh Mohammed Bin Rashid": "Dubai Hills Estate",
      "Madinat Al Mataar": "Dubai South",
      "Nadd Hessa": "Dubai Silicon Oasis",
    });
    for (const [dld, shown] of Object.entries(AREA_MAP)) expect(displayArea(dld)).toBe(shown);
  });

  it("matches case- and space-insensitively and falls back to the DLD name in title case", () => {
    expect(displayArea("  MARSA   DUBAI ")).toBe("Dubai Marina");
    expect(displayArea("al barsha south fourth")).toBe("Jumeirah Village Circle (JVC)");
    expect(displayArea("AL JADDAF")).toBe("Al Jaddaf");
    expect(displayArea("Jumeirah Lakes Towers")).toBe("Jumeirah Lakes Towers");
    expect(displayArea("")).toBe("");
  });
});
