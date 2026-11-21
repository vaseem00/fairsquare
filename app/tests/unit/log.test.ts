import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it } from "vitest";
import { __setLogSinkForTests, isBlockedField, log, scrubFields, type LogLevel } from "@/lib/log";

describe("log", () => {
  const lines: Array<{ level: LogLevel; obj: Record<string, unknown> }> = [];
  afterEach(() => {
    __setLogSinkForTests(null);
    lines.length = 0;
    process.env.LOG_LEVEL = "error";
  });
  const capture = () => __setLogSinkForTests((level, line) => lines.push({ level, obj: JSON.parse(line) }));

  it("writes one JSON line per call, dropping PII fields at any depth", () => {
    capture();
    process.env.LOG_LEVEL = "debug";
    log.info("extract", {
      requestId: "r1",
      name: "Sara",
      phoneE164: "+971501234567",
      text: "pasted",
      image: "bytes",
      buildingText: "Marina",
      ip: "1.2.3.4",
      found: { building: true, name: "x", phone: "y" },
      list: [{ text: "t", ok: 1 }],
    });
    expect(lines).toHaveLength(1);
    const o = lines[0].obj;
    expect(o).toMatchObject({ level: "info", event: "extract", requestId: "r1", found: { building: true }, list: [{ ok: 1 }] });
    for (const k of ["name", "phoneE164", "text", "image", "buildingText", "ip"]) expect(o).not.toHaveProperty(k);
    expect(o.found).not.toHaveProperty("name");
    expect(typeof o.ts).toBe("string");
  });

  it("filters by LOG_LEVEL", () => {
    capture();
    process.env.LOG_LEVEL = "warn";
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d", { err: new TypeError("boom") });
    expect(lines.map((l) => l.obj.event)).toEqual(["c", "d"]);
    expect(lines[1].obj.err).toEqual({ error: "TypeError", message: "boom" });
    process.env.LOG_LEVEL = "nonsense";
    log.info("e");
    expect(lines.at(-1)?.obj.event).toBe("e");
  });

  it("never logs a failed query's parameters (DrizzleQueryError) or a database error's message", () => {
    capture();
    process.env.LOG_LEVEL = "debug";
    const pgCause = Object.assign(new Error('insert or update on table "leads" violates foreign key constraint'), {
      code: "23503",
      constraint: "leads_check_id_fk",
      table: "leads",
    });
    const err = new DrizzleQueryError(
      'insert into "leads" ("anon_id", "name", "phone_e164") values ($1, $2, $3)',
      ["00000000-0000-4000-8000-000000000000", "Sara Ahmed", "+971501234567"],
      pgCause,
    );
    const bigint = Object.assign(new Error('invalid input syntax for type bigint: "+971501234567"'), { code: "22P02" });
    log.error("request_failed", { requestId: "r1", err, other: bigint });
    const raw = JSON.stringify(lines[0].obj);
    expect(raw).not.toContain("+971501234567");
    expect(raw).not.toContain("Sara Ahmed");
    expect(lines[0].obj.err).toEqual({
      error: "Error",
      message: "Failed query (parameters withheld)",
      cause: { error: "Error", code: "23503", constraint: "leads_check_id_fk", table: "leads" },
    });
    expect(lines[0].obj.other).toEqual({ error: "Error", code: "22P02" });
  });

  it("scrubs deep objects safely", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    expect(JSON.stringify(scrubFields({ deep }))).toContain("[deep]");
    expect(isBlockedField("Phone")).toBe(true);
    expect(isBlockedField("phoneLast4")).toBe(true);
    expect(isBlockedField("ms")).toBe(false);
  });

  it("the default sink writes to the console", () => {
    process.env.LOG_LEVEL = "debug";
    expect(() => {
      log.debug("default_sink_info");
      log.warn("default_sink_warn");
    }).not.toThrow();
  });
});
