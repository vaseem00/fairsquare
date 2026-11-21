# Adjusted comparable sales (ACS): integration spec

19 Nov 2026. Stage 5 (model hardening). Nothing in the repository was changed. The method is in `MODEL.md`; this file says how to put it into the app. Every number comes from `s5\e6_out.txt`, `s5\final5_tables.json`, `s5\prod_out.txt` and `prod\run_golden_out.txt`.

Words used here are internal. None of them is page copy. The page copy rules (no "estimate", "similar", "average", and so on) apply to whatever the UI stage writes.

## 1. Scope

- ACS answers first for a matched building, studio to 3-bed: scenario A (the type has 5+ sales in 12 months) and scenario B (fewer).
- Where ACS declines, the app does exactly what it does today: tier-1 median with the 5% band, tier 2, project route, too few, not covered.
- Scenario C (building not in the data) is not integrated. The runtime has no path for it.
- When ACS answers, its range decides within / above / below. The 5% band is not used for that comparison.
- `ACS_TIER=off` returns the app to today's behaviour. `SIMILAR_TIER=off` keeps its meaning.

## 2. Order of answers for one comparison

1. Match the building and run the same-building analysis as today. Keep every field it stores today (`band`, `medianPsf`, `diff`, `salesSnapshot`, and so on).
2. If a building is matched, `ACS_TIER` is not `off`, bedrooms <= 3, and a usable ACS model is loaded (section 9): run ACS (section 6).
3. ACS shown: store `acs_view` (section 7). The page shows the ACS range, the ACS verdict and the list of registered sales used. The tier-1 fields stay stored but do not decide.
4. ACS not shown: store `acs_view` with `shown: false` and the reason. The page is today's page: tier 1 when `band` is above / inline / below; `similarFor` (tier 2) when `band` is thin. Do not call `similarFor` when ACS is shown.
5. No building matched: today's flow, unchanged (project route, area scenario).

A stored comparison without `acs_view` (every comparison stored before this change) renders exactly as today. Never compute `acs_view` for an old comparison.

## 3. What was left out of the runtime, and why it changes nothing

- **Ring 4 (the community).** With the final rule a building in the data needs total weight 2 and class 1 or 2. Ring 4 has weight only when rings 1 to 3 together have under 0.5. Then class 1 is impossible (ring 1 would need at least 1) and class 2 is impossible (ring 2 under 0.5 cannot lead a total of 2). Checked: 20,000 random requests on the production artifact, 5,485 answered by both variants, 0 answered by one only, 0 with any different number (`s5\prod_out.txt`).
- **Classes 4, 5, 6** cannot occur. Class 3 (project siblings lead) is always refused, so its multipliers are not shipped and a class-3 result has no internal range.
- **The refusal reason can differ from the reference** when ring 4 is absent (for example `too_few_comparables` where the reference says `no_close_comparables`). The page shows the same thing in both cases: today's fallback. The golden cases of section 11 fix the production reasons.

## 4. Data flow

### 4.1 Two parts with different lifetimes

| Part | What | Built by | When | Expires |
|---|---|---|---|---|
| Fit | Hyper-parameters, range constants, multipliers `q`, the rule, the tested statement | Python backtest (`scripts/model/acs/`, to be copied from the scratch folder) | Refit, at least twice a year | `data:build` exits 2 and ACS is off when `fittedOn.dataThrough` is more than 200 days before the data date (as tier 2) |
| Snapshot statistics | Time index, slopes, cell slope statistics, other-bedrooms fit, project families | `npm run data:build`, in TypeScript | Every data refresh | Belongs to one snapshot: the model carries `snapshotSha256`; the server ignores a model whose sha is not `app_meta.open_data_sha` |

The pool (the sales) is not in the artifact. It is the `sales` table the app already loads.

### 4.2 `npm run data:build`

1. Collector, as today. New: keep the cleaned rows of the 1,461 days to the data date for the fit (the snapshot keeps 36 months; the time index needs 48). Building facts for the project family use all kept rows of all years, as `prep.py` does.
2. Write `sales.csv.gz`, `buildings.csv.gz`, `similar-cells.csv.gz` as today.
3. Build the snapshot statistics (MODEL.md section 2.2, steps 5 to 9) and write `data/open-data/acs-model.json.gz` (section 5). Merge in `src/lib/acs/constants.json` (the fit).
4. Manifest: add `acs: { version, modelFile: { sha256, bytes }, constantsVersion, fittedOn, dataThrough }`.
5. Exit code 2, with a plain message, when the fit is too old. The snapshot is still written; the site then runs without ACS.

