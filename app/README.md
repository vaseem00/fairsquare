# Fairsquare

Renamed from Mizan to Fairsquare on 18 Nov 2026. Internal identifiers (storage keys, folders, the Railway service, the repo) keep the old name.

A buyer uploads a screenshot of a Dubai apartment listing. Claude reads the building, bedrooms, size and price. The buyer confirms the building. Fairsquare compares the asking AED per sq ft with the median of same-bedroom sales in that building over the last 12 months and returns a stamped card to share on WhatsApp.

The sales are real: the Dubai Land Department (DLD) sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence. Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai. The data rules live in `docs/REAL_DATA.md`.

Stack: Next.js 16 (App Router, Turbopack, Cache Components), React 19, Tailwind CSS v4, shadcn/ui on Base UI, Zod 4, Drizzle ORM on Postgres (Railway) or PGlite (local), and the Anthropic SDK on the server only.

The plan lives in `docs/`: `ARCHITECTURE.md`, `DESIGN.md` and `BUILD_PLAN.md`.

## Run locally on Windows

You need Node.js 22 or later. Use PowerShell.

```powershell
cd app
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000.

- Leave `DATABASE_URL` empty. The app then uses PGlite, an in-process Postgres, stored in `.data\pglite`.
- Each boot applies the migrations, then loads the committed sales snapshot (`data\open-data\`) in the background when it is new. There is no seed and no demo data. Without a snapshot the app starts with no sales. On PGlite, requests wait while a load runs (a few minutes for a full snapshot); on Postgres they do not.
- Screenshot reading is off until you add `ANTHROPIC_API_KEY=...` to `.env.local`. Typing the details and pasting listing text work without it.
- Admin login is off until you set `ADMIN_PASSWORD` (12 characters or more). Then sign in at http://localhost:3000/admin/login.
- Without `SESSION_SECRET`, development uses a fixed insecure secret and logs a warning. Set one to keep cookies stable across setups.

Other commands:

```powershell
npm test               # unit and API tests on in-memory PGlite
npm run typecheck
npm run lint
npm run db:migrate     # apply migrations without starting the app
npm run db:reset       # delete .data\pglite (stop npm run dev first)
npm run data:build -- --in ..\raw-data\<file> --dataset-url <url> --downloaded <YYYY-MM-DD>   # build the sales snapshot
npm run try:extract -- <image> --match   # one real screenshot read (needs ANTHROPIC_API_KEY)
```

Browser smoke test (A§8.3). It uses your installed Microsoft Edge, so it downloads no browser:

```powershell
npm run build
npm run test:e2e
```

`playwright.config.ts` starts two production servers (ports 3110 and 3111) with throwaway local secrets and an empty PGlite folder each, then runs the flow at 390×844 and 1280×800 with axe in light and dark. To test a server you started yourself on an empty database, set `$env:E2E_BASE_URL` and `$env:E2E_ADMIN_PASSWORD`, then run one viewport only (the admin counts assume one run): `npm run test:e2e -- --project mobile-390`.

The `ACS_TIER` switch has its own run, because one server cannot change its environment: `npx playwright test -c playwright.switch.config.ts` starts and stops its own servers (ports 3112 and 3113, one at a time) on one PGlite folder with the switch off, on and off again (REAL_DATA.md section 16.5).

PGlite locks its data folder. Stop `npm run dev` before you run `db:migrate` or `db:reset`.

To use a real Postgres locally, set `DATABASE_URL` in `.env.local`. For example, use Docker `postgres:17`, or the Railway public proxy URL with `?sslmode=require`.

## Deploy to Railway

The app runs as one Railway service with a Railway Postgres database. `railway.json` sets the build, the start command and the healthcheck.

1. Push the repository to GitHub. If the app sits inside a larger repository, set the service **Root Directory** to the `mizan-app` folder.
2. In a Railway project, add **New → Database → PostgreSQL**. Then add **New → GitHub Repo** and pick this repository. Put both in the same region (EU West or Southeast Asia are about 100 ms from Dubai).
3. Set the service variables:

   | variable | value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network, no SSL needed) |
   | `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
   | `NODE_ENV` | `production` |
   | `PARTNER_NAME`, `PARTNER_REGULATOR`, `PARTNER_LICENCE` | only when a licensed mortgage adviser is signed; the adviser opt-in shows only when all three are set |
   | `ANTHROPIC_API_KEY` | secret, set by the owner in the dashboard |
   | `SESSION_SECRET` | secret, set by the owner: 48 random bytes in base64 (at least 32 characters) |
   | `ADMIN_PASSWORD` | secret, set by the owner: at least 12 characters |

   Never put these secrets in the repository. To rotate `SESSION_SECRET`, move the old value to `SESSION_SECRET_PREVIOUS` and set a new one. Existing cookies keep working.
