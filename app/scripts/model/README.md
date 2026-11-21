# The similar-buildings model: backtest and refit

These scripts produce the two files the second tier ships with (REAL_DATA.md section 15):

- `src/lib/similar/constants.json`: the fitted values and the rule;
- `src/lib/similar/backtest.json`: the tested numbers the pages and the manifest state.

They read only the committed snapshot (`data/open-data/`) and write to `.data/model/` (ignored by git). No network.

| File | What it does |
|---|---|
| `vlib.py` | The comparison in Python, written from the specification. It matches `src/lib/domain/similar.ts` on the golden cases. |
| `vbt.py` | Backtest library: hides a building, thins it, measures variances and range multipliers. |
| `rule.py` | The refusal rule as the backtest applies it. Keep it in step with `compareSimilar`. |
| `backtest.py` | Runs every test with the shipped constants and rule. Writes `.data/model/backtest-run.json`. About 30 seconds. |
| `served.mjs` | Runs the shipped TypeScript on every too-few combination of the snapshot. Writes `.data/model/served.json`. |
| `backtest-summary.mjs` | Writes `src/lib/similar/backtest.json` from the two files above. No figure is copied by hand. |
| `refit.py` | Measures the fitted values again. Writes `.data/model/constants-refit.json` and prints old against new. It keeps `projectRoute` as it is. |
| `project_route.py` | The project route for buildings not in the data (REAL_DATA.md section 15.8): its out-of-sample backtest at four cutoffs and the fit of its range. Writes `.data/model/project-route.json`, with `passes` (the owner's rule) and the values for `constants.json` `projectRoute`. About a minute. |

## Set up (once)

Python 3.12 with numpy. Nothing else.

```
py -3.12 -m venv .data/model/venv
.data/model/venv/Scripts/python -m pip install numpy
```

## Ordinary data refresh

`npm run data:build` rebuilds the cells. Nothing here needs to run. `data:build` exits with an error when the constants are more than 200 days older than the data: then refit.

## Refit (at least twice a year, and when the rule changes)

Run from the repository root, one command at a time.

1. Build the snapshot: `npm run data:build -- ...` (README.md of the repository).
2. `.data/model/venv/Scripts/python scripts/model/refit.py`. Read the printed old and new values. A value that moves a lot means the market or the data changed.
3. Copy `.data/model/constants-refit.json` over `src/lib/similar/constants.json`.
4. `.data/model/venv/Scripts/python scripts/model/backtest.py`
5. `npx tsx scripts/model/served.mjs`
6. `node scripts/model/backtest-summary.mjs`
7. Read `src/lib/similar/backtest.json`. The copy states `statement.heldOf10` and `statement.heldLaterOf10`. If a number fell, the wording in `src/lib/copy.ts` (`how.similarTested`, "6 to 8 of 10") and REAL_DATA.md section 15.6 must change with it.
8. `npm run data:build -- ...` again, so the manifest carries the new constants and summary.
9. If ranges stored with the old constants must no longer show, raise `SIMILAR_MIN_CONSTANTS_VERSION` in `src/lib/similar/model.ts`.
9a. The project route: `.data/model/venv/Scripts/python scripts/model/project_route.py`. If `passes` is false, take `projectRoute` out of `constants.json` (the route then shows nothing). Otherwise copy `shipped.lowLog`, `shipped.highLog`, `statement.heldOf10` and the `outOfSample` summary into `projectRoute`; if `heldOf10` changed, the tests that pin it change with it.
10. `npx vitest run --maxWorkers=2`, then commit.

A rule change without a refit (as on 19 Nov 2026, version 2) skips steps 2 and 3: edit the rule in `constants.json`, `rule.py` and `compareSimilar`, raise `version`, then steps 4 to 10.

## What is not here

The search that chose this method among other candidates, and the first test on buildings that were not yet in the data (area and community references), were run once (19 Nov 2026) and are written up in the model reports, which are outside the repository. `backtest-summary.mjs` carries their one table (`notInTheData`) forward unchanged. Those classes are never shown. The project route has its own script, above.

# Adjusted registered sales: backtest and refit

The scripts in `acs/` produce the fit the first answer ships with (REAL_DATA.md section 16):

- `src/lib/acs/constants.json`: the method's parameters, the range multipliers, the rule and the tested statement;
- `tests/fixtures/acs/`: the reference model, the golden cases and the inputs of the build parity test.

They read the raw Data.Dubai downloads (outside the repository, read only) and the committed snapshot, and write to `.data/model/acs/` (ignored by git), or to the folder named by the environment variable `ACS_WORK`. No network. Python is a refit tool only: the server and `npm run data:build` run TypeScript.

| File | What it does |
|---|---|
| `acs/lib.py` | Paths, the data date of the fit (`TEND`) and the four test cutoffs (`CUTS`), small helpers. |
| `acs/prep.py` | Reads the raw downloads and applies the product's cleaning rules over every year (the snapshot keeps 36 months; the time index needs 48 and the backtest needs earlier cutoffs). Checks its rows against the committed snapshot. Writes `data.npz`. About 40 seconds. |
| `acs/acs.py` | The method in Python: the model of one data date (`Ctx.build`), the comparison (`gather`, `combine`), the range and the rule (`decide`). The reference of `src/lib/domain/acs.ts` and `src/lib/acs/build.ts`. |
| `acs/tindex.py` | The monthly time index and the segment size slopes. |
| `acs/bt.py` | The backtest plumbing: for each cutoff the model built from the sales before it, and the sales of the 183 days after it as targets, with today's answers (the same-building median; the second tier through `vlib.py`, `vbt.py`, `rule.py`). |
| `acs/full.py` | Runs the method on every target. 73 to 109 seconds per cutoff. |
| `acs/cal.py`, `acs/evalx_const.py`, `acs/s4lib.py`, `acs/s5lib.py` | The range multipliers (fitted forward in time, by kind of evidence), the range constants and the rule. |
| `acs/chain.py`, `acs/e6.py` | The tables: this answer against today's on the same sales, and the chain "this answer first, today's as the fallback" sale by sale. Writes `final5_tables.json`. |
| `acs/make.py` | Writes `constants.json`, the reference model, the golden expectations and the parity inputs. Prints whether the fit changed. |
| `acs/appkey.py` | The app's building key (`dld_key`) in Python. |
| `acs/golden-sales.ts` | Cuts `tests/fixtures/acs/golden-sales.csv.gz` (the sales the golden cases read) from the snapshot. |

Python 3.12 with numpy, as above (the same venv serves).

## Ordinary data refresh

`npm run data:build` rebuilds the model's snapshot statistics (time index, size slopes, project families) in TypeScript and writes `acs-model.json.gz` with the fit of `constants.json`. Nothing here needs to run. `data:build` exits with code 2 when the fit is more than 200 days older than the data: then refit. After a refresh the golden test keeps running on its frozen fixtures; the build parity test skips itself (its Python model is of the fit's snapshot).

