import "server-only";
/**
 * The structured-output schema sent to Claude (A§5.3) and its Zod mirror, used to validate the reply.
 * Every property is required; "not visible" is expressed as null, never by leaving a key out.
 */
import { z } from "zod";
import { COMPLETIONS, PROPERTY_TYPES } from "@/lib/validation/api";

const nullable = <T extends "string" | "integer" | "number">(type: T) =>
  ({ anyOf: [{ type }, { type: "null" }] }) as const;

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_listing: { type: "boolean" },
    listing_type: { type: "string", enum: ["sale", "rent", "unknown"] },
    property_type: { type: "string", enum: ["apartment", "villa", "townhouse", "other", "unknown"] },
    completion: { type: "string", enum: ["ready", "off_plan", "unknown"] },
    building_text: nullable("string"),
    area_text: nullable("string"),
    bedrooms: nullable("integer"),
    size_sqft: nullable("number"),
    price_aed: nullable("number"),
    contact_details_visible: { type: "boolean" },
  },
  required: [
    "is_listing",
    "listing_type",
    "property_type",
    "completion",
    "building_text",
    "area_text",
    "bedrooms",
    "size_sqft",
    "price_aed",
    "contact_details_visible",
  ],
  additionalProperties: false,
} as const;

/**
 * Zod mirror of EXTRACTION_JSON_SCHEMA (snake_case, as Claude returns it). Numbers are only checked to be
 * numbers here; range clean-up happens in post-processing (A§5.5), so an odd value becomes null instead
 * of failing the whole read.
 */
export const ExtractionSchema = z
  .object({
    is_listing: z.boolean(),
    listing_type: z.enum(["sale", "rent", "unknown"]),
    property_type: z.enum(PROPERTY_TYPES),
    completion: z.enum(COMPLETIONS),
    building_text: z.string().nullable(),
    area_text: z.string().nullable(),
    bedrooms: z.number().nullable(),
    size_sqft: z.number().nullable(),
    price_aed: z.number().nullable(),
    contact_details_visible: z.boolean(),
  })
  .strict();

export type Extraction = z.output<typeof ExtractionSchema>;
