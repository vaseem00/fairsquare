# Fairsquare web app: build plan

Renamed from Mizan to Fairsquare on 18 Nov 2026. Internal identifiers (storage keys, folders, the Railway service, the repo) keep the old name.

> **Status, 18 Nov 2026: the v1 build below is done, and the demo it describes is gone.** This file is kept as the record of how v1 was split and built. The `real-data` branch replaced the fictional demo with the Dubai Land Department open data on Data.Dubai; `docs/REAL_DATA.md` is the spec for that work and wins over this plan. These parts of the plan no longer exist: `DEMO_MODE`, `SEED_DEMO`, the demo seed (`seed.ts`, `demo-data.ts`, `refreshDemoDates`, `demo_anchor_date`, `npm run db:seed`), the sample listings and sample screenshots, the example card and the iPhone frame, `DemoBadge` and `DemoNotice`, the demo consent version `optin-v1-demo`, every demo label on the stamp, card and OG image, `isDemo` / `isSample` / `sample_not_allowed`, `DATA_SOURCE_LABEL` and the fictional partner. `MIN_SALES` is now 5. Fixtures live under `tests/` with synthetic TEST names (the old demo buildings are "Mockup Crest Tower", "Fake Vista Residences" and "Dummyside Heights" in `tests/fixtures/test-buildings.ts`). The real-data work was built in three stages (data layer and snapshot loader, comparison and server, UI and copy) and an integration pass; see the README for the data refresh procedure.

Owner: tech lead. Read `ARCHITECTURE.md` first. This plan refers to its section numbers ("A§x"). DESIGN.md sections are "D§x". Visual decisions, copy and component file names follow DESIGN.md, as ARCHITECTURE section 0.1 explains.

The work is split into **9 packages (WP0–WP8)** that different engineers can build in parallel. Every file has exactly one owner. WP0 delivers the shared contracts in about half a day ("milestone A"). After that, every other package starts at once and codes against frozen interfaces and fixtures.

