/**
 * Public endpoint map (A§4.3): method, path, request and response schemas.
 * Route handlers (WP1–WP4) validate with these; `client.ts` calls these paths. Client-safe.
 */
import type { z } from "zod";
import {
  BuildingRequestResponseSchema,
  BuildingRequestSchema,
  CheckRequestSchema,
  CheckResponseSchema,
  CheckWithCurrentSchema,
  CoverageQuerySchema,
  CoverageResponseSchema,
  EventRequestSchema,
  ExtractResponseSchema,
  HealthResponseSchema,
  LeadRequestSchema,
  LeadResponseSchema,
  LeadsResponseSchema,
  MatchQuerySchema,
  MatchResponseSchema,
  MetaResponseSchema,
  MeViewSchema,
  RecoverRequestSchema,
  RecoveryLinkResponseSchema,
  SavedItemResponseSchema,
  SavedListResponseSchema,
  SaveRequestSchema,
} from "@/lib/validation/api";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface Endpoint {
  method: HttpMethod;
  /** Path template; `:name` segments are filled by `pathFor`. */
  path: string;
  /** JSON body schema ("multipart" for /api/extract), or null for no body. */
  request: z.ZodType | "multipart" | null;
  /** Query schema for GET endpoints that take a query string. */
  query?: z.ZodType;
  /** 2xx JSON body schema, or null for 204. */
  response: z.ZodType | null;
  /** Success status. */
  status: number;
  /** Anonymous cookie: "required" issues one; "optional" reads it and never sets one; "none" ignores it. */
  anon: "required" | "optional" | "none";
}

export const CONTRACT = {
  extract: {
    method: "POST",
    path: "/api/extract",
    request: "multipart",
    response: ExtractResponseSchema,
    status: 200,
    anon: "required",
  },
  match: {
    method: "GET",
    path: "/api/buildings/match",
    request: null,
    query: MatchQuerySchema,
    response: MatchResponseSchema,
    status: 200,
    anon: "none",
  },
  buildings: {
    method: "GET",
    path: "/api/buildings",
    request: null,
    query: CoverageQuerySchema,
    response: CoverageResponseSchema,
    status: 200,
    anon: "none",
  },
  meta: {
    method: "GET",
    path: "/api/meta",
    request: null,
    response: MetaResponseSchema,
    status: 200,
    anon: "none",
  },
  createCheck: {
    method: "POST",
    path: "/api/checks",
    request: CheckRequestSchema,
    response: CheckResponseSchema,
    status: 201,
    anon: "required",
  },
  getCheck: {
    method: "GET",
    path: "/api/checks/:code",
    request: null,
    response: CheckWithCurrentSchema,
    status: 200,
    anon: "none",
  },
  savedList: {
    method: "GET",
    path: "/api/saved",
    request: null,
    response: SavedListResponseSchema,
    status: 200,
    anon: "optional",
  },
  savedAdd: {
    method: "POST",
    path: "/api/saved",
    request: SaveRequestSchema,
    response: SavedItemResponseSchema,
    status: 201,
    anon: "required",
  },
  savedRemove: {
    method: "DELETE",
    path: "/api/saved/:code",
    request: null,
    response: null,
    status: 204,
    anon: "required",
  },
  savedSeen: {
    method: "POST",
    path: "/api/saved/:code/seen",
    request: null,
    response: null,
    status: 204,
    anon: "required",
  },
  leadsCreate: {
    method: "POST",
    path: "/api/leads",
    request: LeadRequestSchema,
    response: LeadResponseSchema,
    status: 201,
    anon: "required",
  },
  leadsWithdraw: {
    method: "POST",
    path: "/api/leads/:id/withdraw",
    request: null,
    response: LeadResponseSchema,
    status: 200,
    anon: "required",
  },
  leadsList: {
    method: "GET",
    path: "/api/leads",
    request: null,
    response: LeadsResponseSchema,
    status: 200,
    anon: "required",
  },
  meGet: { method: "GET", path: "/api/me", request: null, response: MeViewSchema, status: 200, anon: "optional" },
  meDelete: { method: "DELETE", path: "/api/me", request: null, response: null, status: 204, anon: "optional" },
  meRecoveryLink: {
    method: "POST",
    path: "/api/me/recovery-link",
    request: null,
    response: RecoveryLinkResponseSchema,
    status: 200,
    anon: "required",
  },
  meRecover: { method: "POST", path: "/api/me/recover", request: RecoverRequestSchema, response: null, status: 204, anon: "none" },
  requestsCreate: {
    method: "POST",
    path: "/api/requests",
    request: BuildingRequestSchema,
    response: BuildingRequestResponseSchema,
    status: 201,
    anon: "required",
  },
  events: { method: "POST", path: "/api/events", request: EventRequestSchema, response: null, status: 204, anon: "required" },
  health: { method: "GET", path: "/api/health", request: null, response: HealthResponseSchema, status: 200, anon: "none" },
} as const satisfies Record<string, Endpoint>;

export type EndpointName = keyof typeof CONTRACT;

/** Fill `:name` segments: pathFor("getCheck", { code: "K7Q2MX" }) → "/api/checks/K7Q2MX". */
export function pathFor(name: EndpointName, params: Record<string, string | number> = {}): string {
  return CONTRACT[name].path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`pathFor(${name}): missing :${key}`);
    return encodeURIComponent(String(v));
  });
}
