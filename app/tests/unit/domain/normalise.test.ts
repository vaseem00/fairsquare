import { describe, expect, it } from "vitest";
import { ABBREV, GENERIC, NUMBER_WORDS, ROMAN, normalise } from "@/lib/domain";

describe("normalise", () => {
  it.each([
    ["Mockup Crest II", "mockup crest 2"],
    ["Fake Vista Res.", "fake vista residences"],
    ["The Dummyside Hts. No. 2", "dummyside heights 2"],
    ["JVC", "jumeirah village circle"],
    ["A&B Towers", "a and b tower"],
    ["  Bldg   7  ", "building 7"],
    ["constructor", "constructor"],
    ["Fake Peninsula One", "fake peninsula 1"],
    ["Act Two - Tower Twelve", "act 2 tower 12"],
    ["One Fake Vista", "1 fake vista"],
  ])("%s → %s", (input, out) => {
    expect(normalise(input)).toBe(out);
  });

  it.each([[""], [null], [undefined]])("%s → empty", (input) => {
    expect(normalise(input)).toBe("");
  });

  it("exposes the rule tables", () => {
    expect(ABBREV.twr).toBe("tower");
    expect(ROMAN.iv).toBe("4");
    expect(NUMBER_WORDS.twenty).toBe("20");
    expect(normalise("Fake Peninsula One")).toBe(normalise("Fake Peninsula 1"));
    expect(GENERIC.has("tower")).toBe(true);
    expect(GENERIC.has("marina")).toBe(false);
  });
});
