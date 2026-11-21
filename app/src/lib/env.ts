import "server-only";
/**
 * Environment (A§7.1): Zod-parsed lazily on the first getEnv(), so `next build` needs none of it.
 * Read at runtime only; there are no NEXT_PUBLIC_* variables (config reaches the browser through
 * getPublicConfig()).
 */
import { z } from "zod";
import { log } from "@/lib/log";

const DEV_SESSION_SECRET = "mizan-dev-insecure-session-secret-do-not-use-in-production";
const DEV_APP_URL = "http://localhost:3000";
/** README and .env.example: 12 or more characters. Enforced in production. */
export const ADMIN_PASSWORD_MIN = 12;

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1" || v === "yes"));

const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const num = (def: number) => z.coerce.number().default(def);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default("./.data/pglite"),
  ALLOW_PGLITE_IN_PRODUCTION: bool(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  CLAUDE_MAX_TOKENS: int(8192, 1),
  CLAUDE_TIMEOUT_MS: int(24_000, 1000),
  SESSION_SECRET: z.string().optional(),
  SESSION_SECRET_PREVIOUS: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  APP_URL: z.url().optional(),
  /** Set by Railway; the APP_URL fallback in production when APP_URL is unset. */
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  /** The committed open-data snapshot folder (REAL_DATA.md section 4). Default `<cwd>/data/open-data`. */
  OPEN_DATA_DIR: z.string().optional(),
  /**
   * The second tier (REAL_DATA.md section 15.4). "off": no similar-buildings comparison is computed and
   * no stored range is shown anywhere (result, /c, card, preview image, share text).
   */
  SIMILAR_TIER: z.enum(["on", "off"]).default("on"),
  /**
   * Adjusted registered sales, the first answer (REAL_DATA.md section 16.5). "off": nothing new
   * computes it and no stored result of it is shown anywhere; every comparison is then the
   * same-building median and the second tier, as before it existed.
   */
  ACS_TIER: z.enum(["on", "off"]).default("on"),
  /**
   * Nearby registered sales, the last resort (REAL_DATA.md section 17.5). "off": nothing new computes
   * it and no stored result of it is shown anywhere; a listing with no comparison of its own then reads
   * "Too few sales to compare yet" or "Not covered yet", as before it existed.
   */
  NEARBY_TIER: z.enum(["on", "off"]).default("on"),
  /** No default: the adviser opt-in appears only when name, regulator and licence are all set. */
  PARTNER_NAME: z.string().optional(),
  PARTNER_REGULATOR: z.string().optional(),
  PARTNER_LICENCE: z.string().optional(),
  PARTNER_PROMISE: z.string().optional(),
  MIN_SALES: int(5, 1),
  WINDOW_DAYS: int(365, 1),
  BAND_PCT: num(5),
  MORTGAGE_RATE_PCT: num(4.25),
  MORTGAGE_YEARS: int(25, 1),
  MORTGAGE_DOWN_PCT: int(20, 0),
  MAX_IMAGE_BYTES: int(8_388_608, 1),
  EXTRACT_ANON_BURST_LIMIT: int(6, 1),
  EXTRACT_ANON_DAILY_LIMIT: int(20, 1),
  EXTRACT_IP_DAILY_LIMIT: int(60, 1),
  EXTRACT_DAILY_GLOBAL_CAP: int(1000, 1),
  CHECKS_ANON_DAILY_LIMIT: int(100, 1),
  CHECKS_IP_DAILY_LIMIT: int(500, 1),
  LEADS_ANON_DAILY_LIMIT: int(3, 1),
  LEADS_PHONE_DAILY_LIMIT: int(3, 1),
  LEADS_IP_DAILY_LIMIT: int(10, 1),
  LEADS_DAILY_GLOBAL_CAP: int(500, 1),
  CSP_MODE: z.enum(["nonce", "relaxed"]).default("nonce"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

type RawEnv = z.output<typeof EnvSchema>;

export interface Env extends Omit<RawEnv, "SESSION_SECRET" | "APP_URL"> {
  /**
   * The public origin, no trailing slash: APP_URL, else `https://${RAILWAY_PUBLIC_DOMAIN}`, else
   * http://localhost:3000 outside production. Production refuses to start without one of the two.
   */
  APP_URL: string;
  /** Always set: production requires ≥ 32 chars; dev and test fall back to a fixed insecure value. */
  SESSION_SECRET: string;
  /** Comparison rules from MIN_SALES / WINDOW_DAYS / BAND_PCT. */
  rules: { minSales: number; windowDays: number; bandPct: number };
  isProduction: boolean;
}

let cached: Env | null = null;

/** "" counts as unset, so `.env` lines like `DATABASE_URL=` keep the default. */
function cleanSource(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) out[k] = v === undefined || v.trim() === "" ? undefined : v.trim();
  return out;
}

/** Parse an environment. Throws with every problem listed when it is invalid. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(cleanSource(source));
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = result.data;
  const isProduction = e.NODE_ENV === "production";
  let secret = e.SESSION_SECRET;
  if (isProduction) {
    if (!secret || secret.length < 32) {
      throw new Error("Invalid environment: SESSION_SECRET must be set to 32 or more characters in production");
    }
  } else if (!secret) {
    secret = DEV_SESSION_SECRET;
    if (e.NODE_ENV !== "test") log.warn("env_insecure_session_secret", { hint: "set SESSION_SECRET in .env.local" });
  }
  let appUrl = e.APP_URL ?? (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  if (!appUrl) {
    // Without it every mutation fails the origin check (403) and share links point at localhost,
    // while the healthcheck stays green: refuse to start instead.
    if (isProduction) throw new Error("Invalid environment: APP_URL must be set in production (e.g. https://${{RAILWAY_PUBLIC_DOMAIN}})");
    appUrl = DEV_APP_URL;
  }
  let adminPassword = e.ADMIN_PASSWORD;
  if (isProduction && adminPassword !== undefined && adminPassword.length < ADMIN_PASSWORD_MIN) {
    // Fail closed for admin only: a weak password turns admin login off, but must never take the
    // public site down (a throw here crashes every request through the instrumentation hook).
    log.error("admin_disabled_weak_password", {
      hint: `ADMIN_PASSWORD must be ${ADMIN_PASSWORD_MIN} or more characters; admin login is off until it is`,
    });
    adminPassword = undefined;
  }
  return {
    ...e,
    ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: secret,
    APP_URL: appUrl.replace(/\/+$/, ""),
    rules: { minSales: e.MIN_SALES, windowDays: e.WINDOW_DAYS, bandPct: e.BAND_PCT },
    isProduction,
  };
}

/** The mortgage partner leads go to: only when PARTNER_NAME, PARTNER_REGULATOR and PARTNER_LICENCE are all set. */
export interface LeadPartner {
  name: string;
  regulator: string;
  licence: string;
  promise: string | null;
}

/**
 * REAL_DATA.md section 8: the adviser opt-in exists only with a fully configured partner (no default
 * name). Null means leads are off: the money panel shows the estimator only and POST /api/leads
 * answers 404 leads_unavailable.
 */
export function leadPartner(e: Pick<Env, "PARTNER_NAME" | "PARTNER_REGULATOR" | "PARTNER_LICENCE" | "PARTNER_PROMISE">): LeadPartner | null {
  if (!e.PARTNER_NAME || !e.PARTNER_REGULATOR || !e.PARTNER_LICENCE) return null;
  return { name: e.PARTNER_NAME, regulator: e.PARTNER_REGULATOR, licence: e.PARTNER_LICENCE, promise: e.PARTNER_PROMISE ?? null };
}

/** The parsed environment, parsed once on first use. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Tests that change process.env call this so the next getEnv() parses again. */
export function __resetEnvForTests(): void {
  cached = null;
}
