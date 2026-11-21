import { afterEach, describe, expect, it, vi } from "vitest";
import { __setFetchForTests, api } from "@/lib/api/client";
import { CONTRACT, pathFor } from "@/lib/api/contract";
import { FIXTURE_CHECK_MARINA, FIXTURE_ME } from "../fixtures/api-fixtures";
import { COPY, ERROR_COPY } from "@/lib/copy";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  });
  __setFetchForTests(f as unknown as typeof fetch);
  return calls;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => __setFetchForTests(null));

describe("api client", () => {
  it("createCheck posts JSON and returns data", async () => {
    const calls = fakeFetch(() => json(201, { check: FIXTURE_CHECK_MARINA }));
    const body = {
      fields: { buildingText: "Mockup Crest", areaText: null, bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 },
      buildingId: 1,
      source: "claude" as const,
      editedFields: [],
    };
    const r = await api.createCheck(body);
    expect(r).toEqual({ ok: true, data: { check: FIXTURE_CHECK_MARINA } });
    expect(calls[0].url).toBe("/api/checks");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
  });

  it("returns the server error without throwing", async () => {
    fakeFetch(() =>
      json(422, {
        error: { code: "validation_failed", message: "m", fields: { "fields.bedrooms": "x" }, requestId: "rq" },
      }),
    );
    const r = await api.createCheck({} as never);
    expect(r).toEqual({
      ok: false,
      status: 422,
      error: { code: "validation_failed", message: "m", fields: { "fields.bedrooms": "x" }, requestId: "rq" },
    });
  });

  it("falls back to copy for unknown error bodies and reads Retry-After", async () => {
    fakeFetch(() => new Response("<html>", { status: 429, headers: { "retry-after": "30", "x-request-id": "r9" } }));
    const r = await api.me.get();
    expect(r).toEqual({
      ok: false,
      status: 429,
      error: { code: "rate_limited", message: ERROR_COPY.rate_limited, requestId: "r9", retryAfterSec: 30 },
    });
    fakeFetch(() => json(404, { error: { code: "made_up" } }));
    expect(await api.getCheck("K7Q2MX")).toMatchObject({ ok: false, status: 404, error: { code: "not_found" } });
    fakeFetch(() => json(500, { error: { code: "internal", message: "", retryAfterSec: 5 } }));
    expect(await api.buildings()).toMatchObject({ error: { code: "internal", message: ERROR_COPY.internal, retryAfterSec: 5 } });
    fakeFetch(() => new Response("x", { status: 400 }));
    expect(await api.buildings()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("maps network failures to an offline result", async () => {
    fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const r = await api.saved.list();
    expect(r).toEqual({ ok: false, status: 0, error: { code: "internal", message: COPY["error.offline"], requestId: "" } });
  });

  it("rethrows aborts", async () => {
    fakeFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(api.extract({ text: "2 bed" }, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("handles 204 and broken JSON", async () => {
    fakeFetch(() => new Response(null, { status: 204 }));
    expect(await api.saved.remove("K7Q2MX")).toEqual({ ok: true, data: null });
    fakeFetch(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    expect(await api.me.get()).toMatchObject({ ok: false, status: 200, error: { code: "internal" } });
  });

  it("builds every endpoint's URL and method", async () => {
    const calls = fakeFetch((url) => (url.includes("/seen") || url.endsWith("/api/me") ? new Response(null, { status: 204 }) : json(200, FIXTURE_ME)));
    await api.extract({ image: new Blob(["x"], { type: "image/jpeg" }), text: "t" });
    await api.match("Mockup Crest", "Dubai Marina", 2);
    await api.match("Marina", null, null);
    await api.buildings();
    await api.getCheck("K7Q2MX");
    await api.saved.list();
    await api.saved.add("K7Q2MX");
    await api.saved.remove("K7Q2MX");
    await api.saved.markSeen("K7Q2MX");
    await api.leads.create({} as never);
    await api.leads.withdraw(7);
    await api.leads.list();
    await api.me.get();
    await api.me.remove();
    await api.me.recoveryLink();
    await api.requests.create({ text: "Nowhere Point Tower", code: "H8PT5W" });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "POST /api/extract",
      "GET /api/buildings/match?q=Mockup+Crest&area=Dubai+Marina&beds=2",
      "GET /api/buildings/match?q=Marina",
      "GET /api/buildings",
      "GET /api/checks/K7Q2MX",
      "GET /api/saved",
      "POST /api/saved",
      "DELETE /api/saved/K7Q2MX",
      "POST /api/saved/K7Q2MX/seen",
      "POST /api/leads",
      "POST /api/leads/7/withdraw",
      "GET /api/leads",
      "GET /api/me",
      "DELETE /api/me",
      "POST /api/me/recovery-link",
      "POST /api/requests",
    ]);
    const form = calls[0].init.body as FormData;
    expect(form.get("text")).toBe("t");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("track is fire-and-forget with keepalive and never throws", async () => {
    const calls = fakeFetch(() => Promise.reject(new TypeError("offline")));
    expect(() => api.track("share_whatsapp", "K7Q2MX")).not.toThrow();
    api.track("link_copied");
    await Promise.resolve();
    expect(calls[0].url).toBe("/api/events");
    expect(calls[0].init.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: "share_whatsapp", code: "K7Q2MX" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ name: "link_copied" });
    __setFetchForTests((() => {
      throw new Error("sync");
    }) as unknown as typeof fetch);
    expect(() => api.track("cost_opened")).not.toThrow();
  });
});

describe("contract", () => {
  it("fills path params", () => {
    expect(pathFor("getCheck", { code: "K7Q2MX" })).toBe("/api/checks/K7Q2MX");
    expect(() => pathFor("getCheck")).toThrow(/missing :code/);
    expect(CONTRACT.createCheck).toMatchObject({ method: "POST", status: 201, anon: "required" });
    expect(CONTRACT.getCheck.anon).toBe("none");
  });
});