The reference for step 3 is `acs.py` (`Ctx.build`) and `tindex.py`. A second implementation written from MODEL.md alone (`verify\v5_build.py`, plain loops) reproduces it on the same data: centre differences have a median of 2.7e-15 over 238,954 backtest estimates. The spec is enough to port. Needed linear algebra: one minimum-norm solve and about 120 symmetric 48 x 48 solves.

Test for the port (to add in the repo): build the model from the committed snapshot plus a fixture of the 12 older months, and compare with the Python artifact to 1e-9. On this PC that is a slow test: keep it out of the default `vitest` run and document the command.

### 4.3 Loader

`ingest/load.ts` stores the model JSON in `app_meta` under `acs_model` (874 KB of text). The server parses it once per snapshot sha and keeps the parsed object (as `repo/similar.ts` does for the tier-2 model).

## 5. Artifact: `acs-model.json` (version 2)

Measured on the snapshot of 16 Nov 2026: **874,476 bytes, 334 KB gzipped** (the stage 4 artifact with the pool: 19.9 MB, 6.7 MB gzipped). 4,348 buildings, 70 areas, 124 area x basis indexes, 10,708 cells with a slope, 48 multiplier groups, 1,897 buildings with a project sibling.

```
{
  "version": 2, "kind": "acs-model",
  "dataThrough": "2026-11-16", "epoch": "2020-01-01",
  "T": 2511,                      // data date, days from the epoch
  "poolFromDay": 1417,            // T - 1094: the first day of the pool (day T - 1095 is out)
  "params": { "nmax": 150, "size_lo": 0.67, "size_hi": 1.5, "age_half": 8, "size_half": 0.2, "W0": 8,
              "r3": 0.3, "r2": 0.3, "bed2": 0.3, "lam": 0.03, "cap": 0.5, "slope_lo": -1, "slope_hi": 0.2 },
  "range": { "floor": 0.05, "d0": 0.07, "k0": 3, "thinW": 4, "oldAge": 12, "farLsr": 0.1397619...,
             "nominal": [0.85, 0.80],                     // ready, off-plan
             "q": { "0|1|0|0|0": [1.982, 1.990], ... },   // basis|class|thin|old|far and every shorter key; classes 1 and 2 only
             "minComps": 3, "minWeight": 1, "minWeightKnown": 2, "minOwn": 1, "maxLsr": 0.1397619...,
             "typLo": 0.7, "typHi": 1.6, "maxHalfWidth": 0.20, "maxBedrooms": 3, "refuseClasses": [3], "rounding": 10 },
  "areas": ["Al Barsha South Fifth", ...],                // DLD area names; index used below
  "tau": [[48 numbers], [48 numbers]],                    // Dubai x basis month effects (fallback)
  "theta": { "<area index>|<basis>": [48 numbers] },      // area x basis month effects
  "seg": [[5], [5]],                                      // segment size slope [basis][min(bedrooms, 4)]
  "beta2": [2], "prem": [[5], [5]],                       // other-bedrooms fit
  "buildings": { "key": ["<dldKey>", ...], "area": [<area index>, ...], "family": [<id or 0>, ...] },
  "cellSlope": [[<building index>, <bedrooms>, <basis>, sxx, sxy], ...]
}
```

- `family` is 0 when no other building of the pool shares the project family. The ids mean nothing outside the file.
- Numbers are written at full precision. Rounding them was not tested.
- The fit part (`params`, `range`) comes from `src/lib/acs/constants.json`, which also carries `version`, `fittedOn { dataThrough, snapshotSha256 }` and the tested statement (section 10). Proposed constants version: 1.

## 6. Runtime

Reference: `prod\acs-runtime.ts` (plain TypeScript, no dependencies, passes `tsc --strict`). It is the code to move into `src/lib/domain/acs.ts`.

### 6.1 Building key

