# Adjusted comparable sales (ACS): exact spec and backtest

19 Nov 2026. Stage 5 (after the second independent re-verification; section 11). Sections 1 to 10 are the stage 4 record with the wording fixes listed in section 11.2; the numbers of section 6 are the stage 4 rule (ready flats at a nominal 80%). Scratch folder `model\acs\`.

This file is the technical record. The owner's summary is `ACS_REPORT.md`. The stage 2 text is superseded; its code and results are kept in `stage2_backup\`.

## 1. What changed in stage 4

| # | Finding (stage 3) | Confirmed? | What was done |
|---|---|---|---|
| 1 | Backtest and reference code used different evidence classes | Yes. 0.6% to 1.2% of estimates per cutoff differ (204 to 416 B sales per cutoff). B class counts 16,577 / 11,248 / 4,270 with the reference rule against 15,442 / 11,860 / 4,793 with the old `cal.py` rule | One function, `acs.ev_class` (arrays: `acs.ev_class_vec`), is used by the reference, the calibration, the backtest and the audit. Multipliers refitted, artifact and golden cases rebuilt. 20,000 random estimates: 0 mismatches between the two forms |
| 2 | The community gate was decided by rounding | Yes. 206 to 1,340 targets per cutoff have rings 1 to 3 at 0.5 within 1e-9. A second case was found: total weight exactly 1.0 from two capped sibling buildings (85 to 1,402 targets per cutoff, 25 to 678 of them below 1.0 by rounding) | Both tests now use a tolerance of 1e-9 (`gate4 - 1e-9`, `minWeight - 1e-9`), in Python and TypeScript. Four boundary cases are in the golden set. Centres changed for 20 to 269 targets per cutoff, all refused |
| 3 | MODEL.md was not enough to reproduce the method | Yes | Sections 2 to 4 below now define the index, the slopes, the family, the calibration, the encodings and the reason strings. The file is on disk |
| 4 | Error measure not defined | Yes | Section 5 |
| 5 | "No size" ablation kept the cross-bedroom size term | Yes | Column renamed "no same-bedroom size slope"; new column "no size term at all" (B: 9.95 / 22.08 against 7.24 / 16.67) |
| 6 | "Nearest ring" rows were the evidence class | Yes | Relabelled "leading ring (evidence class)" |
| 7 | The family definition changes scenario C | Not re-tested | The definition is now written down (section 2.2). C is a no-go, so the product's resolver was not tested |
| 8 | Stale defaults in `acs.P0` | Yes | `P0` now holds the tuned values |
| 9 | Decision test was not at equal false-flag rates (audit) | Yes | Section 6.6 compares ACS with a tier-1 median that has its own calibrated range |
| 10 | Coverage under 80% in real groups (audit) | Yes, on the two tuning cutoffs: class 3 held 73.4% (ready 72.5%), weight 1 to 2 held 69.6%, no own comparable 68.0% | Rule tightened, chosen on the two tuning cutoffs only (section 4.3). No Mondrian group with 100+ shown sales is under 78% over the four cutoffs any more (lowest 78.1%) |
| 11 | Developer re-pricing pockets (audit) | Yes. 7 pockets with 40+ shown sales held under 50%, all off-plan at 2025-05-17, 805 sales (1.42% of shown) | Cannot be fixed from sales data. Stated in the report |
| 12 | Dependence on fresh sales (audit) | Yes. With the last 30 days of comparables removed: A shown 86.6% to 75.6%, B 32.7% to 18.6%; range still held 83.8% | Stated. A second download is needed to measure the real lag |
| 13 | Cleaning sees the future (audit) | Not re-run. Audit: coverage 83.74% to 83.50% with the removed block sales added back | Stated |
| 14 | B centre is not stable at the last cutoff (audit) | Yes. Both shown, last cutoff: ACS 5.19 against shipped 5.35, ACS bias -1.95% | Stated. The B recommendation claims the range, not the centre |

The rule changes of row 10 were motivated by audit tables that included the two clean cutoffs. The choice among candidates used the tuning cutoffs only (`s4\c2_out.txt`, `s4\c3_out.txt`). The clean cutoffs are therefore clean for the hyper-parameters and for the choice of thresholds, but not blind to the fact that a tightening was needed.

## 2. Exact spec

Authoritative code: `acs.py` (Python) and `ref\acs.ts` (TypeScript, per request). Both produce the same numbers on the 91 golden cases (70,236 numbers, largest relative difference 6.2e-15).

### 2.1 Request

Building index `b` (or -1 with a project family `fam` and a community `master`), bedrooms (0 = studio), basis (0 ready, 1 off-plan), size in sq ft, asking AED per sq ft (optional). The data date T is the artifact's.

### 2.2 Artifact, built once per data date T (`Ctx.build`)

Days are counted from 2020-01-01. A month is 30.4375 days.

1. **Pool**: kept flat sales with T-1095 < day <= T (day T-1095 itself is out).
2. **One-price batches**. Inside building x basis, sort AED/sq ft ascending. A cluster is a run of values <= 1.001 x the run's lowest value. A cluster is a batch when it has 5+ rows, the rows are unlike units (more than one bedroom count, or largest size > 1.05 x smallest size) and they fall on 3 or fewer distinct days. Each batch becomes one row per bedroom count, from the rows of the batch with that bedroom count: day = their latest day, size = their median size, psf = their median psf, cnt = their number.
3. **Exact duplicates** (building, day, bedrooms, basis, size to 0.01, price to AED 1) become one row, cnt = rows.
4. **Pool order**: original row order; a batch row takes the position of the first of its rows. In production the original order is the snapshot file's: ascending `ref` (section 11.4).
5. **Segment slope** `seg[basis][min(bed,4)]` (`tindex.fit_slopes`): sales of the 1,095 days to T, not collapsed. Groups = building x bedrooms x basis x half-year, half-year = floor((T - day) / 183). Regress ln psf on ln size after removing group means. One robust pass: drop rows with |residual| > 4 x 1.4826 x median |residual|, recompute group means on the kept rows, refit. A segment with under 200 rows takes the slope of the next smaller bedroom count.
6. **Time index** (`tindex.Index`, k = 20, smoothing 50, 48 months): sales with T - round(48 x 30.4375) < day <= T, not collapsed. Month m = min(floor((T - day) / 30.4375), 47); month 0 ends at T.
   - Cell = building x bedrooms x basis. y = ln psf - seg x (ln size - mean ln size of the cell).
   - Dubai x basis: month effects tau with cell fixed effects absorbed (minimum-norm solution, then tau[0] = 0).
   - Robust pass: residual = y - tau, demeaned by cell; rows with |residual| > 4 x 1.4826 x median |residual| get weight 0; tau is solved again.
   - Area x basis: deviation d from tau, solved from (A + k I + lam D'D) d = rhs, where A and rhs are the within-cell normal equations after removing tau, I the identity (shrinks to Dubai: k is in sales per month), D the first-difference matrix (random-walk smoothing).
   - theta[area x basis] = tau[basis] + d. The artifact stores theta under the key `"<area index>|<basis>"` and tau as the fallback.
   - Time adjustment of a sale (ln) = theta[0] - theta[m], with the sale's own area and basis.
7. **Cell slope statistics**, on the pool: x = ln size, y = ln psf, as deviations from the mean of cell x floor((T - day) / 183). Per cell: sxx = sum x^2, sxy = sum x y. Cells with sxx <= 1e-12 are left out. Key = (b x 8 + bed) x 2 + basis.
8. **Other-bedrooms fit**, per basis, on the pool: ln psf = effect(building x half-year) + prem[min(bed,4)] + beta2 x ln size, prem[0] = 0. One robust pass (drop |residual| >= 4 x 1.4826 x median |residual|), then refit on the kept rows with the group means of the first pass (they are not computed again).
9. **Building facts**: DLD area, community (master project) and project family per building.
   - **Project family**: take the building's most common project name and project number. Normalise the name (lower case, accents removed, "&" to "and", punctuation to spaces). Strip trailing phase markers: any run of " [phase] <number | roman numeral i/v/x | single letter a to h>". When something was stripped and at least 2 words other than the, a, an, of, by, at, and remain, the family is "stripped name | DLD area". Otherwise the family is the project number. No project number: family 0 (none).
   - These facts come from the long-history file, not from the snapshot's buildings file.

Artifact JSON (`Ctx.dump`): `version, dataThrough, T, params, range, pool {day, b, bed, basis, size, psf, cnt}, buildings {area, master, fam}, tau[2][48], theta {"area|basis": [48]}, seg[2][5], cellSlope {key, sxx, sxy}, beta2[2], prem[2][5], names {buildings, areas, masters, fams}`.

### 2.3 Comparables (`gather`)

L = ln(listing size). For a pool row c: lsr = L - ln(size_c), so exp(lsr) = listing size / sale size. age = (T - day_c) / 30.4375.

| Ring | Rows | Size limits on exp(lsr) |
|---|---|---|
| 1 | same building, bedrooms, basis | 0.67 to 1.5 |
| 3 | same project family (> 0), same bedrooms and basis, other building | 0.67 to 1.5 |
| 2 | same building and basis, another bedroom count (the counts as registered differ); the two counts, each capped at 4, are at most 2 apart (a 5-bed listing takes 4-bed sales with a difference of 0) | 0.4 to 2.5 |
| 4 | same community (> 0), same bedrooms and basis, other building, other family (or family 0) | 0.67 to 1.5 |

In each ring keep the 150 latest rows (ties: pool order). Gather order is ring 1, 3, 2, 4, latest first inside a ring. Typical size = the median size of all pool rows of the listing's building x bedrooms x basis, before the size limits.

### 2.4 Adjusted value (ln AED per sq ft)

a = ln psf_c + time_c + size_c

- Ring 1: size_c = beta1 x lsr, beta1 = clamp((sxy + 0.03 x seg) / (sxx + 0.03), -1, 0.2); seg when the cell has no statistics.
- Rings 3 and 4: size_c = seg x lsr.
- Ring 2: size_c = beta2 x lsr + prem[listing bedrooms] - prem[sale bedrooms].

### 2.5 Weights

- Base: ring 1 = 1; ring 3 = 0.3; ring 2 = 0.3 (0.09 when 2 bedrooms apart); ring 4 = 0.03.
- Rings 1, 3, 4: x 0.5^((|lsr| / 0.2)^2). All rings: x 0.5^(age / 8).
- Cap: in ring 3 and in ring 4, one other building has at most 0.5 in total (scale its rows down).
- Community gate: when rings 1 to 3 together have 0.5 - 1e-9 or more, ring 4 gets weight 0.
- Budget: sort by weight, largest first (stable: ties keep gather order); row i gets min(u_i, max(8 - sum of the weights before it, 0)). Rows with weight 0 are dropped. W = total weight (at most 8).

### 2.6 Centre

Weighted median with the midpoint rule (`wq`): the comparables stay in gather order after the budget; sort by a (stable, so equal values keep gather order); p_i = (cumulative weight_i - weight_i / 2) / W; interpolate a linearly over p; flat outside the first and last p. Comparison price = exp(centre).

### 2.7 Range (`decide`)

- neff = W^2 / sum(w^2). disp = (wq(0.75) - wq(0.25)) / 1.349.
- Scale s = sqrt(0.05^2 + (neff x disp^2 + 3 x 0.07^2) / (neff + 3)).
- **Evidence class**: 1 when ring 1 has at least half of W. Otherwise the ring with the largest weight (ties: order 1, 3, 2, 4). For a building not in the data: 5 when that ring is 3, else 6.
- **Group** = basis | class | thin | old | far. thin: W < 4. old: weighted mean age > 12 months. far: weighted mean |lsr| over rings 1, 3, 4 (ring 2 left out) > ln 1.15.
- Multipliers [qlo, qhi] come from the group; when the group has none, from the key without its last part, down to basis | class. Output `group` is the full key, `groupUsed` the key that supplied the multipliers.
- Range (ln) = [centre - qlo x s, centre + qhi x s]. Half-width = (exp(high) - exp(low)) / (2 exp(centre)).

### 2.8 Refusal, first that applies

| Order | Test | Reason string |
|---|---|---|
| 1 | no comparable with weight | `no_comparables` |
| 2 | more than 3 bedrooms | `bedrooms_not_validated` |
| 3 | class 3, 4 or 6 | `no_close_comparables` |
| 4 | fewer than 3 comparables; or W < 1 - 1e-9; or, building in the data: W < 2 - 1e-9 or no ring-1 comparable with weight | `too_few_comparables` |
| 5 | weighted mean \|lsr\| (rings 1, 3, 4) > ln 1.15; or listing size / typical size outside 0.7 to 1.6 | `size_too_far` |
| 6 | no multipliers for the group | `no_calibration` |
| 7 | half-width over 20% | `range_too_wide` |

Shown range: each end rounded to AED 10 (half to even). The asking price is above, below or within that rounded range.

Stage 4 changed rows 3 to 5: class 3 was shown, the minimum weight was 1 for every building, an own comparable was not required, and the size-gap limit was 0.2.

### 2.9 Parameters

`nmax 150, size_lo 0.67, size_hi 1.5, age_half 8, size_half 0.2, W0 8, r3 0.3, r2 0.3, r4 0.03, bed2 0.3, lam 0.03, cap 0.5, slope_lo -1, slope_hi 0.2, gate4 0.5`.

Range constants: `floor 0.05, d0 0.07, k0 3, thinW 4, oldAge 12, farLsr ln 1.15`. Rule: `minComps 3, minWeight 1, minWeightKnown 2, minOwn 1, maxLsr ln 1.15, typLo 0.7, typHi 1.6, maxHalfWidth 0.20, maxBedrooms 3, refuseClasses [3, 4, 6], rounding 10`.

## 3. Calibration of the range (`cal.py`)

- Normalised split conformal with Mondrian groups. Score z = (ln truth - centre) / s.
- For a test cutoff T the calibration rows are the targets of earlier cutoffs with sale day <= T, studio to 3-bed, with an estimate. Refused rows are included.
- Row weights: scenario A rows weigh (all A targets of the cutoff / 12,000 sampled); B and C rows weigh 1.
- Quantile: weighted, not interpolated: sort z, take the first value whose cumulative weight reaches p x total.
- qlo = -(10th point of z), qhi = 90th point of z, per group and for each shorter key. A key needs 300 rows. Stage 5: for ready flats (keys that start with `0|`) the points are the 7.5th and the 92.5th (nominal 85%); off-plan keeps 10 and 90. The artifact carries `range.nominal = [0.85, 0.80]`.
- Drift guard: each side takes the largest of the pooled value and the value of each calibration cutoff that has 150+ rows in the group. Negative multipliers are set to 0.
- The artifact at 16 Nov 2026 uses all six cutoffs. The backtest never used those multipliers.

## 4. How it was tested

### 4.1 Design

- Six cutoffs: 2023-11-17, 2024-05-18 (calibration only), 2024-11-17, 2025-05-17, 2025-11-16, 2026-05-17 (tested). Each has 183 days of later sales as targets.
- At each cutoff the pool, the index, the slopes and the batches use sales up to the cutoff only. `full.py` asserts that every pool day is on or before the cutoff and every target day is after it. A same-day one-price sibling of a held-out sale can therefore never be a comparable.
- Scenarios: A = the type has 5+ kept sales with T - 365 <= day <= T, both ends in (the product's window; tier 1 today). B = the building is in the data, the type has 0 to 4 (tier 2 today). C = the building has no kept sale in the 36 months to the cutoff. Shares of the 280,010 held-out sales: 55.1% / 14.3% / 30.6%.
- A is a random 12,000 per cutoff, weighted back where scenarios are pooled. B and C are complete.
- Baselines on the same sales: the tier-1 12-month median; the shipped tier-2 centre, range and rule (`scripts/model` code, shipped constants, fitted on data to 16 Nov 2026, which favours the shipped model); the project route with the shipped range and this stage's family.

### 4.2 What was chosen where

- Hyper-parameters: coordinate search on 2023-11-17, 2024-05-18, 2024-11-17, 2025-05-17 (`tune.py`). The surface is flat (objectives 0.1497, 0.1508, 0.1500 for three weighting schemes); the search stopped after two rounds.
- Range design and stage 2 thresholds: 2024-11-17 and 2025-05-17 (`ex2.py`, `ex3.py`).
- Stage 4 thresholds: 2024-11-17 and 2025-05-17 (`s4\c2_explore.py`, `s4\c3_explore.py`).
- 2025-11-16 and 2026-05-17 were used for no choice.

### 4.3 The stage 4 rule choice (tuning cutoffs only)

| Rule | A shown | B shown | B on shown | B held | Groups (100+ shown) under 78% |
|---|---|---|---|---|---|
| Stage 2 rule | 88.0% | 45.3% | 6.14 / 14.08 | 81.4% | 5: ready far 76.0%, ready class 2 75.2%, ready class 3 71.7%, off-plan thin 75.3%, off-plan thin far 77.2% |
| + class 3 refused | 87.7% | 40.1% | 5.99 / 13.65 | 82.5% | 4 |
| + minimum weight 2 | 87.7% | 34.9% | 5.72 / 12.90 | 84.2% | 2 |
| + size gap limit ln 1.15 | 85.9% | 33.9% | 5.67 / 12.76 | 84.5% | 1 |
| + own comparable required, weight 2 for known buildings only (final) | 85.9% | 32.9% | 5.59 / 12.61 | 84.9% | 1: ready class 2, full weight, 75.6% (936) |

Tried and not taken: far threshold 0.05 or 0.08 (new failing groups); multipliers from eligible rows only (off-plan class 2 thin fell to 70.8%); typical-size limit 1.4 (no gain).

## 5. Error measure

e = ln(true AED per sq ft) - ln(prediction). "Typical" = exp(median |e|) - 1, the larger of the two ratio errors. The 80th and 90th percentiles use the same form. Bias = exp(median e) - 1; positive means the prediction is too low. With |prediction / truth - 1| the figures are about 0.2 to 0.3 points lower for every method.

## 6. Results (four test cutoffs; `s4\final_eval_out.txt`, `s4\final_tables.json`, `bt\eval_out.txt`)

Errors are typical / 80th / 90th percentile, then bias.

### 6.1 Scenario A: 5+ same-type sales in 12 months

| Group | Sales | Tier-1 median | ACS, all | ACS shown | ACS on shown | Tier-1 on the same | Held | Half-width |
|---|---|---|---|---|---|---|---|---|
| All, studio to 3-bed | 47,840 | 6.01 / 15.17 / 22.72, +1.2 | 4.84 / 12.32 / 19.38, +0.3 | 86.5% | 4.37 / 10.84 / 16.35 | 5.41 / 13.29 / 19.61 | 83.6% | 10.9% |
| Ready | 13,972 | 9.04 / 19.55 / 27.70, +3.7 | 6.67 / 15.24 / 22.66, +0.8 | 76.8% | 5.95 / 13.22 / 19.45 | 8.20 / 17.32 / 23.93 | 81.1% | 12.9% |
| Off-plan | 33,868 | 4.98 / 12.93 / 19.97, +0.6 | 4.17 / 10.98 / 17.37, +0.2 | 90.6% | 3.85 / 9.89 / 15.09 | 4.64 / 11.68 / 17.48 | 84.4% | 10.3% |
| Tuned cutoffs | 23,894 | 6.74 / 16.42 / 24.88 | 5.30 / 13.19 / 20.89 | 85.8% | 4.89 / 11.82 / 18.21 | 6.09 / 14.70 / 21.55 | 81.6% | 10.6% |
| Clean cutoffs | 23,946 | 5.35 / 13.79 / 20.80 | 4.36 / 11.33 / 17.64 | 87.3% | 3.91 / 9.93 / 14.86 | 4.80 / 11.87 / 17.65 | 85.5% | 11.1% |
| Last cutoff | 11,983 | 5.18 / 13.62 / 21.01, -0.6 | 4.36 / 11.54 / 17.77, -0.8 | 87.8% | 3.90 / 10.11 / 15.22 | 4.68 / 11.81 / 18.14 | 83.6% | 11.0% |
| Last cutoff, ready | 2,710 | 8.24 / 18.34 / 26.05, -3.7 | 6.89 / 15.57 / 22.22, -2.8 | 76.5% | 6.33 / 13.97 / 19.24 | 7.30 / 15.52 / 21.33 | 77.6% | 13.3% |
| Last cutoff, off-plan | 9,273 | 4.52 / 12.08 / 19.20 | 3.77 / 10.29 / 15.97 | 91.1% | 3.48 / 9.21 / 13.77 | 4.18 / 10.87 / 16.84 | 85.1% | 10.6% |
| Size under 0.8x typical | 714 | 13.25 / 30.04 / 47.87, +9.7 | 6.20 / 18.56 / 33.63, -0.4 | 40.9% | 4.24 / 10.10 / 16.75 | 10.85 / 27.65 / 50.72 | 86.3% | 11.1% |
| Size 0.8 to 1.25x | 44,955 | 5.75 / 14.34 / 21.27, +1.4 | 4.76 / 12.01 / 18.64, +0.3 | 89.2% | 4.38 / 10.85 / 16.32 | 5.31 / 13.02 / 19.12 | 83.5% | 10.9% |
| Size 1.25 to 1.4x | 1,305 | 11.11 / 23.51 / 32.29, -7.5 | 5.44 / 14.55 / 23.77, -0.1 | 58.4% | 3.75 / 10.08 / 15.98 | 8.92 / 20.05 / 28.21 | 84.8% | 10.6% |
| Size over 1.4x | 866 | 18.06 / 41.46 / 55.96, -13.0 | 9.50 / 24.04 / 39.08, -0.2 | 29.2% | 4.25 / 13.12 / 22.27 | 10.98 / 24.85 / 35.29 | 79.4% | 12.7% |

- By bedrooms, shown share and error on shown: studio 88.6%, 4.14 / 10.50; 1-bed 87.6%, 4.44 / 10.82; 2-bed 83.5%, 4.56 / 11.56; 3-bed 77.6%, 4.24 / 10.63.
- One random sale per building x type x cutoff (11,947): tier-1 7.44 / 17.20; ACS all 5.79 / 13.83; shown 81.0%; on shown 5.17 / 12.04 against tier-1 6.62 / 14.96 on the same; held 82.6%.
- ACS first with tier 1 as fallback, all A sales: 4.95 / 12.84 / 20.50 against 6.01 / 15.17 / 22.72. Last cutoff: 4.39 / 11.99 against 5.18 / 13.62.

### 6.2 Scenario B: building in the data, 0 to 4 same-type sales

| Group | Sales | Shipped centre, all | Shipped shown; held; half-width | ACS, all | ACS shown | ACS on shown | Held | Half-width | Both shown | Shipped / ACS on both |
|---|---|---|---|---|---|---|---|---|---|---|
| All, studio to 3-bed | 38,845 | 11.04 / 26.03 / 37.95, +6.1 | 62.5%; 58.7%; 9.2% | 8.07 / 18.99 / 28.65, +2.1 | 32.7% | 5.25 / 11.63 / 16.97 | 86.9% | 14.4% | 9,335 | 5.62 / 13.05 against 4.90 / 10.67 |
| Ready | 21,768 | 15.08 / 31.75 / 45.33, +11.6 | 39.4%; 51.7%; 10.3% | 9.59 / 22.73 / 34.38, +3.5 | 26.1% | 6.48 / 14.10 / 20.63 | 83.1% | 15.2% | 2,901 | 9.38 / 20.44 against 6.45 / 14.09 |
| Off-plan | 17,077 | 7.22 / 19.09 / 27.61, +1.9 | 91.8%; 62.5%; 8.5% | 6.50 / 15.84 / 21.84, +0.8 | 41.2% | 4.42 / 9.75 / 13.88 | 90.0% | 13.9% | 6,434 | 4.69 / 9.99 against 4.30 / 9.31 |
| Tuned cutoffs | 20,433 | 13.73 / 29.21 / 40.40 | 61.5%; 53.8%; 9.4% | 8.78 / 20.01 / 28.91 | 32.9% | 5.59 / 12.61 / 18.14 | 84.9% | 14.3% | 4,685 | 6.33 / 15.27 against 5.22 / 11.57 |
| Clean cutoffs | 18,412 | 8.96 / 22.14 / 33.76 | 63.6%; 63.8%; 9.0% | 7.41 / 17.66 / 28.20 | 32.5% | 4.85 / 10.68 / 15.49 | 89.1% | 14.5% | 4,650 | 5.05 / 10.92 against 4.55 / 9.95 |
| Last cutoff | 7,919 | 8.78 / 20.61 / 32.95, +1.4 | 60.7%; 61.4%; 8.9% | 8.01 / 18.92 / 29.85, -0.2 | 29.5% | 5.37 / 11.33 / 17.38, -1.8 | 86.8% | 14.3% | 1,811 | 5.35 / 11.05 (bias 0.0) against 5.19 / 10.84 (bias -1.95) |
| Last cutoff, ready | 4,853 | 10.79 / 23.90 / 37.75 | 42.5%; 57.8%; 10.0% | 9.31 / 21.89 / 34.59 | 19.5% | 6.62 / 14.08 / 20.98 | 82.0% | 14.7% | 576 | 7.34 / 14.59 against 6.51 / 13.63 |
| Last cutoff, off-plan | 3,066 | 6.16 / 15.50 / 24.35 | 89.6%; 64.2%; 7.8% | 6.39 / 14.67 / 22.69 | 45.2% | 4.63 / 9.77 / 14.50 | 90.1% | 14.0% | 1,235 | 4.80 / 9.52 against 4.63 / 9.33 |
| 0 own sales in 12 months | 12,259 | 17.83 / 38.19 | 50.8% | 13.13 / 27.55 | 2.8% | 7.12 / 15.51 | 79.8% | | 308 | 9.22 / 20.05 against 6.96 / 15.37 |
| 1 to 4 own sales | 26,586 | 8.99 / 21.21 | 67.8% | 6.60 / 15.48 | 46.5% | 5.19 / 11.55 | 87.1% | | 9,027 | 5.57 / 12.76 against 4.83 / 10.58 |

- ACS refusals in B (all bedrooms): leading evidence not close (class 3 or community) 27.2%; too few 20.5%; range too wide 14.5%; more than 3 bedrooms 3.0%; size too far 2.7%; no comparable 0.4%.
- Shown by ACS or by the shipped rule: 71.1% of B (studio to 3-bed). Of the sales the shipped rule shows, ACS shows 38.5%.
- Of the 8,502 sales the shipped rule refuses as `evidence_disagrees`, ACS shows 37.6%: 6.56 / 14.41 / 21.04, held 82.3%.
- ACS first, shipped as fallback, on the 24,260 sales shipped shows: 7.74 / 19.72 / 28.64 against 8.26 / 20.51 / 29.34. Last cutoff (4,809): 6.85 / 16.37 / 25.19 against 7.00 / 16.54 / 24.81.
- One random sale per building x type x cutoff (11,003): shipped 12.60 / 26.19; ACS all 8.14 / 18.67; shown 32.7%; on both-shown 6.07 / 12.75 against 7.48 / 17.73; held 83.5%.
- Size bands, shown share: under 0.8x 7.5%; 0.8 to 1.25x 48.4%; 1.25 to 1.4x 10.8%; over 1.4x 3.2%. ACS mostly refuses unusual sizes in B.

### 6.3 Scenario C: building not in the data

| Group | Sales | ACS, all | ACS shown | ACS on shown | Held | Project route, same shown sales | ACS, same shown sales |
|---|---|---|---|---|---|---|---|
| Off-plan, project siblings lead | 6,129 | 6.60 / 14.87 / 21.73, +3.9 | 41.4% | 4.77 / 13.03 / 15.78, +4.1 | 93.5% | 5.54 / 15.21 (2,483) | 4.97 / 13.30 |
| Tuned cutoffs | 2,857 | 6.82 / 14.07 / 20.26 | 31.3% | 2.49 / 7.62 / 12.04 | 90.8% | 2.97 / 7.82 (893) | 2.49 / 7.62 |
| Clean cutoffs | 3,272 | 6.28 / 15.61 / 23.11 | 50.2% | 6.50 / 14.64 / 16.18, +6.0 | 94.9% | 7.57 / 17.13 (1,590) | 6.84 / 14.80 |
| Last cutoff | 1,218 | 5.51 / 13.64 / 27.09 | 31.0% | 5.35 / 9.30 / 11.98, +3.3 | 92.0% | 5.70 / 9.33 (325) | 5.97 / 9.76 |
| Off-plan, community only (refused) | 59,230 | 10.43 / 22.22 / 31.04, +6.1 | 0% | | | | |
| Ready, community only (refused) | 3,064 | 20.02 / 45.48 / 71.20 | 0% | | | | |
| No comparable | 16,675 | none | 0% | | | | |

- All sales with a project-route answer (5,929): route 6.73 / 16.93; ACS 6.82 / 14.98. A tie on the centre.
- ACS shows 3.0% of C; the project route covers at most 7.0% (upper bound: this stage's family, not the product's resolver).
- Group off-plan | class 5 | full weight: held 87.1% over four cutoffs (473), but 64.8% at 2024-11-17 (108) and 61.8% at the last cutoff (34).

### 6.4 Range coverage (nominal 80%), shown cases

| Cutoff | A | B | C | All | Without the drift guard |
|---|---|---|---|---|---|
| 2024-11-17 | | | | 82.9% | 80.7% |
| 2025-05-17 | | | | 81.0% | 78.9% |
| 2025-11-16 | 87.5% | 90.6% | 95.7% | 88.0% | 83.5% |
| 2026-05-17 | 83.6% | 86.8% | 92.1% | 83.9% | 79.2% |
| Tuned cutoffs | 81.4% | 84.9% | 90.8% | 81.9% | |
| Clean cutoffs | 85.6% | 89.1% | 94.9% | 86.1% | |
| All four | 83.5% | 86.9% | 93.5% | 83.9% | 80.6% |

- The guard costs width: median half-width 11.6% against 10.0%.
- Ready 81.4%, off-plan 84.9% (all four). Last cutoff: ready 78.2% (truth below the range 17.7%, above 4.2%), off-plan 85.4% (11.9% and 2.7%). Prices fell after May 2026.
- Days after the data date: 1 to 30: 87.6%; 31 to 61: 85.6%; 62 to 122: 83.2%; 123 to 183: 80.1%.
- Per building: 3,269 buildings; sale-weighted 84.7% (unweighted for A sampling), building-weighted 82.2%. Of 1,561 buildings with 10+ shown sales, 91 held under 60% and 21 under 40%.
- By size adjustment: under 3%: 84.4%; 3 to 6%: 81.6%; over 6%: 80.3%. Size 1.4 to 1.6x typical: 79.7% (279).

Mondrian groups with 100+ shown sales (A and B together; then C):

| Group | Meaning | Shown | Held | Tuned | Clean | By cutoff |
|---|---|---|---|---|---|---|
| 0\|1\|0\|0\|0 | ready, own sales lead, full weight | 12,148 | 81.6% | 81.8% | 81.3% | 81.3 / 82.3 / 83.6 / 78.3 |
| 0\|1\|0\|1\|0 | same, old | 713 | 83.2% | 83.1% | 83.2% | 77.4 / 87.0 / 86.2 / 81.4 |
| 0\|1\|1\|0\|0 | ready, own lead, thin | 1,259 | 84.9% | 83.0% | 91.3% | 82.6 / 83.4 / 91.4 / - |
| 0\|1\|1\|1\|0 | same, old | 140 | 87.1% | 88.2% | 85.5% | 92.9 / - / - / 85.7 |
| 0\|2\|0\|0\|0 | ready, other bedrooms lead, full weight | 1,502 | 79.6% | 76.7% | 84.3% | 74.1 / 80.3 / 85.6 / 82.0 |
| 0\|2\|0\|1\|0 | same, old | 247 | 78.1% | 82.5% | 76.6% | 90.6 / 74.2 / 82.8 / 73.3 |
| 0\|2\|1\|0\|0 | ready, other bedrooms lead, thin | 348 | 82.8% | 80.8% | 86.8% | 82.0 / 79.9 / 91.4 / 82.1 |
| 1\|1\|0\|0\|0 | off-plan, own lead, full weight | 32,236 | 84.7% | 81.9% | 87.1% | 83.7 / 80.2 / 89.0 / 85.3 |
| 1\|1\|0\|1\|0 | same, old | 1,123 | 87.8% | 89.4% | 86.8% | 88.7 / 90.1 / 84.1 / 89.2 |
| 1\|1\|1\|0\|0 | off-plan, own lead, thin | 1,645 | 89.6% | 84.0% | 95.4% | 94.6 / 81.0 / 98.5 / 87.2 |
| 1\|2\|0\|0\|0 | off-plan, other bedrooms lead, full | 2,281 | 92.2% | 91.7% | 92.8% | 88.1 / 93.6 / 94.9 / 90.0 |
| 1\|2\|0\|1\|0 | same, old | 135 | 80.0% | 78.9% | 80.8% | 83.9 / - / 73.8 / 88.9 |
| 1\|2\|1\|0\|0 | off-plan, other bedrooms lead, thin | 249 | 93.2% | 94.4% | 91.4% | 83.8 / 98.1 / 98.2 / 83.3 |
| 1\|5\|0\|0\|0 | not in data, siblings, full weight | 473 | 87.1% | 89.6% | 60.0% | 64.8 / 97.8 / - / 61.8 |
| 1\|5\|1\|0\|0 | not in data, siblings, thin | 1,999 | 95.3% | 92.0% | 96.3% | 95.0 / 86.4 / 95.9 / 97.9 |

- Group rows count each shown sale of the test files once (the A sample is not weighted back). Weighted back, the tuned-cutoff figure for ready | other bedrooms | full weight is 75.6%, not 76.7%.
- The per-cutoff A, B and C columns of the first table were computed for the last two cutoffs and for the pooled pairs only.
- No group is under 78% over the four cutoffs. Group x cutoff cells with 100+ shown: 40; under 75%: 3 (ready other-bedrooms 2024-11-17: 74.1%; same, old, 2026-05-17: 73.3%; not in data 2024-11-17: 64.8%).
- Split by scenario, two cells with 100+ shown are under 78%: A, ready, other bedrooms lead, full weight: 71.8% (156 sales; last cutoff 76.2%). B, ready, other bedrooms lead, old: 77.5% (240; last cutoff 73.1%).

### 6.5 Share served (all bedrooms; share of held-out sales)

| Scenario | Today | ACS alone | ACS first, live as fallback | Of today's answers, given by ACS |
|---|---|---|---|---|
| A | 100% | 86.3% | 100% | 86.3% |
| B | 60.6% | 31.7% | 69.0% | 38.5% |
| C | 7.0% (upper bound) | 3.0% | 7.0% | 41.5% |
| All | 65.9% | 53.0% | 67.1% | 78.5% |
| All, last cutoff | 78.7% | 64.3% | 79.7% | 80.4% |

Lag stress (comparables of the last 30 / 60 days before the cutoff removed, ranges recalibrated; the 150-latest cap was applied before the removal): A shown 86.6% to 75.6% / 65.5%; B shown 32.7% to 18.6% / 15.5%; error on shown A 4.37 to 4.58 / 4.79, B 5.25 to 6.14 / 6.51; range held 83.8% in both.

Same-price comparables removed (every comparable within 0.1% of the held-out price; pessimistic, the removal uses the truth): A on shown 4.37 to 4.51; B 5.25 to 5.38; held 83.9%.

### 6.6 The product's decision

The listing is priced at its real later sale price times a factor. "False flag" = not "within" at the true price. "Caught" = the right verdict at 10% or 20% off (mean of over and under).

| Cases | Method | Range held | Half-width | False flag | Caught at 10% off | Caught at 20% off | Wrong direction at 10% off |
|---|---|---|---|---|---|---|---|
| A, sales ACS shows (41,404) | Tier-1 median, live 5% band | | 5% | 51.7% | 74.4% | 93.3% | 7.1% |
| | Tier-1 median, own calibrated range | 87.2% | 16.8% | 12.8% | 27.3% | 66.1% | 2.0% |
| | ACS | 83.6% | 10.9% | 16.4% | 45.9% | 84.1% | 2.3% |
| A ready (10,733) | Tier-1, 5% band | | 5% | 66.1% | 67.4% | 89.8% | 11.0% |
| | Tier-1, calibrated range | 86.9% | 21.4% | 13.2% | 21.9% | 53.1% | 2.0% |
| | ACS | 81.1% | 12.9% | 19.0% | 39.0% | 77.4% | 2.7% |
| A off-plan (30,671) | Tier-1, 5% band | | 5% | 46.7% | 76.8% | 94.5% | 5.7% |
| | Tier-1, calibrated range | 87.3% | 15.2% | 12.7% | 29.1% | 70.6% | 2.0% |
| | ACS | 84.4% | 10.3% | 15.5% | 48.3% | 86.4% | 2.2% |
| A, size outside 0.8 to 1.25x (1,307) | Tier-1, 5% band | | 5% | 68.6% | 65.6% | 83.0% | 16.6% |
| | Tier-1, calibrated range | 63.4% | 16.8% | 36.4% | 35.7% | 59.6% | 8.2% |
| | ACS | 84.1% | 10.8% | 15.9% | 46.3% | 83.7% | 2.6% |
| A, last cutoff (10,519) | Tier-1, 5% band | | 5% | 46.8% | 76.4% | 93.5% | 6.2% |
| | ACS | 83.6% | 11.0% | 16.3% | 44.2% | 82.4% | 2.1% |
| A, last cutoff, ready (2,073) | ACS | 77.6% | 13.3% | 22.5% | 38.7% | 72.4% | 2.5% |
| B, both shown (9,335) | Shipped range as shipped | 67.2% | 8.1% | 33.0% | 60.2% | 90.2% | 4.0% |
| | Shipped centre, own calibrated range | 93.0% | 21.5% | 7.0% | 17.9% | 57.0% | 1.0% |
| | ACS | 88.5% | 14.1% | 11.5% | 33.3% | 77.0% | 1.5% |
| B, both shown, last cutoff (1,811) | Shipped range as shipped | 68.7% | 7.9% | 31.6% | 61.2% | 90.3% | 3.2% |
| | ACS | 88.2% | 14.0% | 11.7% | 33.4% | 73.2% | 1.4% |
| C, siblings shown (2,535) | ACS | 93.5% | 11.9% | 6.5% | 40.7% | 83.6% | 0.5% |

- At the last cutoff an overpriced listing is caught less often than an underpriced one, because prices fell: A, 10% over: 18.7%; 20% over: 69.5%.
- The baseline ranges have no per-case scale. A better one could be somewhat narrower.

### 6.7 Mixed model and LightGBM

Saved predictions of `ml\fwd.py` (too-few types with 5+ later sales), scored on the single sales of those types. Not rerun. The first saved cutoff is 2024-11-16.

| Cases | Sales | Shipped | Mixed | LightGBM | ACS |
|---|---|---|---|---|---|
| All four cutoffs | 18,282 | 7.85 / 20.09 | 7.90 / 20.06 | 7.53 / 19.10 | 6.80 / 16.57 |
| 2024-11-17 | 3,306 | 8.02 / 18.61 | 8.98 / 19.43 | 8.24 / 17.98 | 5.90 / 14.04 |
| 2025-05-17 | 6,704 | 9.97 / 22.43 | 10.34 / 23.81 | 9.76 / 22.25 | 8.63 / 18.99 |
| 2025-11-16 | 5,375 | 6.54 / 14.93 | 5.97 / 13.65 | 5.77 / 12.51 | 5.39 / 12.44 |
| 2026-05-17 | 2,897 | 7.16 / 17.56 | 6.65 / 17.15 | 6.83 / 17.28 | 7.76 / 17.69 |
| All four, sales ACS shows | 6,920 | 5.19 / 11.30 | 5.63 / 11.82 | 4.97 / 10.98 | 4.46 / 9.82 |
| Last cutoff, sales ACS shows | 1,016 | 5.14 / 10.18 | 4.81 / 9.61 | 4.74 / 9.89 | 4.80 / 10.13 |

At the last cutoff ACS loses on all such sales and ties on the sales it shows.

### 6.8 Ablations (same sales in every column; typical / 80th, bias)

| Cases | Sales | ACS | No same-bedroom size slope | No size term at all | No time | No slope, no time | No rings 3-4 | Equal weights |
|---|---|---|---|---|---|---|---|---|
| A | 47,808 | 4.84 / 12.30 | 5.00 / 12.66 | 5.09 / 12.93 | 5.08 / 13.10 | 5.24 / 13.48 | 4.85 / 12.33 | 7.12 / 17.06 |
| B | 33,198 | 7.24 / 16.67, +1.3 | 7.30 / 17.11 | 9.95 / 22.08 | 8.51 / 19.68, +3.8 | 8.54 / 19.79 | 7.35 / 17.23 | 10.66 / 24.08 |
| Ready | 30,466 | 7.40 / 16.73 | 7.60 / 17.16 | 8.61 / 19.67 | 9.38 / 20.19, +5.1 | 9.54 / 20.38 | 7.53 / 17.03 | 10.08 / 23.08 |
| Off-plan | 50,540 | 4.85 / 12.55 | 4.94 / 12.93 | 5.66 / 15.30 | 4.85 / 12.78 | 4.94 / 13.20 | 4.83 / 12.65 | 7.48 / 17.71 |
| Size 1.25 to 1.4x | 2,103 | 7.11 / 16.82, -0.2 | 7.83 / 18.97, -1.9 | 9.18 / 23.69, -3.2 | 7.50 / 18.58 | 7.92 / 19.88 | 7.15 / 17.30 | 9.75 / 23.77 |
| Size over 1.4x | 1,621 | 9.75 / 23.26, +0.2 | 10.21 / 25.03, -1.4 | 14.77 / 31.05, -4.1 | 10.07 / 25.02 | 10.44 / 25.94 | 9.61 / 24.22 | 13.35 / 28.22 |
| Size under 0.8x | 1,611 | 6.78 / 18.04 | 6.97 / 18.72 | 9.13 / 23.54 | 7.78 / 20.14 | 7.94 / 21.90 | 7.25 / 19.07 | 9.89 / 25.42 |
| Last own sale 12 to 36 months | 1,838 | 10.09 / 22.22, -0.6 | 10.22 / 23.05 | 13.32 / 29.52 | 13.74 / 25.68, +7.7 | 14.04 / 26.54 | 9.99 / 21.49 | 11.15 / 28.66 |
| Last cutoff | 18,627 | 5.41 / 13.40 | 5.67 / 13.89 | 6.30 / 15.93 | 5.49 / 13.88 | 5.78 / 14.29 | 5.28 / 13.17 | 8.15 / 19.37 |

- Weighting is the largest gain. The time adjustment matters for ready flats and old sales, not for off-plan. The same-bedroom slope adds little once similar-size sales are preferred; the cross-bedroom size term is necessary.
- Cross-building rings add nothing on sales that already have an estimate, and class 3 is now refused. Ring 3 still feeds weight into shown estimates where own sales lead.

## 7. Seventh Heaven, Al Barari

Ready 1-bed, 2,904 sq ft, AED 4,100,000 (AED 1,412 per sq ft), data date 16 Nov 2026. `tables\seventh_heaven_acs.json`.

**Refused, `range_too_wide`.** Internal centre AED 1,466 per sq ft (asking 3.7% below). Range AED 596 to 2,842; half-width 76.6% against the 20% limit. 53 comparables: 14 from ring 1 (weight 0.74), 39 from ring 2 (weight 2.62). Class 2, group ready | 2 | thin | old, multipliers 3.17 and 2.33, scale 0.284. Slope for the type -0.659 (segment -0.445). Typical 1-bed size 1,989 sq ft; the listing is 1.46x that.

Stage 2 reported the upper end as 2,994 (half-width 82%); the class fix changed the multipliers. The verdict is the same.

Other readings: ring 1 only: 1,192, range 785 to 1,600, refused (weight 0.74 under 2). Ring 1 within 0.8x to 1.25x of the size: 5 sales, 1,117. Recency half-life 24 months: 37 comparables, 1,332, range 962 to 1,707 (still over the limit). The full list of adjusted sales is in `ACS_REPORT.md` section 6.

## 8. Golden test and artifact

- `golden\artifact.json`: 19.9 MB (6.7 MB gzip); 392,208 pool rows from 403,589; 4,214 batch rows collapsed; 4,604 buildings; 95 multiplier groups. Without names and with sizes and prices rounded to 0.01: 12.6 MB (4.3 MB gzip).
- 91 cases: 42 shown, 15 not close, 14 too few, 7 size too far, 6 too wide, 6 over 3 bedrooms, 1 nothing. 4 are boundary tests (capped weight 0.5 at the gate; capped weight 1.0 at the minimum).
- `node ref\run_golden.ts`: 70,236 numbers, largest relative difference 6.2e-15. `ref\acs.ts` passes `tsc --strict`.
- Node 26: parse 107 ms, index 596 ms, 0.34 ms per request; process memory 283 MB.

## 9. Weak or untested

- The independent re-implementation (`verify\`) was run on the stage 2 rule. It was not repeated after the stage 4 changes. The audit re-run on the stage 4 code matches `bt\res_*.npz` exactly (largest difference 0.0).
- The stage 4 thresholds were chosen on two cutoffs. The remaining group under 78% on those cutoffs (ready, other bedrooms lead: 75.6%) was left as it is.
- Two scenario-level cells with 100+ shown sales are under 78% (section 6.4).
- Scenario C: the product's project resolver was not tested; the family rule changes the shown share by cutoff (stage 3).
- The 25% half-width variant was not re-run.
- Tuning was not re-run; the surface is flat and the search did not converge.
- Mixed model and LightGBM were not re-run.
- No confidence intervals. Sales of one building are not independent.
- Targets are registered sales, not listings. Off-plan targets are mostly developer sales.
- Registration lag is unmeasured (one download).
- The cleaning rules 10a and 10b look at later sales; in production they will see only data to the data date.
- Ring 1x (same building, other basis) was not built. 4+ bedrooms stay refused.
- The pool excludes day T-1095 (403,589 rows against the snapshot's 403,867). Building facts come from the long-history file.

## 10. Files

| File | What |
|---|---|
| `acs.py` | The method (spec in the docstring) |
| `ref\acs.ts`, `ref\run_golden.ts` | TypeScript reference and golden runner |
| `golden\artifact.json`, `cases.json`, `expected.json` | Artifact at 16 Nov 2026 and 91 golden cases |
| `tindex.py`, `lib.py`, `prep.py` | Index and slopes; helpers; long-history data |
| `bt.py`, `full.py`, `bt\res_*.npz` | Targets, baselines; ACS and ablations per cutoff |
| `cal.py`, `evalx_const.py` | Calibration, the rule for arrays; constants |
| `evalx.py`, `bt\eval_out.txt`, `tables\bt_results.json` | Stage 2 table set, re-run |
| `s4\c1_confirm.py`, `c2_explore.py`, `c3_explore.py` and outputs | Finding checks; rule choice on tuning cutoffs |
| `s4\final_eval.py`, `final_eval_out.txt`, `final_tables.json` | Every number in sections 6 and in the report |
| `audit\a1_rerun.py`, `a2_main.py`, `a2_out.txt`, `a5_out.txt` | Audit re-run on the stage 4 code |
| `s4\timing.ts`, `timing_out.txt`, `golden_node.txt` | Load time and golden run |
| `stage2_backup\` | Stage 2 code and results |
| `verify\v_*.py` | Stage 3 re-implementation (stage 2 rule) |
| `verify\v5_*.py` | Stage 5 re-verification of the final rule (section 11.3) |
| `s5\` | Stage 5: rule choice, the chain, final tables, stage 5 artifact, production profile |
| `golden5\` | Stage 5 artifact (ready multipliers at 85%) and the 91 golden cases |
| `prod\` | Production profile: slim artifact, TypeScript runtime, 106 golden cases |
| `INTEGRATION_SPEC.md` | How to put the method into the app |

## 11. Stage 5: hardening before integration

### 11.1 What changed

Only the range multipliers of ready flats. The comparables, the centre and the refusal rule are the stage 4 ones.

**Ready flats are calibrated at a nominal 85%** (7.5th and 92.5th points; off-plan stays at 80%). The decision rule was fixed before the run and used the tuning cutoffs only: the lowest of 80 / 82.5 / 85 / 87.5 at which, on each tuning cutoff, the true price is under the range for at most 10% of answered ready sales, and no Mondrian group with 100+ answered sales holds under 78% (`s5\e4_out.txt`).

| Ready nominal | True price under the range, 2024-11-17 / 2025-05-17 | Groups under 78% on the tuning cutoffs | Held 2025-11-16 | Held 2026-05-17 | Ready A answered, 2026-05-17 | Ready B answered, 2026-05-17 |
|---|---|---|---|---|---|---|
| 80% (stage 4) | 10.1% / 12.1% | ready, other bedrooms lead, full weight: 75.6% (936) | 83.8% | 78.1% | 76.5% | 19.5% |
| 82.5% | 9.2% / 11.3% | the same group: 76.8% (827) | 85.5% | 80.9% | 72.6% | 16.7% |
| **85%** | **8.2% / 9.7%** | **none** | 87.3% | 83.2% | 67.0% | 14.7% |
| 87.5% | 7.0% / 8.2% | none | 89.0% | 85.5% | 58.9% | 11.5% |

- The need for a stronger ready range came from the last cutoff (77.6% for ready A). So the last cutoff is not a clean test of ready coverage. 2025-11-16 is.
- Cost: wider ready ranges, so more of them pass the 20% limit and fall back. Ready A answered 76.9% to 68.2% over four cutoffs; ready B 26.1% to 19.5%. Off-plan is unchanged.
- Cost in the chain (A and B, ready, later cutoffs, `s5\e7_out.txt`): typical error where today answers 7.68 to 7.83; right at the true price 66.9% to 65.4%. All sales: 5.14 to 5.16 and 76.9% to 76.5%. The 82.5% level is the lighter choice if the owner prefers share over the margin; it failed the tuning rule.

**Tried and not adopted** (each decided on the tuning cutoffs, then read on the later cutoffs):

| Candidate | Tuning cutoffs | Later cutoffs | Decision |
|---|---|---|---|
| (a) Send "A, ready, other bedrooms lead" to tier 1 | 90 answered sales, held 70.3%. ACS 8.70 / 21.12 against tier 1 16.41 / 25.49. Right at the true price: ACS 71.3%, tier 1 19.8% | 36 sales, held 80.2%. ACS 5.81 / 17.28 against 11.77 / 16.30 | No. Tier 1 is twice as far on these sales. The cell stays under 78% (73.5% on 120 sales, 0.25% of A) and is stated |
| Both sides take the larger multiplier, ready | Ready A answered 76.4% to 64.2%, held 87.3% | Held 87.2% and 85.7% | No. Costs more share than the 85% level for the same purpose |
| The same for off-plan too | Off-plan A answered 90.6% to 88.8% | Off-plan A answered 85.2% and 86.1% | No. Off-plan needed no change |
| (c) Other Mondrian groups under 78% | One: ready, other bedrooms lead, full weight, 75.6% | | Solved by the 85% level: 79.0% tuning, 86.1% later |

**Size slope and batches** (`s5\variants.py`, `s5\e5_out.txt`). Both were already in the method: the per-building slope shrunk to the segment (0.03) and the collapse of one-price batches. Stage 5 measured what each is worth, on the same held-out sales, typical / 80th percentile:

| Variant of the centre | A all, tuning | A answered, tuning | B all, tuning | B answered, tuning | A all, later | A answered, later | B all, later | B answered, later |
|---|---|---|---|---|---|---|---|---|
| Method | 5.30 / 13.19 | 4.79 / 11.60 | 8.78 / 20.01 | 5.39 / 12.13 | 4.36 / 11.33 | 3.84 / 9.71 | 7.41 / 17.66 | 4.65 / 10.22 |
| Segment slope only | 5.39 / 13.26 | 4.83 / 11.60 | 8.79 / 20.04 | 5.39 / 12.21 | 4.41 / 11.47 | 3.90 / 9.79 | 7.45 / 17.66 | 4.70 / 10.28 |
| Per-building slope, shrink 0.3 | 5.35 / 13.24 | 4.81 / 11.60 | 8.77 / 20.03 | 5.39 / 12.14 | 4.38 / 11.36 | 3.86 / 9.72 | 7.43 / 17.61 | 4.68 / 10.19 |
| Per-building slope, shrink 0.003 | 5.28 / 13.22 | 4.78 / 11.60 | 8.76 / 20.07 | 5.27 / 12.13 | 4.36 / 11.34 | 3.82 / 9.74 | 7.38 / 17.72 | 4.63 / 10.31 |
| No collapse at all | 5.32 / 13.21 | 4.81 / 11.63 | 8.84 / 20.25 | 5.39 / 12.16 | 4.37 / 11.30 | 3.85 / 9.72 | 7.34 / 17.61 | 4.65 / 10.22 |
| One-price lists collapsed whatever their days | 5.32 / 13.16 | 4.77 / 11.59 | 8.81 / 20.05 | 5.45 / 12.26 | 4.39 / 11.38 | 3.86 / 9.71 | 7.34 / 17.60 | 4.67 / 10.31 |

- The per-building slope is worth 0.04 to 0.09 points against the segment slope. ANALYSIS.md's 5.50 against 5.87 was for a prediction from the type's median, where no weight prefers sales of a like size.
- No variant is better on both pairs of cutoffs by more than 0.12 points. Nothing was adopted. The range was not recalibrated for the variants.
- The collapse does not move the centre. It stays because it keeps forty rows at one price from counting as forty sales in the weights and the spread; that effect on the range was not measured.

### 11.2 Spec wording fixed

The re-verification wrote the method again from this file. Each point below was a place where the text allowed a second reading; the code was right in every case and the text was changed.

| Section | First reading | Effect | Text now |
|---|---|---|---|
| 4.1 scenario A | 12 months = T - 365 < day | 0 to 10 sampled sales per cutoff in another scenario (27 of 266,164 in all) | T - 365 <= day <= T |
| 2.3 ring 2 | Capped bedroom counts must differ | 3 comparables lost on one golden case (a 4+ bedroom listing, always refused) | Registered counts differ; capped counts at most 2 apart |
| 2.3 / 2.5 gather order | Rings in the order 1, 2, 3, 4 | Decides which of two equal weights the budget cuts. With the next row: 30 of 238,954 estimates | Already said 1, 3, 2, 4; the stage 3 code had it wrong |
| 2.6 centre | Rows in weight order before the stable sort | Equal adjusted values in another order: the centre moves by about 0.02% on such a sale | Rows stay in gather order |
| 2.2 step 2 | Batch row: day, size, psf of the whole batch | None measured (read as the code does) | Of the batch's rows with that bedroom count |
| 2.2 step 8 | Group means computed again after the robust drop | None measured (read as the code does) | Means of the first pass are kept |

One point is not fixed in the text because both readings are legitimate arithmetic: the size limits are tested in logs (`ln 0.67 <= lsr <= ln 1.5`, lsr = ln listing size - ln sale size). A test on the ratio differs for a sale exactly on a limit. A port must use the log form.

### 11.3 Re-verification of the final rule

Files `verify\v5_*.py`. `v5_build.py` (pool, slopes, time index, other-bedrooms fit) is new and follows section 2.2. `v5_core.py` is the stage 3 scorer with the edits of `v5_make.py`, each tied to a section of this file. `v5_eval.py` is a new calibration (section 3) and rule (2.8). The author had read `acs.py` and `tindex.py` before writing them, so this is a second implementation, not a blind one.

**Golden cases** (`v5_golden.py`): 91 of 91 reasons agree; 33,260 numbers; largest relative difference 3.3e-14.

**Backtest on the method's own cleaned data** (isolates the method; `v5_eval_out_v5same_.txt`), six cutoffs, 266,164 held-out sales, 238,954 estimates:

- Scenario: 0 sales differ. A weights equal.
- Centre, |ln difference| sale by sale: median 2.7e-15, 99th percentile 9.8e-14. 18 estimates differ by more than 0.01%, 1 by more than 0.3% (largest 0.68%).
- 23 estimates differ in a weight or by more than 0.01% in the centre. 19 have a sale exactly on a size limit (ratio test in my code, log test in the method). 4 have the same sales and a centre 0.01% to 0.03% apart; not explained.
- Refusal reason: 0 of 266,164 differ, stage 4 rule and stage 5 rule. Rounded range ends: 0 of 56,647 (stage 4) and 0 of 53,992 (stage 5) differ.
- Every headline number of sections 6.1 and 6.2, and of the stage 5 tables, is reproduced to the printed digit: A 86.5% answered, 4.37 / 10.84 / 16.35, held 83.6% (stage 4); 84.0%, 4.28 / 10.63 / 16.04, held 84.6% (stage 5). B 32.7%, 5.25 / 11.63 / 16.97, held 86.9%; 29.1%, 5.06 / 11.29 / 16.26, held 88.4%.

**Backtest on independently cleaned data** (`v5_data.py`; 21 window sales only in mine, 5 only in the snapshot, of 403,867; `v5_eval_out_v5bt_.txt`):

- Centre: median difference 7.1e-07; 262 of 238,952 estimates differ by more than 0.3%. One odd sale in a small building changes that building's slope.
- Refusal reason differs for 84 sales (stage 4 rule) and 61 (stage 5 rule).
- Differences over 0.3 points among the 24 headline rows (A and B; all four, tuning, later, last; all, ready, off-plan), stage 5 rule: ready A answered at the last cutoff 67.5% against 67.0%; tier 2's error on the sales both answer, B ready tuning, 80th and 90th percentile: 21.81 against 22.17 and 28.38 against 28.76. Every ACS error and every coverage figure is within 0.12 points.

No difference was found where the code was wrong. Three were faults in the re-implementation (ring order, row order, scenario window) and came from the text; the text is fixed.

### 11.4 Production profile

`INTEGRATION_SPEC.md`. In short: the pool is the app's own sales in ascending `ref` order, collapsed per building when a request needs it; rings 1, 3 and 2 only; buildings named by the app's key. Slim artifact 874,476 bytes (334 KB gzipped). `prod\acs-runtime.ts` agrees with `acs.py` on 106 golden cases (36,733 numbers, largest relative difference 1.2e-14). The full method and the production profile agree on 20,000 random requests (5,485 answered, 0 differences).

### 11.5 Results under the stage 5 rule

`s5\e6_out.txt`, `s5\final5_tables.json`. Errors typical / 80th / 90th percentile. "Held" is weighted back.

| Group | Sales | ACS answers | ACS on its answers | Today's method on the same sales | Held | Half-width |
|---|---|---|---|---|---|---|
| A, four cutoffs | 47,840 | 84.0% | 4.28 / 10.63 / 16.04 | tier 1: 5.28 / 13.02 / 19.15 | 84.5% | 11.2% |
| A, tuning | 23,894 | 83.0% | 4.79 / 11.60 / 17.79 | 5.97 / 14.39 / 21.15 | 82.4% | 10.9% |
| A, later | 23,946 | 85.0% | 3.84 / 9.71 / 14.56 | 4.73 / 11.65 / 17.21 | 86.6% | 11.3% |
| A, last | 11,983 | 85.6% | 3.84 / 9.92 / 14.90 | 4.60 / 11.54 / 17.67 | 84.7% | 11.2% |
| A ready, later | 5,986 | 68.7% | 5.49 / 12.38 / 18.33 | 6.77 / 14.58 / 20.34 | 85.2% | 14.3% |
| A ready, last | 2,710 | 67.0% | 5.98 / 13.33 / 18.77 | 6.84 / 14.43 / 20.18 | 82.9% | 14.5% |
| A off-plan, later | 17,960 | 90.5% | 3.47 / 9.04 / 13.49 | 4.27 / 10.89 / 16.25 | 86.9% | 10.7% |
| B, four cutoffs | 38,845 | 29.1% | 5.06 / 11.29 / 16.26 | tier 2, both answer (8,681): 5.44 / 12.22 / 18.30 against ACS 4.73 / 10.33 / 14.93 | 88.4% | 14.8% |
| B, tuning | 20,433 | 28.5% | 5.39 / 12.13 / 17.47 | both (4,311): 6.05 / 14.19 / 20.83 against 5.11 / 11.29 / 16.22 | 86.5% | 14.9% |
| B, later | 18,412 | 29.7% | 4.65 / 10.22 / 14.74 | both (4,370): 4.91 / 10.47 / 15.79 against 4.46 / 9.66 / 13.58 | 90.4% | 14.7% |
| B, last | 7,919 | 26.5% | 5.13 / 10.99 / 16.27 | both (1,687): 5.14 / 10.63 / 15.77 against 5.03 / 10.61 / 15.23 | 88.3% | 14.7% |
| B ready, later | 10,060 | 17.3% | 6.10 / 12.87 / 18.84 | both (982): 7.63 / 16.20 / 21.65 against 6.16 / 12.59 / 18.08 | 87.5% | 16.2% |
| B off-plan, later | 8,352 | 44.6% | 4.18 / 9.13 / 12.44 | both (3,388): 4.36 / 9.10 / 12.95 against 4.06 / 8.77 / 11.97 | 91.7% | 14.1% |

- Tier 2 answers 62.5% of B and its range held 58.7%. ACS or tier 2 answers 69.2%. ACS alone answers 6.7% of B: 6.38 / 13.96 / 21.04, held 84.4%.
- At the last cutoff, B, both answer: ACS 5.03 / 10.61 against tier 2's 5.14 / 10.63. A tie on the centre, as in stage 4.
- Mondrian groups with 100+ answered sales, A and B together: none under 78% over four cutoffs (lowest 80.3%), none on the later cutoffs. By scenario: one, A ready other-bedrooms-lead, 73.5% (120).
- The chain and the verdict comparison: `INTEGRATION_SPEC.md` section 12.

### 11.6 Weak or untested after stage 5

- The verdict trade-off. The ACS range calls a correctly priced listing "within" far more often than the 5% band (76.5% against 50.6%, later cutoffs), and calls a listing 10% over its true price "above" far less often (28.5% against 71.6%). Which rule is right more often depends on how far listings sit from sale prices, and that was not measured.
- Ready coverage at the last cutoff is no longer a clean test. The misses stay one-sided there (under the range 13.7%, over 3.4%).
- The 85% level costs a little chain accuracy for ready flats (11.1).
- Four estimates of 238,954 differ by 0.01% to 0.03% between the two implementations without an explanation.
- The independent cleaning differs on 26 of 403,867 sales; its cause was not traced.
- The lag stress, the same-price stress, the decision table of 6.6 and the ablations of 6.8 were not rerun under the stage 5 rule.
- No confidence intervals. Sales of one building are not independent.
- Nothing was built in the repository.
