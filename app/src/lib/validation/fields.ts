/**
 * The shared listing field schema (client form + server), A§4.6.
 * It fixes the null-bedrooms bug: bedrooms is never nullable and "" never becomes 0 (Studio).
 */
import { z } from "zod";
import { FIELD_ERRORS, COPY } from "@/lib/copy";
import { CODE_RE } from "@/lib/domain/share-code";
import { isIsoDate } from "@/lib/domain/dates";

export const LIMITS = {
  buildingMax: 120,
  areaMax: 80,
  textMax: 4000,
  bedMin: 0,
  bedMax: 7,
  sizeMin: 150,
  sizeMax: 50_000,
  priceMin: 50_000,
  priceMax: 500_000_000,
  psfMin: 300,
  psfMax: 6_000,
} as const;

/** Prices are stored in bigint columns: round to whole dirhams (fils are never meaningful here). */
export function wholeAed(n: number): number {
  return Math.round(n);
}

export const ListingFieldsSchema = z
  .object({
    buildingText: z
      .string({ error: FIELD_ERRORS.buildingText })
      .trim()
      .min(2, { error: FIELD_ERRORS.buildingText })
      .max(LIMITS.buildingMax, { error: FIELD_ERRORS.buildingText }),
    areaText: z.string().trim().max(LIMITS.areaMax).nullable(),
    bedrooms: z
      .number({ error: FIELD_ERRORS.bedrooms })
      .int({ error: FIELD_ERRORS.bedrooms })
      .min(LIMITS.bedMin, { error: FIELD_ERRORS.bedrooms })
      .max(LIMITS.bedMax, { error: FIELD_ERRORS.bedrooms }),
    sizeSqft: z
      .number({ error: FIELD_ERRORS.sizeSqft })
      .gt(LIMITS.sizeMin, { error: FIELD_ERRORS.sizeSqft })
      .max(LIMITS.sizeMax, { error: FIELD_ERRORS.sizeSqft }),
    // Stored as a bigint: a typed "2,450,000.50" is rounded to whole dirhams, never sent as 2450000.5.
    priceAed: z
      .number({ error: FIELD_ERRORS.priceAed })
      .gt(LIMITS.priceMin, { error: FIELD_ERRORS.priceAed })
      .max(LIMITS.priceMax, { error: FIELD_ERRORS.priceAed })
      .transform(wholeAed),
  })
  .superRefine((f, ctx) => {
    const psf = f.priceAed / f.sizeSqft;
    if (psf < LIMITS.psfMin || psf > LIMITS.psfMax) {
      const message = FIELD_ERRORS.psf(psf);
      ctx.addIssue({ code: "custom", path: ["sizeSqft"], message });
      ctx.addIssue({ code: "custom", path: ["priceAed"], message });
    }
  });

/** Form layer only: "" / whitespace / NaN / null → undefined. NEVER use z.coerce.number ("" would become 0 = Studio). */
export function toNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** A share code (trimmed and uppercased first). */
export const CodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(CODE_RE, { error: COPY["cNotFound.h1"] });

export const IsoDateSchema = z.string().refine(isIsoDate, { error: COPY["err.date"] });

/** Positive integer id from a path segment or JSON. */
export const IdSchema = z.coerce.number().int().positive();
