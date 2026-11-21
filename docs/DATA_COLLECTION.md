# How the data was collected

This page explains where the sales data comes from, how it was obtained, how it was cleaned, and how you can rebuild the same dataset yourself. The processed data is **not** included in this repository (see [section 9](#9-why-the-data-is-not-in-this-repository)).

Everything below is about *registered sales*: transactions recorded by the Dubai Land Department (DLD). It is not about asking prices. Asking prices only appear at run time, when a user types or uploads a listing.

## 1. The source

| | |
|---|---|
| Publisher | Dubai Land Department (DLD) |
| Portal | Data.Dubai, the Dubai open-data portal (successor of Dubai Pulse) |
| Dataset | "Transactions" (DLD transactions, open data) |
| Dataset page used | https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open |
| Licence | Dubai Open Data Licence, terms at https://data.dubai/en/terms-conditions |
| What a row is | One registered property transaction: date, type of procedure, property type, area, building, size in square metres, and the registered value in AED |

The dataset has no names of buyers or sellers and no contact details. It is aggregated at the level of the transaction, the building and the area.

## 2. How it was obtained

1. **A person downloaded it in a web browser.** There is no scraper, no automated login and no workaround of any access control. The portal answered requests only from connections inside the UAE, so the download was done on a UAE connection.
2. **Two CSV files were saved** to a folder outside the repository. The files from the November 2026 download are recorded in [`provenance/snapshot-2026-11-17.json`](provenance/snapshot-2026-11-17.json): their names, row counts and SHA-256 checksums.
3. **The server never contacts Data.Dubai.** A snapshot is built locally from the downloaded files, and the app reads the snapshot. This keeps the running site independent of the portal.

| File | Rows | SHA-256 (first 16 characters) |
|---|---|---|
| `transactions_2026-11-17_17-54-54_0001.csv` | 910,002 | `45b00b87f392711c` |
| `transactions_2026-11-17_17-54-54_0002.csv` | 910,001 | `5a5c3e0af4653c27` |

Total read: **1,820,003** rows, covering transactions up to **16 November 2026**.

> Navigation on the portal can change. The dataset page above is the one recorded in the build manifest. If it has moved, search Data.Dubai for the DLD "Transactions" dataset.

## 3. What a downloaded row looks like

The file is a CSV with snake_case columns. The importer matches headers case-insensitively, ignores column order and ignores extra columns. The columns of the November 2026 files:

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

Columns the analysis needs: `transaction_id`, `trans_group_en`, `procedure_name_en`, `instance_date`, `property_sub_type_en`, `area_name_en`, `building_name_en`, `rooms_en`, `procedure_area` (square metres) and `actual_worth` (AED). Columns used when present: `reg_type_en` (ready or off-plan), `property_usage_en`, `project_name_en`, `master_project_en`, `project_number`, the nearest metro, mall and landmark, and `has_parking`.

## 4. Cleaning: which rows count

The full specification is [`app/docs/REAL_DATA.md`](../app/docs/REAL_DATA.md) sections 1 and 2, and the code is `app/src/lib/ingest/`. In short, a row is kept when all of these hold, applied in this order, with every exclusion counted by reason:

1. It is a **sale**: group "Sales" and a procedure of Sell, Sale, Sell - Pre registration or Delayed Sell. Mortgages, grants, leases, development and portfolio procedures are dropped.
2. It is a **residential flat**, with 0 to 7 bedrooms (studio is 0). Villas, land, offices, shops, penthouses and unlabelled units are dropped.
3. It has a **building name** and a positive **size** and **price**.
4. Size is converted to square feet (square metres × 10.7639) and must be between 150 and 15,000 sq ft.
5. Price per square foot is **recomputed** as price ÷ size, never taken from the file, and must lie between AED 279 and 20,000.
6. A transaction id that appears more than once (a multi-unit deal) is dropped.
7. **Bulk and price-list sales are dropped.** Three or more units in one building on one day at one price are a developer's price list, not independent opinions, unless the units are identical. A block of like units whose price per square foot is far from the building's other sales (under 0.85 or over 1.18 times their median) is also dropped.
8. A sale whose size is under half or over twice the building's usual size for that bedroom count is dropped, because the room label or the area is probably wrong.
9. Each sale is labelled **ready** or **off-plan** from the registration type.
10. Only the **latest 36 months** are kept.

Text fields are trimmed, stray Arabic characters are removed from the English name columns, and dates in five formats are read with the day first.

### What the cleaning removed (November 2026 download)

| Step | Rows |
|---|---:|
| Read | 1,820,003 |
| Not a sale | 429,059 |
| Sale procedure excluded | 72,906 |
| Not a flat | 406,301 |
| Room label excluded | 1,936 |
| Size out of range | 579 |
| Price per sq ft out of range | 2,367 |
| Portfolio or price-list blocks | 19,539 |
| Size unlike the building's | 4,545 |
| Older than 36 months | 478,904 |
| **Kept** | **403,867** |

The excluded counts sum to 1,416,136, which with the kept rows gives the 1,820,003 read. The same numbers, with the file hashes, are in [`provenance/snapshot-2026-11-17.json`](provenance/snapshot-2026-11-17.json).

The result is **403,867 flat sales in 4,348 buildings**, from 17 November 2023 to 16 November 2026.

## 5. What the build writes

`npm run data:build` writes four files into `app/data/open-data/`:

| File | Content |
|---|---|
| `sales.csv.gz` | One row per kept sale: reference, date, building, area, project, bedrooms, size, price, ready or off-plan, project number, parking |
| `buildings.csv.gz` | One row of facts per building: nearest metro, mall and landmark, first and last sale date, sale counts |
| `similar-cells.csv.gz` | Medians per building, bedroom count and completion type, used by the second tier |
| `acs-model.json.gz` | The time index and size slopes used to adjust each sale to the listing |
| `manifest.json` | Source, licence, file hashes, row counts, exclusion counts, and the fitted constants and tested numbers |

The build is deterministic: the same input files give the same bytes.

## 6. Rebuild it yourself

You need Node.js 22 or later and the two (or more) CSV files from Data.Dubai.

```bash
# 1. Put the raw files in raw-data/ at the repository root (the folder is git-ignored).
mkdir raw-data
#    ... save the Data.Dubai CSV or ZIP files there ...

# 2. Install and build the snapshot.
cd app
npm ci
npm run data:build -- \
  --in ../raw-data/transactions_<date>_0001.csv \
  --in ../raw-data/transactions_<date>_0002.csv \
  --dataset-url "https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open" \
  --downloaded <YYYY-MM-DD>

# 3. Run the app on the new snapshot (local database, no setup).
cp .env.example .env.local
npm run dev
```

Notes:

- The build **streams** the files, so a 1 GB CSV is fine, and it reads a `.zip` directly. Add `--in` once per file. A transaction that appears in two files is kept once.
- It prints a report: rows read and kept, each exclusion reason, the most common source values and the date range. Read it before you use the snapshot.
- If it ends with an error that a fit is "too old for this data" (exit code 2), the fitted model constants need refreshing. That procedure is in [`app/scripts/model/README.md`](../app/scripts/model/README.md).
- The importer **refuses** the CSV export from the dubailand.gov.ae website and says why (see section 8).

## 7. Reproducing the analysis

Once a snapshot exists, the analysis scripts reproduce the model's tests:

- `app/scripts/model/` holds the Python reference implementations and the backtests (similar-buildings tier, adjusted comparable sales, nearby fallback), with run order and timings in its README.
- [`../reports/`](../reports) holds the written reports and charts.
- Your numbers will differ slightly from the published ones if your download is newer, because the data window and the fitted constants move with the data date.

## 8. What was deliberately not used

- **The dubailand.gov.ae website export.** Its terms allow personal, non-commercial use only, it sits behind a CAPTCHA, and it has no building column. It is not used, and the importer stops with a message when it sees that format.
- **Scraping or automation of any portal.** Nothing here logs in, solves a CAPTCHA, or calls the portal's API.
- **Personal data.** None is in the dataset and none is added. Listing screenshots uploaded by users are read at run time and are not part of the research data.

## 9. Why the data is not in this repository

The Dubai Open Data Licence permits reuse with attribution, but the licence document consulted was marked as a draft, and the publisher has not yet confirmed the licence version and attribution wording in writing. Until that is settled, this repository does not redistribute the rows, the processed snapshot, or test fixtures built from bulk rows. It publishes the method, the checksums and the counts instead, which is enough to rebuild and check the dataset from the original source.

Tests that need the frozen data skip themselves when it is absent, and everything else runs from a fresh clone.

If you republish any data derived from the dataset, check the current terms at https://data.dubai/en/terms-conditions first.

## 10. Attribution

Wherever results derived from this data are shown, use wording like:

> Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence. This project is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.

Do not use DLD, Dubai Government or Data.Dubai logos.

## 11. Known limits of the data

- **Registered is not asking.** Registered prices can differ from the prices listings ask, and the data cannot show how far.
- **Names differ.** Marketing names and registered names are often different (for example, a brand-name tower registered under another name). The importer keeps a small hand-made list of such links in `app/src/lib/ingest/market-names.ts`.
- **Off-plan prices move with the developer's price list**, which sales data alone cannot see coming.
- **Freshness.** The model stops answering when the data is more than 122 days old, so the snapshot has to be rebuilt regularly.