The model names a building by the app's `dldKey` (`normalise(building) + "|" + normalise(area_dld)`, `buildings.dld_key`). Checked on the snapshot: 4,348 keys in `sales.csv.gz`, 4,348 in `buildings.csv.gz`, 4,348 model buildings, one to one; no key joins two DLD names. The build must fail if two model buildings ever get one key.

A building created by an admin has no `dld_key`: ACS declines (`no_comparables`) and the app falls back.

### 6.2 Reads (one query)

```
select b.dld_key, s.external_ref, s.sale_date, s.bedrooms, s.size_sqft, s.price_aed
from sales s join buildings b on b.id = s.building_id
where b.dld_key = any($keys)            -- the listing's building and its project siblings (model.buildings.family)
  and s.completion = $basis             -- 'ready' or 'off_plan'
  and s.source = 'open_data'            -- sales added by hand are not in the pool
  and s.sale_date >= $poolFrom and s.sale_date <= $dataThrough
```

- All bedroom counts are read, also for the siblings: a one-price batch spans bedroom counts.
- Rows a request reads, over every building x basis of the snapshot: median 89, 90th percentile 637, 99th percentile 3,423, largest 11,651 (Azizi Venice, a family of many buildings).
- Day number of a sale = whole days from 2020-01-01 to `sale_date` (UTC dates).

### 6.3 Steps (MODEL.md sections 2.2 to 2.8, for a building in the data)

1. **Collapse** the rows of each building (one basis) into pool rows. Order the rows by `external_ref`, ascending by code unit (the order of `sales.csv.gz`; in SQL `order by external_ref collate "C"`, or sort in code). One-price batch: a run of 5+ sales within 0.1% of the run's lowest AED per sq ft, unlike units (more than one bedroom count, or largest size over 1.05 x smallest), on 3 or fewer days; it becomes one row per bedroom count (latest day, median size, median AED per sq ft, count). Exact duplicates (day, bedrooms, size to 0.01, price to AED 1) become one row with a count. A pool row keeps the refs of its sales.
2. **Gather**, latest first, ties by pool order, at most 150 per ring, in this order: ring 1 (own building, same bedrooms; size 0.67x to 1.5x), ring 3 (siblings, same bedrooms; same limits), ring 2 (own building, another bedroom count, capped counts at most 2 apart; size 0.4x to 2.5x). Typical size = median size of all own pool rows of the type, before the size limits.
3. **Adjust** each row: time (`theta[area of the sale's building | basis]`, month = min(floor((T - day) / 30.4375), 47); `tau[basis]` when the area has no index) and size (own slope shrunk to the segment for ring 1; segment slope for ring 3; other-bedrooms slope plus the bedroom step for ring 2).
4. **Weight**: base 1 / 0.3 / 0.3 (0.09 when 2 bedrooms apart); size closeness (rings 1 and 3); recency (half-life 8 months); one sibling building at most 0.5; budget 8, best first.
5. **Centre** = weighted median with the midpoint rule; rows stay in gather order, equal values keep that order.
6. **Range and refusal**: class, group, multipliers, half-width, the rule; ends rounded to AED 10, half to even; the asking AED per sq ft is above, below or within the rounded range.

The time the runtime needs is small against the read: 1.5 ms per request on the 106 golden cases, 18 ms for the largest read (11,651 rows). Node 26 on this PC.

### 6.4 Memory

Measured in Node 26: process 66 MB RSS before the model, 77 MB with the model parsed and indexed (heap 10 MB to 13 MB), 21 ms to load. Against 283 MB for the stage 4 artifact with the pool. The test harness then loads all sales into memory to stand in for Postgres (868 MB RSS): that is the harness, not production. The query against real Postgres was not timed.

## 7. Stored result: `checks.acs_view` (jsonb, new nullable column, version 1)

```
{
  "v": 1,
  "constantsVersion": 1,
  "dataThrough": "2026-11-16",
  "shown": true,
  "reason": null,                         // section 8 when shown is false
  "rangeLowPsf": 1830, "rangeHighPsf": 2260,
  "verdict": "within",                    // "above" | "below" | "within"; null when not shown
  "evidence": { "class": 1, "sales": 14, "ownSales": 11, "otherBedroomSales": 3, "projectSales": 0 },
  "typicalSizeSqft": 812.4,
  "tested": { "heldOf10": 8, "heldLaterOf10": 8 },
  "comparables": [ ... section 7.1 ... ],
  "comparablesTotal": 14
}
```

