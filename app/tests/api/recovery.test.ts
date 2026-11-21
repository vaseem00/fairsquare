import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as GET_RECOVER } from "@/app/r/[token]/route";
import { POST as POST_CHECK } from "@/app/api/checks/route";
import { DELETE as DELETE_ME } from "@/app/api/me/route";
import { POST as POST_LINK } from "@/app/api/me/recovery-link/route";
import { POST as POST_RECOVER } from "@/app/api/me/recover/route";
import { GET as GET_SAVED, POST as POST_SAVED } from "@/app/api/saved/route";
import { signAnonId, verifyAnonCookie } from "@/lib/auth/anon";
import { sign } from "@/lib/auth/sign";
import { createRecoveryToken, RECOVERY_TTL_SEC, verifyRecoveryToken } from "@/lib/db/repo/me";
import { anonUsers, buildings } from "@/lib/db/schema";
import { dubaiToday } from "@/lib/domain/dates";
import type { CheckView, SavedItemView } from "@/lib/types";
import { clearUserData, useTestDb as setupTestDb } from "../helpers/db";
import { call } from "../helpers/http";

const t = setupTestDb({ today: dubaiToday() });

beforeEach(async () => {
  await clearUserData(t.db);
});

const MARINA = { buildingText: "Mockup Crest Tower", areaText: "Dubai Marina", bedrooms: 2, sizeSqft: 1284, priceAed: 2_450_000 };

/** A person with one saved Marina comparison. */
async function personWithSaved() {
  const [b] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
  const check = await call<{ check: CheckView }>(POST_CHECK, {
    method: "POST",
    url: "/api/checks",
    json: { fields: MARINA, buildingId: b.id, source: "manual" },
  });
  const cookie = check.cookies.mz_aid.value;
  const code = check.body.check.code;
  expect((await call(POST_SAVED, { method: "POST", url: "/api/saved", json: { code }, cookies: { mz_aid: cookie } })).status).toBe(201);
  return { cookie, code, anonId: verifyAnonCookie(cookie) as string };
}

function recover(token: string, cookies?: Record<string, string>) {
  return call(GET_RECOVER, { url: `/r/${token}`, params: { token }, cookies, origin: null });
}