4. Open **Settings → Networking → Generate Domain**. If you add a custom domain later, update `APP_URL`. No rebuild is needed: the app reads it at runtime.
5. Deploy. Each push to the connected branch builds and deploys:
   - Railpack runs `npm run build`. The build never touches the database (the private network is not available during builds).
   - `npm run start` starts `next start` on Railway's `PORT`.
   - On boot, `src/instrumentation.ts` applies the migrations. Then it loads the committed sales snapshot in the background when its SHA-256 differs from the loaded one. The load never delays the start or the healthcheck. A failure is logged as `open_data_load_failed` and the previous data stays.
   - Railway calls `GET /api/health` and promotes the deploy only after it returns 200. If a migration fails, the boot fails, the healthcheck fails, and the previous deploy stays live.
6. Check `https://<your-domain>/api/health`. It returns `{ "ok": true, "db": "postgres", "version": "<commit>" }`. The log line `open_data_loaded` (rows, inserted, updated, deleted, buildings, ms) confirms a new snapshot.

## Sales data: refresh procedure

> **In this public repository the snapshot is not committed** (`app/data/open-data/` is git-ignored). Build it from your own download ([`docs/DATA_COLLECTION.md`](../docs/DATA_COLLECTION.md)). The steps below describe the original private deployment, where the snapshot was committed so that the host could load it. If you deploy your own copy, keep the snapshot in a private repository or load it as a build artifact. Raw files stay in `raw-data/` at the repository root.

The sales come from the DLD "Transactions" dataset on Data.Dubai. Data.Dubai answers only inside the UAE and Railway runs outside it, so the server never downloads anything. The owner builds a snapshot locally and commits it. Never use the dubailand.gov.ae website export: its terms allow personal, non-commercial use only, and `data:build` refuses it.

1. On a UAE connection, download the latest Transactions file (CSV or ZIP) from data.dubai into `..\raw-data\`, outside the repository. Raw files are never committed.
2. Build the snapshot and read the report:

   ```powershell
   npm run data:build -- --in ..\raw-data\<file> --dataset-url <dataset page URL> --downloaded <YYYY-MM-DD>
   ```

   - Add `--in` again for a second file (for example the historic file plus a newer one). A transaction that appears in both is kept once.
   - The build streams the file (a 1 GB CSV is fine) and reads a `.zip` directly.
   - It writes `data\open-data\sales.csv.gz`, `data\open-data\buildings.csv.gz` (one row of facts per building), `data\open-data\similar-cells.csv.gz` (the similar-buildings model, `docs\REAL_DATA.md` section 15) and `data\open-data\manifest.json`, and prints the rows read and kept, each exclusion reason, the 20 most common source values, the date range and the building count. Check them before you commit.
   - If it ends with "the similar-buildings constants are too old for this data" (exit code 2), refit them before you commit: `scripts\model\README.md`. This is due at least twice a year; for the constants of 16 Nov 2026, with data that runs past 4 Jun 2027.
   - It also writes `data\open-data\acs-model.json.gz`: the adjusted-registered-sales model (`docs\REAL_DATA.md` section 16), rebuilt from the same files on every refresh. Commit it with the other files.
   - If it ends with "the adjusted-registered-sales fit is too old for this data" (exit code 2), refit before you commit: `scripts\model\README.md`. The site still works without a refit, but compares with the same-building median and the second tier only. For the fit of 16 Nov 2026 this is due with data that ends after 4 Jun 2027.
3. Commit `data/open-data/` and push to `main`. Railway deploys and loads the new snapshot in the background. Existing sales keep their "recorded in Fairsquare" time, so "new since you saved" shows only sales that are new in this snapshot. A transaction DLD corrected (same transaction id, other values) is updated in place and keeps that time too. Sales that left the snapshot are removed.

Logs are JSON lines on stdout. Use the Railway log explorer to read them. They never contain names, phone numbers, pasted text, screenshots or IP addresses.

## Security notes

- Mutating API calls must come from the same origin. Cross-site calls get `403`.
- Pages get a fresh nonce-based Content Security Policy from `src/proxy.ts`. If a third-party component ever breaks under it, set `CSP_MODE=relaxed` as a temporary fallback.
- People have no accounts. A signed, HttpOnly cookie (`mz_aid`) identifies a browser. The admin uses a password and a 12-hour session cookie (`mz_admin`). The database stores only a hash of each session token.
- Rate limits live in the database: reads, comparisons, leads, requests, events and admin login attempts.