- The centre and the unrounded ends stay on the server (as tier 2 does). The page shows a range and the sales, never a single price.
- When `shown` is false: `rangeLowPsf`, `rangeHighPsf`, `verdict`, `tested` are null and `comparables` is empty.
- Read it back through a Zod schema, never as typed. A view with a `v` the build does not know is treated as absent, and the page renders today's result from the tier-1 and tier-2 fields, which are always stored.
- Raise a `ACS_MIN_CONSTANTS_VERSION` only if ranges stored with old constants must stop showing (as `SIMILAR_MIN_CONSTANTS_VERSION`).

### 7.1 One comparable

| Field | Meaning | From the runtime |
|---|---|---|
| `ring` | 1 own building and bedrooms; 2 own building, other bedrooms; 3 another building of the project | `ring` |
| `building` | Name as shown (`buildings.name`); null for rings 1 and 2 | via `buildingKey` |
| `date` | Registration date; for several sales in one row, the latest | `day` |
| `bedrooms` | 0 = studio | `bed` |
| `sizeSqft` | Size; for a one-price batch, the median size | `size` |
| `priceAed` | Price of the sale; null for a one-price batch | `psf * size`, rounded, when `batch` is false |
| `psf` | Registered AED per sq ft | `psf` |
| `count` | Sales in the row (1; more for duplicates or a batch) | `count` |
| `batch` | True when the row is a one-price batch | `batch` |
| `timePct` | Adjustment to the data date, percent | `exp(timeLn) - 1` |
| `sizePct` | Adjustment to the listing's size, percent (ring 2: without the bedroom step) | `exp(sizeLn - bedroomLn) - 1` |
| `bedroomPct` | Adjustment between bedroom counts, percent; 0 except ring 2 | `exp(bedroomLn) - 1` |
| `adjustedPsf` | AED per sq ft after the adjustments | `adjustedPsf` |
| `weightPct` | Share of the total weight, percent | `weight / W` |

Store the rows sorted by weight, largest first, at most 200 (the cap of `sales_snapshot`); `comparablesTotal` is the full count. Sales used per answered case in the backtest: A median 10, 90th percentile 21, largest 220; B median 21, 90th percentile 62, largest 404. 95.9% of A answers and 64.9% of B answers use 30 or fewer.

The page needs words for three things the tier-1 list never had: a sale of another bedroom count, a sale in another building of the project, and several sales registered at one price. That copy is not written.

## 8. Refusal reasons (stored, never shown as such)

| Order | Reason | Test |
|---|---|---|
| 1 | `no_comparables` | No pool row passes the ring limits (also: building without `dld_key`, building not in the model) |
| 2 | `bedrooms_not_validated` | More than 3 bedrooms |
| 3 | `no_close_comparables` | Class 3: sales of other buildings of the project lead |
| 4 | `too_few_comparables` | Fewer than 3 rows with weight; or total weight under 2 - 1e-9; or no own same-bedroom row with weight |
| 5 | `size_too_far` | Weighted mean size gap (rings 1 and 3) over ln 1.15; or listing size outside 0.7x to 1.6x the typical size |
| 6 | `no_calibration` | No multipliers for the group or any shorter key |
| 7 | `range_too_wide` | Half-width over 20% |

Reasons the service adds before the runtime: `off` (switch), `no_model` (none loaded, wrong snapshot, fit too old, unknown version), `not_matched` (no building). For these store no `acs_view` at all.

Share of refusals in the backtest (stage 4 rule, scenario B, all bedrooms): not close 27.2%, too few 20.5%, too wide 14.5%, bedrooms 3.0%, size 2.7%, nothing 0.4%. Not recomputed for stage 5; "too wide" is higher now for ready flats.

## 9. Switches and expiry

- `ACS_TIER=off`: the service returns null before any read. Today's behaviour, byte for byte.
- Model unusable: no `acs_model`; `snapshotSha256` is not `app_meta.open_data_sha`; `dataThrough` is not `app_meta.data_through`; `version` is not 2; fit older than `ACS_MAX_FIT_AGE_DAYS = 200` days against the data date; constants version under `ACS_MIN_CONSTANTS_VERSION`. In each case: no ACS, today's behaviour.
- `SIMILAR_TIER=off` still hides tier 2. With both off the app is tier 1 only.

