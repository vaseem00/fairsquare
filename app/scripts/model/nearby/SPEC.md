# Nearby registered sales: implementation spec

The last-resort comparison for a listing whose own building gives no usable evidence. It runs only after every other
answer declined. Reference implementation: `nearby()` in `make.py` (plain loops, written from this text). Fitted numbers:
`constants.json` (nominal 80%, "about 7 of 10") or `constants-nominal87.json` (wider range, "about 8 of 10").
Golden cases: `golden.json` (42 cases, values to 6 significant figures, computed on the committed snapshot of 2026-11-16).

## 1. Inputs

| Input | Meaning |
|---|---|
| `bedrooms` | 0 to 7 |
| `basis` | `ready` (0) or `off_plan` (1) |
| `sizeSqft` | the listing's size |
| `askingPsf` | optional; asking price / size |
| `buildingId` | the listing's building when it is in the data, else none. Sets `kind`: `in` or `out` |
| `master` | community = `buildings.master_project`. For kind `in`: the building's own. May be unknown |
| `area` | `buildings.area_dld`. For kind `in`: the building's own. May be unknown |

From the ACS model file (`acs-model.json.gz`, already loaded by the server): `T` (data date as days since 2020-01-01),
`areas`, `theta["<area index>|<basis>"]` (48 monthly values), `tau[basis]`, `seg[basis][min(bedrooms, 4)]`.

## 2. The one read

```sql
select s.external_ref, s.sale_date, s.size_sqft, s.price_aed, s.building_id,
       b.name, b.area_dld, b.master_project, b.first_sale_date, b.first_ready_sale_date
from sales s join buildings b on b.id = s.building_id
where s.source = 'open_data'
  and s.bedrooms = :bedrooms and s.completion = :basis
  and s.sale_date > :dataDate::date - 730 and s.sale_date <= :dataDate
  and (b.area_dld = :area or b.master_project = :master)      -- an unknown one never matches; an empty master_project never matches
  and (:buildingId is null or s.building_id <> :buildingId)
```

Own-building sales are never comparables. `inCommunity` = `master` is known and `b.master_project = master`.
`inArea` = `area` is known and `b.area_dld = area`.

## 3. One pass: `estimate(rows, levelWeight)`

Constants are `params` in `constants.json`. `L = ln(sizeSqft)`. For each row:

1. `ageMonths = (T - day) / 30.4375`; `mo = min(floor((T - day) / 30.4375), 47)`.
2. `timeLn = th[0] - th[mo]`, `th = theta[index of the ROW's area_dld | basis]`, or `tau[basis]` when that key is absent.
3. `psf = price_aed / size_sqft`; `lsr = L - ln(size_sqft)`; `sizeLn = seg[basis][min(bedrooms, 4)] * lsr`.
4. Building age of the row, in years: off-plan `(T - first_sale_date) / 365.25`; ready `(T - first_ready_sale_date) / 365.25`.
   A missing date counts as age 0 in the curve (step 5), and as 50 (off-plan) or 0 (ready) in the kernel (step 7).
5. `vintageLn = gT - g(row age)` when the vintage adjustment is on, else 0. `g` = the curve `vintage` of the basis:
   linear between the listed ages, flat outside them. The adjustment is on for kind `in`, and for kind `out` off-plan.
   It is off for kind `out` ready. `gT = g(listing age)`:
   - kind `in`, off-plan: the building's age from `first_sale_date`;
   - kind `in`, ready: its age from `first_ready_sale_date`, 0 when it has none;
   - kind `out`, off-plan: 0 (taken as a new launch).
6. `a = ln(psf) + timeLn + sizeLn + vintageLn`.
7. `u = levelWeight * 0.5^(ageMonths / ageHalfMonths) * 0.5^((lsr / sizeHalf)^2)`.
   Kind `in` only: `u *= 0.5^(|row age - listing age| / vintageHalfYears)`; for a ready listing only when the listing's
   building has a `first_ready_sale_date`.
8. Drop rows with `u <= 0`. No row left: the pass has no result.
9. Cap per building: `tot_b = sum of u`; when `tot_b > cap`, multiply that building's `u` by `cap / tot_b`.
   `W_b = min(tot_b, cap)`. `W = sum of W_b`. `buildings = count of W_b >= countWeight * cap`.
10. Sort rows by `a` ascending; ties by `u` ascending. Weighted quantile `wq(p)`: `P_i = (cumsum(u)_i - u_i / 2) / sum(u)`;
    `p <= P_first` gives the first `a`, `p >= P_last` the last, else linear interpolation between the two neighbours
    (`j` = first index with `P_j > p`; between `j - 1` and `j`). `centre = wq(0.5)`, `q10 = wq(0.1)`, `q90 = wq(0.9)`.
