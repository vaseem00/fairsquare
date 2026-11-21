import { defineConfig } from "drizzle-kit";

// `npm run db:generate` needs no database: it diffs src/lib/db/schema.ts against drizzle/meta.
// Never use `drizzle-kit push` against Railway; migrations are applied on boot (src/instrumentation.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
