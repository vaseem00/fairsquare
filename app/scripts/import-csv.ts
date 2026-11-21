/**
 * npm run import:csv -- --kind sales|buildings|aliases --file path/to/file.csv [--commit]
 *
 * The same import as the admin "Import CSV" tab (A§4.4). It is a dry run unless --commit is passed:
 * the dry run checks every row and prints the counts, rejected rows and median impact, and writes
 * nothing. With --commit every row goes in one transaction. Prints the ImportResult as JSON on stdout.
 * Do not run against the local PGlite database while `npm run dev` holds its lock.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

const KINDS = ["sales", "buildings", "aliases"] as const;
type Kind = (typeof KINDS)[number];

export interface CliArgs {
  kind: Kind;
  file: string;
  commit: boolean;
}

/** Parses `--kind x --file y [--commit]` (also `--kind=x`). Throws with a usage line when invalid. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const kind = get("kind");
  const file = get("file");
  const usage = "Usage: npm run import:csv -- --kind sales|buildings|aliases --file path/to/file.csv [--commit]";
  if (!kind || !(KINDS as readonly string[]).includes(kind)) throw new Error(`--kind is missing or unknown. ${usage}`);
  if (!file || file.startsWith("--")) throw new Error(`--file is missing. ${usage}`);
  return { kind: kind as Kind, file, commit: argv.includes("--commit") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const { getEnv } = await import("@/lib/env");
  const { log } = await import("@/lib/log");
  const { closeDb, dbKind, getDb } = await import("@/lib/db/client");
  const { applyMigrations } = await import("@/lib/db/migrate");
  const { dubaiToday } = await import("@/lib/domain/dates");
  const { importCsv } = await import("@/lib/csv/import");

  const text = readFileSync(path.resolve(process.cwd(), args.file), "utf8");
  try {
    await applyMigrations(getDb(), dbKind());
    const result = await importCsv(getDb(), {
      kind: args.kind,
      text,
      commit: args.commit,
      today: dubaiToday(),
      rules: getEnv().rules,
    });
    log.info("import_csv_done", {
      kind: result.kind,
      rows: result.rows,
      ok: result.ok,
      rejected: result.rejectedCount,
      created: result.created,
      skipped: result.skippedDuplicates,
      committed: result.committed,
      dryRun: !args.commit,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeDb();
  }
}

// Run only as a script (tests import parseArgs).
const invoked = process.argv[1] ? path.basename(process.argv[1]).replace(/\.[cm]?[jt]s$/, "") : "";
if (invoked === "import-csv") {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