## Refit (at least twice a year, and when the method or the rule changes)

Run from the repository root, one command at a time. `PY` is `.data/model/venv/Scripts/python`.

1. Build the snapshot: `npm run data:build -- ...` (README.md of the repository). It may exit with code 2 (the old fit); go on.
2. Move the dates: `TEND` in `acs/lib.py` is the snapshot's `dataThrough`; `CUTS` are the four dates 732, 549, 366 and 183 days before it; `PRE` in `acs/bt.py` are the two dates 1,095 and 912 days before it. The first two of `CUTS` are the tuning cutoffs: choose rules on them only.
3. `PY scripts/model/acs/prep.py <the .csv files given to data:build, in that order>`. The printed snapshot check must show `mine_not_snapshot` 0 and `snapshot_not_mine` 0.
4. `PY scripts/model/acs/bt.py prep` (all six cutoffs; a few seconds each).
5. `PY scripts/model/acs/full.py` (about 10 minutes for the six cutoffs).
6. `PY scripts/model/acs/e6.py > .data/model/acs/e6_out.txt`. Read the tables: the held shares by date, the errors against today's answers, the verdict table. A share that fell, or a group under 78%, is a reason to stop and look.
7. `PY scripts/model/acs/make.py --version <the next version>`. It prints whether the parameters, the range and the tested statement changed, and the count of golden cases by outcome.
8. Copy `.data/model/acs/constants.json` over `src/lib/acs/constants.json`. Copy `acs-model.json.gz`, `expected.json.gz`, `cases.json`, `older-sales.csv.gz` and `families.json.gz` from `.data/model/acs/` into `tests/fixtures/acs/`.
9. `npx tsx --conditions=react-server scripts/model/acs/golden-sales.ts`
10. `npm run data:build -- ...` again, so the model file and the manifest carry the new fit.
11. The copy states `tested.heldOf10` ("about 8 of 10": `acs.tested`, `how.acsTested`). If it changed, the wording in `src/lib/copy.ts`, DESIGN.md section 6.17 and REAL_DATA.md section 16.7 changes with it, and so do the numbers the tests pin (`tests/unit/domain/acs-golden.test.ts`, `tests/db/acs.test.ts`, `tests/db/e2e-snapshot.test.ts`).
12. The build parity test, once: `$env:ACS_PARITY = "1"; npx vitest run tests/unit/acs/build-parity.test.ts` (PowerShell). Then `npx vitest run --maxWorkers=2`, and commit.
13. If ranges stored with the old fit must no longer show, raise `ACS_MIN_CONSTANTS_VERSION` in `src/lib/acs/model.ts`.

