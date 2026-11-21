# Real data: replacing the demo with DLD open data

Renamed from Mizan to Fairsquare on 18 Nov 2026. Internal identifiers (storage keys, folders, the Railway service, the repo) keep the old name.

Status: spec for the `real-data` branch, 18 Nov 2026. This document overrides DESIGN.md and ARCHITECTURE.md wherever they mention demo mode, sample listings, the example card or the fictional mortgage partner.

## 0. Decisions already made by the owner

- **Source now:** the Dubai Land Department (DLD) sales-transactions dataset published as **Open Data on Data.Dubai** (the successor of Dubai Pulse), used under the **Dubai Open Data Licence**. It allows commercial use with attribution, no implied government endorsement, no misleading presentation and no resale of the original rows.
- **Not allowed:** the dubailand.gov.ae website CSV export (personal, non-commercial terms, CAPTCHA, no building column). The importer must refuse that format with a clear message.
- **Later:** a licensed API (PropertyIndex PIX). Build the ingest layer around a source-agnostic `NormalisedSale` so another adapter can be added without touching analysis or UI. Do not implement any network adapter now.
- **Demo removal goes live in the same deploy that loads real data.** No fictional building, sale, listing, price, screenshot or partner may remain anywhere in shipped product code or the production database. Test fixtures may stay synthetic, but they live under `tests/` only and use obviously synthetic names (for example "TEST TOWER A").
- **Access constraint:** Data.Dubai only answers from inside the UAE, and Railway runs outside the UAE. The owner downloads the file in a browser on a UAE connection. The snapshot is built locally and committed to the private repo. The server never calls Data.Dubai.

## 1. Input format (Data.Dubai / Dubai Pulse "Transactions")

A CSV (possibly zipped) with these snake_case columns, in this order in the historic file:

```
transaction_id, procedure_id, trans_group_id, trans_group_ar, trans_group_en, procedure_name_ar,
procedure_name_en, instance_date, property_type_id, property_type_ar, property_type_en,
property_sub_type_id, property_sub_type_ar, property_sub_type_en, property_usage_ar, property_usage_en,
reg_type_id, reg_type_ar, reg_type_en, area_id, area_name_ar, area_name_en, building_name_ar,
building_name_en, project_number, project_name_ar, project_name_en, master_project_en, master_project_ar,
nearest_landmark_ar, nearest_landmark_en, nearest_metro_ar, nearest_metro_en, nearest_mall_ar,
nearest_mall_en, rooms_ar, rooms_en, has_parking, procedure_area, actual_worth, meter_sale_price,
rent_value, meter_rent_price, no_of_parties_role_1, no_of_parties_role_2, no_of_parties_role_3
```

Rules for reading it:
- Match headers case-insensitively after trimming and removing a UTF-8 BOM. Column order must not matter. Extra columns are ignored.
- Required: `transaction_id, trans_group_en, procedure_name_en, instance_date, property_sub_type_en, area_name_en, building_name_en, rooms_en, procedure_area, actual_worth`. Optional but used when present: `reg_type_en, property_usage_en, project_name_en, master_project_en, project_number, nearest_metro_en, nearest_mall_en, nearest_landmark_en, has_parking`.
- If the header instead looks like the dubailand.gov.ae export (for example `Transaction Number`, `Transaction Date`, `Master Project`, `Project` and no building column), stop with: "This is the dubailand.gov.ae website export. Its terms allow personal, non-commercial use only and it has no building names. Download the Transactions dataset from data.dubai instead."
- The file can be about 1 GB. Read it as a stream (papaparse step mode or a line reader); never load it whole into memory.
- Dates appear as `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`, `DD-MM-YYYY`, `DD-MM-YY` or `DD/MM/YYYY`. Day comes first in every non-ISO form. Two-digit years are 20YY. Unparseable dates are excluded and counted.
- Trim and collapse whitespace in every text field. The data has trailing spaces.
- Remove Arabic-script characters from the English name columns (building, area, project, master project, nearest metro, mall and landmark) before cleaning the spaces. In the Nov 2026 files 45 project names start with stray Arabic vowel marks.
- `project_number` is written as a decimal ("2977.00"); it is stored as a whole number. `has_parking` is "1" or "0".

## 2. Which rows count (apply in this order and count each exclusion reason)

1. `trans_group_en` equals `Sales` (case-insensitive).
2. `procedure_name_en` is one of `Sell`, `Sale`, `Sell - Pre registration`, `Delayed Sell` (case- and space-insensitive). Everything else is excluded: Development, Lease to Own, Lease Finance, Mortgage, Grant, Portfolio, Adding Land and so on.
3. `property_sub_type_en` equals `Flat`. When `property_usage_en` is present and not empty it must be `Residential`.
4. `rooms_en`: `Studio` → 0; `N B/R` (also `N BR`, `N`) → N for N from 1 to 7. Everything else is excluded: PENTHOUSE, Single Room, Office, Shop, Store, GYM, empty, and N above 7.
5. `building_name_en` is not empty (excluded as `no_building_name` otherwise).
6. `procedure_area` > 0 (square metres) and `actual_worth` > 0.
7. Size in sq ft = `procedure_area × 10.7639`, kept with 2 decimals. Exclude sizes under 150 or over 15,000 sq ft. (150 is also the smallest size a listing may have. It was 200 until 19 Nov 2026; section 14.)
8. AED per sq ft = `actual_worth / size_sqft`. Recompute it; never use `meter_sale_price`. Exclude values outside 279 to 20,000 AED per sq ft. (The ceiling was 11,148 until 19 Nov 2026; section 14.)
9. A `transaction_id` that appears more than once in the kept rows is a multi-unit deal: exclude every row with that id.
10. Blocks at one price: in the same building on the same date, 3 or more rows with the same `actual_worth` are excluded as a group **when their units are unlike**: the bedrooms differ, or the largest size is more than 5% above the smallest. Identical units at one price on one day stay (they are ordinary sales at a list price; section 14). Counted as `portfolio_deal`.
10a. Blocks of like units at an unlike price level: a block that passed rule 10 (3 or more rows, one building, one date, one price, same bedrooms, sizes within 5%) is still excluded when its AED per sq ft is under 0.85 times or over 1.18 times the median of the building's other sales (0.8 and 1.25 until the owner's review of 19 Nov 2026): rows that are in no block, with the same bedrooms and the same completion, dated within 365 days of the block. At least 5 such sales are needed; a block with fewer to compare with stays. A block that mixes ready and off-plan rows is judged once per completion, each part against the building's other sales of that completion, so the result does not depend on the order of the rows. Such blocks are bulk deals (section 14). Counted as `portfolio_deal`.
10b. Size unlike the building's: when a building has 5 or more remaining sales with the same bedrooms (every year in the files counts), a sale whose size is under 0.5 times or over 2 times their median size is excluded (`size_unlike_building`). The room label or the area of such a row is wrong.
11. Completion: `reg_type_en` containing `Off-Plan` → `off_plan`; containing `Existing` → `ready`. When `reg_type_en` is missing: `Sell - Pre registration` → `off_plan`, otherwise `ready`.
12. Keep only rows dated within the 36 months that end at the latest kept date (`dataThrough`).

## 3. Snapshot (built locally, committed)

`npm run data:build -- --in <file.csv|file.zip> [--in <another>] --dataset-url <url> --downloaded <YYYY-MM-DD>` writes:

- `data/open-data/sales.csv.gz`: one row per kept sale with columns `ref,date,building,area_dld,project,master_project,bedrooms,size_sqft,price_aed,completion,project_number,parking`, sorted by `ref`. `ref` is `dld:<transaction_id>`. `project_number` is a whole number or empty; `parking` is `1`, `0` or empty. A file with the first 10 columns only (built before 19 Nov 2026) still loads.
- `data/open-data/buildings.csv.gz`: one row per building of the kept sales, sorted by building name and then area, with columns `building,area_dld,project_number,project,master_project,nearest_metro,nearest_mall,nearest_landmark,first_sale,first_ready_sale,last_sale,sales,off_plan_sales,parking_sales`. `first_sale` and `first_ready_sale` look at every flat sale in the source files that passes rules 1 to 8 (all years, not only the 36 months), so they say roughly how old the building is; `last_sale` and the three counts are the kept sales. The nearest places are DLD's own reference values.
- `data/open-data/manifest.json`:
  ```json
  {
    "version": 1,
    "source": "data.dubai",
    "publisher": "Dubai Land Department",
    "datasetTitle": "...", "datasetUrl": "https://data.dubai/...",
    "licence": "Dubai Open Data Licence", "licenceUrl": "https://data.dubai/en/terms-conditions",
    "downloadedOn": "YYYY-MM-DD",
    "sourceFiles": [{ "name": "...", "sha256": "...", "rows": 0 }],
    "dataFrom": "YYYY-MM-DD", "dataThrough": "YYYY-MM-DD",
    "counts": { "read": 0, "kept": 0, "excluded": { "<reason>": 0 } },
    "buildings": 0,
    "snapshotSha256": "<sha256 of sales.csv.gz>",
    "buildingsFile": { "sha256": "<sha256 of buildings.csv.gz>", "rows": 0 }
  }
  ```
- `data/open-data/similar-cells.csv.gz`: the similar-buildings cells (section 15.1), one row per building, bedroom count and basis with at least one kept sale, in the order of `buildings.csv.gz`, then bedrooms, then basis, with columns `building,area_dld,project_number,master_project,bedrooms,completion,n_raw12,n12,med12,n_old1,med_old1,n_old2,med_old2`. Medians are written with every digit, and are empty when the count beside them is 0.
- The manifest then also has a `similar` section: `version` (1), `builtOn` (`--built`, default the download day, so the same inputs give the same bytes), `windowStart`, `cellsFile` (`sha256`, `rows`), `buildings`, `constants` (the fitted constants of `src/lib/similar/constants.json`, copied whole) and `backtest` (the verified summary of `src/lib/similar/backtest.json`). It is absent in a manifest built before 19 Nov 2026; such a snapshot still loads, without the second tier.
- It also prints a report: rows read, kept, excluded by reason, the 20 most common values of `procedure_name_en`, `property_sub_type_en`, `rooms_en`, `reg_type_en` and `area_name_en` seen, date range and building count. The owner and tech lead review this before committing.
- `buildingsFile` is absent in a manifest built before 19 Nov 2026; such a snapshot still loads, without the building facts.
- `data/open-data/` is committed. `.gitignore` must not exclude it. Raw source files are never committed (they go in `../raw-data/`, outside the repo).

