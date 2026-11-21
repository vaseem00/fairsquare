/**
 * A mocked `api` object (same shape as `src/lib/api/client.ts`). Kept free of component imports so
 * it can be loaded inside a `vi.mock` factory:
 *   vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));
 */
import { vi } from "vitest";

/** An `ApiResult` success. */
export const ok = <T>(data: T) => ({ ok: true as const, data });

/** An `ApiResult` failure. */
export const fail = (status: number, code: string, message: string, fields?: Record<string, string>) => ({
  ok: false as const,
  status,
  error: { code, message, requestId: "test", ...(fields ? { fields } : {}) },
});

/** Loosely typed so each test can return any ApiResult shape. */
type AnyFn = (...args: never[]) => unknown;
const fn = (impl?: AnyFn) => (impl ? vi.fn<AnyFn>(impl) : vi.fn<AnyFn>());

export function makeApiMock() {
  return {
    extract: fn(),
    match: fn(),
    buildings: fn(),
    createCheck: fn(),
    getCheck: fn(),
    saved: {
      list: fn(async () => ok({ items: [] as unknown[] })),
      add: fn(),
      remove: fn(async () => ok(null)),
      markSeen: fn(async () => ok(null)),
    },
    leads: { create: fn(), withdraw: fn(), list: fn() },
    me: {
      get: fn(async () => ok({ savedCount: 0, savedWithNewSales: 0, checksCount: 0, requests: [], leads: [] })),
      remove: fn(async () => ok(null)),
      recoveryLink: fn(),
      recover: fn(async () => ok(null)),
    },
    requests: { create: fn() },
    track: fn(),
  };
}

export type ApiMock = ReturnType<typeof makeApiMock>;