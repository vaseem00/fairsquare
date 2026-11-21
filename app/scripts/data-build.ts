/**
 * npm run data:build -- --in <file.csv|file.zip> [--in <another>] --dataset-url <url> --downloaded <YYYY-MM-DD>
 *                       [--dataset-title "<title>"] [--out <dir>] [--built <YYYY-MM-DD>]
 *
 * Builds the open-data snapshot (REAL_DATA.md section 3) from the Data.Dubai "Transactions" download:
 * writes data/open-data/sales.csv.gz, buildings.csv.gz, similar-cells.csv.gz (the similar-buildings
 * model, REAL_DATA.md section 15), acs-model.json.gz (adjusted registered sales, section 16) and manifest.json and prints the report to read before committing. Files are streamed (a 1 GB CSV is fine); a .zip is read with Node built-ins.
 * Keep the raw downloads outside the repository (../raw-data/). No network, no database.
 */
import path from "node:path";

const USAGE =
  "Usage: npm run data:build -- --in <file.csv|file.zip> [--in <another>] --dataset-url <https://data.dubai/...> " +
  '--downloaded <YYYY-MM-DD> [--dataset-title "Transactions"] [--out data/open-data] [--built <YYYY-MM-DD>]';

export interface DataBuildArgs {
  inputs: string[];
  datasetUrl: string;
  downloadedOn: string;
  datasetTitle: string;
  outDir: string;
  /** The day of the build for manifest.similar.builtOn; absent: the download day. */
  builtOn?: string;
}

export const DEFAULT_DATASET_TITLE = "DLD Transactions";

/** Parses the arguments (also `--name=value`). Throws with the usage line when something is missing. */
export function parseArgs(argv: readonly string[], cwd: string = process.cwd()): DataBuildArgs {
  const inputs: string[] = [];
  const single = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument: ${a}. ${USAGE}`);
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value. ${USAGE}`);
    if (name === "in") inputs.push(path.resolve(cwd, value));
    else if (["dataset-url", "downloaded", "dataset-title", "out", "built"].includes(name)) single.set(name, value);
    else throw new Error(`Unknown option --${name}. ${USAGE}`);
  }
  if (inputs.length === 0) throw new Error(`--in is missing. ${USAGE}`);
  const datasetUrl = single.get("dataset-url");
  const downloadedOn = single.get("downloaded");
  if (!datasetUrl) throw new Error(`--dataset-url is missing. ${USAGE}`);
  if (!downloadedOn) throw new Error(`--downloaded is missing. ${USAGE}`);
  return {
    inputs,
    datasetUrl,
    downloadedOn,
    datasetTitle: single.get("dataset-title") ?? DEFAULT_DATASET_TITLE,
    outDir: path.resolve(cwd, single.get("out") ?? path.join("data", "open-data")),
    ...(single.has("built") ? { builtOn: single.get("built") } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { acsFitTooOld, buildSnapshot, formatReport, nearbyFitTooOld, similarFitTooOld } = await import("@/lib/ingest/build");
  const report = await buildSnapshot({
    ...args,
    onProgress: (n) => process.stderr.write(`  ${n.toLocaleString("en-US")} rows read\n`),
  });
  process.stdout.write(`${formatReport(report)}\n`);
  // The snapshot is written and loads, but without the second tier: fail loudly so it is not committed unnoticed.
  if (similarFitTooOld(report.manifest)) {
    process.stderr.write(
      "ERROR: the similar-buildings constants are too old for this data. The snapshot was written, but the site will show no similar-buildings comparison with it. Refit them (scripts/model/README.md) and build again.\n",
    );
    process.exitCode = 2;
  }
  // The same for the first answer: the snapshot loads, and the site falls back to the median and the second tier.
  if (acsFitTooOld(report.manifest)) {
    process.stderr.write(
      "ERROR: the adjusted-registered-sales fit is too old for this data. The snapshot was written, but the site will not use adjusted registered sales with it. Refit (scripts/model/README.md) and build again.\n",
    );
    process.exitCode = 2;
  }
  // And for the last resort: the snapshot loads, and a listing with no comparison of its own gets none.
  if (nearbyFitTooOld(report.manifest)) {
    process.stderr.write(
      "ERROR: the nearby-registered-sales constants are too old for this data. The snapshot was written, but the site will not compare with nearby registered sales with it. Refit (scripts/model/README.md) and build again.\n",
    );
    process.exitCode = 2;
  }
}

// Run only as a script (tests import parseArgs).
const invoked = process.argv[1] ? path.basename(process.argv[1]).replace(/\.[cm]?[jt]s$/, "") : "";
if (invoked === "data-build") {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
