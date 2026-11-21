/**
 * Manual smoke test of screenshot reading against the real Claude API (WP2). Needs ANTHROPIC_API_KEY in
 * the environment or .env.local; tests never call this.
 *
 *   npx tsx --conditions=react-server scripts/try-extract.ts <screenshot.png|jpg|webp> [--text "pasted text"] [--match]
 *   npx tsx --conditions=react-server scripts/try-extract.ts --text-file tests/fixtures/listings/marina-listing.txt --match
 *
 * Prints the request shape (without the image), the outcome, the fields and the latency. With --match it
 * also runs building matching against the local database (stop `npm run dev` first: PGlite takes a lock).
 * The screenshot is read into memory and sent to Anthropic only; nothing is written anywhere.
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function usage(): never {
  out("Usage: npx tsx --conditions=react-server scripts/try-extract.ts <image> [--text \"...\"] [--text-file path] [--match]");
  process.exit(2);
}

function parseArgs(argv: string[]) {
  let imagePath: string | undefined;
  let text: string | undefined;
  let match = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text") text = argv[++i];
    else if (a === "--text-file") text = readFileSync(argv[++i] ?? "", "utf8");
    else if (a === "--match") match = true;
    else if (a === "--help" || a === "-h") usage();
    else if (!a.startsWith("--") && !imagePath) imagePath = a;
    else usage();
  }
  if (!imagePath && !text) usage();
  return { imagePath, text, match };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { getEnv } = await import("@/lib/env");
  const { sniffImage } = await import("@/lib/image/sniff");
  const { buildRequest, extractListing } = await import("@/lib/claude/extract");
  const { isExtractError } = await import("@/lib/claude/errors");

  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    out("ANTHROPIC_API_KEY is not set (add it to .env.local). Nothing was sent.");
    process.exitCode = 1;
    return;
  }

  let image: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string } | undefined;
  if (args.imagePath) {
    const bytes = new Uint8Array(readFileSync(args.imagePath));
    if (bytes.byteLength > env.MAX_IMAGE_BYTES) {
      out(`The image is ${bytes.byteLength} bytes; the limit is ${env.MAX_IMAGE_BYTES}.`);
      process.exitCode = 1;
      return;
    }
    const mediaType = sniffImage(bytes);
    if (!mediaType) {
      out("Not a JPEG, PNG or WebP file (checked by magic bytes).");
      process.exitCode = 1;
      return;
    }
    image = { mediaType, base64: Buffer.from(bytes).toString("base64") };
    out(`Image: ${mediaType}, ${bytes.byteLength} bytes`);
  }
  const text = args.text?.trim() || undefined;

  const body = buildRequest({ image, text });
  out(
    `Request: model=${body.model} max_tokens=${body.max_tokens} effort=${body.output_config?.effort} ` +
      `betas=${JSON.stringify(body.betas)} fallbacks=${JSON.stringify(body.fallbacks)} thinking=${"thinking" in body ? "SENT" : "not sent"} ` +
      `timeout=${env.CLAUDE_TIMEOUT_MS}ms`,
  );

  const ac = new AbortController();
  process.once("SIGINT", () => ac.abort());
  const started = performance.now();
  try {
    const result = await extractListing({ image, text }, { signal: ac.signal });
    const ms = Math.round(performance.now() - started);
    out(`Latency: ${ms} ms${ms >= 25_000 ? " (OVER the 25 s budget)" : ""}`);
    out(JSON.stringify(result, null, 2));
    if (args.match && result.fields.buildingText) {
      const { closeDb, dbKind, getDb } = await import("@/lib/db/client");
      const { applyMigrations } = await import("@/lib/db/migrate");
      const { matchBuildings } = await import("@/lib/services/match");
      const { dubaiToday } = await import("@/lib/domain/dates");
      try {
        const db = getDb();
        // Matches against whatever the local database holds (the open-data snapshot once loaded).
        await applyMigrations(db, dbKind());
        const f = result.fields;
        const m = await matchBuildings(db, f.buildingText as string, f.areaText, f.bedrooms, dubaiToday());
        const pre = m.candidates.find((c) => c.buildingId === m.preselectId);
        out(`Match: preselect=${pre ? pre.name : "none"} towerCheck=${m.towerCheck}`);
        out(JSON.stringify(m.candidates, null, 2));
      } finally {
        await closeDb();
      }
    }
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    if (isExtractError(err)) {
      out(`Failed after ${ms} ms: ${err.code} (HTTP ${err.status}) ${JSON.stringify(err.detail)}`);
    } else {
      out(`Failed after ${ms} ms: ${err instanceof Error ? err.name : String(err)}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
