import { NextResponse, type NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { buildings } from "@/lib/db/schema";
import { buildRequest, call, cookieJar, parseSetCookie } from "../helpers/http";
import { clearUserData, useTestDb } from "../helpers/db";

async function echo(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  const params = await ctx.params;
  const type = req.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (type.includes("json")) body = await req.json();
  else if (type.includes("multipart")) body = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const res = NextResponse.json({
    method: req.method,
    path: req.nextUrl.pathname,
    q: req.nextUrl.searchParams.get("q"),
    origin: req.headers.get("origin"),
    cookie: req.cookies.get("mz_aid")?.value ?? null,
    params,
    body,
  });
  res.cookies.set("mz_aid", "abc.def", { httpOnly: true, path: "/", maxAge: 400 * 86400, sameSite: "lax" });
  res.cookies.set("gone", "", { maxAge: 0 });
  return res;
}

describe("tests/helpers/http", () => {
  it("calls a handler with a same-origin request and parses the response", async () => {
    const r = await call<Record<string, unknown>>(echo, {
      method: "POST",
      url: "/api/x/K7Q2MX?q=1",
      json: { a: 1 },
      cookies: { mz_aid: "v1" },
      params: { code: "K7Q2MX" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      method: "POST",
      path: "/api/x/K7Q2MX",
      q: "1",
      origin: "http://localhost:3000",
      cookie: "v1",
      params: { code: "K7Q2MX" },
      body: { a: 1 },
    });
    expect(r.cookies.mz_aid.value).toBe("abc.def");
    expect(r.cookies.mz_aid.attributes.httponly).toBe(true);
    expect(cookieJar({ gone: "x" }, r)).toEqual({ mz_aid: "abc.def" });
  });

  it("sends multipart forms and can omit the Origin", async () => {
    const r = await call<{ body: Record<string, string>; origin: string | null }>(echo, {
      method: "POST",
      form: { text: "2 bed" },
      origin: null,
    });
    expect(r.body.body).toEqual({ text: "2 bed" });
    expect(r.body.origin).toBeNull();
    const fd = new FormData();
    fd.append("text", "x");
    expect((await call<{ body: Record<string, string> }>(echo, { method: "POST", form: fd })).body.body).toEqual({ text: "x" });
  });

  it("handles 204 and text responses", async () => {
    expect((await call(() => new Response(null, { status: 204 }))).body).toBeNull();
    expect((await call(() => new Response("hi", { headers: { "content-type": "text/csv" } }))).body).toBe("hi");
    expect((await call(() => new Response("{bad", { headers: { "content-type": "application/json" } }))).body).toBe("{bad");
    expect(buildRequest({ headers: { host: "example.com" } }).headers.get("host")).toBe("example.com");
    expect(parseSetCookie("a=b; Path=/; Secure")).toEqual({ name: "a", value: "b", attributes: { path: "/", secure: true } });
  });
});

describe("tests/helpers/db", () => {
  const t = useTestDb();

  it("useTestDb seeds an in-memory database and makes getDb() return it", async () => {
    expect(getDb()).toBe(t.db);
    expect(t.today).toBe("2026-11-17");
    expect((await t.db.select().from(buildings)).length).toBe(6);
    await clearUserData(t.db);
    expect((await t.db.select().from(buildings)).length).toBe(6);
  });
});
