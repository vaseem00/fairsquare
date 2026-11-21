import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Modules that render in the browser must never pull in server-only code (A§1).
const CLIENT_SAFE_FILES = [
  "src/lib/domain/**",
  "src/lib/result/**",
  "src/lib/copy.ts",
  "src/lib/format.ts",
  "src/lib/types.ts",
  "src/lib/utils.ts",
  "src/lib/validation/fields.ts",
  "src/lib/validation/api.ts",
  "src/lib/validation/index.ts",
  "src/lib/api/**",
];

const SERVER_ONLY_MESSAGE =
  "Client-safe module: do not import server-only code here (A§1). Use src/lib/api/client.ts or props from a server component.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-danger": "error",
      "no-console": "error",
    },
  },
  {
    // Product code never ships test data (REAL_DATA.md section 8): nothing under src/ imports tests/.
    files: ["src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/tests/**", "**/tests"], message: "Test fixtures stay under tests/ (REAL_DATA.md section 8)." }] },
      ],
    },
  },
  {
    // shadcn's chart writes a <style> tag built from the static chart config (colour tokens), never
    // from user input. It is the one allowed exception to react/no-danger.
    files: ["src/components/ui/chart.tsx"],
    rules: { "react/no-danger": "off" },
  },
  {
    files: CLIENT_SAFE_FILES,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "server-only", message: SERVER_ONLY_MESSAGE },
            { name: "next/headers", message: SERVER_ONLY_MESSAGE },
          ],
          patterns: [
            {
              group: [
                "@/lib/db/*",
                "@/lib/ingest/*",
                "@/lib/env",
                "@/lib/config",
                "@/lib/extract-circuit",
                "@/lib/log",
                "@/lib/claude/*",
                "@/lib/auth/*",
                "@/lib/rate-limit",
                "@/lib/rate-limit/*",
                "@/lib/http/*",
                "@/lib/services/*",
                "@/lib/csv/*",
                "@/lib/csp",
                "node:*",
                "pg",
                "@electric-sql/pglite",
                "@anthropic-ai/sdk",
              ],
              message: SERVER_ONLY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / local data:
    "drizzle/**",
    "coverage/**",
    ".data/**",
    "playwright-report/**",
    "test-results/**",
    "test-results-switch/**",
  ]),
]);

export default eslintConfig;