## 10. The tested statement

Forward in time, four cutoffs. "Held" = the true later sale price was inside the range, on the sales ACS answered. Stage 5 rule.

| | Tuning cutoffs (2024-11-17, 2025-05-17) | 2025-11-16 | 2026-05-17 | Statement |
|---|---|---|---|---|
| A, ready | 85.0% | 87.0% | 82.9% (1,816 sales) | about 8 of 10 |
| A, off-plan | 81.5% | 88.8% | 85.1% (8,446) | about 8 of 10 |
| B, ready | 84.5% | 89.3% | 85.0% (713) | about 8 of 10 |
| B, off-plan | 88.0% | 92.6% | 90.1% (1,387) | about 8 of 10 |

- `heldOf10 = 8` and `heldLaterOf10 = 8` for every scenario and basis (the lowest share, rounded down).
- The ready level at 2026-05-17 is not a clean test: the stronger ready range was asked for because that cutoff held 77.6%. Its strength was chosen on the tuning cutoffs. 2025-11-16 is clean.
- The range holds less as the data ages: off-plan, 123 to 183 days after the data date: 79.7%; ready 84.9%.
- One cell is weaker: scenario A, ready, other bedrooms lead: 73.5% on 120 sales (0.25% of A). It stays, because its centre is twice as close as the tier-1 median on the same sales (section 12).
- After prices fell (2026-05-17) the misses are one-sided: the true price was under the range for 13.7% of ready A answers and over it for 3.4%.

## 11. Golden cases (regenerated)

| Set | Files | Cases | What it fixes |
|---|---|---|---|
| Reference, stage 5 multipliers | `golden5\artifact.json`, `cases.json`, `expected.json`; `node ref\run_golden.ts golden5` | 91 (41 shown) | `ref\acs.ts` against `acs.py`: 70,234 numbers, largest relative difference 6.2e-15 |
| Production | `prod\acs-model.json`, `prod\cases.json`, `prod\expected.json`; `node prod\run_golden.ts <open-data folder>` | 106 (55 shown, 11 too wide, 11 size, 10 too few, 7 not close, 6 bedrooms, 6 nothing) | `prod\acs-runtime.ts` reading `sales.csv.gz` against `acs.py` with a pool collapsed in one pass: 36,733 numbers, largest relative difference 1.2e-14 |

- Stage 4 to stage 5 on the 91 cases: one answer became "too wide", one verdict changed from below to within. Off-plan multipliers are unchanged.
- The production cases name buildings by `dldKey`. Expected comparables carry the building key, date, bedrooms, size, AED per sq ft, count, ring, both adjustments, the adjusted value and the weight.
- For the repo: copy `prod\acs-model.json`, `cases.json`, `expected.json` as test fixtures (about 0.9 MB + 0.5 MB). The test needs the sales of the buildings the cases use: cut a fixture from `sales.csv.gz` rather than load the whole file in `vitest`.
- Tolerance 1e-9 relative to max(1, |expected|). Strings, booleans and nulls must be equal.

## 12. What to expect after integration (the chain, sale by sale)

"Today" = tier-1 median with the 5% band (A), the shipped tier 2 where it shows a range (B). "Chain" = ACS where it answers, else today's answer. All bedrooms. Errors are typical / 80th percentile.

| | Answered today | Answered by the chain | Given by ACS | Error where today answers: today | chain |
|---|---|---|---|---|---|
| A, four cutoffs | 100% | 100% | 83.7% | 6.01 / 15.17 | 4.99 / 13.01 |
| A, later cutoffs | 100% | 100% | 84.8% | 5.36 / 13.80 | 4.45 / 11.99 |
| A, last cutoff | 100% | 100% | 85.5% | 5.19 / 13.62 | 4.40 / 12.13 |
| A ready, later | 100% | 100% | 68.6% | 8.01 / 17.86 | 6.83 / 16.79 |
| A off-plan, later | 100% | 100% | 90.3% | 4.66 / 12.23 | 3.82 / 10.38 |
| B, four cutoffs | 60.6% | 67.1% | 28.2% | 8.26 / 20.51 | 7.82 / 19.88 |
| B, later cutoffs | 61.5% | 67.3% | 28.7% | 6.96 / 16.98 | 6.74 / 16.34 |
| B, last cutoff | 58.8% | 63.8% | 25.7% | 7.00 / 16.54 | 6.86 / 16.41 |
| B ready, later | 39.2% | 46.5% | 16.8% | 10.00 / 20.81 | 9.51 / 20.20 |
| B off-plan, later | 88.2% | 92.1% | 43.0% | 5.93 / 13.72 | 5.76 / 13.41 |
| A and B, later | 92.3% | 93.4% | 73.6% | 5.92 / 14.73 | 5.16 / 13.27 |

