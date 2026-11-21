/**
 * DESIGN.md section 2.1: every token in both themes, and the WCAG 2 contrast pairs
 * (text 4.5:1; control boundaries, focus rings and meaningful marks 3:1), measured from globals.css.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  const vars: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = block(":root");
const dark = { ...light, ...block(".dark") };

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** docs/REDESIGN.md section 3.2 values: two inks on paper. */
const LIGHT: Record<string, string> = {
  background: "#F5F4F0", foreground: "#17191E", card: "#FDFCF9", "card-foreground": "#17191E",
  popover: "#FDFCF9", "popover-foreground": "#17191E", primary: "#17191E", "primary-foreground": "#F5F4F0",
  "primary-hover": "#2C2F36",
  secondary: "#ECEAE4", "secondary-foreground": "#17191E", muted: "#ECEAE4", "muted-foreground": "#595C65",
  accent: "#E8E5DD", "accent-foreground": "#17191E", destructive: "#B3261E", "destructive-foreground": "#FFFFFF",
  border: "#DEDBD3", input: "#7A7D85", ring: "#17191E", "chart-1": "#3B5B7A", "chart-2": "#3A37C9",
  "chart-3": "#17191E", "chart-4": "#E7E4DC", "chart-5": "#8F4A0A", stamp: "#3A37C9",
  "verdict-above": "#8F4A0A", "verdict-inline": "#17191E", "verdict-below": "#1E5B98",
  notice: "#F5EACD", "notice-foreground": "#6B4300",
};
const DARK: Record<string, string> = {
  background: "#121317", foreground: "#ECE9E2", card: "#1B1D22", "card-foreground": "#ECE9E2",
  popover: "#1B1D22", "popover-foreground": "#ECE9E2", primary: "#ECE9E2", "primary-foreground": "#121317",
  "primary-hover": "#D7D3CB",
  secondary: "#24272D", "secondary-foreground": "#ECE9E2", muted: "#24272D", "muted-foreground": "#A3A6AE",
  accent: "#2A2D34", "accent-foreground": "#ECE9E2", destructive: "#F2867E", "destructive-foreground": "#121317",
  border: "#2C2F36", input: "#7A7E87", ring: "#ECE9E2", "chart-1": "#8FB3D9", "chart-2": "#A9A7FF",
  "chart-3": "#ECE9E2", "chart-4": "#24272D", "chart-5": "#EBA65A", stamp: "#A9A7FF",
  "verdict-above": "#EBA65A", "verdict-inline": "#ECE9E2", "verdict-below": "#86B6EE",
  notice: "#3A2D12", "notice-foreground": "#F0C46C",
};

const TEXT: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "accent"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "primary-hover"],
  ["primary", "background"],
  ["primary", "card"],
  ["accent-foreground", "accent"],
  ["secondary-foreground", "secondary"],
  ["destructive", "card"],
  ["destructive", "background"],
  ["destructive-foreground", "destructive"],
  ["verdict-above", "card"],
  ["verdict-above", "background"],
  ["verdict-above", "muted"],
  ["verdict-inline", "card"],
  ["verdict-inline", "background"],
  ["verdict-inline", "muted"],
  ["verdict-below", "card"],
  ["verdict-below", "background"],
  ["verdict-below", "muted"],
  ["notice-foreground", "notice"],
  ["notice-foreground", "background"],
  ["stamp", "card"],
  ["stamp", "background"],
  ["stamp", "chart-4"],
  ["chart-3", "chart-4"],
];

const NON_TEXT: Array<[string, string]> = [
  ["input", "card"],
  ["input", "background"],
  ["input", "accent"],
  ["input", "muted"],
  ["ring", "background"],
  ["ring", "card"],
  ["chart-1", "card"],
  ["chart-1", "background"],
];

