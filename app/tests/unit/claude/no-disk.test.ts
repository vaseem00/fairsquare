/**
 * A§5.7: screenshots are never written to disk. The extraction code must not import the file system at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const DIRS = ["src/lib/claude", "src/lib/image", "src/app/api/extract"];

function files(dir: string): string[] {
  const abs = path.join(root, dir);
  return readdirSync(abs).flatMap((name) => {
    const p = path.join(abs, name);
    return statSync(p).isDirectory() ? files(path.join(dir, name)) : [p];
  });
}

describe("no file-system access in extraction code", () => {
  const all = DIRS.flatMap(files).filter((f) => /\.(ts|tsx)$/.test(f));

  it("finds the extraction sources", () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it.each(DIRS)("%s imports neither fs nor fs/promises and writes no files", (dir) => {
    for (const file of files(dir)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']/);
      expect(src, file).not.toMatch(/require\(\s*["'](node:)?fs(\/promises)?["']\s*\)/);
      expect(src, file).not.toMatch(/\b(writeFile|writeFileSync|createWriteStream|appendFile)\b/);
    }
  });
});