On the sales ACS itself answers (studio to 3-bed): A 4.28 / 10.63 against the tier-1 median 5.28 / 13.02 on the same sales (four cutoffs); later cutoffs 3.84 / 9.71 against 4.73 / 11.65. B, where both answer (8,681 sales): 4.73 / 10.33 against tier 2's 5.44 / 12.22; later cutoffs (4,370): 4.46 / 9.66 against 4.91 / 10.47. B sales only ACS answers (6.7% of B): 6.38 / 13.96, held 84.4%.

**The verdict changes, and not in one direction.** A listing is a held-out sale priced at its true AED per sq ft times a factor. Right = within at the true price, above when priced over it, below when under it. A and B together, later cutoffs:

| Price | Verdict differs from today's | Right today | Right with the chain | Wrong direction today | chain |
|---|---|---|---|---|---|
| true price | 27.4% | 50.6% | 76.5% | | |
| 10% over | 46.5% | 71.6% | 28.5% | 8.3% | 5.8% |
| 10% under | 18.3% | 71.6% | 61.7% | 6.9% | 3.5% |
| 20% over | 17.9% | 88.7% | 72.9% | 3.3% | 2.5% |
| 20% under | 4.2% | 93.2% | 91.2% | 1.8% | 1.2% |

- Today's 5% band calls half of the correctly priced listings above or below. The chain calls a quarter of them so.
- The price of that: a listing 10% over its true price is called "above" 28.5% of the time, against 71.6% today. The ACS range is about 11% wide each way (ready 14%), so a 10% gap is mostly inside it.
- Which is right more often depends on how listings are priced. If listings sit mostly within a few percent of what they sell for, the chain is right more often. If most are 10% or more off, today's rule is. This was not measured: the data has sales, not listings.
- Four cutoffs, the same table: true price 46.9% to 73.7%; 10% over 74.8% to 37.6%; 10% under 65.3% to 56.4%; 20% over 90.2% to 76.4%; 20% under 89.5% to 87.5%.

## 13. Refit (to document in `scripts/model/README.md`)

Scripts to copy from the scratch folder into `scripts/model/acs/`: `lib.py`, `prep.py`, `tindex.py`, `acs.py`, `bt.py`, `full.py`, `cal.py`, `evalx_const.py`, `s4\s4lib.py`, `s5\s5lib.py`, `s5\chain.py`, `s5\e6.py` (tables), `s5\final5.py` and `s5\prod.py` (constants, golden cases), `s5\appkey.py`. They need numpy only.

Steps, one command at a time: build the long-history file from the raw downloads (`prep.py`); `bt.py prep` (artifacts and held-out sales at six cutoffs; not timed in this stage); `full.py` (73 to 109 seconds per cutoff, about 10 minutes); `e6.py`; read the tables; write `src/lib/acs/constants.json`; regenerate the golden cases; `data:build`; tests.

Open for the copy: `prep.py` reads `model\work\units_sales.tsv.gz`, an extract of the raw files made in the data stage. The script that wrote it was not found among the Python files. The refit must read the raw downloads directly, or the extract step must be copied too. The six cutoff dates are fixed strings in `lib.py` and `bt.py`; a refit moves them.

## 14. Not done

- No repository change, no TypeScript port of the build, no migration, no UI.
- The Postgres query was not run or timed.
- Rounding the model's numbers to shrink it further was not tested (it is already 334 KB gzipped).
- Building facts in production must come from all years of the download; the snapshot's `buildings.csv.gz` was not compared with the long-history facts.
- A sale added by an admin is not in the pool. A building with admin sales only gets no ACS answer.
- Copy for the three new kinds of row (section 7.1) and for the statement "about 8 of 10" is not written and not legally reviewed.