## What was checked on 19 Nov 2026, and what was not

- `prep.py` on the two raw files gives the same `data.npz` as the run the fit was made on, array for array.
- `bt.py prep` and `full.py` on one cutoff (2026-05-17) give the same result file as that run, array for array. The other five cutoffs and `e6.py` were not run again from this folder.
- `make.py` on that run's result files gives the committed `constants.json` and the committed fixtures, value for value.
- Not here: the search that tuned the method's parameters (its result is `acs.P0`), the stress tests and the independent re-implementation. They are written up in the model reports, outside the repository.
- `prep.py` does not mirror rule 9 (a transaction id kept twice); the files of 19 Nov 2026 have none, and its snapshot check fails when a later download does.

# Nearby registered sales: backtest and refit

The scripts in `nearby/` produce the fit the last resort ships with (REAL_DATA.md section 17). The method is written in `nearby/SPEC.md`.

- `nearby/constants.json`: the method's parameters, the rule, the building-age curves, the range multipliers and the tested statement (nominal 80%, `tested.heldOf10` 7). The app reads its copy, `src/lib/nearby/constants.json`. `nearby/constants-nominal87.json` is a wider variant that is not used.
- `nearby/golden.json`: 42 cases of the Python reference on the committed snapshot; `nearby/cases.json`: the worked cases.
- `tests/fixtures/nearby/`: the golden cases with the rows they read.

**The backtest needs the work folder of the adjusted-registered-sales backtest** (`.data/model/acs/` or `ACS_WORK`: `data.npz` and `bt/ctx_<cut>.pkl`, made by steps 1 to 4 of the refit above). `make.py` alone reads only the committed snapshot and `.data/model/nearby/final.json`.

| File | What it does |
|---|---|
| `nearby/nlib.py` | Backtest library: the pool at a cutoff, the fit of the building-age curve, the vectorised method, the targets. |
| `nearby/run.py`, `nearby/variants.py` | Run named variants on every target cell of a cutoff. |
| `nearby/ana.py`, `nearby/ana2.py`, `nearby/cause.py`, `nearby/strata.py` | Error tables; where the low bias comes from. |
| `nearby/explore_cal.py`, `nearby/explore_scale.py` | The choice of the range's scale and groups (on the tuning cutoffs). |
| `nearby/fin.py`, `nearby/final.py` | The chosen method, the rule, the forward calibration, the tables. Writes `.data/model/nearby/final.json`. |
| `nearby/make.py` | The reference implementation (`nearby()`), the constants, the golden cases and the worked cases. |
| `nearby/golden-fixture.ts` | Cuts `tests/fixtures/nearby/` (the golden cases, the time index and size slopes, the rows the cases read) from the committed snapshot. |

## Ordinary data refresh

Nothing here needs to run: the method reads the `sales` and `buildings` tables and the time index and size slopes of `acs-model.json.gz`. `npm run data:build` exits with code 2 when the data date is more than 200 days after `fittedOn` of `src/lib/nearby/constants.json`: then refit.

## Refit (with the refit of adjusted registered sales)

`PY` is `.data/model/venv/Scripts/python`. After steps 1 to 4 of that refit:

1. `PY scripts/model/nearby/run.py f` (about 2 minutes per cutoff).
2. `PY scripts/model/nearby/final.py`. Read the shares held by group in `.data/model/nearby/final.json`.
3. `PY scripts/model/nearby/make.py`. It writes `constants.json`, `golden.json` and `cases.json` in `scripts/model/nearby/` and prints the largest difference between the reference and the backtest code.
4. Copy `scripts/model/nearby/constants.json` over `src/lib/nearby/constants.json` (raise `version` when ranges must be told apart).
5. `npx tsx --conditions=react-server scripts/model/nearby/golden-fixture.ts`
6. `tested.heldOf10` is the number the pages state. It is read from the constants; if it changed, read DESIGN.md section 6.18 and REAL_DATA.md section 17.8 again.
7. `npx vitest run --maxWorkers=2`, then commit. If ranges stored with the old constants must no longer show, raise `NEARBY_MIN_CONSTANTS_VERSION` in `src/lib/nearby/model.ts`.

Not run again on 20 Nov 2026: the backtest (`run.py`, `final.py`, `make.py`). The TypeScript was checked against the committed `golden.json` only.