Reconciled on 17 Nov 2026 (principal engineer). The decisions are in A§0.2. They changed: who owns `StepHeader`/`ActionBar` (now WP8), the example card and sample screenshot (now WP7), sample data and the circuit breaker (now WP0); building requests (explicit, through `POST /api/requests` with a code); saved-listing removal (soft delete with exact Undo) and the header badge (`seen`); admin routes (`sales`, `quality`); and `/how-it-works` (now WP7, because it embeds WP7's example and evidence, which keeps the package graph acyclic: WP8 → WP7 → WP6).

---

## 1. Ground rules

1. **One owner per file.** Only the owning package edits a file. If you need a change in a file you don't own, ask its owner in the PR thread, or the tech lead if the owner is unavailable.
2. **`package.json` belongs to WP0.** WP0 installs every dependency and UI component in milestone A. If you need a new one, ask the tech lead, who adds it in WP0 the same day.
3. **One migration stream.** Only WP0 edits `src/lib/db/schema.ts` and runs `npm run db:generate`. Ask for schema changes; never commit your own migration.
4. **Interfaces freeze at milestone A**: `types.ts`, `validation/*`, `api/contract.ts` and `client.ts`, domain signatures, `extract-circuit.ts`, `samples.ts`, the db schema, `copy.ts` keys, and the `route()` signature (WP1-A). A change needs tech-lead approval and a note in the team channel.
5. **Copy.** Every user-facing string is in `src/lib/copy.ts` (WP0). WP0 ports the complete DESIGN.md copy deck (D§6, including the D§6.12 `outcome.*`, `error.*`, `rate.*` keys and the D§6.13 admin keys) and the server-only error text (A§4.1, as `apiError.{code}`) in milestone A, using DESIGN's keys. If a package needs a new key, it asks WP0. There are no inline literals in JSX and no other copy files. The plan docs are copied into `mizan-app/docs/` in milestone A, so the copy-key test can read `docs/DESIGN.md`.
6. **Definition of done**, every package:
   - `npm run typecheck`, `npm run lint` and `npm test` are green, and the acceptance criteria below pass.
   - No `console.log`: use `src/lib/log.ts`.
   - Visuals match DESIGN.md, including the D§7 accessibility checklist items that apply to your files.
   - Mobile first: tested at 360 and 390 px, then 1024 and 1280 px, in light and dark.
   - The keyboard-only path works, and there are no serious or critical axe violations.
7. **Branches** are `wp<N>-<slug>` and merge into `main` by PR. The tech lead reviews each PR. Rebase daily.
8. **Never:** write screenshots to disk or upload them anywhere except `/api/extract`; log PII; use `next/headers` inside route handlers (A§0).

---

## 2. Scaffold assumptions (in progress, not a package)

Someone else is scaffolding `mizan-app` now. WP0 expects these and fixes any gaps:
- `package.json`, `tsconfig.json` (strict, `@/*` → `src/*`), `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/favicon.ico`, `src/lib/utils.ts`
- possibly some `src/components/ui/*` and `src/components/magicui/*`

On day 0, WP0 checks the Next version (16.x: `proxy.ts`, async `params`) and Tailwind v4. Once the scaffold lands, the owners in section 5.1 take these files over.

---

## 3. Order and dependencies

```
Day 0 (½ day)   WP0 milestone A: deps + UI kit + contracts + copy deck + fixtures + schema/migration 0000
Day 1           WP1 milestone A: route() wrapper, cookies, rate limit, events/anon repos, serverExternalPackages
                ─────────────────────────────────────────────────────────────────────────────────────────────
In parallel     WP0-B  domain impl, db client, migrate+seed, test harness
from day 0/1    WP1    platform, security, Railway
                WP2    Claude extraction + image handling
                WP3    core API: buildings, match, checks, requests
                WP4    user-data API: saved, leads, me, recovery
                WP5    admin: API, pages, CSV
                WP6    compare flow UI (home page, steps 1–3)
                WP7    stamp, example card, sample screenshots, result evidence, share, /c page, OG image, How it works
                WP8    shell, design system, flow chrome, Saved, Coverage, Privacy, money UI
                ─────────────────────────────────────────────────────────────────────────────────────────────
Last 1.5 days   Integration and release (tech lead), section 6
```

| package | imports from | can start against | must be merged before its own tests run |
|---|---|---|---|
| WP0-B | none | none | none |
| WP1 | WP0 | WP0-A | WP0-B (db) for repo tests |
| WP2 | WP0 (incl. `extract-circuit`), WP1, WP3 (`matchBuildings`) | stubs | WP1-A, WP0-B. Until WP3 merges, the match part returns an empty `MatchResponse`. |
| WP3 | WP0, WP1 | WP0-A | WP0-B, WP1-A |
| WP4 | WP0, WP1, WP3 (`getCheckRowByCode`, `recentSales`, `listRequestsForAnon`) | WP0-A | WP0-B, WP1-A, WP3 `checks.ts` and `requests.ts` |
| WP5 | WP0, WP1, WP3 (`invalidateAliasCache`, `recentSales`) | WP0-A | WP0-B, WP1 |
| WP6 | WP0, WP2 (`downscaleForUpload`), WP7 and WP8 components | fixtures | none for unit tests; WP2 and WP3 for live runs |
| WP7 | WP0, WP1 (`trackEvent`, `readAnonFromCookies`), WP3 (`getCheckWithCurrent` for `/c`), WP8 (`SaveButton`, `ActionBar`, `DemoBadge`, providers) | fixtures | WP3 for the `/c` page tests |
| WP8 | WP0 (api client, domain, copy), WP3 (`listCoverage` for `/coverage`) | fixtures | none for unit tests; WP3 for the Coverage page |

**Merge order:** WP0-A → WP1-A → WP0-B → WP3 → WP2, WP4 → WP5 → WP8 → WP7 → WP6 → integration. UI packages may merge earlier behind fixtures. The UI graph is acyclic: WP8 imports no WP6/WP7 code, WP7 imports WP8, WP6 imports both.

**Rough effort** (one engineer each): WP0 2.5 d (A: 0.5 d), WP1 2 d, WP2 1.5 d, WP3 2 d, WP4 2 d, WP5 3.5 d, WP6 3.5 d, WP7 5 d, WP8 3.5 d, integration 1.5 d.

---

## 4. Work packages

### WP0: Foundation (contracts, copy, domain, database)

**Milestone A** (first, about half a day; merge before anyone else starts):
- `package.json` scripts (A§7.2), `engines.node >= 22`, and every dependency:
  - runtime: `next@16 react@19 react-dom@19 @anthropic-ai/sdk@^1 zod@^4 drizzle-orm pg @electric-sql/pglite react-hook-form @hookform/resolvers lucide-react motion sonner next-themes papaparse server-only class-variance-authority clsx tailwind-merge tw-animate-css @tanstack/react-table`, plus the Radix, vaul, cmdk and recharts packages that the CLI adds below;
  - dev: `drizzle-kit vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event tsx @types/pg @types/papaparse @playwright/test @axe-core/playwright typescript eslint`.
- UI kit, exactly per D§4:
  - `npx shadcn@latest add button input textarea label field input-group select radio-group checkbox slider accordion collapsible alert alert-dialog badge card dialog drawer sheet popover command table tabs toggle-group skeleton spinner sonner separator dropdown-menu progress empty item kbd chart tooltip`
  - `npx shadcn@latest add @magicui/iphone @magicui/blur-fade @magicui/border-beam @magicui/number-ticker`
  - After milestone A, `src/components/ui/**` and `src/components/magicui/**` move to WP8.
- Contracts with real code, not stubs:
  - `src/lib/types.ts` (every DTO, `ErrorCode`, `EventName`, `ClientEventName`, `RequestView`, `CoverageResponse`; A§4.1–4.2); `src/lib/validation/{fields,api,index}.ts`; `src/lib/api/{contract,client,fixtures}.ts`
  - `src/lib/env.ts`, `src/lib/config.ts`, `src/lib/format.ts`, `src/lib/log.ts`
  - `src/lib/extract-circuit.ts` (A§5.6), fully implemented: it is tiny and `getPublicConfig()` needs it
  - `src/lib/samples.ts`: the four sample listings (Marina 2-bed, JVC 1-bed, Al Jaddaf 3-bed, Nowhere Point Tower) as `Sample` objects (interface below), using the A§2.4 known cases as their fields
  - `src/lib/copy.ts` with the **whole** DESIGN deck
  - `src/lib/db/schema.ts` (with `saved_listings.seen_at` / `removed_at` and `building_requests.check_id`, A§3.3) and migration `drizzle/0000_*`
  - `docs/{DESIGN,ARCHITECTURE,BUILD_PLAN}.md`: copies of the plan files
- Domain: every exported signature in A§2. Bodies may `throw new Error("not implemented")` until milestone B, **except** the pure helpers `fixtures.ts` needs, which are implemented in A.

**Milestone B:** domain implementations and tests, `db/client.ts`, `db/meta.ts`, `migrate.ts`, `seed.ts`, `demo-data.ts`, `instrumentation.ts`, scripts and the test harness.

**Owns:**
- `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs` (add `react/no-danger` and the A§1 `no-restricted-imports` rule that keeps client-safe modules free of `server-only` imports), `.gitignore` (add `.data/`, `.env*.local`), `.env.example`, `components.json`
- `vitest.config.ts`, `drizzle.config.ts`, `drizzle/**`
- `src/instrumentation.ts`
- `src/lib/utils.ts`, `src/lib/env.ts`, `src/lib/config.ts`, `src/lib/types.ts`, `src/lib/copy.ts`, `src/lib/format.ts`, `src/lib/log.ts`, `src/lib/extract-circuit.ts`, `src/lib/samples.ts`
- `src/lib/domain/{normalise,match,analyse,parse-fields,mortgage,share-code,phone,dates,index}.ts`
- `src/lib/validation/{fields,api,index}.ts`
- `src/lib/api/{contract,client,fixtures}.ts`
- `src/lib/db/{schema,client,migrate,seed,demo-data,meta}.ts`
- `scripts/{migrate,seed,reset-local}.ts`
- `tests/setup.ts`, `tests/helpers/{db,http,empty}.ts`
- `tests/unit/domain/*.test.ts`, `tests/unit/validation/*.test.ts`, `tests/unit/copy.test.ts`, `tests/unit/format.test.ts`, `tests/unit/extract-circuit.test.ts`, `tests/unit/samples.test.ts`, `tests/db/seed.test.ts`
- `src/components/ui/**` and `src/components/magicui/**` during milestone A only
- `docs/**` during milestone A only (then the tech lead)

**Provides:** A§2, A§3.1–3.3, A§3.5, A§4.2, A§4.6, and:
```ts
// src/lib/api/client.ts: one function per public endpoint; never throws on HTTP errors
export const api: {
  extract(input: { image?: Blob; text?: string }, signal?: AbortSignal): Promise<ApiResult<ExtractResponse>>;
  match(q: string, area?: string | null, beds?: number | null): Promise<ApiResult<MatchResponse>>;
  buildings(): Promise<ApiResult<CoverageResponse>>;
  createCheck(body: CheckRequest): Promise<ApiResult<{ check: CheckView }>>;
  getCheck(code: string): Promise<ApiResult<{ check: CheckView; current: AnalysisView }>>;
  saved: {
    list(): Promise<ApiResult<{ items: SavedItemView[] }>>;
    add(code: string): Promise<ApiResult<{ item: SavedItemView }>>;     // also the Undo after remove
    remove(code: string): Promise<ApiResult<null>>;
    markSeen(code: string): Promise<ApiResult<null>>;
  };
  leads: { create(body: LeadRequest): Promise<ApiResult<{ lead: LeadView }>>; withdraw(id: number): Promise<ApiResult<{ lead: LeadView }>>; list(): Promise<ApiResult<{ leads: LeadView[] }>> };
  me: { get(): Promise<ApiResult<MeView>>; remove(): Promise<ApiResult<null>>; recoveryLink(): Promise<ApiResult<{ url: string }>> };
  requests: { create(body: { text: string; area?: string; code?: string }): Promise<ApiResult<{ id: number; othersAsked: number; created: boolean }>> };
  track(name: ClientEventName, code?: string): void;          // fire-and-forget, keepalive
};
export function __setFetchForTests(f: typeof fetch | null): void;
// src/lib/api/fixtures.ts: built with the real domain + copy functions
export const FIXTURE_CONFIG: PublicConfig;                     // demo mode, optin-v1-demo, extractEnabled true
export const FIXTURE_CONFIG_CLAUDE_OFF: PublicConfig;          // extractEnabled false
export const FIXTURE_CHECK_MARINA: CheckView;                  // above, +14.0%, 11 demo sales
export const FIXTURE_CHECK_JVC: CheckView;                     // inline, −1.7%, 9
export const FIXTURE_CHECK_THIN: CheckView;                    // Dummyside Heights 2, 3-bed, 2 sales
export const FIXTURE_CHECK_NONE: CheckView;                    // Nowhere Point Tower
export const FIXTURE_CHECK_SAMPLE: CheckView;                  // isSample
export const FIXTURE_CHECK_OFFPLAN: CheckView;
export const FIXTURE_EXTRACT_OK: ExtractResponse;              // Marina fields, preselect Mockup Crest Tower, towerCheck true
export const FIXTURE_EXTRACT_CONTACT: ExtractResponse;         // contactDetailsVisible: true
export const FIXTURE_COVERAGE: CoverageResponse;               // the 6 demo buildings
export const FIXTURE_SAVED: SavedItemView[]; export const FIXTURE_ME: MeView;  // FIXTURE_ME has 1 request and 1 lead
// src/lib/extract-circuit.ts (A§5.6)
export function extractionEnabled(now?: number): boolean;
export function recordExtractOutcome(kind: "ok" | "server_fail" | "other", now?: number): void;
export function __resetCircuitForTests(): void;
// src/lib/samples.ts
export interface Sample { id: "marina" | "jvc" | "jaddaf" | "uncovered"; labelKey: CopyKey; fields: ListingFields; expectedBuildingName: string | null }
export const SAMPLES: readonly Sample[];
// src/lib/db/meta.ts
export async function getAppMeta(db: Db, key: "demo_anchor_date" | "data_imported_at"): Promise<string | null>;
export async function setAppMeta(db: Db, key: "demo_anchor_date" | "data_imported_at", value: string): Promise<void>;
```

**Acceptance criteria:**
- After milestone A merges, `npm install`, `npm run typecheck` and `npm run dev` all work, and every fixture typechecks.
- `copy.ts` covers every key in D§6, so a test compares the key list with a list extracted from `docs/DESIGN.md`. `t()` throws on a missing placeholder.
- `extract-circuit`: no key → `extractionEnabled()` false; three `server_fail` in a row → false for 5 minutes (faked clock), then true; one `ok` resets the count; `other` never trips it.
- `SAMPLES` run through `findCandidates` + `analyse` on the seed give Marina above, JVC in line, Al Jaddaf thin (2 sales) and no candidates for the uncovered sample.
- Every test table in A§2 passes:
  - Marina is **+14.0% vs 11, above**.
  - JVC is **−1.7% vs 9, in line**.
  - Dummyside Heights 2 3-bed has **2 sales, no verdict** (stamp figure "2 OF 3").
  - "Nowhere Point Tower" gives **no candidates**.
  - "Mockup Crest II" gives **Mockup Crest Tower 2**.
  - The monthly payment is **AED 10,618**.
  - `src/lib/domain` has 100% line coverage.
- `ListingFieldsSchema` rejects bedrooms `null`, `undefined`, `""` (via `toNumberOrUndefined`) and `NaN`. The psf issue appears on both `sizeSqft` and `priceAed`.
- Copy tests: the A§2.10 table passes, no "never write" word appears anywhere in the deck, and demo builders never say "registered".
- `createTestDb()` seeds **6 buildings, 9 aliases and 32 sales**. A second run adds 0. `refreshDemoDates` shifts only `source = 'demo'` rows.
- `migrateAndSeed` purges `saved_listings` rows removed more than 30 days ago and keeps newer ones.
- `npm run dev` without `DATABASE_URL` migrates and seeds `.data/pglite` on boot, and a restart does not reseed. In production, a missing `DATABASE_URL` fails fast with a clear log line.

---

### WP1: Platform, security and deployment

**Owns:**
- `next.config.ts`, `railway.json`, `README.md`, `src/proxy.ts`, `src/lib/csp.ts`
- `src/lib/http/{handler,errors,origin,ip,cookies}.ts`, `src/lib/auth/{sign,anon,admin,admin-page}.ts`, `src/lib/rate-limit/index.ts`
- `src/lib/db/repo/{anon,events}.ts`
- `src/app/api/health/route.ts`, `src/app/api/events/route.ts`, `src/app/api/admin/login/route.ts`, `src/app/api/admin/logout/route.ts`
- `tests/unit/http/*`, `tests/unit/auth/*`, `tests/unit/rate-limit.test.ts`, `tests/api/{health,events,admin-auth}.test.ts`

**Milestone A** (end of day 1): `http/*`, `auth/sign.ts`, `auth/anon.ts`, `rate-limit`, `repo/anon.ts`, `repo/events.ts`, and `next.config.ts` with `serverExternalPackages: ["@electric-sql/pglite", "pg"]`.

**Provides** (frozen at milestone A):
```ts
// src/lib/http/handler.ts
export interface RouteCtx {
  req: NextRequest; db: Db; requestId: string; today: IsoDate; ipHash: string;
  anonId: string | null;                        // always set with anon: "require"
  setCookie(name: string, value: string, opts: CookieOpts): void;
}
export interface RouteOpts { anon?: "require" | "optional" | "none"; admin?: boolean; origin?: boolean /* default true for non-GET */ }
export function route<P extends Record<string, string> = {}>(
  opts: RouteOpts, fn: (ctx: RouteCtx, params: P) => Promise<Response>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function json<T>(data: T, status?: number): NextResponse;          // Cache-Control: no-store, X-Request-Id
export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T>; // HttpError 422 + fields
// src/lib/http/errors.ts
export class HttpError extends Error { constructor(status: number, code: ErrorCode, opts?: { fields?: Record<string, string>; retryAfterSec?: number; vars?: Record<string, string | number> }) }
// src/lib/rate-limit/index.ts
export type Window = "day" | "hour" | "15m";
export async function hit(db: Db, key: string, limit: number, window: Window): Promise<{ allowed: boolean; count: number; limit: number; retryAfterSec: number }>;
export async function enforce(db: Db, rules: Array<{ key: string; limit: number; window: Window; onDeny: ErrorCode; scope: string }>): Promise<void>;
// src/lib/auth/admin-page.ts
export async function requireAdminPage(): Promise<void>;                // redirect("/admin/login")
// src/lib/auth/anon.ts
export function readAnonFromCookies(store: { get(name: string): { value: string } | undefined }): string | null; // verify only, never issues
// src/lib/db/repo/events.ts
export async function trackEvent(db: Db, e: { name: EventName; anonId?: string | null; checkId?: number | null; meta?: Record<string, string | number | boolean | null> }): Promise<void>;
```
`route()`:
- Assigns `requestId` and runs the origin check (A§6.3).
- Resolves the anon id: with `require`, it issues the cookie, upserts `anon_users`, and sets `refCode` on first touch.
- Verifies the admin session when `admin: true`.
- Maps `HttpError` to the A§4.1 contract, with the message from `ERROR_COPY` filled with `vars`.
- Maps unknown errors to `500 internal` and logs them with `requestId`.
- Writes one access log line: method, route, status, ms. Never bodies.

**Tasks:**
- `next.config.ts`: `poweredByHeader: false`, the static security headers (A§6.6), and a redirect from `/buildings` to `/coverage`.
- `proxy.ts`: the nonce CSP (A§6.6), the matcher, the optimistic `/admin` redirect, and the `CSP_MODE=relaxed` fallback.
- The health and events routes; admin login and logout with `admin_sessions`.
- Railway setup per A§7.3, and a README with "Run locally on Windows" and "Deploy to Railway".

**Acceptance criteria:**
- Anon cookie:
  - `mz_aid` is issued on the first anon-required call.
  - A tampered value is replaced with a new id.
  - A value signed with `SESSION_SECRET_PREVIOUS` still verifies.
- Origin checks: a POST with `Origin: https://evil.example` returns 403 `bad_origin`, and so does a POST with no Origin or with `Sec-Fetch-Site: cross-site`. Same-origin requests pass.
- Rate limits:
  - Day windows: calls 1–20 succeed and the 21st returns 429 with `retryAfterSec` set to the seconds until Dubai midnight. Moving the faked clock to the next Dubai day allows calls again.
  - The 15-minute burst window behaves the same way.
- Admin sessions:
  - A wrong password returns 401. The 6th attempt within 15 minutes returns 429 "Too many tries. Wait 15 minutes."
  - The correct password returns 204 with a `SameSite=Strict` cookie.
  - A forged cookie, a cookie used after logout, and an expired session all return 401.
- `/api/health` returns 200 `{ ok: true, db: "pglite" }` locally and 503 when the DB is closed.
- CSP: every page request gets a fresh nonce. `/`, `/saved`, `/coverage`, `/how-it-works`, `/privacy`, `/c/<code>`, `/admin/login` and `/admin` load with **zero CSP violations** in both themes (the next-themes script carries the nonce). `/api/*` and `/c/<code>/opengraph-image` have no proxy CSP.
- `route({ anon: "optional" })` never sets `mz_aid`; `route({ anon: "require" })` sets it on first touch. `readAnonFromCookies()` (for server pages such as `/c`) is read-only.
- Railway: a push to `main` builds, migrates on boot, passes the healthcheck, and serves `https://<domain>/api/health`. A deliberately broken migration leaves the previous deploy live.

---

### WP2: Claude extraction

**Owns:**
- `src/lib/claude/{client,prompt,schema,extract,errors}.ts`, `src/lib/image/{sniff,downscale}.ts`
- `src/app/api/extract/route.ts`, `scripts/try-extract.ts`
- `tests/helpers/fake-anthropic.ts`, `tests/unit/claude/*`, `tests/unit/image/*`, `tests/api/extract.test.ts`, `tests/fixtures/listings/*` (≤ 200 KB each)

**Consumes:** `route`, `enforce` and `trackEvent` (WP1); `matchBuildings` (WP3); `getEnv`, `copy`, `extractionEnabled` and `recordExtractOutcome` (WP0, `src/lib/extract-circuit.ts`).

**Provides:**
```ts
export async function extractListing(input: { image?: { mediaType: SniffedType; base64: string }; text?: string }, opts?: { signal?: AbortSignal }): Promise<ExtractionOutcome>;
export class ExtractError extends Error { code: ErrorCode; status: number }
export { extractionEnabled } from "@/lib/extract-circuit";    // re-export only; the state is WP0's
export type SniffedType = "image/jpeg" | "image/png" | "image/webp";
export function sniffImage(bytes: Uint8Array): SniffedType | null;                    // server
export const MAX_EDGE = 1568;
export async function downscaleForUpload(file: Blob, opts?: { maxEdge?: number; quality?: number }): Promise<{ blob: Blob; width: number; height: number }>; // client
```

**Tasks:**
- Implement A§5 exactly: prompt (including `contact_details_visible`), schema, call shape, post-processing, error map, circuit breaker and logging.
- Rate limits for extract: burst, per person, per IP and global (A§6.4).
- Call `recordExtractOutcome` after every Claude call (`ok`, `server_fail` for `extract_failed`/`extract_timeout`, `other` otherwise). Record `extract_ok` / `extract_fail` events with `meta.ms` and `meta.code` for **every** non-200, non-499 response, including rate limits, 413, 415 and `empty_input` (A§5.6, A§5.8).
- Before coding, check the `maxRetries`, `timeout` and `{ signal }` request option against `node_modules/@anthropic-ai/sdk/README.md`. If one is missing, use the A§5.1 fallback (`new Anthropic()` and a `Promise.race` against the abort signal) and record the finding in the PR; the tech lead updates A§5.1.

**Acceptance criteria:**
- Request shape, checked with the fake client:
  - `model = CLAUDE_MODEL`, `output_config.effort = "low"`, and `output_config.format = { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA }`.
  - `betas = ["server-side-fallback-2026-07-01"]` and `fallbacks = "default"`.
  - **No** `thinking` key.
  - The client is built with `maxRetries: 0` when the installed SDK supports it (A§5.1); otherwise the PR shows the fallback in use.
- Response mapping:
  - `refusal` → 422 `extract_refused`.
  - `max_tokens` → 422 `extract_unreadable`.
  - Non-JSON output → 502 `extract_failed`.
  - `RateLimitError` or status 529 → 503 `extract_busy` with `retryAfterSec: 30`.
  - `AuthenticationError` → 503 `extract_unavailable`.
  - `BadRequestError` with an image → 422 `image_rejected`.
  - Other `APIError` → 502 `extract_failed`.
  - A fake that never resolves → 504 `extract_timeout` after `CLAUDE_TIMEOUT_MS` (faked timers).
  - No API key → 503 `extract_unavailable`.
  - Client abort → status 499 and no error log.
- Circuit breaker: three consecutive 502 or 504 responses make the next call return 503 `extract_unavailable` without calling Claude, and `getPublicConfig().extractEnabled` is false. After 5 minutes (faked), it calls Claude again. A refusal or a 429 never trips it.
- Events: a 429, a 413 and a refusal each record one `extract_fail` event with the matching `meta.code`; a success records `extract_ok` with a numeric `meta.ms`.
- With the fake client, `max_tokens` sent equals `CLAUDE_MAX_TOKENS` (default 8192).
- Outcomes: `is_listing: false` → `not_listing`; rent → `rental`; villa → `not_apartment`. Each returns 200 with the fields. `contactDetailsVisible` passes through.
- Upload checks:
  - A body over 9 MB → 413 before `formData()` is called (spy).
  - A text file posted as `image/png` → 415. A PNG posted as `image/jpeg` → accepted.
  - Empty input → 400 `empty_input`.
- Rate-limit order: the 7th read within 15 minutes → 429 with the burst message and its minutes. The 21st read in a day → 429. Reaching the global cap → 503 `daily_cap_reached`. In each case the fake records **zero** Claude calls.
- No `fs` import or write anywhere under `src/lib/claude`, `src/lib/image` or `src/app/api/extract`. Test logs contain no building name, price or text.
- `downscaleForUpload`: a 3000×6000 PNG gives a 784×1568 JPEG. A small image is not upscaled. A corrupt blob throws `unsupported_image`.
- Manual check with a real key: the Marina sample screenshot returns `{ buildingText: "Mockup Crest", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2450000 }`, outcome `ok`, preselect Mockup Crest Tower. The PR records the latency, which must be under 25 s.

---

### WP3: Core API (buildings, matching, checks, requests)

**Owns:**
- `src/lib/db/repo/{buildings,checks,requests}.ts`, `src/lib/services/{check,match}.ts`
- `src/app/api/buildings/route.ts`, `src/app/api/buildings/match/route.ts`, `src/app/api/checks/route.ts`, `src/app/api/checks/[code]/route.ts`, `src/app/api/requests/route.ts`
- `tests/api/{buildings,match,checks,requests}.test.ts`, `tests/unit/services/check.test.ts`

**Consumes:** `route`, `readJson`, `enforce`, `trackEvent` (WP1); domain (`findCandidates`, `preselect`, `needsTowerCheck`, `inWindow`, `analyse`, `normalise`, `generateShareCode`), `ListingFieldsSchema`, `refreshDemoDates` and `getDb` (WP0).

**Provides** (signatures frozen at WP0-A):
```ts
export async function matchBuildings(db: Db, q: string, area: string | null, beds: number | null, today: IsoDate): Promise<MatchResponse>;
export async function runCheck(db: Db, req: CheckRequest, ctx: { anonId: string; today: IsoDate; appUrl: string; rules: Rules; demoMode: boolean }): Promise<CheckView>;
export async function getCheckRowByCode(db: Db, code: string): Promise<CheckRow | null>;
export function toCheckView(row: CheckRow, appUrl: string): CheckView;
export async function getCheckWithCurrent(db: Db, code: string, today: IsoDate, rules: Rules, appUrl: string): Promise<{ check: CheckView; current: AnalysisView } | null>;
export async function getAliasRows(db: Db): Promise<AliasRow[]>;
export function invalidateAliasCache(): void;
export async function recentSales(db: Db, buildingId: number, bedrooms: number, today: IsoDate, windowDays: number): Promise<SaleRow[]>;
export async function listCoverage(db: Db, today: IsoDate, rules: Rules): Promise<CoverageBuilding[]>;
export async function upsertRequest(db: Db, r: { anonId: string; text: string; area: string | null; checkId: number | null; source: "none_of_these" | "request_form" }): Promise<{ id: number; created: boolean }>;
export async function countOthersAsked(db: Db, textNorm: string, anonId: string): Promise<number>;
export async function listRequestsForAnon(db: Db, anonId: string): Promise<RequestView[]>;   // used by WP4's getMe
```

**Acceptance criteria:**
- Marina check (Mockup Crest Tower, 2-bed, 2,450,000 / 1,284, source `claude`): `POST /api/checks` returns 201 with:
  - `band: "above"`, `diff ≈ 0.13953`, `count: 11`, `medianPsf ≈ 1674.45`, `sales.length = 11`, `isDemo: true`;
  - `code` matching `CODE_RE` and `url = APP_URL + "/c/" + code`.
  - The row is persisted with `edited_fields` and `ref_code`.
- Other known cases:
  - JVC → `inline`, `diff ≈ −0.01705`.
  - Dummyside Heights 2, 3-bed → `thin`, `count: 2`, `diff: null`.
  - Fake Vista Residences 2, 1-bed → a verdict with `count: 3`.
- Validation:
  - `bedrooms: null` → 422 with `fields.bedrooms`.
  - 2,450,000 for 200 sq ft → 422 with the psf message on both `fields.sizeSqft` and `fields.priceAed`.
  - An unknown `buildingId` → 404 `building_not_found`.
- Building requests:
  - `POST /api/checks` with `buildingId: null` → 201 with `band: "none"` and **no** `building_requests` row.
  - `POST /api/requests { text, code }` for that comparison → 201, one row with `source: "none_of_these"`, `check_id` set and `area_text` from the comparison. Repeating it → 200 with the same `id` and `created: false`. An unknown `code` → 404.
  - `POST /api/requests { text }` (Coverage form) → `source: "request_form"`.
  - `POST /api/requests` with the code of a sample comparison → 422 `sample_not_allowed` (samples never create demand).
  - `othersAsked` counts rows with the same `text_norm` from other people, including rows whose `anon_id` was cleared.
  - `listRequestsForAnon` returns one `RequestView` per `text_norm`; after `resolved_building_id` is set it shows `covered: true` with the building.
- `GET /api/checks/<code>`:
  - Returns `check` and `current`. After inserting a sale, `current.count` is 12 while `check.analysis.count` stays 11.
  - An unknown code → 404. The call never sets `mz_aid`.
- `GET /api/buildings/match`:
  - Reproduces the A§2.3 table over HTTP.
  - With `beds=2`, Mockup Crest Tower has `salesForBedrooms: 11`.
  - Candidates never expose a numeric score.
- `GET /api/buildings` returns a `CoverageResponse` with 6 buildings, the correct `verdictAvailable` values and each building's `latestSaleDate`.
- The 101st check in a Dubai day → 429. The 21st request in a Dubai day → 429.

---

### WP4: User-data API (saved listings, leads, me, recovery)

**Owns:**
- `src/lib/db/repo/{saved,leads,me}.ts`, `src/lib/services/lead.ts`
- `src/app/api/saved/route.ts`, `src/app/api/saved/[code]/route.ts`, `src/app/api/saved/[code]/seen/route.ts`, `src/app/api/leads/route.ts`, `src/app/api/leads/[id]/withdraw/route.ts`, `src/app/api/me/route.ts`, `src/app/api/me/recovery-link/route.ts`, `src/app/r/[token]/route.ts`
- `tests/api/{saved,leads,me,recovery}.test.ts`

**Consumes:** `route`, `enforce`, `trackEvent` (WP1); `getCheckRowByCode`, `recentSales`, `listRequestsForAnon` (WP3); domain, `consentFor`, `copy` (WP0).

**Provides:** the Saved, Leads and Me endpoints in A§4.3, and:
```ts
export async function listSaved(db: Db, anonId: string, today: IsoDate, rules: Rules): Promise<SavedItemView[]>;    // excludes removed rows
export async function countSavedWithNewSales(db: Db, anonId: string, today: IsoDate, rules: Rules): Promise<number>; // items with unseenNewSales > 0
export async function markSeen(db: Db, anonId: string, code: string): Promise<boolean>;                             // false → 404
export async function deleteAllForAnon(db: Db, anonId: string): Promise<void>;
```

**Acceptance criteria:**
- Saving:
  - Save is idempotent: one row, and a second save returns 200 with the same item.
  - Remove returns 204 and the item leaves `GET /api/saved`. Saving the same code again returns 200 with the **original** `savedAt` and `atSave` (exact Undo).
  - A sample check → 422 `sample_not_allowed`.
  - `GET /api/saved` and `GET /api/me` with no cookie return empty results and **no** `Set-Cookie`.
- New-sales count: after saving Marina, insert an admin sale (Mockup Crest Tower, 2-bed, today).
  - `GET /api/saved` shows `newSalesSinceSave: 1`, `unseenNewSales: 1`, `now.count: 12`, `atSave.count: 11`.
  - `GET /api/me` shows `savedWithNewSales: 1`. After `POST /api/saved/<code>/seen` it shows 0, while `newSalesSinceSave` stays 1.
  - `refreshDemoDates` creates **no** new-sales count.
  - A removed item never counts toward `savedWithNewSales`.
- `GET /api/me` returns `requests` from `listRequestsForAnon`: after `POST /api/requests` with a not-covered code, one `RequestView` with `covered: false`; after admin "Mark as covered", `covered: true` with the building.
- Leads:
  - Missing consent → 422 `consent_required`.
  - In demo mode, `consentVersion: "optin-v1"` → 409. Only `optin-v1-demo` is accepted; in live mode it is the reverse.
  - The stored `consent_text` equals `consentFor(isDemo, PARTNER_NAME).text`, and the stored SHA-256 matches it.
  - Phone: `"050 123 4567"` → `+971501234567`, and the response's `phoneMasked` is `"+971 •• ••• 4567"`.
  - Loan and monthly are stored from `estimateMortgage` (10,618 for Marina at 20% / 4.25% / 25 years). `downPct` below `minDownPct(price)` → 422 `fields.downPct`.
  - A lead on a `none` comparison stores the typed building text as `building_name`.
  - The 4th lead in a day → 429. A duplicate active lead returns the existing one.
- Withdraw sets `status: "withdrawn"`, nulls `name` and `phone_e164`, keeps `phone_last4`, and is idempotent. Another anon's lead id → 404.
- `DELETE /api/me` returns 204 and clears the cookie (with no cookie it is a 204 no-op). Afterwards:
  - the user's checks, saved items (including removed ones) and `anon_users` row are gone;
  - their leads are withdrawn with no PII and `anon_id` null;
  - their requests and events keep `anon_id` null;
  - their `/c/<code>` returns 404.
- Recovery link: `GET /r/<token>` on a request with no cookie returns 303 to `/saved` and sets `mz_aid` to the same id. A tampered or expired token returns 303 to `/saved?recovery=failed`.

---

### WP5: Admin (API, pages, CSV)

**Owns:**
- Pages: `src/app/admin/login/page.tsx`, `src/app/admin/(secure)/{layout,page,loading}.tsx`, `src/app/admin/(secure)/{leads,requests,sales,quality}/page.tsx`
- Code: `src/components/admin/**`, `src/lib/db/repo/admin.ts`, `src/lib/csv/{parse,import,export}.ts` (`parse.ts` exports `CSV_COLUMNS` for the in-browser template), `src/lib/validation/admin.ts`, `src/lib/api/admin-client.ts`
- Routes: `src/app/api/admin/{stats,requests,buildings,sales,import}/route.ts`, `src/app/api/admin/leads/route.ts`, `src/app/api/admin/leads/export/route.ts`, `src/app/api/admin/leads/[id]/route.ts`, `src/app/api/admin/leads/[id]/reveal/route.ts`, `src/app/api/admin/buildings/[id]/aliases/route.ts`, `src/app/api/admin/sales/preview/route.ts`, `src/app/api/admin/sales/[id]/route.ts`
- `scripts/import-csv.ts`
- Tests: `tests/api/admin-*.test.ts` (except WP1's `admin-auth.test.ts`), `tests/unit/csv/*`, `tests/fixtures/csv/*`

**Consumes:** `route({ admin: true })` and `requireAdminPage` (WP1); `invalidateAliasCache`, `recentSales` and `listCoverage` (WP3); `analyse`, `normalise`, `setAppMeta` and `copy` (`admin.*` keys) (WP0). UI per D§3.8 (Overview, Leads, Requests, Sales data with tabs Sales / Register a sale / Buildings / Import CSV, Quality). Number-ticker is used on KPIs only.

**Provides:** the A§4.4 endpoints, the `AdminStats` and `AdminLeadRow` shapes, and `CSV_COLUMNS: Record<"buildings" | "aliases" | "sales", readonly string[]>`.

**Acceptance criteria:**
- Access:
  - Without a session, every `/api/admin/*` route except login returns 401, and `/admin`, `/admin/leads`, `/admin/requests`, `/admin/sales` and `/admin/quality` redirect to `/admin/login`.
  - Admin pages are `noindex` and never appear in public navigation.
- Overview:
  - The 7, 30 and 90-day ranges change the numbers.
  - Funnel counts match a seeded fixture, with sample checks excluded. `shares` sums the four share events; `checksFromShares` counts checks with `ref_code`; `kFactor` is their ratio (null with no checks).
  - The per-day chart (`perDay`) and the verdict chart render, each with a "Show as table" toggle.
- Quality (`/admin/quality`):
  - `editedFieldRate`, `extractFailByCode` (including `rate_limited` and `image_rejected` from seeded events) and `medianReadMs` render as tables.
  - The freshness table shows the latest sale date for each building and bedroom count.
- Leads:
  - Phones are masked in the list. Reveal shows the full number and records `lead_revealed`.
  - "Mark sent to partner" sets `sent_at`. A withdrawn lead shows "Withdrawn on {date}. Tell the partner." with "Partner told" until `withdrawalNotified` is set. Demo leads show a Demo badge.
  - The CSV export includes full phones. A cell starting with `=` is exported as `'=…`.
- Sales data:
  - The register-sale form starts empty and has no source picker; the sale is stored with `source: "admin"`. A future date is rejected.
  - Preview returns `admin.impact` with exact before and after medians and the number of saved listings affected. For Marina 2-bed plus a 2,236,000 / 1,284 sale, the test asserts both medians.
  - Create works. Delete shows an AlertDialog and then removes the sale.
  - Buildings tab: adding a building and an alias works, and the new alias is matched immediately because the alias cache is invalidated.
- CSV import:
  - "Download template" produces exactly the `CSV_COLUMNS[kind]` header row, built in the browser.
  - A dry run of `tests/fixtures/csv/sales-mixed.csv` reports `ok: 23, rejected: 2` with line numbers and reasons, plus the per-building `impact`, and writes nothing.
  - `commit=1` runs in one transaction; a forced DB error rolls everything back. Committed rows have `source: "import"`, and `is_demo` follows the column. `data_imported_at` is set.
  - Re-importing the same file skips every row. `size_sqm` is converted.
  - `npm run import:csv` runs as a dry run unless `--commit` is passed.
- Requests are aggregated by normalised text with `requests`, `people`, first and last asked. "Mark as covered" sets `resolved_building_id` on every row with that `text_norm`, and WP4's `GET /api/me` then shows `covered: true`.

---

### WP6: Compare flow UI (home page, steps 1–3)

**Goal:** `/` per D§3.1–3.4. On a phone it takes 2 taps when the read is clean: choose a screenshot, then "Compare price".

**Owns:**
- `src/app/page.tsx`, `src/hooks/use-check-flow.ts`
- `src/components/check/**`: `compare-flow.tsx`, `upload-card.tsx`, `paste-text.tsx`, `reading-status.tsx`, `details-form.tsx`, `building-picker.tsx`, `building-search.tsx`, `result-view.tsx`, `thin-result.tsx`, `not-covered-result.tsx`, `outcome-alert.tsx`, `sample-chips.tsx`
- `tests/ui/check/*`

**Consumes:**
- `api`, fixtures, `copy`, validation and `SAMPLES` (WP0)
- `downscaleForUpload` (WP2)
- `StampedSheet`, `VerdictSummary`, `SalesEvidence`, `ShareActions`, `renderCard`, `ExampleCard` and `drawSampleScreenshot` (WP7)
- `StepHeader`, `ActionBar`, `SaveButton`, `CostRow`, `CostPanel`, `usePublicConfig`, `useAnnounce`, `useMe`, `DemoNotice` and `scrollIntoViewSafe` (WP8)
- Magic UI `border-beam` (thumbnail while reading). The `iphone` frame is inside WP7's `ExampleCard`.

**Provides:** the `/` page only. No exported components.

**Requirements** (each is also an acceptance check):
1. **First visit** (D§3.1):
   - The hero is the tool.
   - The static example is WP7's `<ExampleCard framed />` (the `iphone` frame on desktop only), showing `FIXTURE_CHECK_MARINA` with "Example with demo data". It makes **no API call and never scrolls**.
   - The example never enters form state.
   - At 390×844, "Choose a screenshot" is in the first viewport.
2. **Upload:**
   - A real `<Button>` opens a sr-only `<input type="file" accept="image/*">`.
   - The drop and paste hint (with `Kbd`) shows only on `(pointer: fine)`.
   - Thumbnail with Replace and Remove.
   - **Reading starts on file choice**: downscale, then `api.extract` with an AbortController and a 28 s backstop.
   - The original file is kept for the card (A§5.7).
   - "Paste listing text" and "Type the details" are always available. The `home.privacy` line is shown.
3. **Reading** (D§3.2):
   - `border-beam` on the thumbnail, only when `motion-safe`.
   - Skeleton fields with `aria-busy`.
   - Staged status text ("Preparing your screenshot", then "Reading the price and size"), plus the 8 s "still reading" line. `read.matching` is used only for the debounced match in step 2.
   - **Stop** returns to step 1 and keeps the image.
   - Status goes through `useAnnounce`. Errors use an Alert with `role="alert"`, the D§5.3 copy for the code, and its action buttons.
   - `extract_busy` enables "Try again" after a visible 30 s countdown.
4. **Claude off** (D§5.6): if `config.extractEnabled` is false or the API returns `extract_unavailable`, show `claudeOff.notice`, make "Type the details" primary, and hide "Choose a screenshot". Pasted text is parsed locally with `parseFields`.
5. **Outcomes:**
   - `rental` → "It's for sale, continue".
   - `not_listing` → "Try another screenshot" / "Type the details".
   - `not_apartment` → "Type the details anyway".
   - Off-plan → passed into the check as `completion`.
6. **Step 2: details and building** (D§3.3):
   - `StepHeader` "Step 2 of 3", pushed as `?step=details` with `history.pushState`.
   - react-hook-form with `zodResolver(ListingFieldsSchema)`, `mode: "onTouched"`, `reValidateMode: "onChange"`, and `toNumberOrUndefined` for numbers.
   - Bedrooms is a Select with Studio and 1–7.
   - `InputGroup` with an AED prefix and a sq ft suffix. `inputMode`, `enterKeyHint="go"`, and a `<form onSubmit>`.
   - Each FieldError is linked with `aria-describedby`. Fields Claude left null show `details.missing` ("Not in the screenshot. Add it here."), or `details.missingBeds` for Bedrooms, as their FieldDescription.
   - **"Compare price" stays enabled.** Submitting with errors focuses the first invalid field, or shows the summary Alert when there are 2 or more errors.
   - `editedFields` is tracked against the extracted values.
7. **Building picker:**
   - A RadioGroup inside a FieldSet with the legend "Which building is it?". Options are cards at least 56 px tall.
   - The badge reads "Best match", never a percentage, plus the sales-for-bedrooms line.
   - `towerCheck` shows its line. Matching is debounced 250 ms through `api.match`, and "3 matching buildings" is announced.
   - "Search covered buildings" (`CommandDialog`) and "None of these" are always offered.
   - The pre-selection comes from `preselectId`.
8. **Step 3: result** (D§3.4):
   - `api.createCheck`, then `?step=result&code=XXXXXX`, then focus the result heading (`tabIndex={-1}`) and call `scrollIntoViewSafe`.
   - The layout per D§3.4 composes `VerdictSummary`, `StampedSheet` (original image, `contactDetailsVisible`, trim state), `ActionBar` with `ShareActions` and `SaveButton`, `CostRow` / `CostPanel`, and `SalesEvidence`.
   - `thin` and `none` use `thin-result.tsx` and `not-covered-result.tsx` (D§3.4, D§6.5).
   - Not covered: "Request it and track" calls `api.requests.create({ text: buildingText, area: areaText, code })`, then shows `none.done` with `othersAsked` (second sentence dropped at 0) and turns into the inert "Requested". "Fairsquare covers {n} demo buildings" takes `n` from `api.buildings()`. There is no Save button and no stamp on this result; the cost row is present.
   - Sample results show `sample.notice` and disable Save and the adviser opt-in. The uncovered sample shows no "Request it and track" (the API refuses sample requests).
   - "Edit details" and "Compare another listing" are present.
   - Reloading `?step=result&code=` with no image in memory redirects to `/c/<code>`.
9. **Samples:** four chips from `SAMPLES` (WP0) draw the canvas screenshot with WP7's `drawSampleScreenshot` (D§8.5: "Sample agent", no phone number). They **skip Claude**, fill the known fields with `source: "sample"`, and call `track("sample_used")`. The uncovered sample leads to the not-covered result.
10. `?ref=CODE` is kept in flow state and `sessionStorage`, and forwarded as `ref` to `createCheck`.

**Acceptance criteria:**
- Reducer tests cover idle → reading → (outcome | details) → comparing → result, plus stop, timeout, busy countdown, Claude-off mode, edit and reset.
- With mocked fetch:
  - The Marina sample renders "+14.0%" and "Compared with 11 demo sales" after **one** tap on "Compare price".
  - Null bedrooms blocks submit, puts focus on Bedrooms, and sends **no request**.
  - "Nowhere Point Tower" leads to the not-covered result; "Request it and track" sends one `POST /api/requests` with the code, and a second tap sends nothing.
  - With `FIXTURE_CONFIG_CLAUDE_OFF`, "Choose a screenshot" is absent, "Type the details" is primary, and pasted text fills fields through `parseFields` with no `/api/extract` call.
- At 390×844: the initial load does not scroll; targets are at least 44 px; no input is under 16 px; the action bar never covers the focused control.
- Keyboard-only completion. Focus lands on each step heading, and nothing is lost on re-render.
- Browser and Android Back move between steps.
- axe reports no serious or critical issues in any state.

---

### WP7: Stamp, result evidence, share, the public card, and How it works

**Goal:** the stamp in every medium (SVG, canvas PNG, OG image) from one geometry (D§8), the static example and sample screenshots, the evidence views, the share loop, `/c/[code]` (D§3.5), and the methodology page `/how-it-works` (D§3.9), which is built from the same example and evidence components.

**Owns:**
- `src/lib/stamp/geometry.ts`, `src/lib/stamp/card-canvas.ts`, `src/lib/stamp/sample-screenshot.ts`
- `src/components/stamp/**`: `stamp.tsx`, `stamped-sheet.tsx`, `listing-plate.tsx`, `trim-dialog.tsx`, `stamp-mask.tsx`, `example-card.tsx`
- `src/components/result/**`: `verdict-summary.tsx`, `sales-evidence.tsx`, `sales-strip.tsx`, `sales-table.tsx`, `provenance.tsx`, `how-popover.tsx`
- `src/components/share/**`: `share-actions.tsx`, `share-fallback.tsx`, `share.ts`
- `src/app/c/[code]/page.tsx`, `src/app/c/[code]/loading.tsx`, `src/app/c/[code]/opengraph-image.tsx`, `src/app/c/[code]/not-found.tsx`
- `src/app/how-it-works/page.tsx`
- `src/assets/fonts/**`, `public/fonts/**`, `src/assets/og/**`
- Tests: `tests/ui/stamp/*`, `tests/ui/result/*`, `tests/ui/share/*`, `tests/ui/how-it-works.test.tsx`, `tests/api/og.test.ts`, `tests/api/c-page.test.ts`

**Consumes:** `copy` builders, fixtures, `SAMPLES`, `getPublicConfig`, `getAppMeta` (WP0); `trackEvent`, `readAnonFromCookies` (WP1); `getCheckWithCurrent`, `getCheckRowByCode` (WP3); `SaveButton`, `ActionBar`, `DemoBadge`, `DemoNotice`, `usePublicConfig`, `useAnnounce`, `scrollIntoViewSafe` (WP8); Magic UI `blur-fade` and `iphone`.

**Font files** (D§2.2), fixed names so WP8's `globals.css` `@font-face` rules can point at them before WP7 lands: `public/fonts/archivo-stamp-condensed.woff` ("Mizan Stamp Condensed"), `public/fonts/archivo-stamp-wide.woff` ("Mizan Stamp Wide"), and `src/assets/fonts/{archivo-400,archivo-600,archivo-stamp-condensed,archivo-stamp-wide}.woff` for next/og.

**Provides** (props follow D§4.3):
```ts
// src/components/stamp/stamp.tsx: spread copy.stampProps(check) into it
export function Stamp(p: StampProps & { landing?: boolean; labelBacking?: boolean; className?: string }): JSX.Element;
//   inline SVG from geometry.ts; always aria-hidden (D§3.4): the surrounding figure carries the accessible name
export function StampedSheet(p: {
  check: CheckView; imageUrl: string | null;            // null → ListingPlate (typed details, /c page)
  contactDetailsVisible?: boolean; trimBottom?: number; onTrimChange?: (v: number) => void; // 0.4–1, D§3.4
  className?: string;
}): JSX.Element;
//   <figure>; the screenshot <img> (or the plate, as role="img") is named by result.sheetAlt; band "none" renders no stamp
// src/lib/stamp/card-canvas.ts (client only)
export async function renderCard(p: { check: CheckView; image: Blob | null; trimBottom?: number }): Promise<File>; // fairsquare-{slug}-{code}.png, D§8.3
export function VerdictSummary(p: { check: CheckView; current?: AnalysisView; headingRef?: React.Ref<HTMLHeadingElement>; headingLevel?: 1 | 2 }): JSX.Element;
export function SalesEvidence(p: { check: CheckView; defaultOpen?: boolean }): JSX.Element;  // Accordion + SalesStrip + SalesTable + sr summary
export function ShareActions(p: { check: CheckView; getCard: () => Promise<File | null> }): JSX.Element;
// src/lib/stamp/sample-screenshot.ts (client only, D§8.5): 720×1440 PNG of a generic portal listing
export async function drawSampleScreenshot(sample: Sample): Promise<Blob>;
// src/components/stamp/example-card.tsx: the static example (home, /how-it-works); no API call, no motion
export function ExampleCard(p: { framed?: boolean /* iphone frame at ≥1024px only */; className?: string }): JSX.Element;
```

**Requirements:**
- **Geometry and texture** per D§8.1–8.2:
  - The SVG uses an `feTurbulence` mask, the canvas uses speckles seeded with mulberry32 from the code, and the OG image uses `specks.png`.
  - The dark-area label backing is applied by the luminance rule.
  - When `isDemo`, "DEMO DATA" is drawn inside the stamp.
- **Card** per D§8.3: the original image, height capped at 2.4× width, the trim value, and the footer lines and demo pill. Fonts get a 2 s timeout before falling back. Rendering happens in idle time after the result shows.
- **Share:**
  - "Share card" calls `navigator.share({ files: [file], text: shareText, url })` when `navigator.canShare({ files })` is true.
  - Otherwise it opens the fallback (Drawer or Dialog) with "Send on WhatsApp" (`https://wa.me/?text=` + encoded text), "Download card", "Copy link", and the link visible in a read-only Input.
  - A user cancelling the share sheet (`AbortError`) shows nothing. Other failures use the D§5.3 toast.
  - Each action calls `api.track`.
- **`/c/[code]`** (D§3.5):
  - The server calls `getCheckWithCurrent` and `trackEvent("card_viewed", { anonId: readAnonFromCookies(await cookies()), checkId })`. It never sets a cookie.
  - The page shows the stamp on the listing plate (no screenshot is ever stored), blur-fade on first view (once per code per session, `sessionStorage`), `c.date`, `c.h1`, `c.sentence`, `c.today` (only when count or median changed), the demo badge, `c.salesTrigger` with SalesEvidence, `SaveButton`, and the CTA `c.cta` linking to `/?ref=<code>` inside WP8's `ActionBar` below 1024px and inline above.
  - `generateMetadata` uses `ogTitle`, `ogDescription` and `ogAlt`, with `noindex`.
  - An unknown code renders `cNotFound.*`. `loading.tsx` shows the D§5.1 skeleton.
- **OG image** per D§8.4: 1200×630, the WOFF fonts read as ArrayBuffers, square-crop safety, built from the **stored** comparison and served with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (bounded, so a deleted comparison's image expires).
- **Example card and samples:** `ExampleCard` draws the Marina sample with `drawSampleScreenshot` into a reserved 4:5 box and overlays the final-state `Stamp` (no landing). `drawSampleScreenshot` uses system-ui, neutral colours, no real portal branding, and "Sample agent" with no phone number.
- **How it works** (D§3.9, copy D§6.10): one prose column (max 65ch), h2 sections with a sticky table of contents on desktop, the `how.*` copy, an `id="data"` section (the demo badge links there) showing `how.dataDemo` in demo mode or `how.dataLive` with `getAppMeta(db, "data_imported_at")` in live mode, the rules as a `dl` built from `config.rules`, `ExampleCard` plus `SalesEvidence` for `FIXTURE_CHECK_MARINA` under "An example", and a "Compare a listing" link.

**Acceptance criteria:**
- `Stamp` tests cover above, inline, below and thin ("2 OF 3"), in demo and live. Demo prints "DEMO DATA" **inside** the border and never "REGISTERED". No variant prints "CHECKED". Off-plan adds "OFF-PLAN" to row D. The same code always produces the same texture. The SVG is `aria-hidden`, and `StampedSheet`'s figure has the `result.sheetAlt` name.
- A `none` comparison has no stamp anywhere (D§3.4): `StampedSheet` shows the plate only, `/c/<code>` shows the plate, the "Not covered yet" badge and the CTA, and its OG image shows the plate and the building name without a stamp.
- `renderCard`:
  - `FIXTURE_CHECK_MARINA` with a 720×1440 sample gives a PNG `File` 1080 px wide, named `fairsquare-mockup-crest-tower-<code>.png`.
  - Without an image it renders the plate. `trimBottom: 0.5` reduces the base height.
- Share tests:
  - With mocked `canShare` and `share`, the files path is used.
  - Without them, the WhatsApp link, Download, Copy link and the visible URL all appear.
  - `api.track` receives the correct event names.
- At 360 px the strip chart's text renders at 13 px or larger (HTML/CSS, not a scaled SVG). The sr summary is `11 sales from AED 1,593 to AED 1,763 per sq ft. Median AED 1,674. This listing AED 1,908.`
- `/c/<code>` for Marina:
  - It renders on the server. `og:title` = `+14.0% vs 11 demo sales: Mockup Crest Tower 2-bed`, and `og:description` starts with `Demo:`.
  - After a new sale is added, `c.today` shows 12 sales.
  - An unknown code returns 404 with `cNotFound.h1`. The CTA links to `/?ref=<code>`.
- `GET /c/<code>/opengraph-image` returns `image/png`, 1200×630, under 300 KB, with "DEMO DATA" inside the stamp area.
- Under reduced motion the stamp appears with no animation. Otherwise the landing uses the D§2.6 stamp spring. The Magic UI components used are D§4.2's only.
- `ExampleCard` makes no network request, causes no layout shift (reserved aspect ratio), shows the `iphone` frame only at 1024 px and up when `framed`, and has the alt text `home.exampleAlt`.
- `drawSampleScreenshot` returns a 720×1440 PNG for each of the four `SAMPLES`, and the drawn text never contains a phone number pattern.
- `/c/<code>` for a viewer without `mz_aid` sets no cookie and records one `card_viewed` event with `anon_id` null.
- `/how-it-works`: one h1, headings in order, `#data` exists, the rules list shows 3 sales / 12 months / 5% from `config.rules`, live mode shows the import date, and the page has no serious or critical axe issues in both themes.

---

### WP8: App shell, design system, flow chrome, Saved, Coverage, Privacy, and money UI

**Owns:**
- Root files: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/fonts.ts`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/manifest.ts`, `src/app/robots.ts`, `src/app/icon.svg`, `src/app/apple-icon.png` (and delete the scaffold's `favicon.ico`), `postcss.config.mjs`
- Pages: `src/app/saved/{page,loading}.tsx`, `src/app/coverage/{page,loading}.tsx`, `src/app/privacy/page.tsx` (`/how-it-works` is WP7)
- `src/lib/motion.ts`
- `src/components/ui/**` and `src/components/magicui/**`, from the end of WP0 milestone A: variant and size edits per D§4.1, for example Button `h-11 md:h-10`, `sm` `h-9 pointer-coarse:min-h-11`, Input `h-11 text-base md:text-sm`, and the Badge `demo` variant
- `src/components/shell/**`: `header.tsx`, `menu-sheet.tsx`, `footer.tsx`, `theme-menu.tsx`, `config-provider.tsx`, `me-provider.tsx`, `providers.tsx`
- `src/components/flow/**`: `step-header.tsx`, `action-bar.tsx` (moved from WP6, because WP6 and WP7 both use them)
- `src/components/a11y/**`: `live-region.tsx`, `skip-link.tsx`
- `src/components/demo/**`: `demo-badge.tsx`, `demo-notice.tsx`
- `src/components/money/**`: `cost-row.tsx`, `cost-panel.tsx`, `estimator.tsx`, `lead-form.tsx`, `lead-receipt.tsx`
- `src/components/saved/**`: `save-button.tsx`, `saved-list.tsx`, `saved-item.tsx`, `requests-list.tsx`, `adviser-requests.tsx`, `your-data.tsx`, `recovery-link.tsx`
- `src/components/coverage/**`: `coverage-list.tsx`, `request-building-form.tsx`
- Tests: `tests/ui/{shell,flow,a11y,money,saved,coverage}/*`

**Consumes:** `api`, fixtures, domain (`estimateMortgage`, `minDownPct`), `copy`, `getPublicConfig` (WP0); `listCoverage` (WP3, Coverage page). Nothing from WP6 or WP7.

**Provides:**
```ts
export function ConfigProvider(p: { value: PublicConfig; children: React.ReactNode }): JSX.Element;
export function usePublicConfig(): PublicConfig;
export function LiveRegion(): JSX.Element;
export function useAnnounce(): (message: string, politeness?: "polite" | "assertive") => void;
export function useMe(): { me: MeView | null; refresh(): Promise<void> };   // GET /api/me never creates an id
export function DemoBadge(p: { className?: string }): JSX.Element | null;   // null when !isDemo
export function DemoNotice(p: { className?: string }): JSX.Element | null;
export function SaveButton(p: { check: CheckView }): JSX.Element;          // save.cta → save.done (then a link to /saved); hidden for samples and none
export function CostRow(p: { check: CheckView; onOpen(): void }): JSX.Element;   // cost.row + cost.adjust
export function CostPanel(p: { check: CheckView; open: boolean; onOpenChange(o: boolean): void }): JSX.Element; // Drawer <1024, Sheet ≥1024
export function StepHeader(p: { step: 1 | 2 | 3; title: string; onBack?: () => void; backLabel?: string; headingRef?: React.Ref<HTMLHeadingElement> }): JSX.Element;
export function ActionBar(p: { children: React.ReactNode; className?: string }): JSX.Element; // sticky below 1024px; sets data-action-bar on <html> while mounted
export function scrollIntoViewSafe(el: Element | null, opts?: ScrollIntoViewOptions): void;  // src/lib/motion.ts
export const archivo: NextFontWithVariable;                                // src/app/fonts.ts (D§2.2)
```

**Requirements and acceptance criteria:**
- **Layout** (D§3.0):
  - `<html lang="en" data-demo>`. The nonce from `headers()` is passed to next-themes (`attribute="class"`, `defaultTheme="system"`).
  - Providers: `ConfigProvider` (from `getPublicConfig()`), `MotionConfig reducedMotion="user"`, `MeProvider`, then `LiveRegion` (polite and assertive regions) and the skip link to `<main id="main" tabIndex={-1}>`.
  - Sonner sits top-center below 768 px and bottom-right on desktop, 4 s.
  - `metadataBase` comes from `APP_URL`.
- **Header and nav** (D§3.0):
  - Mobile is a 56 px header: mark, wordmark, Demo badge, a Saved link with a count badge and the sr phrase `nav.savedSr`, and a 44 px Menu that opens a right-side Sheet (Compare a listing, Saved, Coverage, How Fairsquare compares, Privacy, Theme).
  - Desktop is a 64 px header with links and `aria-current`.
  - There is **no bottom tab bar**. Admin never appears.
  - At 360 px the header fits on one row.
  - Scroll padding is set for the header and the action bar.
- **Footer**: per D§3.0, with the demo, not-a-valuation and AI sentences.
- **Tokens:**
  - `globals.css` holds every D§2 token in light and dark, plus `@font-face` rules for "Mizan Stamp Condensed" and "Mizan Stamp Wide" pointing at WP7's `/fonts/archivo-stamp-{condensed,wide}.woff`.
  - AA contrast passes in both themes, including the `--input` border at 3:1 or more.
  - Archivo is a variable font via next/font, with tabular numbers on all figures.
- **Flow chrome** (D§3.0):
  - `StepHeader` renders the `<ol aria-label="Progress">` with `aria-current="step"`, "Step {n} of 3", a 44 px Back button, and an h2 with `tabIndex={-1}`.
  - `ActionBar` is sticky below 1024 px (72 px plus the safe-area inset, opaque, top border) and inline from 1024 px. While mounted it sets `data-action-bar` on `<html>`; on unmount it removes it. With it mounted, a focused input near the bottom is never covered (scroll-padding test).
- **Demo:**
  - `DemoBadge` reads "Demo" on mobile and "Demo data" on desktop, with the Info icon, and links to `/how-it-works#data`.
  - `DemoNotice` appears on Home and Coverage.
- **CostPanel** (D§3.4, D§6.7):
  - The Marina fixture at defaults shows "About AED 10,618 a month", loan AED 1,960,000 and upfront about AED 644,350, with an itemised breakdown.
  - The down-payment Slider minimum is `minDownPct(price)`, with `aria-valuetext` per `cost.downSr` and −/+ buttons.
  - The rate takes 1–12 with an inline `cost.rateErr`. Term is 15, 20 or 25 years.
  - The output is in `<output aria-live="polite">`, debounced 400 ms.
  - `cost.disclosure` is shown word for word.
  - Opening the panel calls `track("cost_opened")`.
- **LeadForm** (D§6.8):
  - Partner lines show only when their env vars are set (live). In demo, `lead.partnerDemo` is shown.
  - The Checkbox is **unticked** by default, and its label is `config.consent.text`.
  - Name and mobile appear after the tick: `autoComplete` name and tel, `inputMode="tel"`, the help line, errors on blur, one column below `sm`.
  - Send is disabled until the box is ticked, then shows the loading state.
  - Success shows a receipt with `lead.sent*` and "Withdraw this request" (AlertDialog). **No JSON.**
  - API field errors map onto the fields.
  - Samples show `lead.sampleOff`.
- **SaveButton** (D§3.4): `save.cta` becomes `save.done` with a BookmarkCheck icon and announces `save.announce`. Once saved it is a link to `/saved`; it never removes. It calls `useMe().refresh()`. It is not rendered for samples or `none` comparisons.
- **Saved page** (D§3.6):
  - Each item shows its new-sales badge (`newSalesSinceSave`) and then-vs-now values. "Open" calls `api.saved.markSeen(code)`, then goes to `/c/<code>`. Remove sits in an overflow menu.
  - Remove collapses the item into the inline row "Removed {building}. Undo" for 10 s with focus on Undo; Undo calls `api.saved.add(code)` and restores the item with its original baseline. When the row times out, focus moves to the next item or the Listings h2.
  - "Buildings you asked for" renders `MeView.requests` (hidden when empty), with `saved.nowCovered` when covered. "Adviser request" renders `MeView.leads` with Withdraw (AlertDialog). The empty state uses `Empty`.
  - "Saved on this browser" with a recovery link (copy).
  - "Your data" lists what is stored, offers withdraw, and has "Delete all my data" (AlertDialog, focus returns correctly; afterwards the page shows the empty state).
  - The header badge counts `me.savedWithNewSales` (unseen) and its sr text is `nav.savedSr`.
- **Coverage page** (D§3.7): server-rendered from `listCoverage()`, with search, `Item`s on phones and a Table on desktop, neutral badges, and a request form with a visible label and inline error. The form calls `api.requests.create({ text })` and shows `coverage.requestDone`.
- **Privacy** (D§3.10, D§6.11): content per the deck, with the "What Fairsquare stores" table (Data, Why, How long). It matches A§6.7 and A§3.3 exactly, including usage events and the `privacy.howLong` retention text.
- **Tests:**
  - LeadForm: the box starts unticked, Send is disabled until it is ticked, an invalid phone shows a FieldError, and the receipt contains no JSON.
  - CostPanel numbers match the domain functions.
  - Saved page: Remove then Undo within 10 s calls `add` and restores the same `savedAt`; "Open" calls `markSeen` before navigating; requests and leads sections render from `FIXTURE_ME`.
  - SaveButton never calls `api.saved.remove`.
  - Announcements reach the live region.
  - The header fits at 360 px (DOM width check in a jsdom layout stub, plus the Playwright smoke test).
  - `ActionBar` adds and removes `data-action-bar` on `document.documentElement`.

---

## 5. Cross-package interfaces

| interface | owner | consumers |
|---|---|---|
| DTOs, `ErrorCode`, `EventName`, `ClientEventName`, `PublicConfig`, `ExtractResponse`, `RequestView`, `CoverageResponse` (`types.ts`, `validation/api.ts`) | WP0 | all |
| `ListingFieldsSchema`, `toNumberOrUndefined`, `LIMITS` | WP0 | WP3 (server), WP6 (form), WP5 (CSV rows) |
| Domain functions (A§2) | WP0 | WP2–WP8 |
| `copy.ts`: `COPY`, `t`, `ERROR_COPY`, `stampProps`, `verdictSentence`, `shareText`, `ogTitle`, `ogDescription`, `ogAlt`, `chartSummary`, `consentFor` | WP0 | all |
| `api` client and fixtures | WP0 | WP6, WP7, WP8 |
| `extractionEnabled`, `recordExtractOutcome` (`extract-circuit.ts`), `getPublicConfig` | WP0 | WP2 (records outcomes), WP8 (layout) |
| `SAMPLES` (`samples.ts`), `getAppMeta` / `setAppMeta` (`db/meta.ts`) | WP0 | WP6, WP7 / WP5, WP7 |
| `route`, `HttpError`, `readJson`, `enforce`, `trackEvent`, `requireAdminPage`, `readAnonFromCookies` | WP1 | WP2–WP5, WP7 (`trackEvent`, `readAnonFromCookies` on `/c`) |
| `downscaleForUpload` | WP2 | WP6 |
| `matchBuildings`, `runCheck`, `getCheckWithCurrent`, `getCheckRowByCode`, `recentSales`, `listCoverage`, `invalidateAliasCache`, `upsertRequest`, `listRequestsForAnon` | WP3 | WP2, WP4, WP5, WP7, WP8 |
| `listSaved`, `countSavedWithNewSales`, `markSeen`, `deleteAllForAnon` | WP4 | WP4 routes |
| `AdminStats`, `AdminLeadRow`, `CSV_COLUMNS` | WP5 | WP5 |
| `Stamp`, `StampedSheet`, `renderCard`, `VerdictSummary`, `SalesEvidence`, `ShareActions`, `ExampleCard`, `drawSampleScreenshot` | WP7 | WP6, WP7 |
| `ConfigProvider`/`usePublicConfig`, `LiveRegion`/`useAnnounce`, `useMe`, `DemoBadge`, `DemoNotice`, `SaveButton`, `CostRow`, `CostPanel`, `StepHeader`, `ActionBar`, `scrollIntoViewSafe`, `archivo` | WP8 | WP6, WP7 |

### 5.1 Path → owner index
| path | owner |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `components.json`, `vitest.config.ts`, `drizzle.config.ts`, `drizzle/**` | WP0 |
| `next.config.ts`, `railway.json`, `README.md`, `src/proxy.ts` | WP1 |
| `postcss.config.mjs` | WP8 |
| `playwright.config.ts`, `tests/e2e/**` | Integration (tech lead) |
| `docs/**` | WP0 during milestone A, then the tech lead |
| `src/instrumentation.ts` | WP0 |
| `src/app/{layout.tsx,globals.css,fonts.ts,not-found.tsx,error.tsx,manifest.ts,robots.ts,icon.svg,apple-icon.png}` | WP8 |
| `src/app/page.tsx` | WP6 |
| `src/app/{saved,coverage,privacy}/**` | WP8 |
| `src/app/c/**`, `src/app/how-it-works/**` | WP7 |
| `src/app/r/**` | WP4 |
| `src/app/admin/**` | WP5 |
| `src/app/api/{health,events}/**`, `src/app/api/admin/{login,logout}/**` | WP1 |
| `src/app/api/extract/**` | WP2 |
| `src/app/api/{buildings,checks,requests}/**` | WP3 |
| `src/app/api/{saved,leads,me}/**` (including `saved/[code]/seen`) | WP4 |
| `src/app/api/admin/**` (except login and logout) | WP5 |
| `src/components/{ui,magicui}/**` | WP0 during milestone A, then WP8 |
| `src/components/check/**`, `src/hooks/use-check-flow.ts` | WP6 |
| `src/components/{stamp,result,share}/**`, `src/lib/stamp/**`, `src/assets/**`, `public/fonts/**` | WP7 |
| `src/components/{shell,flow,a11y,demo,money,saved,coverage}/**`, `src/lib/motion.ts` | WP8 |
| `src/components/admin/**` | WP5 |
| `src/lib/{env,config,types,copy,format,log,utils,extract-circuit,samples}.ts`, `src/lib/domain/**`, `src/lib/validation/{fields,api,index}.ts`, `src/lib/api/{contract,client,fixtures}.ts`, `src/lib/db/{schema,client,migrate,seed,demo-data,meta}.ts` | WP0 |
| `src/lib/validation/admin.ts`, `src/lib/api/admin-client.ts`, `src/lib/csv/**`, `src/lib/db/repo/admin.ts` | WP5 |
| `src/lib/{http,auth,rate-limit}/**`, `src/lib/csp.ts`, `src/lib/db/repo/{anon,events}.ts` | WP1 |
| `src/lib/{claude,image}/**` | WP2 |
| `src/lib/db/repo/{buildings,checks,requests}.ts`, `src/lib/services/{check,match}.ts` | WP3 |
| `src/lib/db/repo/{saved,leads,me}.ts`, `src/lib/services/lead.ts` | WP4 |
| `scripts/{migrate,seed,reset-local}.ts` | WP0 |
| `scripts/try-extract.ts` | WP2 |
| `scripts/import-csv.ts` | WP5 |
| `tests/setup.ts`, `tests/helpers/{db,http,empty}.ts` | WP0 |
| `tests/helpers/fake-anthropic.ts`, `tests/fixtures/listings/**` | WP2 |
| `tests/fixtures/csv/**` | WP5 |
| every other `tests/**` file | the package that lists it |

---

## 6. Integration and release (tech lead)

1. Switch `/` from fixtures to the live API. Run the flow locally with a real `ANTHROPIC_API_KEY`.
2. `tests/e2e/smoke.spec.ts` (A§8.3) passes against `npm run build && npm start` on PGlite. It runs at 390×844 and 1280×800, with axe in light and dark.
3. Run `npm run typecheck && npm run lint && npm test`. `src/lib/domain` coverage must be 100%.
4. Work through the DESIGN.md D§7 accessibility checklist; every item ticked or ticketed.
5. Deploy to Railway, then on the live URL:
   - `/api/health` returns 200.
   - A real phone screenshot of a real listing reads correctly and gives the not-covered result.
   - A typed comparison of a covered building shows a verdict against registered sales.
   - The `/c/<code>` link pasted in WhatsApp shows the OG image and title, with "REGISTERED SALES" inside the stamp.
   - The share sheet works on iOS Safari and Android Chrome, including from WhatsApp's in-app browser.
   - Admin shows the check and the card view on Overview, the read on Quality, and the request from "Request it and track" on Requests; a CSV dry run and a registered sale work on Sales data.
   - The recovery link moves a saved list from WhatsApp's in-app browser to Safari.
   - "Delete all my data" works.
6. Screen-reader pass with VoiceOver on iOS and TalkBack on Android: reading status is announced, focus moves to each step heading, and alerts are read.
7. Before any real launch: load a real Data.Dubai snapshot (`npm run data:build`, REAL_DATA.md section 13; done on the real-data branch, there is no demo switch any more); set the real `PARTNER_*` values only once a partner is signed (until then leads are off); get a legal review of `consent.v1`.

---

## 7. Risks and mitigations

| risk | mitigation |
|---|---|
| Nonce CSP breaks next-themes or a Magic UI script | Pass the nonce to ThemeProvider. Keep the `CSP_MODE=relaxed` switch. WP1 acceptance requires zero console violations. |
| PGlite under Turbopack (WASM bundling) | `serverExternalPackages` in WP1-A. Tests run in Vitest, not Next. |
| Next 16 API renames (`proxy.ts`, async `params`) differ from the scaffold | Listed in A§0. WP0 checks the version on day 0. |
| SDK option names (`maxRetries`, `timeout`, `{ signal }`) are missing from the bundled reference | WP2 checks the installed SDK README before coding. Timeouts use our own `AbortSignal.timeout`, so we never need SDK timeout classes. |
| DESIGN.md and ARCHITECTURE.md drift | A§0.1 sets precedence: copy, components and visuals follow DESIGN.md; API, data and security follow ARCHITECTURE.md. `copy.ts` key coverage is tested against D§6. |
| The anon cookie is lost when moving from WhatsApp's in-app browser to Safari | Recovery link (WP4, WP8) and the "Saved on this browser" note. |
| Carrier-grade NAT puts many users behind one IP | The per-IP extract limit (60/day) is above the per-person limit (20/day), and both are env-tunable. |
| Sales data ages between refreshes | The window ends at min(today, `data_through`), and the stale note shows when the data is more than 45 days old (REAL_DATA.md section 7). |
| Reads slower than 25 s on poor connections | Client downscale (typically 150–400 KB). The 24 s server deadline, the 28 s client backstop and "Type the details" are always available. |
| The installed SDK lacks the per-request `{ signal }` option or the `maxRetries` / `timeout` client options (not in the bundled reference) | A§5.1 fallback: `new Anthropic()` plus a `Promise.race` against the abort signal; the deadline and Stop still hold. |
| A UI dependency cycle (WP7 uses WP8's `SaveButton`/`ActionBar`; the methodology page uses WP7's example and evidence) | `/how-it-works` belongs to WP7, so WP8 imports nothing from WP6 or WP7 and the order is WP8 → WP7 → WP6. |

---

## 8. Open questions for the product owner

These do not block the build; each has a default that ships unless the product owner says otherwise.

1. **Lead delivery.** v1 sends leads to the partner by admin CSV export plus "Mark sent to partner". Is a manual daily export acceptable, or does the partner need an automatic email or webhook (and to which address)? Default: manual export.
2. **Withdrawal notice to the partner.** Same channel question for "tell the partner to delete". Default: manual, tracked by "Partner told" in admin.
3. **Retention.** A§6.7 defaults: comparisons, saved items, requests and events kept until the person deletes them; withdrawn lead records kept without name and mobile; no automatic purge. Confirm, or give periods (for example 24 months of inactivity).
4. **The partner.** Name, regulator, licence number and the contact promise (`PARTNER_*`) for live mode, and legal sign-off of the unchanged `optin-v1` wording.
5. **Data licence and the demo switch.** Resolved (REAL_DATA.md): the source is the DLD open data on Data.Dubai under the Dubai Open Data Licence, the sales noun is "registered sales", results show the real dates and a stale note, and the demo is removed. Still open: the refresh cadence (How it works says "about once a month").
6. **Domain.** The production domain for `APP_URL` (share links and OG previews carry it).
7. **Anthropic spend.** Is the global cap of 1,000 reads a day (`EXTRACT_DAILY_GLOBAL_CAP`) the right budget ceiling?
8. **Not-covered requests.** Should choosing "None of these" alone count as a request in admin, or only the explicit "Request it and track" (current decision)?
