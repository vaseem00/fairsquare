/**
 * JSON-line logger with a PII guard (A§5.8, A§6.7). One line per call on stdout/stderr.
 * Fields named name, phone*, text, image, buildingText or ip are dropped at any depth, and database
 * errors are logged without their message (it can list the query's parameter values; see scrubError).
 * Never log request bodies, screenshots, pasted text, extracted values, IPs, names or phones.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const BLOCKED = new Set(["name", "text", "image", "buildingtext", "ip"]);

/** True for field names that may carry personal data. */
export function isBlockedField(key: string): boolean {
  const k = key.toLowerCase();
  return BLOCKED.has(k) || k.startsWith("phone");
}

type ErrorProps = Error & { query?: unknown; params?: unknown; code?: unknown; constraint?: unknown; table?: unknown };

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * An error as `{ error, message }`, except where the message can carry personal data:
 * - a failed-query error (drizzle's DrizzleQueryError has `query` and `params`, and its message is
 *   "Failed query: …\nparams: <every bound value>", names and phones included): the message is
 *   withheld and the database cause is logged instead;
 * - a database error (a SQLSTATE `code`): its message can echo an input value
 *   (`invalid input syntax for type bigint: "…"`), so only the code, constraint and table are kept.
 */
function scrubError(err: Error, depth: number): Record<string, unknown> {
  const e = err as ErrorProps;
  if ("params" in e || "query" in e) {
    const out: Record<string, unknown> = { error: e.name, message: "Failed query (parameters withheld)" };
    if (e.cause instanceof Error && depth < 4) out.cause = scrubError(e.cause, depth + 1);
    return out;
  }
  if (typeof e.code === "string" && SQLSTATE.test(e.code)) {
    const out: Record<string, unknown> = { error: e.name, code: e.code };
    if (typeof e.constraint === "string") out.constraint = e.constraint;
    if (typeof e.table === "string") out.table = e.table;
    return out;
  }
  return { error: e.name, message: e.message };
}

function scrub(value: unknown, depth: number): unknown {
  if (value instanceof Error) return scrubError(value, 0);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isBlockedField(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** Removes PII-named fields, recursively. Exported for tests. */
export function scrubFields(fields: LogFields): LogFields {
  return scrub(fields, 0) as LogFields;
}

function threshold(): number {
  const env = typeof process !== "undefined" ? process.env.LOG_LEVEL : undefined;
  const lvl = (env ?? "info").toLowerCase() as LogLevel;
  return ORDER[lvl] ?? ORDER.info;
}

type Sink = (level: LogLevel, line: string) => void;

const defaultSink: Sink = (level, line) => {
  if (level === "warn" || level === "error") {
    // eslint-disable-next-line no-console -- the logger is the one place that writes to the console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console -- the logger is the one place that writes to the console
    console.log(line);
  }
};

let sink: Sink = defaultSink;

/** Tests capture lines with this; pass null to restore the console sink. */
export function __setLogSinkForTests(s: Sink | null): void {
  sink = s ?? defaultSink;
}

function write(level: LogLevel, event: string, fields?: LogFields): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ? scrubFields(fields) : {}),
  });
  sink(level, line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