11. `sizeDistance = sum(u * |lsr|) / sum(u)`.

## 4. Scope

- `master` known: pass 1 on the `inCommunity` rows, `levelWeight = 1`. Scope `community`.
  When pass 1 has no result or `buildings < minCommunityBuildings`, and `area` is known: pass 2 on the rows that are
  `inCommunity` or `inArea`, `levelWeight = 1` for `inCommunity` rows, `areaWeight` for the rest. Scope `community_and_area`.
- `master` unknown, `area` known: one pass on the `inArea` rows, `levelWeight = 1`. Scope `area`.
- No result: refusal `no_comparables`.

## 5. Range

- Group = `R` (ready) or `O` (off-plan), then the first class that applies: `t` when `buildings < thinBuildings`;
  `b` when `bedrooms = 3`; scope `community`: `c0` when `sizeDistance < far[0]`, `c1` when `< far[1]`, else `c2`; else `a`.
- `[qLow, qHigh] = range[kind][group]`.
- `sLow = sqrt(max(centre - q10, floor))`, `sHigh = sqrt(max(q90 - centre, floor))`.
- `low = centre - qLow * sLow`, `high = centre + qHigh * sHigh` (ln). `halfWidth = (exp(high) - exp(low)) / (2 * exp(centre))`.

## 6. Refusal, first that applies

| Reason | Test |
|---|---|
| `no_comparables` | no pass gave a result |
| `bedrooms_not_validated` | `bedrooms > maxBedrooms` (3) |
| `too_few_buildings` | `buildings < minBuildings` (3) or `W < minWeight - 1e-9` (1) |
| `size_too_far` | `sizeDistance > maxSizeDistance` (0.5) |
| `no_calibration` | the group has no multipliers |
| `range_too_wide` | `halfWidth > maxHalfWidth` (0.5) |

Shown: `rangeLowPsf = floor(exp(low) / 10 + 0.5) * 10`, same for high. `ask = floor(askingPsf + 0.5)`.
`above` when `ask > rangeHighPsf`, `below` when `ask < rangeLowPsf`, else `within`.

## 7. Output

`kind, shown, reason, scope, group, centrePsf = exp(centre), lowPsf, highPsf, halfWidth, rangeLowPsf, rangeHighPsf, verdict,
buildings, weight = W, comparables (rows with weight), sizeDistance`.

Per comparable, largest `u` first (ties: `external_ref` ascending): `ref, building, date, sizeSqft, registeredPsf, timeLn,
sizeLn, vintageLn, adjustedPsf = exp(a), weightShare = u / sum(u), inCommunity`. Show the adjustments as percentages:
`exp(x) - 1`. Per building: `weightShare = sum of its u / sum(u)`.

## 8. Refresh and refit

- **Each data refresh:** nothing to build. The method reads `sales`, `buildings` and the time index and size slopes that
  `npm run data:build` already rebuilds into `acs-model.json.gz`.
- **Constants** (`vintage`, `range`, `tested`) come from a refit. They expire with the ACS fit: refit when the data date
  is more than 200 days after `fittedOn`. Do not serve when today is more than 122 days after the data date (the ACS
  rule); the range was tested on sales up to 183 days after the data date.
- **Refit** (after the ACS refit steps 1 to 4 of `scripts/model/README.md`, which make `data.npz` and `bt/ctx_<cut>.pkl`):
  1. `PY scripts/model/nearby/run.py f` (about 2 minutes per cutoff).
  2. `PY scripts/model/nearby/final.py` writes `.data/model/nearby/final.json`. Read the shares held by group.
     Optional: `NEARBY_NOM=0.87` writes `final_87.json`.
  3. `PY scripts/model/nearby/make.py` writes `constants.json`, `golden.json`, `cases.json` here and prints the largest
     difference between the reference and the backtest code (4e-14 on 2026-11-16).
- `tested.heldOf10` is the number the page may state. If it changes, the copy changes.

## 9. Files

| File | What it does |
|---|---|
| `nlib.py` | Backtest library: the pool at a cutoff, the vintage curve fit, the vectorised method, targets |
| `run.py`, `variants.py` | Run named variants on every target cell of a cutoff |
| `ana.py`, `ana2.py`, `cause.py`, `strata.py` | Error tables; where the low bias comes from |
| `explore_cal.py`, `explore_scale.py` | The choice of the range's scale and groups (tuning cutoffs) |
| `fin.py`, `final.py` | The chosen method, the rule, the forward calibration, the tables |
| `make.py` | The reference implementation, constants, golden cases, worked cases |
