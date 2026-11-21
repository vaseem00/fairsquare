/**
 * Test environment defaults (A§8.1). Runs before every test file.
 * No ANTHROPIC_API_KEY: tests use fakes. No DATABASE_URL: tests use in-memory PGlite (tests/helpers/db.ts),
 * seeded with the synthetic test buildings (tests/fixtures/test-buildings.ts).
 * MIN_SALES is the production default (5). A synthetic mortgage partner is fully configured (name,
 * regulator and licence), so the adviser opt-in is on; tests of the "no partner" state unset it.
 */
const env = process.env as Record<string, string | undefined>;

env.SESSION_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
env.APP_URL = "http://localhost:3000";
env.ADMIN_PASSWORD = "test-admin-pass";
env.PARTNER_NAME = "Test Mortgage Partner";
env.PARTNER_REGULATOR = "Test Regulator";
env.PARTNER_LICENCE = "TEST-0001";
env.LOG_LEVEL = env.TEST_LOG_LEVEL ?? "error";
delete env.MIN_SALES;
delete env.ANTHROPIC_API_KEY;
delete env.DATABASE_URL;
delete env.SESSION_SECRET_PREVIOUS;
delete env.OPEN_DATA_DIR;
delete env.PARTNER_PROMISE;