describe("POST /api/me/recovery-link", () => {
  it("returns `${APP_URL}/r/<token>` for the current person", async () => {
    const { cookie, anonId } = await personWithSaved();
    const res = await call<{ url: string }>(POST_LINK, { method: "POST", url: "/api/me/recovery-link", cookies: { mz_aid: cookie } });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^http:\/\/localhost:3000\/r\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const token = res.body.url.split("/r/")[1];
    expect(verifyRecoveryToken(token)).toBe(anonId);
  });

  it("rejects cross-site posts", async () => {
    const res = await call(POST_LINK, { method: "POST", url: "/api/me/recovery-link", origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("GET /r/[token]", () => {
  it("with no cookie: 303 to /saved and sets mz_aid to the same id, which then lists the saved item", async () => {
    const { cookie, code, anonId } = await personWithSaved();
    const link = await call<{ url: string }>(POST_LINK, { method: "POST", url: "/api/me/recovery-link", cookies: { mz_aid: cookie } });
    const token = link.body.url.split("/r/")[1];

    const res = await recover(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/saved");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const restored = res.cookies.mz_aid;
    expect(restored).toBeDefined();
    expect(verifyAnonCookie(restored.value)).toBe(anonId);
    expect(restored.attributes.httponly).toBe(true);
    expect(restored.attributes.samesite).toBe("Lax");

    const list = await call<{ items: SavedItemView[] }>(GET_SAVED, { url: "/api/saved", cookies: { mz_aid: restored.value } });
    expect(list.body.items.map((i) => i.code)).toEqual([code]);
  });

  it("never silently replaces another person's list: it asks first, and only a same-origin POST switches", async () => {
    const a = await personWithSaved();
    const b = await personWithSaved();
    const token = createRecoveryToken(a.anonId);
    const res = await recover(token, { mz_aid: b.cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/saved?recovery=confirm&token=${encodeURIComponent(token)}`);
    expect(res.setCookies).toEqual([]);

    // A cross-site POST cannot do the switch.
    const evil = await call(POST_RECOVER, { method: "POST", url: "/api/me/recover", json: { token }, cookies: { mz_aid: b.cookie }, origin: "https://evil.example" });
    expect(evil.status).toBe(403);

    const ok = await call(POST_RECOVER, { method: "POST", url: "/api/me/recover", json: { token }, cookies: { mz_aid: b.cookie } });
    expect(ok.status).toBe(204);
    expect(verifyAnonCookie(ok.cookies.mz_aid.value)).toBe(a.anonId);

    const bad = await call<{ error: { code: string } }>(POST_RECOVER, { method: "POST", url: "/api/me/recover", json: { token: "garbage" } });
    expect(bad.status).toBe(404);
    expect(bad.setCookies).toEqual([]);
  });

  it("the same id already in the browser, or a browser cookie for no existing person, switches directly", async () => {
    const a = await personWithSaved();
    const same = await recover(createRecoveryToken(a.anonId), { mz_aid: a.cookie });
    expect(same.headers.get("location")).toBe("http://localhost:3000/saved");
    const stale = await recover(createRecoveryToken(a.anonId), { mz_aid: signAnonId("6b1c7faa-8093-44b5-8a51-6c7d8e9f0a1b") });
    expect(stale.headers.get("location")).toBe("http://localhost:3000/saved");
    expect(verifyAnonCookie(stale.cookies.mz_aid.value)).toBe(a.anonId);
  });

  it("a tampered, malformed or wrong-purpose token → 303 to /saved?recovery=failed with no cookie", async () => {
    const { anonId } = await personWithSaved();
    const good = createRecoveryToken(anonId);
    const [payload, sig] = good.split(".");
    const otherPayload = Buffer.from(`6b1c7faa-8093-44b5-8a51-6c7d8e9f0a1b.${Math.floor(Date.now() / 1000) + 1000}`).toString("base64url");
    for (const token of [
      // Flip a middle character (the last one also carries padding bits), and try a non-canonical last character.
      `${payload}.${sig.slice(0, 10)}${sig[10] === "A" ? "B" : "A"}${sig.slice(11)}`,
      `${payload}.${nonCanonical(sig)}`,
      `${otherPayload}.${sig}`,
      "garbage",
      "",
      signAnonId(anonId),
      sign("rec", anonId),
    ]) {
      const res = await recover(token);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost:3000/saved?recovery=failed");
      expect(res.setCookies).toEqual([]);
    }
  });

  it("an expired token → failed", async () => {
    const { anonId } = await personWithSaved();
    const issued = new Date(Date.now() - (RECOVERY_TTL_SEC + 60) * 1000);
    const token = createRecoveryToken(anonId, issued);
    expect(verifyRecoveryToken(token, new Date(issued.getTime() + 1000))).toBe(anonId);
    const res = await recover(token);
    expect(res.headers.get("location")).toBe("http://localhost:3000/saved?recovery=failed");
    expect(res.setCookies).toEqual([]);
  });

  it("a token of a person who deleted their data → failed", async () => {
    const { cookie, anonId } = await personWithSaved();
    const token = createRecoveryToken(anonId);
    expect((await call(DELETE_ME, { method: "DELETE", url: "/api/me", cookies: { mz_aid: cookie } })).status).toBe(204);
    const res = await recover(token);
    expect(res.headers.get("location")).toBe("http://localhost:3000/saved?recovery=failed");
    expect(res.setCookies).toEqual([]);
  });

  it("a surviving copy of a deleted person's cookie gets a fresh id, and old recovery links stay dead", async () => {
    const { cookie, anonId } = await personWithSaved();
    const token = createRecoveryToken(anonId);
    expect((await call(DELETE_ME, { method: "DELETE", url: "/api/me", cookies: { mz_aid: cookie } })).status).toBe(204);
    // Another browser still holds the signed cookie and makes a comparison.
    const [b] = await t.db.select().from(buildings).where(eq(buildings.name, "Mockup Crest Tower"));
    const again = await call<{ check: CheckView }>(POST_CHECK, {
      method: "POST",
      url: "/api/checks",
      json: { fields: MARINA, buildingId: b.id, source: "manual" },
      cookies: { mz_aid: cookie },
    });
    expect(again.status).toBe(201);
    const fresh = verifyAnonCookie(again.cookies.mz_aid.value);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(anonId);
    expect(await t.db.select().from(anonUsers).where(eq(anonUsers.id, anonId))).toHaveLength(0);
    const res = await recover(token);
    expect(res.headers.get("location")).toBe("http://localhost:3000/saved?recovery=failed");
  });
});

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Same bytes, different spelling: set a padding bit in the last character of a 32-byte base64url MAC. */
function nonCanonical(sig: string): string {
  const last = B64URL.indexOf(sig[sig.length - 1]);
  return sig.slice(0, -1) + B64URL[last | 1];
}
