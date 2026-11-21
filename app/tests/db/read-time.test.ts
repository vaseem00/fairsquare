import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/lib/db/schema";
import { publicConfigWith } from "@/lib/config";
import { UNKNOWN_DATA_STATUS } from "@/lib/data-status";
import { __resetReadTimeForTests, cachedReadTimeP50Sec, READ_TIME_MIN_READS, READ_TIME_SAMPLE, readTimeP50Sec } from "@/lib/read-time";
import { createTestDb, type TestDb } from "../helpers/db";

/** The measured "Still reading" note (RESULT_SPEC sections 2.3 and 9.1, item 7). */
describe("readTimeP50Sec: the median of the last 200 reads, once 50 exist", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seed: false });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.db.delete(events);
    __resetReadTimeForTests();
  });

  const reads = (ms: readonly unknown[], at = Date.parse("2026-11-01T10:00:00Z")) =>
    t.db.insert(events).values(ms.map((v, i) => ({ name: "extract_ok", meta: { ms: v as number }, createdAt: new Date(at + i * 1000) })));

  it("is null with fewer than 50 reads, then the median in whole seconds", async () => {
    await reads(Array.from({ length: READ_TIME_MIN_READS - 1 }, () => 9_400));
    // Failures and reads without a numeric time never count.
    await t.db.insert(events).values([
      { name: "extract_fail", meta: { ms: 1_000 } },
      { name: "extract_ok", meta: { ms: "fast" } },
    ]);
    expect(await readTimeP50Sec(t.db)).toBeNull();
    await reads([12_000], Date.parse("2026-11-02T10:00:00Z"));
    expect(await readTimeP50Sec(t.db)).toBe(9);
  });

  it("takes only the newest 200 reads", async () => {
    // 150 old slow reads, then 200 new fast ones: the old ones are outside the sample.
    await reads(Array.from({ length: 150 }, () => 30_000), Date.parse("2026-10-01T10:00:00Z"));
    await reads(Array.from({ length: READ_TIME_SAMPLE }, (_, i) => 4_000 + (i % 3) * 1_000), Date.parse("2026-11-01T10:00:00Z"));
    expect(await readTimeP50Sec(t.db)).toBe(5);
  });

  it("is kept for 60 s, and reaches the public config", async () => {
    expect(await cachedReadTimeP50Sec(t.db)).toBeNull();
    await reads(Array.from({ length: 60 }, () => 7_000));
    expect(await cachedReadTimeP50Sec(t.db)).toBeNull();
    __resetReadTimeForTests();
    expect(await cachedReadTimeP50Sec(t.db)).toBe(7);
    expect(publicConfigWith(UNKNOWN_DATA_STATUS, 7).readP50Sec).toBe(7);
    expect(publicConfigWith(UNKNOWN_DATA_STATUS).readP50Sec).toBeNull();
  });
});
