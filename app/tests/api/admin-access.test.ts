/**
 * WP5 access: without a session every /api/admin/* route (except login) answers 401 unauthorized, and
 * every secure admin page redirects to /admin/login. Admin pages are noindex.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as statsGet } from "@/app/api/admin/stats/route";
import { GET as leadsGet } from "@/app/api/admin/leads/route";
import { GET as exportGet } from "@/app/api/admin/leads/export/route";
import { PATCH as leadPatch } from "@/app/api/admin/leads/[id]/route";
import { GET as revealGet } from "@/app/api/admin/leads/[id]/reveal/route";
import { GET as requestsGet, PATCH as requestsPatch } from "@/app/api/admin/requests/route";
import { GET as buildingsGet, POST as buildingsPost } from "@/app/api/admin/buildings/route";
import { GET as optionsGet } from "@/app/api/admin/buildings/options/route";
import { POST as aliasPost } from "@/app/api/admin/buildings/[id]/aliases/route";
import { GET as dataSourceGet } from "@/app/api/admin/data-source/route";
import { GET as salesGet, POST as salesPost } from "@/app/api/admin/sales/route";
import { POST as previewPost } from "@/app/api/admin/sales/preview/route";
import { DELETE as saleDelete } from "@/app/api/admin/sales/[id]/route";
import { POST as importPost } from "@/app/api/admin/import/route";
import { sign } from "@/lib/auth/sign";
import { useTestDb as setupTestDb } from "../helpers/db";
import { call, type RouteHandler } from "../helpers/http";
import { adminCookies } from "./admin-helpers";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
    has: (name: string) => name in cookieJar,
  }),
  headers: async () => new Headers(),
}));

const t = setupTestDb();

afterEach(() => {
  cookieJar = {};
});

const ROUTES: Array<{ name: string; handler: RouteHandler; method: string; url: string; params?: Record<string, string>; json?: unknown; form?: Record<string, Blob> }> = [
  { name: "GET stats", handler: statsGet, method: "GET", url: "/api/admin/stats?range=7" },
  { name: "GET leads", handler: leadsGet, method: "GET", url: "/api/admin/leads" },
  { name: "GET leads/export", handler: exportGet, method: "GET", url: "/api/admin/leads/export" },
  { name: "PATCH leads/[id]", handler: leadPatch, method: "PATCH", url: "/api/admin/leads/1", params: { id: "1" }, json: { status: "sent" } },
  { name: "GET leads/[id]/reveal", handler: revealGet, method: "GET", url: "/api/admin/leads/1/reveal", params: { id: "1" } },
  { name: "GET requests", handler: requestsGet, method: "GET", url: "/api/admin/requests" },
  { name: "PATCH requests", handler: requestsPatch, method: "PATCH", url: "/api/admin/requests", json: { textNorm: "x", resolvedBuildingId: 1 } },
  { name: "GET buildings", handler: buildingsGet, method: "GET", url: "/api/admin/buildings" },
  { name: "GET buildings/options", handler: optionsGet, method: "GET", url: "/api/admin/buildings/options" },
  { name: "GET data-source", handler: dataSourceGet, method: "GET", url: "/api/admin/data-source" },
  { name: "POST buildings", handler: buildingsPost, method: "POST", url: "/api/admin/buildings", json: { name: "X Tower", area: "Y" } },
  { name: "POST buildings/[id]/aliases", handler: aliasPost, method: "POST", url: "/api/admin/buildings/1/aliases", params: { id: "1" }, json: { alias: "Xx" } },
  { name: "GET sales", handler: salesGet, method: "GET", url: "/api/admin/sales" },
  { name: "POST sales", handler: salesPost, method: "POST", url: "/api/admin/sales", json: {} },
  { name: "POST sales/preview", handler: previewPost, method: "POST", url: "/api/admin/sales/preview", json: {} },
  { name: "DELETE sales/[id]", handler: saleDelete, method: "DELETE", url: "/api/admin/sales/1", params: { id: "1" } },
  { name: "POST import", handler: importPost, method: "POST", url: "/api/admin/import?kind=sales", form: { file: new Blob(["a,b\n"]) } },
];

describe("admin API without a session", () => {
  it.each(ROUTES)("$name → 401 unauthorized", async (r) => {
    const res = await call<{ error: { code: string } }>(r.handler, r);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(ROUTES.slice(0, 3))("$name → 401 with a forged cookie", async (r) => {
    const res = await call(r.handler, { ...r, cookies: { mz_admin: sign("adm", "A".repeat(43)) } });
    expect(res.status).toBe(401);
  });

  it("a real session opens them", async () => {
    const cookies = await adminCookies(t.db);
    expect((await call(statsGet, { url: "/api/admin/stats", cookies })).status).toBe(200);
    expect((await call(buildingsGet, { url: "/api/admin/buildings", cookies })).status).toBe(200);
  });
});

function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: string })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? null;
}

async function expectRedirectToLogin(render: () => Promise<unknown>) {
  let target: string | null = null;
  try {
    await render();
  } catch (err) {
    target = redirectTarget(err);
  }
  expect(target).toBe("/admin/login");
}

describe("admin pages without a session", () => {
  const sp = Promise.resolve({});

  it("the (secure) layout redirects to /admin/login", async () => {
    const { default: Layout } = await import("@/app/admin/(secure)/layout");
    await expectRedirectToLogin(() => Layout({ children: null }));
  });

  it("/admin, /admin/leads, /admin/requests, /admin/sales and /admin/quality redirect", async () => {
    const pages = await Promise.all([
      import("@/app/admin/(secure)/page"),
      import("@/app/admin/(secure)/leads/page"),
      import("@/app/admin/(secure)/requests/page"),
      import("@/app/admin/(secure)/sales/page"),
      import("@/app/admin/(secure)/quality/page"),
    ]);
    for (const p of pages) {
      const Page = p.default as (props: { searchParams: typeof sp }) => Promise<unknown>;
      await expectRedirectToLogin(() => Page({ searchParams: sp }));
    }
  });

  it("a forged cookie still redirects; a real session renders", async () => {
    cookieJar = { mz_admin: sign("adm", "B".repeat(43)) };
    const { default: Page } = await import("@/app/admin/(secure)/quality/page");
    await expectRedirectToLogin(() => Page({ searchParams: sp }));
    cookieJar = await adminCookies(t.db);
    await expect(Page({ searchParams: sp })).resolves.toBeTruthy();
  });

  it("/admin/login sends a signed-in admin to /admin", async () => {
    cookieJar = await adminCookies(t.db);
    const { default: Login } = await import("@/app/admin/login/page");
    let target: string | null = null;
    try {
      await Login();
    } catch (err) {
      target = redirectTarget(err);
    }
    expect(target).toBe("/admin");
  });

  it("admin pages are noindex", async () => {
    const layout = await import("@/app/admin/(secure)/layout");
    const login = await import("@/app/admin/login/page");
    expect(layout.metadata.robots).toMatchObject({ index: false, follow: false });
    expect(login.metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
