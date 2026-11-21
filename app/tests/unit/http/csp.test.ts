import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { buildCsp, cspModeFrom, generateNonce } from "@/lib/csp";
import { config, proxy } from "@/proxy";

const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;
afterEach(() => {
  env.NODE_ENV = savedNodeEnv;
  delete env.CSP_MODE;
});

function directives(csp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csp.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [name, ...rest] = part.split(/\s+/);
    out[name] = rest.join(" ");
  }
  return out;
}

describe("buildCsp", () => {
  it("builds the A§6.6 nonce policy", () => {
    const d = directives(buildCsp({ nonce: "abc" }));
    expect(d["default-src"]).toBe("'self'");
    expect(d["script-src"]).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(d["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(d["img-src"]).toBe("'self' blob: data:");
    expect(d["font-src"]).toBe("'self'");
    expect(d["connect-src"]).toBe("'self'");
    expect(d["worker-src"]).toBe("'self' blob:");
    expect(d["object-src"]).toBe("'none'");
    expect(d["base-uri"]).toBe("'self'");
    expect(d["form-action"]).toBe("'self'");
    expect(d["frame-ancestors"]).toBe("'none'");
    expect(d["manifest-src"]).toBe("'self'");
    expect("upgrade-insecure-requests" in d).toBe(false);
  });

  it("adds eval and websockets in dev, upgrade-insecure-requests in production", () => {
    const dev = directives(buildCsp({ nonce: "n", isDev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
    const prod = directives(buildCsp({ nonce: "n", isProduction: true }));
    expect(prod["script-src"]).not.toContain("unsafe-eval");
    expect("upgrade-insecure-requests" in prod).toBe(true);
  });

  it("relaxed mode drops the nonce and allows inline scripts", () => {
    const d = directives(buildCsp({ nonce: "n", mode: "relaxed" }));
    expect(d["script-src"]).toBe("'self' 'unsafe-inline'");
    expect(cspModeFrom("relaxed")).toBe("relaxed");
    expect(cspModeFrom(" RELAXED ")).toBe("relaxed");
    expect(cspModeFrom("nonce")).toBe("nonce");
    expect(cspModeFrom(undefined)).toBe("nonce");
  });

  it("generates fresh 128-bit nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });
});

function page(path: string, cookies?: string) {
  const headers = new Headers();
  if (cookies) headers.set("cookie", cookies);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

function nonceOf(csp: string | null): string | null {
  return /'nonce-([^']+)'/.exec(csp ?? "")?.[1] ?? null;
}

describe("proxy", () => {
  it("sets a fresh nonce CSP on every page request and forwards it with x-nonce", () => {
    const a = proxy(page("/"));
    const b = proxy(page("/"));
    const cspA = a.headers.get("content-security-policy");
    const nA = nonceOf(cspA);
    expect(nA).toBeTruthy();
    expect(nonceOf(b.headers.get("content-security-policy"))).not.toBe(nA);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers like this:
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nA);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(cspA);
    expect(a.headers.get("x-middleware-next")).toBe("1");
  });

  it("uses the relaxed policy when CSP_MODE=relaxed", () => {
    env.CSP_MODE = "relaxed";
    const csp = proxy(page("/")).headers.get("content-security-policy");
    expect(nonceOf(csp)).toBeNull();
    expect(csp).toContain("'unsafe-inline'");
  });

  it("redirects /admin pages without the admin cookie to /admin/login", () => {
    for (const p of ["/admin", "/admin/leads", "/admin/sales"]) {
      const res = proxy(page(p));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location") as string).pathname).toBe("/admin/login");
    }
    const login = proxy(page("/admin/login"));
    expect(login.headers.get("location")).toBeNull();
    const withCookie = proxy(page("/admin", "mz_admin=x.y"));
    expect(withCookie.headers.get("location")).toBeNull();
    expect(proxy(page("/administrator")).headers.get("location")).toBeNull();
  });

  describe("matcher", () => {
    const source = config.matcher[0].source;
    const re = new RegExp(`^${source}$`);
    it("matches pages", () => {
      for (const p of ["/", "/saved", "/coverage", "/how-it-works", "/privacy", "/c/K7Q2MX", "/admin", "/admin/login", "/r/tok"]) {
        expect(re.test(p), p).toBe(true);
      }
    });
    it("skips /api, static files, metadata images, robots and the manifest", () => {
      for (const p of [
        "/api/health",
        "/api",
        "/_next/static/chunks/a.js",
        "/_next/image",
        "/favicon.ico",
        "/icon.svg",
        "/apple-icon.png",
        "/c/K7Q2MX/opengraph-image",
        "/c/K7Q2MX/opengraph-image-abc123",
        "/robots.txt",
        "/manifest.webmanifest",
        "/fonts/archivo-stamp-wide.woff",
        "/fonts/OFL.txt",
      ]) {
        expect(re.test(p), p).toBe(false);
      }
    });
    it("skips router prefetches", () => {
      expect(config.matcher[0].missing.map((m) => m.key)).toEqual(["next-router-prefetch", "purpose"]);
    });
  });
});