## 4. Loading the snapshot (server)

- Runs from `src/instrumentation.ts` **after** `migrateAndSeed`, in the background: it must not delay the server start or the health check. Errors are logged (`open_data_load_failed`) and never crash the process.
- Reads `OPEN_DATA_DIR` (default `<cwd>/data/open-data`). No manifest → nothing to do (log `open_data_missing` once).
- Skips when `app_meta.open_data_sha` already equals `manifest.snapshotSha256`, `app_meta.open_data_similar_sha` equals the sha of the manifest's `similar` section (empty when it has none) and, when the manifest has a `buildingsFile`, `app_meta.open_data_buildings_sha` equals its sha.
- Reads `buildings.csv.gz` (when the manifest names it), checks it against the manifest's sha and row count, and refuses the load when it is missing or does not match.
- Takes a Postgres advisory lock (PGlite: none needed) so two instances never load at once.
- Streams the gzip. In one transaction:
  - upserts buildings by `dld_key = normalise(building) + "|" + normalise(area_dld)`, setting `name` (display form, section 5), `area` (section 6), `area_dld`, `project` and `master_project`, and from `buildings.csv.gz` `project_number`, `nearest_metro`, `nearest_mall`, `nearest_landmark`, `first_sale_date`, `first_ready_sale_date`, `last_sale_date` and `off_plan_share` (a snapshot without the file leaves these as they are);
  - adds aliases with source `import`: the raw DLD name and the cleaned display name;
  - inserts sales in batches of 2,000 with `source = 'open_data'`, `external_ref = ref`, `has_parking` and `ON CONFLICT (external_ref) DO NOTHING`, so `created_at` of existing rows is kept and "new since you saved" stays correct;
  - fills `has_parking` on sales loaded before the column existed (not a correction: `created_at` and `import_batch` stay);
  - deletes `open_data` sales whose `external_ref` is not in the snapshot (staging temp table);
  - replaces `similar_cells` with the rows of `similar-cells.csv.gz` (checked against the manifest's sha and row count first) and stores the model in `app_meta.similar_model`; a snapshot without a `similar` section empties both (section 15.6);
  - sets `app_meta`: `open_data_sha`, `open_data_buildings_sha`, `open_data_similar_sha` (the SHA-256 of the manifest's `similar` section, so a refit of the constants alone also loads), `data_from`, `data_through`, `data_source` (the manifest without counts and without the model, as JSON) and `data_imported_at`;
  - then invalidates the alias cache.
- Logs `open_data_loaded` with counts and milliseconds. Target: a 400,000-row snapshot loads in under 3 minutes on Railway Postgres.

## 5. Building identity and names

- Display name: the DLD name in title case with known acronyms kept (JLT, JVC, DIFC, MBR, II, III, IV) and Roman numerals preserved.
- Matching keeps working on `building_aliases` with the existing normaliser and its rules (generic words ignored, 0.62 floor, pre-select at 0.8, two towers that differ only by a number are flagged). Add a cleaning variant for aliases that removes a leading `THE`, `RESIDENCES AT` / `THE RESIDENCES AT`, and `TOWER` / `TWR`, but never removes a tower number.
- `buildings.name` is no longer unique (DLD names repeat across areas). `dld_key` is unique when not null. Admin-created buildings have a null `dld_key`.
- With thousands of buildings, the alias match must stay fast: under 50 ms for one query with 15,000 aliases. Add a token index if the linear scan is slower.
- **Marketing names (20 Nov 2026).** Some buildings are sold under a name DLD does not register. `src/lib/ingest/market-names.ts` is a short list kept by hand: the DLD name with its DLD area, the names listings use, and the evidence. The load adds each name as an alias (source `import`). First entries: DLD's Three Towers A-1 and Three Towers B-2 in Dubai Science Park are marketed as Marriott Residences, towers 1 and 2 ("Marriott Residences Tower 1", "Marriott Residences 1", "Marriott Residences Tower A" for A-1; the same with 2 and B for B-2). An alias is an exact name: "Marriott Executive Apartments Al Barsha South", a hotel name shown beside these towers, is not listed, because the matcher has no possible-only alias and would select one tower outright. `syncMarketNames` (`src/lib/ingest/load.ts`) runs at every server start after the snapshot check: it adds what is missing when the list changed since the last start (`app_meta.market_names_sha`), also when the snapshot is unchanged, and again after every snapshot load. It only adds; a name taken off the list stays in `building_aliases` until it is deleted there. The tower-number question ("Two towers have similar names") is still asked, and its rows show the DLD names.

## 6. Area names

- `area_dld` keeps the official DLD area name.
- `area` (shown to people) is, in order: a confident mapping from the table below; otherwise the DLD area name in title case. Show both where space allows ("Dubai Marina (DLD area: Marsa Dubai)") on the result and coverage pages.
- Mapping table (only these; add more only with evidence): `Marsa Dubai` → `Dubai Marina`; `Burj Khalifa` → `Downtown Dubai`; `Business Bay` → `Business Bay`; `Palm Jumeirah` → `Palm Jumeirah`; `Al Barsha South Fourth` → `Jumeirah Village Circle (JVC)`; `Al Thanyah Fifth` → `Jumeirah Lake Towers (JLT)`; `Al Khairan First` → `Dubai Creek Harbour`; `Hadaeq Sheikh Mohammed Bin Rashid` → `Dubai Hills Estate`; `Madinat Al Mataar` → `Dubai South`; `Nadd Hessa` → `Dubai Silicon Oasis`.

## 7. The comparison with real data

- **Completion basis.** A listing marked off-plan is compared with `off_plan` sales; ready or unknown with `ready` sales. Never pool them. Store the basis on the check (`completion_basis`) and say it in the sentence, stamp line and provenance ("ready apartments", "off-plan apartments").
- **Window.** 12 months (`WINDOW_DAYS`) ending at `min(today, data_through)`. Store `window_end` as that date. Copy always shows the real dates.
- **Minimum sales.** `MIN_SALES` default becomes 5.
- **Outliers.** When n ≥ 5, drop sales whose AED per sq ft is below 0.5× or above 2× the median, then recompute. Store how many were dropped and show "1 unusual sale left out" when above zero.
- **Size check.** If the listing's size differs from the median size of the compared sales by more than 20%, show a note: "This listing is 24% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies."
- **Stale data.** When `data_through` is more than 45 days before today, every result, the home page and the /c page show: "Fairsquare's sales data currently runs to {date}. Sales registered after that aren't included yet."
- No data loaded at all (`data_through` missing): the home page says "Sales data is being loaded. Try again in a few minutes." and comparisons return the not-covered state.

## 8. Removing the demo (product code and database)

Remove completely:
- `DEMO_MODE`, `SEED_DEMO`, the demo seed (`seedDemo`, `seedDemoIfEmpty`, `refreshDemoDates`, `demo_anchor_date`), `src/lib/db/demo-data.ts` (move its contents to `tests/fixtures/` for tests only).
- Sample listings (`src/lib/samples.ts`, sample chips, `isSample`, `sample_not_allowed`, the sample screenshot drawer `src/lib/stamp/sample-screenshot.ts`).
- The fictional example card on the home page (`ExampleCard`, the iPhone frame with a made-up listing).
- `DemoBadge`, `DemoNotice`, every "demo" string in `copy.ts`, the demo consent version `optin-v1-demo`, demo stamp/card/OG labels, the admin "demo" checkbox and CSV `is_demo` column.
- The fictional partner: `PARTNER_NAME` has no default. The adviser opt-in (lead form) appears **only** when `PARTNER_NAME`, `PARTNER_REGULATOR` and `PARTNER_LICENCE` are all set. Otherwise the money panel shows the monthly-cost estimator with "Talking to a mortgage adviser through Fairsquare isn't available yet." The lead API returns 404 `leads_unavailable` in that state.

Migration `0002` (one file, in this order):
1. `DELETE FROM leads WHERE is_demo`; `DELETE FROM checks WHERE is_demo OR is_sample` (cascades saved listings); `DELETE FROM buildings WHERE is_demo` (cascades sales and aliases); `DELETE FROM sales WHERE source = 'demo'`; `DELETE FROM app_meta WHERE key = 'demo_anchor_date'`.
2. Drop `is_demo` from buildings, sales, checks and leads; drop `checks.is_sample`.
3. Add `sales.completion text not null default 'ready'` with a check (`ready`, `off_plan`); `sales.raw_building_name text`; `buildings.dld_key text` (unique where not null) and `buildings.area_dld text`; drop the unique constraint on `buildings.name`; add `checks.completion_basis text not null default 'ready'`, `checks.outliers_dropped smallint not null default 0`, `checks.data_through date`.
4. `sales.source` values become `open_data | admin | import`.

## 9. Attribution and wording (licence conditions)

- Result provenance, the /c page, How it works and the footer carry: "Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence." The dataset and licence names link to `datasetUrl` and `licenceUrl` from the manifest.
- Footer and How it works also say: "Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai."
- No DLD, Dubai Government or Data.Dubai logos anywhere.
- The list of individual sales stays freely visible on every result and /c page. It is never placed behind the adviser form or any other ask.
- Keep the existing neutral wording: never "fair price", "good deal" or "valuation". The only "Fair" in user-facing copy is the brand name Fairsquare.
- The sales noun is "registered sales". Remove `DATA_SOURCE_LABEL`.

## 10. Home page without the fictional example

The hero stays the tool. Where the example card was, show a small, real "From the data" panel computed on the server from the loaded data (cached for an hour): the building with the most ready 2-bed sales in the window, its area, its median AED per sq ft, the number of sales and the date range, linking to /coverage. Below it, one line: "Sales data runs to {date}." Never invent a listing or an asking price. If no data is loaded, show the loading message from section 7.

## 11. Coverage page at real scale

Thousands of buildings: server-side search (name or area, 2+ characters) and paging of 50. The default order is by number of sales in the window. Each row shows the building, area, number of ready and off-plan sales, and the latest sale date.

## 12. Admin

- The sales-data page gets a "Data source" panel: dataset title and link, downloaded date, data range, rows, buildings, last load time and the exclusion counts from the manifest.
- Admin-registered sales and the admin CSV import stay (source `admin` / `import`), without the demo flag. Admin sales carry a completion field.

## 13. Refresh procedure (README)

1. On a UAE connection, download the latest Transactions file from data.dubai into `../raw-data/`.
2. `npm run data:build -- --in ../raw-data/<file> --dataset-url <url> --downloaded <date>` and read the report. It rebuilds the similar-buildings cells too; when the constants are too old for the data it says so and exits with an error: refit them first (section 15.7, `scripts/model/README.md`).
3. Commit `data/open-data/` (four files: `sales.csv.gz`, `buildings.csv.gz`, `similar-cells.csv.gz`, `manifest.json`), push to `main`. Railway deploys and loads the new snapshot in the background.

## 14. Data review of 19 Nov 2026 (rules changed, snapshot extended)

Both source files were profiled in full (1,820,003 rows, 47 columns) and every rule of section 2 was checked against them. The full report, with the counts and examples behind each verdict, was written for the modelling stage (`DATA_REPORT.md`, outside the repository). What it found, and what changed here:

| Rule | Verdict | Evidence in the Nov 2026 files |
|---|---|---|
| 1, 2 (Sales group; Sell, Pre registration, Delayed Sell) | keep | Delayed Sell sits at the same-building Sell median (ratio 1.00, 7,244 compared). Lease to Own also sits at it (1.00) but mixes purchases with refinancing; Sale On Payment Plan runs high (1.06, a tenth above 1.85). Both stay out. |
| 3 (Flat, Residential) | keep | Every flat row is Residential. Hotel Apartment (6,506 window sales) stays out. |
| 4 (rooms) | keep | Dropped in the window: PENTHOUSE 126, empty 197, Single Room 21, others 4. They have no bedroom count to compare by. |
| 5 (building name) | keep | 28% of all rows have no building name, but none of them is a flat: all 959,306 flat sales rows have one. Nothing is lost here, and no stand-in key is needed. |
| 7 (size) | loosen the floor to 150 | 129 window sales of 150 to 200 sq ft sit at their building's median AED per sq ft (ratio 1.03). Under 150 the rows are slips. The 15,000 ceiling stays (38 window sales above it, all 4 bedrooms or more). |
| 8 (AED per sq ft) | loosen the ceiling to 20,000 | 102 window sales were above 11,148; of the 59 with a building to compare with, 43 are within twice its median. The floor stays: 1,047 window rows under 279 sit at 3% of their building's median. |
| 9 (repeated transaction id) | keep as a guard | Every one of the 1,820,003 transaction ids is distinct, so this rule excludes nothing in these files. |
| 10 (3 or more at one price) | loosen to unlike units | The old rule dropped 15,507 window rows. The 9,964 in groups of like units (same bedrooms, sizes within 5%) sit at the median of the building's other sales (ratio 1.00; 0.9% outside 0.5x to 2x). They are identical units at a list price and now stay. The 5,543 in groups of unlike units (one price for sizes up to 47% apart) stay out. |
| 10a (like-unit block at an unlike price level) | add (review of 19 Nov 2026) | The ratio 1.00 above is a median. 13% of like-unit block rows (1,221 of 9,426 that can be checked) were under 0.8x or over 1.25x the building's other sales, against 5.5% of ordinary sales, and the far ones are bulk deals: Paradise View - 2 had 77 one-bedroom units registered on two days at exactly AED 851 per sq ft, which moved that building's median from 1,500 to 851. With the rule, 1,283 window rows go out, 8,638 like-unit block rows stay (0.4% of the checkable ones outside the band), and 15 building, bedroom and basis medians of the last 12 months move back by more than 5%. **Tightened to 0.85x to 1.18x (owner's review of 19 Nov 2026)** for the one-price batches below: 499 more window rows go out, 8,139 like-unit block rows stay. Of the 4,750 combinations with 5 or more sales in the 12 months, one median moves by more than 5% (Hera Tower, ready 2-bed, +19.6%). The cost: 10.1% of ordinary sales sit outside 0.85x to 1.18x of their building's other sales (5.4% outside 0.8x to 1.25x), and before the change 6.4% of the checkable block rows did, so the tighter band also takes out blocks that are no further from their building than ordinary sales often are. |
| 10b (size unlike the building's) | add | 1,311 window rows had a size under half or over twice their building's median for those bedrooms; their AED per sq ft is off (median ratio 0.82, 54% outside 0.8 to 1.25, against 6% for all sales). |
| 11 (completion) | keep | `reg_type_en` and the procedure agree on every sales row. |
| 12 (36 months) | keep | |
| text clean-up | add | Arabic-script characters are removed from the English name columns (45 project names). |

Kept sales went from 397,009 to 404,366: 8,638 from like-unit blocks, 98 above the old ceiling and 35 under the old floor came in (8,771; most of the other 150 to 200 sq ft rows are under half their building's usual size and fall to rule 10b), and 1,414 with a size unlike their building's went out. (The first build of this review kept 405,649; rule 10a then took out 1,283 rows of bulk blocks, and its tighter band of 19 Nov 2026 499 more: **403,867 kept**. Over all years portfolio_deal is 19,539, was 17,638.) Buildings went from 4,346 to 4,348. Building names need no merging: within one DLD area no building has two spellings, and the look-alike names found are different buildings.

The snapshot also carries what the second tier of comparison (section 15) needs: `project_number` and `parking` per sale, and `buildings.csv.gz` (section 3). The source has no floor or level column.

**Batches at one price that pass rule 10a (read by eye, review of 19 Nov 2026).** In 3 of the 4,750 building, bedroom and basis combinations with a verdict, same-day groups of 3 or more like units at one price are more than half of the 12 months' sales and move the median by more than 10%:

| Building, type | Sales | In batches | Median with them | Median of the others | What the rows show |
|---|---|---|---|---|---|
| HERA TOWER, ready 2-bed | 30 | 21 | AED 763 | AED 912 (9 sales) | AED 900,000 on four days (15, 22, 29 Dec 2025, 5 Jun 2026), 4 to 7 units a day. Three single sales also registered at exactly AED 900,000 (12 Dec 2025 twice, 11 Mar 2026). |
| SAFEER TOWER 2, ready studio | 13 | 7 | AED 1,550 | AED 1,390 (6 sales) | AED 750,000 on 17 and 18 Nov 2025; the later single sales are AED 615,000 to 700,000. |
| STORIES BY MIRFA, off-plan studio | 25 | 13 | AED 1,510 | AED 1,314 (12 sales) | Two prices throughout, AED 579,780 and AED 426,499, in batches and as single sales alike: a developer's two list prices. |

The batch price also appears as single sales in two of the three, so these read as units sold at a fixed list price over weeks, which is what rule 10 keeps on purpose; they sat inside rule 10a's first band (0.84x, 1.12x and 1.16x of the other sales).

**The owner asked for the tighter band (0.85x to 1.18x, 19 Nov 2026).** What it did to the three, 12 months to 16 Nov 2026:

| Building, type | Before | After |
|---|---|---|
| HERA TOWER, ready 2-bed | 30 sales, AED 763 | 9 sales, AED 912: all 21 batch rows out |
| SAFEER TOWER 2, ready studio | 13 sales, AED 1,550 | unchanged: the batch is at 1.12x, inside the band |
| STORIES BY MIRFA, off-plan studio | 25 sales, AED 1,510 | 22 sales, AED 1,520: one batch of 3 rows out; the other batches stay inside the band |

So the band fixes one of the three. Safeer Tower 2 and Stories by Mirfa would need another rule (counting a batch once, or a band under 1.12x), which would take out more ordinary list-price sales and was not tested. The figure Fairsquare shows there is the median of the registered sales, as it says.

Not measurable from one download: how late sales are registered. The transaction id does not run in date order, and the file has one date per row. The last 9 weeks hold about 18% fewer kept sales per week than the 17 weeks before them, all of it in off-plan sales, with no sharp drop in the final days. Compare two downloads to measure it.

## 15. The second tier: a range from more registered sales (19 Nov 2026)

The same-building comparison of section 7 is the product and is unchanged. This tier runs only when that comparison gives no verdict. It is weaker evidence and is shown as such: its own section under "Too few sales to compare yet", a range and never one figure, the outcome in words only. It is not a valuation, and it is never a price for the unit. Words such as "model", "centre" and "similar" below and in the code are internal; the copy is DESIGN.md section 6.16. The page never calls the other buildings "similar": they are matched on place, bedrooms and basis only, so it says "other buildings in" the project, community or area and states how far apart their medians are.

The method was chosen in a backtest and then checked by an independent verification; both reports are outside the repository. A review on the same day found that the rule showed ranges that contradicted the building's own sales, and tightened it (constants version 2, section 15.3). The code is `src/lib/domain/similar.ts` (pure), with the code contract in ARCHITECTURE.md section 2.11. The backtest and refit scripts are in `scripts/model/`.

### 15.1 What is precomputed

`npm run data:build` writes one table next to the sales, `similar-cells.csv.gz` (section 3): one cell per building, bedroom count and basis (ready or off-plan) with at least one kept sale in the 36 months. On the snapshot of 16 Nov 2026 that is 13,575 cells in 4,348 buildings (412 KB). Per cell:

| Field | Meaning |
|---|---|
| `n_raw12` | sales dated on or after `dataThrough` - 365 days |
| `n12`, `med12` | the sales the product median used, and that median in AED per sq ft (price / size; with 5 or more sales, those under 0.5x or over 2x the median are left out once and it is recomputed) |
| `n_old1`, `med_old1` | sales 366 to 730 days before `dataThrough`: count and product median |
| `n_old2`, `med_old2` | sales 731 to 1,095 days before: the same |

Each row also carries the building's DLD area, master project and project number from `buildings.csv.gz`. Sales are grouped into buildings by `dld_key`, as the loader groups them. There is no time index and no size adjustment: neither improved the backtest.

### 15.2 The comparison

Input: bedrooms, basis, the asking AED per sq ft, and the matched building.

1. **Comparable cells**: same bedrooms, same basis, same DLD area, `n_raw12` of 3 or more, not the listing's own building. Nothing matches size or price level.
2. **Reference**: the first level with enough comparable buildings: the same project number (1 or more), else the same master project (2 or more), else the same DLD area (3 or more). The reference is the median of the buildings' ln(`med12`), so a building counts once however much it sells. Its variance comes from the constants: fixed for a project; for a community or an area it grows with the spread of the buildings' medians ((90th - 10th point of the logs) / 2.563).
3. **The building's own evidence**, each with a variance measured in the backtest by basis and by count:
   - its 1 to 4 sales of the 12 months (`med12`);
   - its sales 12 to 24 months back (`med_old1`) and 24 to 36 months back (`med_old2`), taken at their own prices;
   - its other bedroom types on the same basis: how far each sits from its own reference, weighted n / (n + 3), added to the reference.
4. **Combine**: the mean of all pieces weighted by 1 / variance; the spread is 1 / sqrt(the sum of 1 / variance). The spread does not grow when the pieces disagree; rule 6 of section 15.3 refuses those cases.
5. **Evidence class**: `own` when the 12-month sales were used; else `indirect` when older sales or other bedroom types were; else the reference level alone (`project`, `community` or `area`).
6. **Range**: per class a floor and two multipliers (`range80`): spread' = sqrt(spread² + floor²); the range runs from centre - lower x spread' to centre + upper x spread' in logs. The upper side is wider than the lower side in every class. Half-width W = (lower + upper) / 2 x spread'.
7. **Output**: both ends rounded to the nearest AED 10 per sq ft. The asking price is above the range, below it, or within it (the ends count as within). The middle of the range is never shown.

Ready and off-plan sales are never pooled, here as in section 7.

### 15.3 When it is shown (the refusal rule)

In order; the first that applies ends it:

1. More than 3 bedrooms: not shown (`bedrooms_not_validated`). Only 11 such test cases exist, so nothing could be checked.
2. Nothing to combine: not shown (`no_evidence`).
3. The class is `project`, `community` or `area`, that is, nothing from the building itself: not shown (`no_building_evidence`).
4. Only the building's 1 to 4 sales of the 12 months, with no earlier sale, no other bedroom type and no other building: not shown (`own_sales_only`). Those are the very sales the first tier has just called too few; a range and an outcome from them alone would contradict it.
5. W above 0.20: not shown (`range_too_wide`). Beyond it the top of the range is about 1.5 times the bottom, and 2 in 10 tested cases were more than 20% off.
6. The building's own evidence disagrees (`evidence_disagrees`): its own medians (the 12 months, 12 to 24 months back, 24 to 36 months back) are more than 1.25 times apart, or the median of its own 12-month sales is outside the rounded range.
7. Otherwise shown: "close" when W is 0.10 or less, "broad" above that.

When it is not shown, the result is exactly what it was before this tier existed.

**Rules 3 (for `project`), 4 and 6 are version 2 of the constants** (`neverShownClasses`, `requireEvidenceBeyondOwnSales`, `maxOwnMedianRatio`, `ownMedianInsideRange`). They came from the review of 19 Nov 2026:

- *Rule 6.* On the snapshot, 1,075 of 5,096 shown ranges that used own sales did not contain the median of those sales (Ellington House, ready 3-bed: 4 sales with a median of AED 3,647, a "narrow" range of 2,620 to 3,140, because 3 sales of the year before sat at 1,748). In the backtest such ranges held the building's median in 55.7% of 1,120 cases, and ranges whose own medians were more than 1.25 times apart in 64.6% of 809, against 89% for the rest. Between 1.2 and 1.25 times they still held 77%, so the limit is 1.25.
- *Rule 4.* A range from the 12-month sales alone held in 81.8% of 88 test cases; it is refused for what it says, not for that number.
- *Rule 3, project.* A range from sibling buildings alone was shown for 31 building and bedroom combinations with no sale of the listed type. The verification had 10 and 23 forward cases for it and called it neither confirmed nor contradicted, and the pages said a range needs sales of the building itself.

The same rule is applied once more wherever a range is drawn or worded (`shownSimilar` in `src/lib/similar/shown.ts`): an entry that rests on nothing from the building, or on its 12-month sales alone, shows nothing whatever its flags say.

**A building that is not in DLD sales data gets no range from its area or community.** The listing's area is resolved (15.5), and rule 3 always refuses; the cells of the area are not even read. The one exception is the project route of section 15.8 (off-plan, its project named in the listing, other buildings of that project). This is the tested result, not a gap: buildings that first appeared in the data sold 5% to 10% above the reference of the existing buildings of their area or community, and a range built from that reference held their median only 65% to 82% of the time, almost always missing low. A listing there would be told "above the range" far too often.

The server adds its own conditions (`src/lib/services/similar.ts`): the band is "too few" or "not covered"; `SIMILAR_TIER` is not `off`; the loaded model belongs to the loaded sales; its constants are version `SIMILAR_MIN_CONSTANTS_VERSION` (2) or newer (the project route needs version 4, `PROJECT_ROUTE_MIN_VERSION`); the comparison's 12 months are the model's; and the constants were fitted no more than 200 days before `data_through`.

### 15.4 What is stored and shown

The comparison keeps a versioned entry (`checks.similar_view`, `CheckView.similar`, `v: 1`): shown or not and why, close or broad, the level and place of the other buildings, how many buildings and sales, the rounded range, the outcome, the counts of the building's own evidence, the 12 months, the constants version (`modelVersion`) and the two test statements of 15.6. It holds no middle figure and no unrounded bounds. /c, the preview image, the card and the share text show the stored entry, so a shared page reads the same later, with the 12 months it was stated for. The second tier is not recomputed when a page is viewed (the one exception: a comparison stored while no data was loaded gets today's, with its first real verdict). Comparisons stored before this tier have no entry and are unchanged.

**The other buildings are named.** A shown entry also stores `comparables`: the buildings the reference was read from (`similarComparables` in `src/lib/domain/similar.ts`, the same level and the same cells as the comparison, never the building itself), most sales first, 200 at most, each with its name as shown (`buildings.name`), its same-bedroom, same-basis sales in the 12 months and their median rounded to a whole dirham; and `comparableSpan`, the lowest and the highest of all those medians. On the snapshot, the highest is more than twice the lowest in 2,211 of the 5,699 shown ranges that read other buildings, and more than three times in 720, which is why the page states the span and does not call them similar. These are registered facts about other buildings; the range's centre is still not stored. A refusal stores none. The page shows them as rings on the range scale and as an open list (DESIGN.md section 6.16).

**Withdrawing.** Two switches hide stored ranges everywhere (result, /c, card, preview image, share text) without touching the rows; both act in `storedSimilar` (`src/lib/db/repo/checks.ts`):

- `SIMILAR_TIER=off` (environment): nothing stored is shown and nothing new is computed. Use it if the legal review says no.
- `SIMILAR_MIN_CONSTANTS_VERSION` (`src/lib/similar/model.ts`): entries made by older constants are not shown, and a loaded model older than it is not used. It is 2, so nothing made by the first rule can show. Raise it when a rule is tightened again.

### 15.5 The area resolver

`src/lib/domain/area.ts` with `src/lib/similar/area-aliases.json`: 253 aliases (65 DLD area names, 30 master project names, 137 common names such as "JVC" and "Downtown", and 21 names that span several DLD areas). The text is normalised (lower case, accents removed, "&" to "and", other characters to spaces); every alias that occurs as whole words is found; a match inside a longer match is dropped. Then:

- one DLD area named: resolved, with the master project when exactly one is named;
- a name that spans several areas ("Meydan", "Dubailand", "Al Barsha") and nothing more specific: ambiguous, with the areas it could mean;
- two different areas in one text: ambiguous, both offered;
- nothing found, but the text is close to a known name (similarity 0.84 or more, for example "Buisness Bay"): ambiguous, with the near names as candidates. A misspelling is never resolved silently;
- otherwise unresolved.

On 40 listing-style strings of the verification, 36 resolved to the right DLD area, none to a wrong one, and 4 were refused. Known limits: there is no listing data to measure how sites write areas; the bare words "marina" and "downtown" resolve on their own; a listing from another emirate could resolve to a Dubai area. All of this is harmless while an area alone never produces a result, and must be handled before any use of the area alone. For the same reason the flow does not ask the person to choose among candidates: the answer could not change the result. The resolver's outcome is stored with a not-covered comparison (`area`, `areaCandidates`, the reasons `area_unresolved` and `area_ambiguous`) for the analytics only; nothing on a page reads it.

### 15.6 Tested numbers

Written by `scripts/model/backtest.py` on the snapshot of 16 Nov 2026 (403,867 sales, rule 10a at 0.85x to 1.18x) with the shipped constants (version 3, refit on that snapshot) and rule; the same numbers are in `src/lib/similar/backtest.json` and in the manifest (`similar.backtest`). Test set: the 2,689 combinations with 10 or more sales, each building hidden in turn and thinned to look sparse. **Every figure is of the ranges the rule shows.** Errors are a share of the building's true median AED per sq ft.

| Case | Shown | Typical error | 8 in 10 within | Range held the median | Typical range |
|---|---|---|---|---|---|
| 1 to 4 own sales (10,716 cases) | 85.0% | 2.8% | 6.1% | 89.2% | -6.5% to +9.3% |
| No own sale in 12 months, other evidence of the building only (2,679 cases) | 74.8% | 4.4% | 10.5% | 85.9% | -8.9% to +14.1% |
| Same two, sibling buildings of the project hidden too | 86.9% and 71.5% | 3.0% and 5.3% | 6.6% and 11.8% | 88.6% and 86.5% | |

Version 2 changed the rule and no fitted value. Version 3 (19 Nov 2026) is the refit with `scripts/model/refit.py` after rule 10a was tightened; it changes no rule, and the multipliers moved by at most 0.04 (own 1.500 and 2.002, indirect 1.581 and 2.224). The two shares above 80% are partly selection (rule 6 keeps the cases whose evidence agrees), so the copy still says "about 8 of 10".

What is weaker than that table:

- **Against the following six months**, on real too-few combinations: the shown ranges held the median of the next 183 days in 78.1% (192 shown of 226, from 17 May 2026) and 77.4% (274 shown of 324, from 16 Nov 2025). Prices moved 3% to 4% in each half-year. The range is a statement about the 12 months to the data date, not about what comes next.
- **Really thin buildings are noisier than the thinned ones of the test.** The ranges of the `own` and `indirect` classes are therefore 1.2 times wider than the backtest alone gave (`thinCellFactor`; `range80` already includes it). On like-for-like noisy targets the shown ranges held 77.9% and 81.5% for combinations of 5 to 9 sales, 62.3% for one held-out sale of a combination with 2 to 4 (68.1% for rich combinations cut to that size), and 63.4% for real one-sale combinations with no own evidence (72.5% simulated). A single sale is a noisier target than a median, so these sit below the table for a reason; the gap between real and simulated is the part the factor does not close.
- **A bedroom type the building never sold** is shown from its other bedroom types (3,257 of 22,008 such requests on the snapshot). Its shown ranges held the next half-year's median in 69.0% and 75.5% of 29 and 53 cases: few cases, and under the rest.
- **Disagreement with the same-building rule.** For listings priced like single registered sales, 13.8% are called above, 68.1% within and 18.1% below. Of those called above, the same-building rule would agree for 71.2%, say in line for 27.5% and say below for 1.3%. A result can change as a building reaches 5 sales and the first tier takes over.
- 3-bedroom ranges with no own sale held 81.0% (163 shown cases), under the others.

Who gets a result: of the 8,825 combinations that are too few today, 67.0% are shown (39.4% close, 27.5% broad), 65.2% weighted by sales; of studios to 3 bedrooms 73.3%. Not shown: 1,944 whose own evidence disagrees, 759 with 4 or more bedrooms, 147 with a range too wide, 66 with nothing but their 12-month sales. With version 2 on the earlier snapshot the share was 67.6%; before version 2 it was 90.4%. Requests that resolve only to an area, a community or a project: none shown.

The copy states two whole numbers from this (`similar.tested`): a range built this way held the building's own median in about 8 of 10 tested cases (the lower of 89.2% and 85.9%, rounded down), and in about 7 of 10 against the six months that followed (the lower of 78.1% and 77.4%, rounded down) (`backtest.statement`). How Fairsquare compares also says "about 6 to 8 of 10" for really thin buildings: the measured 62.3% to 81.5%.

### 15.7 Refreshing and refitting

- Every `npm run data:build` rebuilds the cells from the new sales and copies the constants and the summary into the manifest. Nothing else is needed for an ordinary refresh.
- The constants belong to the market they were fitted on (`constants.fittedOn`). Refit them when a refresh adds more than a few months of sales, and at least twice a year. With data that runs more than 200 days past the fit, `data:build` prints the warning and exits with an error (the snapshot is written, but must not be committed unnoticed), and the server stops showing this tier until they are refitted (`SIMILAR_MAX_FIT_AGE_DAYS`). For the constants of 16 Nov 2026 that day is 5 Jun 2027.
- A refit replaces `src/lib/similar/constants.json` and `src/lib/similar/backtest.json` together. The scripts and the steps are in `scripts/model/` (`README.md` there): `refit.py` measures the fitted values again, `backtest.py` and `served.mjs` run the tests, `backtest-summary.mjs` writes the summary, so no figure is copied by hand. Then `npm run data:build` and a commit. The loader takes a snapshot whose sales are unchanged when only this section changed.
- The golden cases in `tests/fixtures/similar/` are frozen with the cells and the constants they were made on (the rule of version 1, without the consistency rules), so they keep testing the arithmetic after a refresh or a refit. They were made again on 19 Nov 2026 (snapshot 8f62f3cd, the fitted values of version 3) with the independent reference of the model reports, whose own artifact matched the committed cells file on all 13,575 cells. `tests/db/similar-snapshot.test.ts` checks the committed cells against the committed sales, and the rules of 15.3 on every shown range.
- Load time measured on in-memory PGlite (19 Nov 2026): the whole snapshot with the 13,575 cells in 24.2 s; the cells add one delete and seven inserts to the last step. One comparison is one query by area and basis (joined to the building names) plus arithmetic: about 12 ms on PGlite for the largest areas.

### 15.8 The project route: a building that is not in the data (19 Nov 2026)

Asked for by the owner after the stage 3 review, which had refused it for want of a resolver and of out-of-sample cases. Shipped because it passed the owner's rule (below); the evidence is still thin, and the pages say so.

**What it shows.** Under "Not covered yet" (unchanged above it), the section of 15.4 with its own wording (DESIGN.md section 6.16, `similar.project*`): "A range from other buildings in the {project} project", that the building itself has no registered sales in the data, the range, the outcome, the count of sales and buildings it is built from, the span of their medians, "weaker evidence" and "Not a valuation". It is stored as scenario `project` with `project: { name, areaDld }`, the other buildings in `comparables`, and `modelVersion` 4 or later. Never "similar".

**When.** All of these, else nothing changes:
1. the building was not matched (band `none`); `SIMILAR_TIER` is not `off`; the constants carry `projectRoute` (version 4);
2. the listing says off-plan (`completion` is `off_plan`; an unknown completion is not enough), and it is a studio to a 3-bed;
3. its building and area text name exactly one project of the data (`resolveProject`, below);
4. at least one other building of that project in its DLD area has 3 or more off-plan sales of the same bedrooms in the 12 months.

Ready buildings never get it (no ready case could be tested: buildings that first appear ready had no project siblings in the data). An area or a community alone never gives it.

**The resolver** (`src/lib/domain/project.ts`). The project rows are the loaded buildings with a project number (`similarProjectIndex` in `src/lib/db/repo/similar.ts`). A project is keyed by its registered name, normalised as in 15.5, with a trailing number, roman numeral, single letter or "phase N" taken off ("AZIZI VENICE 15" and "Azizi Venice 3" are both "azizi venice"; "DAMAC LAGOONS - LAGOON VIEWS 13" is "damac lagoons lagoon views"), in one DLD area; so one project is one DLD project number, or the numbered phases of one name. A key needs two words other than "the", "by" and the like ("Reef 998", "Oxford 212", "The 8" are never keys), and a key that is a place (a community, a DLD area or an area alias) is dropped. Exact whole words only, no near spelling. It refuses: nothing found (`nothing`), a community or area only (`community_only`), another emirate named anywhere in the text (`other_emirate`: Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Umm Al Quwain, Fujairah, Al Reem, Yas, Saadiyat, Aljada and others), the listing's area pointing elsewhere (`area_conflict`), two projects or one name in two areas the text does not settle (`ambiguous`), and the listing naming a numbered project or a building that IS in the data (`building_in_data`: "Azizi Venice 3" has sales, so its listing may be one of its buildings under another name, and the page could not say the building has no sales). 72 tests in `tests/unit/domain/project.test.ts`, 24 that must resolve and 42 that must not, on the real names of this snapshot (frozen in `tests/fixtures/similar/projects.json.gz`).

**The range** (`compareProjectRoute`, `src/lib/domain/project-route.ts`): the median of the other buildings' ln(12-month median), each building once; the range runs from that plus `lowLog` to that plus `highLog`, rounded to AED 10. Shipped: -2.8% to +21.7% (half-width 11.3%, so always "broad"). New buildings of a project sold above its other buildings more often than below, so it reaches further up; the definitions say so (`similar.projectReach`).

**The test** (`scripts/model/project_route.py`, written to `.data/model/project-route.json`; the summary is in `constants.json` under `projectRoute.backtest`). Four cutoffs (17 Nov 2024, 17 May 2025, 16 Nov 2025, 17 May 2026). At each, a case is a building whose first valid flat sale in DLD history is after the cutoff, off-plan, studio to 3-bed, with 5 or more sales of that type in the next 183 days; its truth is their median. The reference uses only sales up to the cutoff. Only cases the product can serve are kept (the building's project number had no sale before the cutoff, or its project name has no number). Each cutoff is scored with `lowLog` and `highLog` fitted on the earlier cutoffs only (expanding window, nominal 80%).

| Out of sample (3 later cutoffs) | |
|---|---|
| Cases | 119 (71 buildings, 43 project numbers, 32 projects) |
| Range held the truth | 89.9% (86.2% of 65, 100% of 41, 76.9% of 13 by cutoff) |
| Same, each project weighted equally | 82.0% |
| Typical error, 8 in 10 within | 4.9%, 12.3% |
| Bias (median, mean) | +3.6%, +4.8% (the new building above its project) |
| Mean half-width | 15.9% |

The owner's rule was: ship only with at least about 75% out of sample, at least about 100 test cases and a typical half-width under about 20%. It passed. The tested statement on the page is "about 7 of 10" (`projectRoute.heldOf10`): the lowest of the three shares above, rounded down. What is weak about it: one project has 25 of the 119 cases (without it 87.2% of 94); the latest cutoff has only 13 cases; the first fit rests on 26 cases; and cases of one project are not independent. A version that only counted DLD project numbers (no numbered phases) had 57 out-of-sample cases at 75.4% and would not have passed. With the route's own refusals left out (every new building with any sibling of its group), 130 cases held 87.7%. Areas and communities stay refused: there a new building was 10% to 13% off and 5% to 10% low.

On today's data, 884 projects (2,061 project and bedroom combinations) have off-plan sales of other buildings to read. How often listings will name one is not known: there is no listing data.

**Refit.** `project_route.py` runs in about a minute on the snapshot. Copy `shipped.lowLog`, `shipped.highLog` and `statement.heldOf10` into `constants.json` `projectRoute` (with the `backtest` summary), raise `version`, then the steps of 15.7. `refit.py` keeps `projectRoute` as it is.

## 16. The first answer: registered sales adjusted to the listing (19 Nov 2026)

For a building that is in the data, the comparison now starts with the building's registered sales of three years, each moved to the data date and to the listing's size. When that gives a range, the range is the answer and decides above, within or below. When it gives none, the comparison is exactly what sections 7 and 15 describe: the same-building median with its 5% band, the second tier under "Too few sales", the project route, "Not covered yet". A building that is not in the data never gets this answer.

Words such as "model", "centre", "comparable" and "ACS" (adjusted comparable sales) below and in the code are internal. The copy is DESIGN.md section 6.17: it must read as registered sales adjusted to the listing, never as a price Fairsquare states. It is not a valuation.

The method was chosen and tested in a backtest over four data dates and re-implemented once from its written specification; the reports are outside the repository. The backtest and refit scripts are in `scripts/model/acs/`.

### 16.1 The method

Pure code: `src/lib/domain/acs.ts` (`estimateAcs`). Input: the listing's building, bedrooms, basis (ready or off-plan), size and asking AED per sq ft.

1. **Pool.** The open-data sales of the building on the listing's basis, registered in the 1,095 days to the data date, and the same for the other buildings of its project family (16.2). Sales added by hand are not read. Each building is collapsed: 5 or more sales of unlike units within 0.1% of one AED per sq ft on 3 or fewer days become one row per bedroom count (a batch registered at one price); exact duplicates (date, bedrooms, size, price) become one row.
2. **Rings.** Ring 1: the building's rows of the same bedroom count, size 0.67x to 1.5x the listing's. Ring 3: the same in other buildings of the project family. Ring 2: the building's rows of another bedroom count (at most 2 apart), size 0.4x to 2.5x. At most 150 rows per ring, latest first.
3. **Adjustments.** Date: the monthly index of the sale's DLD area and basis (48 months, building types held fixed; Dubai's index when the area has none) moves the sale to the data date. Size: the relation between size and AED per sq ft inside the building's own sales of the type, shrunk to the segment's (ring 1); the segment's (ring 3); a fit across bedroom counts with a step per bedroom count (ring 2).
4. **Weights.** Ring 1 counts 1, rings 3 and 2 count 0.3 (0.09 when two bedroom counts apart); closeness in size (rings 1 and 3) and recency (half-life 8 months) scale that; one other building counts at most 0.5 in all; the best rows are taken first until their weights add to 8.
5. **Range.** The weighted median of the adjusted rows is the centre. The range around it is the spread of the rows, with a floor, times multipliers fitted in the backtest by kind of evidence (basis, which ring leads, little weight, old sales). Each end is rounded to AED 10 per sq ft, and the asking price is above, below or within exactly that rounded range.

### 16.2 What a data refresh builds

`npm run data:build` writes `acs-model.json.gz` next to the sales (323,090 bytes for the snapshot of 16 Nov 2026) and an `acs` section in the manifest. The file holds no sale. It has two parts with different lifetimes:

| Part | What | Made by | Lifetime |
|---|---|---|---|
| Snapshot statistics | the time index (124 area and basis indexes), segment size slopes, size statistics of 10,708 building types, the fit across bedroom counts, the project family of each of 4,348 buildings | `src/lib/acs/build.ts`, in TypeScript, on every `data:build` | one snapshot: the file names the sales file it belongs to (`snapshotSha256`) |
| Fit | the method's parameters, the range multipliers (48 groups), the rule, the tested statement | the Python backtest (`scripts/model/acs/`), copied from `src/lib/acs/constants.json` | expires: see 16.5 |

The time index needs 48 months, the snapshot keeps 36. The collector therefore hands the build every sale of the 1,461 days to the data date that passes rules 1 to 10b (491,268 for this snapshot: the 403,867 kept and 87,401 of the 12 months before). The older sales are used for the index only and are not written anywhere. The project family of a building is the numbered or lettered phases of one project name in one DLD area ("Azizi Venice 1" to "Azizi Venice 12"), else its DLD project number; it reads the building's most common project number and name over every year of the source files. 1,897 buildings have at least one other building of their family in the pool.

The loader checks the file against the manifest (hash, schema, the snapshot it names) before it loads anything, stores its text in `app_meta.acs_model` (about 0.9 MB) and its section hash in `app_meta.open_data_acs_sha`. A snapshot without the section empties both. The server parses the model once per loaded snapshot.

### 16.3 When there is no range

`estimateAcs` refuses, in this order, and the stored result keeps the reason (never shown as such):

| Reason | Test |
|---|---|
| `no_comparables` | no row passes the ring limits; also a building added by hand (no `dld_key`) or one the model does not have |
| `bedrooms_not_validated` | more than 3 bedrooms (not tested) |
| `no_close_comparables` | sales of other buildings of the project carry the most weight |
| `too_few_comparables` | fewer than 3 rows, or total weight under 2, or no row of the same bedroom count in the building |
| `size_too_far` | the weighted mean size gap is over 15%, or the listing's size is outside 0.7x to 1.6x the building's usual size for the type |
| `no_calibration` | no multipliers for this kind of evidence |
| `range_too_wide` | the range would be wider than 20% either way |

It does not run at all, and nothing is stored, when: `ACS_TIER=off`; no building was matched; no sales data is loaded; no usable model is loaded (16.5); the comparison's window does not end at the model's data date; or today is more than 122 days after the data date (`ACS_MAX_DATA_AGE_DAYS`: the backtest followed prices for 183 days, and off-plan sales 123 to 183 days after the data date were inside the range in 79.7% of cases, under the "about 8 of 10" the page states; see 16.7).

### 16.4 What is stored and shown

`runCheck` computes and stores the same-building result and the second tier exactly as before, for every comparison, and stores this answer beside them in `checks.acs_view` (migration 0008, jsonb, nullable). So a comparison still reads as it did before whenever this answer is absent, refused, switched off or withdrawn later; nothing is ever recomputed for a stored comparison, and a comparison stored before 19 Nov 2026 (no `acs_view`) renders exactly as it did.

The stored value is `AcsStoredSchema` (`src/lib/validation/api.ts`), version `v: 1`: the fit and model versions, the data date and the first day of the sales read, `scenario` ("enough": the type had its 5 or more sales in 12 months; "few": it had too few), `shown`, `reason`, the rounded range, the outcome, counts of registered sales by ring (`evidence`), the tested statement, and the rows used, largest weight first (at most 200; `comparablesTotal` is the full count). Each row: ring, the other building's name (ring 3), registration date, bedrooms, size, registered price and AED per sq ft, how many registered sales it stands for, whether it is a batch at one price, the adjustment for date, for size and between bedroom counts (fractions), the adjusted AED per sq ft and its share of the weight.

The centre and the unrounded ends are stored under `server` for audit and never leave the server: every reader goes through `AcsViewSchema`, which drops them (`storedAcs` in `src/lib/db/repo/checks.ts`). A value of another version, of withdrawn constants or of a wrong shape is taken as absent. `shownAcs` (`src/lib/acs/shown.ts`) is the last line of defence for everything that draws or words the range.

`CheckView.acs` carries the view. The interface (DESIGN.md section 6.17) reads it through two functions of `src/lib/copy.ts`: `acsShown` (a range to show: a matched building, a result that is not "Not covered yet", and `shownAcs`) and `acsLead` (it leads: the same-building comparison had a verdict of its own). When it leads, the headline, the scale, the stamp, the card, the link preview, the share text and the Saved line state the outcome against the range, and the fixed band is not used; the same-building median stays on the page as one line. With too few sales the range shows in its own section under the unchanged "Too few sales to compare yet", in the second tier's place. `SavedItemView.acs` carries the outcome and the range of a saved comparison whose range leads. Every other case reads `analysis` and `similar` as before.

### 16.5 Switches and expiry

- `ACS_TIER=off`: nothing new computes this answer and no stored result of it is shown; the site is the same-building median and the second tier, as before, and /how-it-works does not describe it. `SIMILAR_TIER=off` keeps its meaning. With both off the site is the same-building median only.
- The fit belongs to the market it was made on (`constants.fittedOn`). With data that runs more than 200 days past it (`ACS_MAX_FIT_AGE_DAYS`), `data:build` prints the warning and exits with code 2 (the snapshot is written, but must not be committed unnoticed), and the server does not use the model. For the fit of 16 Nov 2026 that day is 5 Jun 2027.
- The server also ignores a model that is unreadable, of another format version, of another snapshot (`snapshotSha256` or the data date differ from the loaded sales), or whose constants are older than `ACS_MIN_CONSTANTS_VERSION` (raise it only when ranges stored with old constants must stop showing).
- None of this is silent. `acsStatus` (`src/lib/services/acs.ts`) is the one test of whether the answer can run today; a comparison and /how-it-works both use it. When a loaded model cannot be used it logs `acs_inactive` once per model and reason (`constants_withdrawn`, `fit_too_old`, `data_too_old`), and /how-it-works stops describing the answer. For the snapshot of 16 Nov 2026 the data-age limit is reached on 19 Mar 2027 (the first day without the answer) unless the data is refreshed.
- An error inside the step (a failed read, an unforeseen case in `estimateAcs`) does not cost the comparison: `runCheck` logs `acs_failed`, stores no `acs_view`, and the page shows the same-building result and the second tier it had already computed.
- `data:build` warns when the download's first usable sale is more than 31 days after the start of the 48 months the time index needs (`acs.indexFrom` in the manifest): a shorter download still builds, with the missing months filled in.
- Refit steps: `scripts/model/README.md`.

### 16.6 Tests

- `tests/unit/domain/acs-golden.test.ts`: `estimateAcs` against the Python reference on 106 golden cases (55 with a range, 51 refusals of six kinds): 36,733 numbers within 1e-9; the largest relative difference measured is 1.2e-14.
- `tests/unit/acs/build-parity.test.ts` (slow, run on request; the command is in its header): the TypeScript build against the Python build on the data of the fit, 491,268 sales: every number within 1e-9 (largest 9.8e-13), the same families, built in 2.9 s. The model that `data:build` wrote from the raw files was compared with the Python model too: 27,486 numbers, largest relative difference 1.4e-12, the same 478 families.
- `tests/db/acs.test.ts`: build, load and compare end to end on a synthetic file: the fallbacks, 4 bedrooms and more, sizes outside the limits, a batch at one price, a project sibling, the switch, the two expiries, stored versions, and what stays on the server. `tests/db/e2e-snapshot.test.ts` does the same on the committed synthetic snapshot.
- The fixtures in `tests/fixtures/acs/` are frozen with the snapshot of the fit and hold DLD's own building names, as `data/open-data` does.
- The interface: `tests/ui/result/acs-section.test.tsx` (who leads, the two layouts, the list, the scale, the fallbacks compared by markup, /c, the stamp, the share words, Saved) and `tests/ui/stamp/card-canvas.test.ts`. End to end at 390 and 1280: `tests/e2e/smoke.spec.ts` tests 20 to 23 (a leading range with /c, the preview and Saved; above and below; the section under "Too few sales", from a fixture because the synthetic snapshot has no such building; the fallbacks to the median, to the second tier and to "Too few sales" alone; a comparison without a stored range). `tests/e2e-switch/acs-switch.spec.ts` (`npx playwright test -c playwright.switch.config.ts`) runs real servers on one database with `ACS_TIER` off, on and off again. The smoke test runs against today's date: its range tests hold while today is at most 183 days after the synthetic data date (10 Nov 2026), that is until 12 May 2027; after that the synthetic files need newer dates.

### 16.7 Tested numbers

Forward in time: at each of four data dates the range is built from the sales registered before it and compared with the price of each flat sold in the 183 days after. Errors are typical / 80th / 90th percentile, in percent. Studio to 3-bed. "Held" is the share of later sale prices inside the range, on the sales answered.

| | Answered | This answer | Same-building median on the same sales | Held | Half-width |
|---|---|---|---|---|---|
| 5+ sales, four dates (47,840 sales) | 84.0% | 4.28 / 10.63 / 16.04 | 5.28 / 13.02 / 19.15 | 84.5% | 11.2% |
| 5+ sales, the two later dates | 85.0% | 3.84 / 9.71 / 14.56 | 4.73 / 11.65 / 17.21 | 86.6% | |
| 5+ sales, ready, the last date | 67.0% | 5.98 / 13.33 / 18.77 | 6.84 / 14.43 / 20.18 | 82.9% | |
| Too few sales, four dates (38,845 sales) | 29.1% | 5.06 / 11.29 / 16.26 | | 88.4% | 14.8% |
| Too few, where the second tier answers too (8,681) | | 4.73 / 10.33 / 14.93 | second tier: 5.44 / 12.22 / 18.30 | | |

With this answer first and today's as the fallback, on the two later dates: buildings with 5+ sales go from 5.36 / 13.80 to 4.45 / 11.99 (it gives 84.8% of the answers); too-few buildings are answered 67.3% of the time against 61.5%, and where today answers the error goes from 6.96 / 16.98 to 6.74 / 16.34. The tested statement on the page is "about 8 of 10" (`tested.heldOf10`): the lowest held share of the two tuning dates and the two later dates, by 5+ and too few, ready and off-plan, is 81.5%, rounded down.

What is weak, stated plainly:

- **The outcome changes in both directions.** The range is about 11% wide each way (ready: about 14%), where the fixed band is 5%. A listing priced at what the flat later sold for is called right 76.5% of the time against 50.6% today. A listing 10% over that price is called "above" 28.5% of the time against 71.6% today; at 20% over, 72.9% against 88.7%. Which rule is right more often depends on how far listings sit from sale prices, which the data cannot show (it has sales, not listings).
- Ready flats are fitted at a nominal 85% (off-plan 80%). That choice was prompted by the last date, where the ready range had held 77.6%, so 82.9% there is not a clean test; 87.0% at the date before it is.
- After prices fell (the last date) the misses are one-sided: the later price was under the range for 13.7% of ready answers and over it for 3.4%.
- One small group is weaker: 5+ sales, ready, other bedroom counts lead: 73.5% held on 120 sales. It is kept because the same-building median is twice as far on those sales.
- The range holds less as the data ages: off-plan, 123 to 183 days after the data date: 79.66% (8,744 sales). That is why the server stops after 122 days (16.3). One more slice is under 80% and is still served: ready sales 62 to 122 days after the last test date, 79.71% (843 sales, one date).
- "About 8 of 10" is the lowest of the 12 tested shares (two kinds of building, ready and off-plan, three groups of dates), 81.46%, rounded down. With the range rounded to AED 10 the overall share is 84.82% against 84.80% unrounded.
- No confidence intervals were computed. The second implementation was written by a reader of the first.

### 16.8 Known limits of the method as shipped (review of 19 Nov 2026)

Checked on 6,932 real requests against the Python reference (the full method): 1,748 shown on both sides, no difference in shown or declined, in the rounded range, in the outcome or in the number of sales used.

- **Equal sales are taken in file order.** The best rows are taken until their weights add to 8; rows of equal weight (same day, same size) are taken in pool order, which in production is ascending transaction ref. The backtest ran on another order of the same sales. Same sales, same code, the two orders, on 1,747 requests shown in both: 58 (3.3%) get a different rounded range (55 of them off-plan), 34 centres differ by more than 0.1%, 3 by more than 1%, the largest 4.137%; 2 outcomes change and 1 request changes between shown and declined. Production is the same on every run for a given snapshot, and nothing suggests the order favours high or low prices, so the tested shares should hold on average; but a shown range can sit up to about 4% from where another order would put it. The fix (equal rows share what is left of the budget, in `acs.py` and `acs.ts` together) changes answers, so it needs a full rerun of the backtest and new golden cases. Not done.
- **Near-ties in the weighted median.** With the pool in one order on both sides, 4 of 6,932 requests differ between TypeScript and Python by more than 1e-9 (two sales adjusted to the same figure up to the last bits sort differently). Largest effect: centre 0.0035%, a range end 0.03%. No rounded range, outcome or shown/declined decision changed. Not fixed.
- **Other bedroom types can lead.** When a building has few sales of the listing's type, its sales of other bedroom types can carry most of the weight (the rule asks for one sale of the type, not a share). Example: Avenue Park Towers II, off-plan 3-bed, 2,040 sq ft: one 3-bed sale counts for 11.8% and 24 two-bed sales for 88.2%. Tested share held where other bedroom types lead: too-few buildings 84.0% ready (1,507 sales) and 92.1% off-plan (2,430); 5+ sales 86.5% off-plan (243) and 73.2% ready (126). The page says so in a note (`acs.leadOtherBeds`) and lists every row with its bedroom adjustment. A minimum share for the listing's own type would need a rerun of the backtest; it is an owner decision.
- **A refusal for a wide range falls back to a firm verdict.** Of 3,012 studio to 3-bed requests at the usual size, this answer showed 1,079 and declined 728 for a wide range; the page then gives the same-building median with its 5% band, as decided. Example: Seventh Heaven 2-bed (range 52.6% wide) reads "below" by 23.9% on a median of 10 sales.
- **The outcome uses the asking price as printed.** `estimateAcs` rounds the asking price to whole AED per sq ft (halves up) before it compares it with the rounded range, so "AED 1,800 per sq ft" beside "AED 1,450 to AED 1,800" always reads "within". `acs.py` does the same.
- **Admin counts.** The admin overview still counts comparisons by the same-building result (`checks.band`), not by the outcome people saw when this answer led. The outcome is in the `check_created` event (`meta.acs`).

### 16.9 Measured cost (19 Nov 2026, this PC, a local production server on PGlite with the real snapshot)

- `data:build` on the two source files (1,820,003 rows): 74 s in all; the model's statistics take 2.9 s of it.
- Server start on an empty database: `/api/health` answered after 5.0 s; the open-data load took 27.3 s for 403,867 sales (as before; the model adds one `app_meta` value); the slowest health check during the load took 1.7 s.
- Memory (working set): 468 MB after the load. After comparisons on four buildings: 437 MB with this answer on and 399 MB with `ACS_TIER=off`, on a second start with the database kept. The first start on an empty PGlite folder peaked at 720 MB before the health check answered; a later start peaked at 329 MB. That peak is PGlite's own start and does not come from this change.
- One comparison: 2 to 4 ms more than before for three ordinary buildings (19 to 48 ms in all). For the largest read there is, a building of the Azizi Venice family (11,651 sales of the family), about 220 ms against 21 ms with the switch off. 99 of 100 building and basis pairs read 3,423 sales or fewer.
- Measured again after the review fixes (same day, same PC): empty database, health after 5.8 s, load 26.3 s, 558 MB after the load, 491 MB after 118 comparisons, peak 680 MB before the health check answered. Second start with the database kept: health after 3.9 s, peak 513 MB after the screenshot run. Repeat comparisons: Azizi Venice 12 A 206 to 219 ms, Elite Residence 17 to 19 ms, Ozone 1 Residence 38 to 39 ms, Aykon City (2) -Tower C 20 to 22 ms.
- Not measured: Postgres (Railway). The read is one join by `dld_key` on the existing `sales_lookup_idx`; no index was added.

## 17. The last resort: nearby registered sales (20 Nov 2026)

Owner decision of 20 Nov 2026: when a listing's building has no usable registered sales (the page said only "Too few sales to compare yet") or is not in the data ("Not covered yet"), the page must still compare with the most relevant apartments nearby and give a result. The case that prompted it: "Marriott Residences Tower 2", area "Dubai Science Park", ready 2-bed, 1,491 sq ft, AED 2,695,000, with no building chosen. (That building turned out to be in the data under its DLD name, Three Towers B-2; see section 5, marketing names.)

This is the fourth and weakest answer. It runs only when the other three give nothing to show: the same-building comparison is "too few" or "not covered" (section 7), adjusted registered sales shows no range (section 16) and the second tier shows none (section 15, the project route included). It never changes an answer one of those gives.

Words such as "nearby", "kind in", "kind out", "centre", "group" and "comparable" below and in the code are internal. The copy is DESIGN.md section 6.18: the page gives the outcome, and directly under it says that the building itself has no (or too few) registered sales, or is not in DLD data, and that the range comes from other buildings in a named place. It is not a valuation.

The method was designed and backtested before it was built here. Its specification is `scripts/model/nearby/SPEC.md`, its fitted numbers `scripts/model/nearby/constants.json` (copied to `src/lib/nearby/constants.json`), its Python reference `nearby()` in `scripts/model/nearby/make.py`. The TypeScript (`src/lib/domain/nearby.ts`) is written from the specification and reproduces the reference's 42 golden cases.

### 17.1 The method

Two kinds:

- **in**: a building was chosen. Its community (`buildings.master_project`) and its DLD area (`buildings.area_dld`) are the building's own. Its own sales are never comparables.
- **out**: no building was chosen. The listing's area text is resolved to a DLD area and, when it is named, a community, with the resolver of section 15.5 (`resolveArea`, the alias table `src/lib/similar/area-aliases.json`). When the text names no community, the project resolver of section 15.8 (`resolveProject`) may add one from the listing's words, but never against a resolved area that is another one. When nothing resolves, the entry says `area_unresolved` or `area_ambiguous` and the page stays "Not covered yet".

One read (`src/lib/db/repo/nearby.ts`): the open-data sales of the listing's bedroom count and basis, registered in the 730 days to the data date, in buildings of that DLD area or that community, without the listing's own building. Then, for each sale (SPEC.md section 3):

1. It is moved to the data date with the time index of its own DLD area (Dubai's when the area has none): the index of section 16.2.
2. It is moved to the listing's size with the size slope of its basis and bedroom count: the segment slopes of section 16.2.
3. It is moved for the age of its building against the listing's, with a curve fitted per basis (`vintage` in the constants): for kind in always (off-plan: age from the building's first sale; ready: from its first ready sale, 0 when it has none), for kind out off-plan with the listing taken as a new launch, and not at all for kind out ready (its age is not known).
4. Its weight is 0.5 per 6 months of age of the sale and 0.5 per (0.25 in log size) squared. For kind in the weight also halves per year of difference in building age. A building's sales together weigh at most 1 (the cap).

Scope: the community alone when at least 3 of its buildings count (a building counts with a weight of 0.05 or more); otherwise the community together with the rest of the DLD area, the rest weighted 0.3; the DLD area alone when no community is known.

The centre is the weighted median of the adjusted sales; the 10% and 90% weighted points give two scales (their square roots, with a floor), and the range is the centre minus and plus a fitted multiple of each. The multiples are fitted per kind and group (ready or off-plan; fewer than 6 buildings; 3-bed; community scope by how far the sales are from the listing's size; other scopes) on the two earlier test dates and tested on the two later ones. Each end is rounded to AED 10 per sq ft; the asking price, rounded to whole AED per sq ft as printed, is above, within or below exactly that range.

### 17.2 What a data refresh builds

Nothing. The method reads `sales`, `buildings` and the time index and size slopes that `npm run data:build` already writes into `acs-model.json.gz`. The constants are in the repository (`src/lib/nearby/constants.json`), not in the manifest.

### 17.3 When there is no range

First that applies (`estimateNearby`; the page is then exactly what it was):

| Reason | Test |
|---|---|
| `area_unresolved`, `area_ambiguous` | kind out: the area text names no place, or several |
| `no_comparables` | no sale of that bedroom count and basis in the place in 730 days |
| `bedrooms_not_validated` | more than 3 bedrooms (untested) |
| `too_few_buildings` | fewer than 3 buildings count, or the total weight is under 1 |
| `size_too_far` | the weighted distance in log size is over 0.5 |
| `no_calibration` | the group has no fitted multiples |
| `range_too_wide` | the half-width is over 50% |

Every page, card, preview and text also goes through `nearbyShown()` (`src/lib/copy.ts`) and `shownNearby()` (`src/lib/nearby/shown.ts`): no range without both ends in order, an outcome, the place named, the sales and the buildings listed and the tested share; never beside a verdict, a range of adjusted registered sales or a range of the second tier; never for a kind the comparison is not.

### 17.4 What is stored and shown

`checks.nearby_view` (jsonb, migration 0009, additive): version 1 (`NearbyStoredSchema`). The kind, shown or the reason, the scope, the community and the area as shown, the two rounded ends, the outcome, whether building age was adjusted, the tested share (`tested.heldOf10` of the constants at that time), the buildings with their sales and weight share (at most 200), and every sale used with its building, date, size, registered AED per sq ft, the three adjustments as fractions, the adjusted figure and its weight share (the 200 with the most weight; `comparablesTotal` and `buildingsTotal` say how many there were). Under `server`, never sent to a browser: the centre, the unrounded ends, the half-width, the group, the number of buildings that count, the weight and the size distance. `CheckView.nearby` and `SavedItemView.nearby` carry the view. A stored entry is never recomputed: it is a dated statement, as in section 16.4.

The page (DESIGN.md section 6.18): the headline is the outcome; under it what the building itself has and where the range comes from; the range scale with the asking price and a ring per adjusted sale; the weakness note, always; the buildings with their weight share and every sale with its adjustments; "Not a valuation". No single figure and no percentage difference. A not-covered comparison with a range gets the share card, the stamp ("... NEARBY REGISTERED SALES"), Save and track and the WhatsApp text; without one it has none of them, as before.

### 17.5 Switches and expiry

- `NEARBY_TIER` (default on). `off`: nothing new computes it and no stored result of it is shown anywhere (`storedNearby`); /how-it-works and /coverage do not describe it.
- `NEARBY_MIN_CONSTANTS_VERSION` (`src/lib/nearby/model.ts`, 1): raise it to stop showing ranges stored with older constants.
- Not served when today is more than 122 days after the data date (`NEARBY_MAX_DATA_AGE_DAYS`, the rule of section 16.5; the range was tested on sales up to 183 days after each data date).
- Not served when the data date is more than 200 days after the constants' `fittedOn` (`NEARBY_MAX_FIT_AGE_DAYS`); `npm run data:build` then exits with code 2 and says so.
- Needs the adjusted-registered-sales model of the loaded snapshot for its time index and size slopes; without one it does not run. `ACS_TIER=off` does not turn it off.
- When loaded data cannot be used, `nearby_inactive` is logged once per snapshot and reason. A failure inside the step is logged (`nearby_failed`) and the comparison is stored without it: the page is then what it was.
- The `check_created` event carries `meta.nearby`: `shown_in_above`, `shown_out_within`, or the reason.

### 17.6 Refit

After the refit of section 16 (steps 1 to 4 of `scripts/model/README.md`, which make the backtest's work folder), the steps of `scripts/model/nearby/SPEC.md` section 8: `run.py f`, `final.py`, `make.py`; then copy `scripts/model/nearby/constants.json` to `src/lib/nearby/constants.json`, run `scripts/model/nearby/golden-fixture.ts`, and the tests. `tested.heldOf10` is the number the page states ("about 7 of 10"); it is read from the constants and from the stored entry, never written in the copy. If it changes, read DESIGN.md section 6.18 and this section again. `constants-nominal87.json` (a wider range, "about 8 of 10") is not used.

### 17.7 Tests

- `tests/unit/domain/nearby-golden.test.ts`: the 42 golden cases of the reference (35 ranges, 5 `too_few_buildings`, 1 `bedrooms_not_validated`, 1 `no_comparables`), every number to the 6 significant figures the reference prints. Buildings at the weight cap have equal shares but for the last bit of a power (Python's and V8's `pow` differ there), so their order among themselves is not compared. The fixtures (`tests/fixtures/nearby/`) are cut from the committed snapshot by `scripts/model/nearby/golden-fixture.ts`.
- `tests/unit/domain/nearby.test.ts`: the scope, the cap, the building-age adjustment, every refusal (the reference has no case of `size_too_far`, `range_too_wide` or `no_calibration`; they are tested on made-up markets), the outcome at the rounded ends.
- `tests/db/nearby.test.ts`: build, load and `runCheck` on PGlite: both kinds, when it does not run, the refusals, the switch, the expiry, a failure inside the step, what stays on the server, Saved, and the marketing names.
- `tests/ui/result/nearby-section.test.tsx`, `tests/unit/copy-nearby.test.ts`, `tests/ui/how-it-works.test.tsx`.

### 17.8 Tested numbers

From the modelling report (outside the repository). Forward in time: at each test date the range is built from the sales registered before it and compared with the price of each flat sold in the 183 days after. The two later dates; error against an individual later sale, typical / 80th / 90th percentile, in percent. Studio to 3-bed.

| | Ready | Off-plan |
|---|---|---|
| Kind in (the building's own sales hidden) | 10.4 / 23.8 / 34.8 | 9.8 / 21.8 / 31.4 |
| Kind out | 13.2 / 30.8 / 44.1 | 11.7 / 25.4 / 36.4 |

- The range held (the later sale price was inside it): in the lowest group with 400 or more test sales, 74.3% (in), 75.6% (out), 73.9% (out, with the whole project hidden). Hence "about 7 of 10" (`tested.heldOf10` 7, the lowest of the three rounded down). The ranges are fitted at a nominal 80%.
- Median half-width of the range: 19.3% (in), 23.8% (out). Nothing over 50% is shown.
- It answers about 95% of cases (in 95.0%, out 94.6%, out with the project hidden 92.3%).
- For comparison, adjusted registered sales (section 16.7) is about 4 / 10 / 15 on a building with 5 or more sales of its own. This answer is two to three times further off. It is the last resort.

What is weak, stated plainly:

- **A premium or a budget building in a mixed community reads above or below.** The sales are in other buildings; nothing in DLD data says what sets one building apart from the next (brand, quality, view). The weakness note on the page says this.
- **A ready listing in a brand-new building that is not in the data.** At the last test date the range held 51.8% of the later prices of such buildings (245 sales): a new building usually sells above its older neighbours, and for kind out ready no age adjustment is made. /how-it-works says "only about half".
- **Off-plan, kind out, assumes a new launch.** If the building is an older launch under another name, the range reads about 5.5% high.
- **Thin communities are fragile.** With fewer than 6 buildings the range rests on few buildings; under 3 it is refused, or the rest of the DLD area is read at a lower weight.
- **Own-building sales are ignored**, also when a building has 1 to 4 of them. They stay listed on the page.
- **4 or more bedrooms are untested and declined.**
- No confidence intervals were computed.

### 17.9 What was seen on the real snapshot, and what differs from the specification (20 Nov 2026)

A local production server on PGlite with the snapshot of 16 Nov 2026, no network:

- An unlisted name ("Cedar Gate Residences") in Dubai Science Park, ready 2-bed, 1,491 sq ft, AED 2,695,000, "None of these": kind out, community scope, AED 990 to 1,770, asking AED 1,808, **above**; 134 sales in 10 buildings. This is the reference's worked case, number for number.
- The same listing under its real name, "Marriott Residences Tower 2": with the marketing names of section 5 the match offers Three Towers B-2 first (the tower-number question is still asked, as for every numbered tower). On its own sales: median AED 1,800 from 10 sales, adjusted registered sales AED 1,420 to 2,110, **within**. The two answers for one flat differ (above against within): the building sells above its community, which is the first weakness of 17.8, seen on the case that prompted this section.
- Kind in: 1 Wood Residence (Jumeirah Village Circle; off-plan sales only), ready 1-bed, 760 sq ft, AED 1,050,000: AED 1,070 to 1,670, within; 4,978 sales in 228 buildings, of which the 200 rows and 200 buildings with the most weight are stored. A new building against older ones: the building-age adjustment moves single sales by up to about 40%.
- Seventh Heaven (Al Barari), ready 1-bed, 2,904 sq ft, AED 4,100,000: `too_few_buildings`; the page is unchanged. E1 (Al Barari) and Bella Rose 3-bed (Dubai Science Park) decline the same way.
- "Nowhere Point Tower" with an area that names no place: `area_unresolved`; the page is unchanged. A 4-bed in Dubai Science Park: `no_comparables`.
- Off-plan 1-bed, 750 sq ft, AED 2,150,000 in Dubai Maritime City, no building: AED 2,320 to 3,690, within; 3,307 sales in 30 buildings.
- Elite Residence 2-bed and Bahar 4 1-bed 1,100 sq ft: the same answers as before (their screenshots are byte for byte those of 19 Nov 2026).
- One comparison with this step: 34 to 112 ms on that server (the largest read here, 4,978 rows, included).

Differences from the specification and the brief:

- `topBuildings` order among buildings at the weight cap is not the reference's (17.7). Nothing shown depends on it beyond the order of rows with equal shares.
- `inCommunity` per sale is computed and tested but not stored: the page names the scope, not each sale's side of it.
- Two reasons are added to the specification's list for kind out: `area_unresolved` and `area_ambiguous`.
- The page counts the buildings the sales are in (every building with a sale used); the rule counts only buildings with a weight of 0.05 or more (`server.buildings`). The two were equal in the cases above.
- A not-covered comparison answered this way has no "Request it and track" and no "Search covered buildings" on its page; "Find the building in DLD data" opens the building question, which has the search.
- The share card drops its one-line caption under the scale when the source line takes three lines.

Not tested: Postgres (the read is one join filtered by `sales.bedrooms`, `completion`, `sale_date` and `buildings.area_dld` or `master_project`; no index was added, and neither building column is indexed); the backtest itself was not run again here; `ACS_TIER=off` together with this tier end to end; the Playwright switch run for `NEARBY_TIER`.
