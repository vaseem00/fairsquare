# Fairsquare

**Can Dubai's registered property sales price-check a listing, and how honestly can that be done?**

Fairsquare is a research project and an open-source web app. A buyer gives a Dubai apartment listing (a screenshot or typed details). Fairsquare compares the asking price per square foot with **registered sales** from the Dubai Land Department and returns a *range* with the sales behind it, or says it does not have enough evidence.

It is a price check, **not a valuation** and not financial advice.

> This project is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.

## The research

The core of the project is the data analysis: how to turn about 400,000 registered flat sales into a comparison a buyer can trust, and how to test that honestly.

| | |
|---|---|
| Data | Dubai Land Department "Transactions", from Data.Dubai: 1.82 million rows read, **403,867 flat sales in 4,348 buildings** kept (17 Nov 2023 to 16 Nov 2026) |
| Method | Each registered sale is **adjusted** to the listing's date and size, combined by a **weighted median**, and given a range **calibrated forward in time** to hold about 80% of later prices. It declines to answer when evidence is thin |
| Test | Fitted on the past, scored on the next 183 days, at four cutoffs. Coverage is reported next to accuracy |
| Result | On buildings with 5 or more sales the typical miss falls from **5.3% to 4.3%** against the 12-month median, on the sales the method answers |
| Also tried | Machine-learning models (mixed model, LightGBM, k-NN). They looked better on hide-a-building tests and **failed forward in time**, so they were not shipped |

Read, in this order:

1. [`docs/DATA_COLLECTION.md`](docs/DATA_COLLECTION.md): where the data comes from, how it was downloaded, cleaned and counted, and how to rebuild it.
2. [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md): the question, the methods, the tests, the results and the limits.
3. [`reports/`](reports): the full working reports and charts.

## What is in this repository

```
docs/            Data collection, methodology, provenance
reports/         Analysis reports and charts (the research record)
app/             The web app (Next.js) and the model code
  scripts/model/   Python reference implementations, backtests and refits
  src/lib/         The comparison methods in TypeScript, the data importer
  docs/            Specifications: data rules, architecture, design
bot/             An earlier Telegram bot prototype (demo data only)
```

## Run the app locally

You need Node.js 22 or later.

```bash
cd app
npm ci
cp .env.example .env.local      # every variable is optional locally
npm run dev                     # http://localhost:3000
```

Without sales data the app starts but has nothing to compare with. To load data, build a snapshot from your own Data.Dubai download: see [`docs/DATA_COLLECTION.md`](docs/DATA_COLLECTION.md), section 6.

Reading screenshots needs an Anthropic API key. Typing the details works without one.

```bash
npm test            # unit and API tests
npm run typecheck
npm run lint
```

More commands, deployment and the security notes are in [`app/README.md`](app/README.md).

## Secrets

No API keys, passwords or tokens are in this repository, and none should ever be committed.

- Copy `app/.env.example` to `app/.env.local` and put your own values there. Files named `.env*` are git-ignored.
- `ANTHROPIC_API_KEY`, `SESSION_SECRET` and `ADMIN_PASSWORD` are set by you, in your own environment or hosting dashboard.
- If you find a secret in this repository, see [`SECURITY.md`](SECURITY.md).

## Data

The sales data is **not included**. The licence version and attribution wording for the Data.Dubai dataset have not yet been confirmed in writing, so the rows, the processed snapshot and fixtures built from them are not redistributed. What is published instead is enough to rebuild and check the dataset: the cleaning rules, the code, the file checksums and the row counts ([`docs/provenance/`](docs/provenance/snapshot-2026-11-17.json)).

## Authorship and AI assistance

This was a research project on registered-sales price checking.

- **Research direction and decisions:** the project owner chose the question, sourced the data from Data.Dubai, set the standard that results must hold up forward in time, and decided what shipped.
- **Implementation:** the analysis code, the web app and most of the documentation were written with **Claude**, an AI assistant from Anthropic, in Claude Code sessions, and run and reviewed by the owner. Reports are written in the first person of those sessions.

Please keep this note if you reuse the work.

## Status and known limits

The model's fitted constants and its answers expire as the data ages (they stop at about four months after the data date), and the user-facing copy has not had legal review. The full list of limits is in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md), section 7.

## Licence

- **Code:** MIT, see [`LICENSE`](LICENSE).
- **Documentation and reports** (`docs/`, `reports/`, and the Markdown under `app/docs/`): Creative Commons Attribution 4.0 International, see [`LICENSE-DOCS.txt`](LICENSE-DOCS.txt). Credit the project when you reuse them.
- **Data:** not included, and not covered by these licences. The Dubai Open Data Licence applies to the Data.Dubai dataset: https://data.dubai/en/terms-conditions
