/**
 * Shared DTO types (A§4.1–4.2), inferred from the Zod schemas in `validation/api.ts`.
 * Client-safe: type-only imports. Server row types live in `src/lib/db/schema.ts`.
 */
import type { z } from "zod";
import type {
  AcsComparableSchema,
  AcsStoredSchema,
  AcsViewSchema,
  AnalysisViewSchema,
  ApiErrorSchema,
  BuildingRefSchema,
  BuildingRequestResponseSchema,
  BuildingRequestSchema,
  CandidateViewSchema,
  CheckRequestSchema,
  CheckViewSchema,
  CoverageBuildingSchema,
  CoverageQuerySchema,
  CoverageResponseSchema,
  CoverageTypeSchema,
  DataStatusSchema,
  ExtractedFieldsSchema,
  ExtractResponseSchema,
  FromTheDataSchema,
  LeadRequestSchema,
  LeadViewSchema,
  MatchResponseSchema,
  MetaResponseSchema,
  MeViewSchema,
  NearbyComparableSchema,
  NearbyStoredSchema,
  NearbyViewSchema,
  PublicConfigSchema,
  RequestViewSchema,
  SavedItemViewSchema,
  SaleViewSchema,
  SimilarViewSchema,
  SizeClusterViewSchema,
  CHECK_BANDS,
  CHECK_SOURCES,
  CLIENT_EVENT_NAMES,
  COMPLETION_BASES,
  COMPLETIONS,
  CONSENT_VERSIONS,
  ERROR_CODES,
  EVENT_NAMES,
  EXTRACT_OUTCOMES,
  FIELD_KEYS,
  LEAD_STATUSES,
  PROPERTY_TYPES,
  RATE_LIMIT_SCOPES,
  SIZE_SOURCES,
} from "@/lib/validation/api";
import type { ListingFieldsSchema } from "@/lib/validation/fields";

export type { IsoDate } from "@/lib/domain/dates";

export type CheckBand = (typeof CHECK_BANDS)[number];
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type Completion = (typeof COMPLETIONS)[number];
/** The sales a listing is compared with: off-plan listings with off-plan sales, all others with ready ones. */
export type CompletionBasis = (typeof COMPLETION_BASES)[number];
export type CheckSource = (typeof CHECK_SOURCES)[number];
/** Where a comparison's size came from: read, typed, or a size button ("cluster", "about 815 sq ft"). */
export type SizeSource = (typeof SIZE_SOURCES)[number];
export type FieldKey = (typeof FIELD_KEYS)[number];
export type ExtractOutcome = (typeof EXTRACT_OUTCOMES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type ConsentVersion = (typeof CONSENT_VERSIONS)[number];

/** Exactly the codes of the A§4.1 table. */
export type ErrorCode = (typeof ERROR_CODES)[number];
/** `rate_limited` messages depend on the scope that `enforce()` passes. */
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

export type EventName = (typeof EVENT_NAMES)[number];
/** Client-reportable events (allowlist for POST /api/events). */
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export type ListingFields = z.output<typeof ListingFieldsSchema>;
export type ExtractedFields = z.output<typeof ExtractedFieldsSchema>;
export type BuildingRef = z.output<typeof BuildingRefSchema>;
export type CandidateView = z.output<typeof CandidateViewSchema>;
/** A size button on the preselected candidate (`CandidateView.sizes`). */
export type SizeClusterView = z.output<typeof SizeClusterViewSchema>;
export type MatchResponse = z.output<typeof MatchResponseSchema>;
export type SaleView = z.output<typeof SaleViewSchema>;
export type AnalysisView = z.output<typeof AnalysisViewSchema>;
export type CheckView = z.output<typeof CheckViewSchema>;
/** The similar-buildings comparison stored with a comparison (the second tier, REAL_DATA.md section 15.4). */
export type SimilarView = z.output<typeof SimilarViewSchema>;
/** The adjusted-registered-sales result of a comparison (the first answer, REAL_DATA.md section 16.4). */
export type AcsView = z.output<typeof AcsViewSchema>;
export type AcsComparableView = z.output<typeof AcsComparableSchema>;
/** What the database row holds: the view plus the figures that stay on the server. */
export type AcsStored = z.output<typeof AcsStoredSchema>;
/** The nearby-registered-sales result of a comparison (the last resort, REAL_DATA.md section 17.4). */
export type NearbyView = z.output<typeof NearbyViewSchema>;
export type NearbyComparableView = z.output<typeof NearbyComparableSchema>;
/** What the database row holds: the view plus the figures that stay on the server. */
export type NearbyStored = z.output<typeof NearbyStoredSchema>;
export type SavedItemView = z.output<typeof SavedItemViewSchema>;
export type RequestView = z.output<typeof RequestViewSchema>;
export type LeadView = z.output<typeof LeadViewSchema>;
export type MeView = z.output<typeof MeViewSchema>;
export type CoverageType = z.output<typeof CoverageTypeSchema>;
export type CoverageBuilding = z.output<typeof CoverageBuildingSchema>;
export type CoverageResponse = z.output<typeof CoverageResponseSchema>;
/** GET /api/buildings query. */
export type CoverageQueryParams = z.input<typeof CoverageQuerySchema>;
export type ExtractResponse = z.output<typeof ExtractResponseSchema>;
export type PublicConfig = z.output<typeof PublicConfigSchema>;
export type DataStatusView = z.output<typeof DataStatusSchema>;
export type FromTheData = z.output<typeof FromTheDataSchema>;
export type MetaResponse = z.output<typeof MetaResponseSchema>;

/** POST /api/checks body (what the client sends). */
export type CheckRequest = z.input<typeof CheckRequestSchema>;
/** POST /api/leads body. */
export type LeadRequest = z.input<typeof LeadRequestSchema>;
/** POST /api/requests body. */
export type BuildingRequestBody = z.input<typeof BuildingRequestSchema>;
export type BuildingRequestResponse = z.output<typeof BuildingRequestResponseSchema>;

/** Every non-2xx JSON response is `{ error: ApiError }`. */
export type ApiError = z.output<typeof ApiErrorSchema>;
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

/** The empty MeView returned when there is no anon cookie. */
export const EMPTY_ME: MeView = Object.freeze({
  savedCount: 0,
  savedWithNewSales: 0,
  checksCount: 0,
  requests: [],
  leads: [],
}) as MeView;