describe("design tokens (docs/REDESIGN.md section 3)", () => {
  it("has no demo tokens any more (REAL_DATA.md section 8)", () => {
    expect(css).not.toMatch(/--(color-)?demo/);
  });

  it.each([
    ["light", light, LIGHT],
    ["dark", dark, DARK],
  ] as const)("%s theme has every token with the spec value", (_name, vars, spec) => {
    for (const [k, v] of Object.entries(spec)) expect(vars[k]?.toLowerCase(), k).toBe(v.toLowerCase());
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme: text pairs reach 4.5:1", (_name, vars) => {
    for (const [fg, bg] of TEXT) {
      const ratio = contrast(vars[fg], vars[bg]);
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme: control boundaries, focus ring and chart marks reach 3:1", (_name, vars) => {
    for (const [fg, bg] of NON_TEXT) {
      const ratio = contrast(vars[fg], vars[bg]);
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("matches the measured values in the spec table", () => {
    expect(contrast(LIGHT.foreground, LIGHT.background)).toBeCloseTo(15.98, 1);
    expect(contrast(LIGHT.input, LIGHT.background)).toBeCloseTo(3.74, 1);
    expect(contrast(DARK.input, DARK.card)).toBeCloseTo(4.14, 1);
    expect(contrast(LIGHT.stamp, LIGHT.background)).toBeCloseTo(7.43, 1);
  });

  it("two inks: no teal or petrol left in either theme, and the stamp hue only on stamp tokens", () => {
    for (const vars of [LIGHT, DARK]) {
      for (const [k, v] of Object.entries(vars)) {
        expect(/^#(0f4c5c|6bbbcb|dcecef|173840)$/i.test(v), `${k}: ${v}`).toBe(false);
        if (v.toLowerCase() === vars.stamp.toLowerCase()) expect(["stamp", "chart-2"]).toContain(k);
      }
    }
  });

  it("focus on a filled control is a separate ring: a background-coloured offset, since --ring equals --primary", async () => {
    // ring and primary are the same ink (1:1), so a ring flush with an ink fill would be invisible.
    expect(LIGHT.ring).toBe(LIGHT.primary);
    const { buttonVariants } = await import("@/components/ui/button");
    for (const variant of ["default", "destructive", "outline"] as const) {
      const cls = buttonVariants({ variant });
      expect(cls).toContain("focus-visible:ring-offset-2");
      expect(cls).toContain("focus-visible:ring-offset-background");
    }
    // The gap is the page background, which contrasts with the fill.
    expect(contrast(LIGHT.background, LIGHT.primary)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.background, DARK.primary)).toBeGreaterThanOrEqual(3);
  });

  it("cn() treats the type scale as font sizes, so text colours survive", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn("flex text-caption text-muted-foreground")).toBe("flex text-caption text-muted-foreground");
    expect(cn("text-sm text-muted-foreground", "text-body")).toBe("text-muted-foreground text-body");
    expect(cn("text-title", "text-heading")).toBe("text-heading");
  });

  it("registers the stamp faces and the type, radius, motion and offset tokens", () => {
    expect(css).toContain('font-family: "Mizan Stamp Condensed"');
    expect(css).toContain('url("/fonts/archivo-stamp-condensed.woff")');
    expect(css).toContain('font-family: "Mizan Stamp Wide"');
    expect(css).toContain('url("/fonts/archivo-stamp-wide.woff")');
    expect(css).toMatch(/font-display: block/);
    for (const t of ["--text-caption: 0.875rem", "--text-display: 3rem", "--radius-sm: 4px", "--radius-xl: 12px", "--radius-md: 6px"]) {
      expect(css).toContain(t);
    }
    for (const t of ["--dur-press: 80ms", "--dur-set: 220ms", "--dur-sheet: 280ms", "--header-h: 56px", "--header-h: 64px", "--action-bar-h: 0px"]) {
      expect(css).toContain(t);
    }
    expect(css).toContain("--font-sans: var(--font-archivo)");
    expect(css).toContain("--font-display: var(--font-newsreader)");
    expect(css).toMatch(/@utility num\s*{\s*font-variant-numeric: tabular-nums lining-nums;/);
    // The public type scale: Newsreader display, heading, title, statement, lead and prose utilities.
    for (const u of ["type-display-xl", "type-display-lg", "type-display-md", "type-heading", "type-title", "type-statement", "type-lead", "type-prose"]) {
      expect(css).toMatch(new RegExp(`@utility ${u} \\{\\s*font-family: var\\(--font-display\\)`));
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/backdrop-filter|blur\(/);
  });
});
