import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const abs = (p: string) => path.resolve(root, p).replace(/\\/g, "/");

// Golden tests replay the model on frozen Data.Dubai rows. This repository does not redistribute those rows
// (see docs/DATA_COLLECTION.md), so the tests that need them run only after you rebuild the fixtures locally
// (app/scripts/model/README.md). Everything else runs from a fresh clone.
const hasGoldenData = existsSync(path.join(root, "tests/fixtures/acs/acs-model.json.gz"));
const needsGoldenData = hasGoldenData
  ? []
  : [
      "tests/unit/domain/acs-golden.test.ts",
      "tests/unit/acs/build-parity.test.ts",
      "tests/unit/domain/nearby-golden.test.ts",
      "tests/unit/domain/project.test.ts",
    ];

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: abs("tests/helpers/empty.ts") },
      { find: /^@\//, replacement: `${abs("src")}/` },
    ],
  },
  test: {
    // jsdom per file with `// @vitest-environment jsdom` (tests/ui/**).
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", ...needsGoldenData],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/domain/**"],
      reporter: ["text", "html"],
      thresholds: { lines: 100, functions: 100, statements: 100 },
    },
  },
});
