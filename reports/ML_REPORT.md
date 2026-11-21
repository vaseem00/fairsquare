# Fairsquare: a stronger model for "too few sales"? (ML report)

19 Nov 2026. Branch `real-data`, HEAD `f091a20`. **Decision: nothing ships. The product is unchanged.** No commit was made, nothing was pushed or deployed, and Railway and the Anthropic API were not called.

Scripts and outputs are in the scratch folder `model\ml\`. The research notes are in `ML_RESEARCH.md` next to this file.

## 1. In short

- I tested three new models against the shipped one on the same harness, with the same cells and the same random replicates (seed 31337). The harness reproduces `backtest-run.json` exactly: shipped LBO own thinned shows 85.0%, holds 89.2%, error 2.76% / 6.08%.
  - (b) An empirical-Bayes mixed model of ln AED per sq ft.
  - (c) LightGBM on the mixed model's residuals, with normalised-conformal and CQR ranges.
  - (d) A learned comparable-sales reference (k-NN with fitted similarity weights).
- **On the hiding tests (leave-building-out and leave-project-out), the boosted residual model is a little better.** Typical error falls 0.2 to 0.4 points and the 80th-percentile error 0.3 to 0.8 points. With its own Mondrian group for "evidence disagrees", it could show ranges for 91.4% of today's too-few combinations, against 67.0% now. On the hiding tests it holds about 80% in every group.
- **On the forward tests it fails.** Pooled over 4 cutoffs (1,162 real too-few combinations, truth = median of the next 183 days):
  - The shipped range held 73.7%. The new ranges held 58.6% to 67.4%, even with the shipped widening factor of 1.2.
  - To hold as often as the shipped range on the same cases, the new models need a wider range than the shipped one (median half-width 10.8% to 11.2%, against 10.0%).
  - The cases the shipped rule refuses as `evidence_disagrees` held 62.4% to 73.3% forward. Holding 80% of them needs a half-width of about 22% to 23%, above the 20% limit.
- **The owner's rule is not met, so nothing ships.** No candidate improves both errors without lowering forward coverage, and none raises the share served while keeping about 80% in every group.
- **Size is the one clear finding.**
  - For a unit 1.4 times or more the building's typical size for that bedroom count, the shipped centre overstates its AED per sq ft by a median of 17.3%. A within-building size slope removes that bias (-1.4%) and cuts the typical error from 20.3% to 11.8%.
  - Only about 4% to 7% of cases are that far from typical.
  - A size-adjusted range was not calibrated or tested forward, so it is a recommendation, not a change.

## 2. Seventh Heaven, Al Barari, ready 1-bed (live check SVJY59)

Listing: 2,904 sq ft, AED 4,100,000, so **AED 1,412 per sq ft**. Snapshot of 16 Nov 2026, building key `SEVENTH HEAVEN|Wadi Al Safa 3`, project number 1482, community Al Barari.

**What the shipped tier computed** (`scripts/model/vlib.py`, shipped constants version 4):

| Evidence | Value | Weight source |
|---|---|---|
| Own 1-bed sales, 12 months | 1 sale, 8 Oct 2026, 1,920 sq ft, **AED 1,927** | own, ready, k=1 |
| Older, 12 to 24 months | 10 sales, median **AED 1,552** | older12to24, bucket 5 |
| Older, 24 to 36 months | 11 sales, median **AED 1,450** | older24to36, bucket 5 |
| Other bedroom types | 11 sales in 12 months (10 two-bed, median 2,103; 1 three-bed) | otherBedrooms |
| Reference | community Al Barari, 2 buildings, 50 sales, ln median 7.4606 (AED 1,738) | community, spread 0 |

- Combined centre AED 1,737. Class `own`. Range AED **1,610 to 1,920** (half-width 8.8%, would be "close"). The asking price would be "below".
- **Rule that fired: `evidence_disagrees`, by both of its tests.**
  1. Own medians 1,927, 1,552 and 1,450: max/min = **1.329 > 1.25** (`maxOwnMedianRatio`).
  2. The own 12-month median 1,927 is above the rounded range top 1,920 (`ownMedianInsideRange`).
- Rule 1 is checked first in `rule.py` and both are true. Either one alone refuses.

**What the numbers say**
1. **The disagreement is mostly a price rise, not noise.** The building's 2-beds went from about 1,500 (2024) to 2,103 (12 months). The 1-bed medians rise the same way. A time-adjusted model reads these as one trend. The mixed model fits a building trend (posterior) and puts the 1-bed level at AED 1,685 for the 12 months, at the cell's typical size.
2. **The community reference is a block, not a market.** The 2 "other buildings" (B2 and C1, Wadi Al Safa 3) each have 25 one-bed sales at AED 1,738.2 to 1,738.4. Their studios and 2-beds sell at the same AED 1,738 too. This looks like one bulk price, so its spread is 0 and it gets a weight it does not deserve. I did not change any data rule for it.
3. **Size matters here, and the shipped model ignores it.**
   - The 1-bed sales of this building are two kinds of unit: about 1,900 to 2,000 sq ft (AED 1,450 to 2,084) and 2,700 to 3,900 sq ft. The large ones are all older sales: 2,944 sq ft at 1,053, 2,905 at 930, 2,720 at 1,021, 3,154 at 1,205, 3,158 at 1,052 and 3,887 at 1,454. Their median is about AED 1,050, from Mar 2024 to Jul 2025.
   - The listing is 2,904 sq ft, 1.31 times the cell's typical 2,221 sq ft (geometric mean) and 1.5 times the one recent sale.
   - The fitted within-cell slope for ready 1-beds is -0.454: AED per sq ft falls about 4.5% for each 10% more size.

**What each model would show** (these are not shown in the product)

| Model | Centre (AED/sq ft) | Range | Asking 1,412 |
|---|---|---|---|
| Shipped | 1,737 | 1,610 to 1,920 | refused (`evidence_disagrees`). Unrefused, it would say "below". |
| Mixed model, disagree group, x1.0 / x1.2 | 1,685 | 1,550 to 1,850 / 1,530 to 1,880 | below |
| Boosted residual model, disagree group, x1.0 / x1.2 | 1,727 | 1,590 to 1,890 / 1,560 to 1,920 | below |
| Mixed model at the listing's 2,904 sq ft (range **not** tested) | 1,493 | 1,370 to 1,640 | **within** |

**Honest reading.**
- Every building-median model says "below". That is true of the building's typical 1-bed, but it misleads for this unit. Large 1-beds in this building have always sold far under the small ones. Even after a price rise of 30% to 40%, the older large-unit sales point to about AED 1,350 to 1,500.
- Size-adjusted, the listing is within the range.
- So the refusal protected the owner from a wrong "below" by accident. It fired because of the price rise, not because of size.
- A better product would compare at the listing's size, or at least refuse or warn when the listing is more than about 1.25 times the typical size. Section 6 has the evidence. The forward coverage of a size-adjusted range is not measured, so I did not ship it.

## 3. What was tested

**Harness.**
- Test A: the cells and replicates of `scripts/model/backtest.py`, mirrored exactly. The shipped numbers match `backtest-run.json` to the decimal.
- The 2,689 cells with 10 or more sales give 26,890 replicates. In each, the building keeps k = 0 to 4 of its 12-month sales. "Thinned" also cuts its other sales.
- Truth is the median of the sales it did not keep. All figures below are for studios to 3-beds.

**Fitting only on held-out data.**
- Mixed model, LBO: 10 folds over buildings. The hidden building is out of the fit, together with 10% of other buildings. This is harder than the shipped LBO, which removes only the one building.
- LPO: the World's 5 folds over project groups. The hidden building's whole project is out.
- GBM: cross-fitted by the same folds.
- Conformal multipliers: from the other folds' thinned replicates, Mondrian by own/indirect x basis (x disagree).

**Forward tests.**
- 4 cutoffs: 16 Nov 2024, 17 May 2025, 16 Nov 2025 and 17 May 2026.
- At each cutoff, everything new is fitted on sales up to that date: the harness at the cutoff, the multipliers, the GBM and the full mixed model.
- Cases: real too-few combinations (bedrooms 3 or fewer, building known) with 5 or more sales in the next 183 days. Counts: 281, 331, 324 and 226. The last two match `backtest.py` D.
- **The shipped model uses the shipped constants, fitted on data to 16 Nov 2026. This favours the shipped model.**
- The new models' two settings (cell variance 0.004 and older-sale drift 0.005 per year) were chosen on the LBO harness. That favours the new models on LBO.

**Candidates.**
- (a) Shipped (constants v4 plus its rule).
- (b) Mixed model, `ml/mm.py`:
  - ln psf = bed x basis mean + within-cell log-size slope + between-cell size slope + monthly index by basis, plus random effects: area, community, project, area x bed, community x bed, project x bed, building, and building x bed (all x basis).
  - Plus area and building random time slopes.
  - Huber weights, backfitting with EM-type variance updates.
  - A hidden building gets an exact Gaussian posterior from its own sales, time- and size-adjusted.
  - It is about 90 lines of linear algebra per request. It could run in TypeScript from effect tables.
- (c) LightGBM 4.7.0 (pip in the venv; it imported in under 60 s, no DLL was blocked).
  - Huber and 10%/90% quantile models on the mixed model's residual.
  - 22 features: shipped centre, spread, own, older and other-bedroom evidence minus the mixed centre, reference level and spread, counts, basis, bedrooms, area effect and typical size.
  - Ranges: normalised split conformal, CQR, and a Mondrian "disagree" group.
- (d) Learned comparables, `ml/knn.py`:
  - Neighbours are the area's buildings with 3 or more sales of the same type.
  - Weight = exp(-(3 x other project + 3 x other community + 1 x other metro + 1 x years apart + 2 to 5 x ln size apart)), with the weights chosen per fold.
  - Weighted median, then combined with the building's own evidence by the shipped variances.
- Blend: the mean of the shipped and mixed centres.

## 4. Results

### 4.1 Centre error, all cases (typical / 80th percentile, %)

| Scenario | Shipped | Mixed (b) | Blend | GBM residual (c) | Learned k-NN (d) |
|---|---|---|---|---|---|
| LBO, 1-4 own sales, thinned (10,716) | 3.05 / 7.00 | 3.00 / 6.73 | 2.94 / 6.67 | **2.85 / 6.66** | 3.07 / 7.17 |
| LBO, no own sale, thinned (2,679) | 4.87 / 11.83 | 5.10 / 11.73 | 4.72 / 11.08 | **4.65 / 11.00** | 5.21 / 12.43 |
| LBO, 1-4 own, intact | 2.94 / 6.48 | 2.78 / 6.17 | 2.66 / 5.93 | **2.57 / 5.84** | 2.87 / 6.52 |
| LBO, no own, intact | 4.01 / 8.95 | 3.58 / 7.98 | 3.43 / 7.87 | **3.35 / 7.80** | 4.08 / 8.96 |
| LPO, 1-4 own, thinned | 3.26 / 7.36 | 3.12 / 6.98 | 3.07 / 6.90 | **2.96 / 6.76** | not run |
| LPO, no own, thinned | 6.03 / 13.65 | 5.78 / 13.08 | 5.75 / 12.96 | **5.60 / 12.71** | not run |
| **Forward, 4 cutoffs pooled (1,162)** | 6.11 / 12.69 | 6.26 / 13.28 | not run | 5.94 / 12.50 | not run |
| Forward, the 1,005 cases the shipped rule shows (same cases) | 5.59 / 12.03 | 5.92 / 12.48 | | 5.63 / 11.75 | |

On the same 1,005 forward cases, the GBM is level on typical error (5.63 against 5.59) and better at the 80th percentile (11.75 against 12.03). The mixed model is worse on both.

The reference alone, LBO per cell, median absolute log error: shipped first-available level 0.0712 (80th pct 0.1768), learned k-NN 0.0665 (0.1611), plain area median 0.1062. A better reference, but it adds nothing once the building's own evidence is combined.

### 4.2 Share shown and coverage of the shown ranges

| Scenario | Shipped: shown / held / error shown | Mixed + disagree group | GBM + disagree group |
|---|---|---|---|
| LBO own thinned | 85.0% / 89.2% / 2.76, 6.08 | 99.9%(1) / 80.0% / 3.00, 6.72 | 100% / 80.0% / 2.84, 6.66 |
| LBO indirect thinned | 74.8% / 85.9% / 4.43, 10.50 | 80.7% / 79.0% / 4.68, 10.41 | 81.9% / 79.5% / 4.34, 10.17 |
| LPO own thinned | 86.9% / 88.6% / 3.04, 6.60 | 99.7% / 80.0% | 99.7% / 79.9% |
| LPO indirect thinned | 71.5% / 86.5% / 5.34, 11.79 | 79.3% / 80.2% | 79.3% / 79.7% |
| LBO, shipped `evidence_disagrees` (1,514) | 0% (would have held 61.2%) | 99.9% / 80.0%, half-width 12.0% | 99.9% / 80.0%, half-width 12.0% |
| **Forward pooled, x1.0** | **86.5% / 73.7%** | 99.5% / **58.6%** | 99.5% / **59.9%** |
| **Forward pooled, x1.2** | | 98.7% / **65.9%** | 99.1% / **67.4%** |
| Forward, shipped `evidence_disagrees` (109) | 0% | x1.0 62.4%, x1.2 70.0% (91.7% shown) | x1.0 64.2%, x1.2 73.3% (96.3% shown) |
| Forward, other shipped refusals (48) | 0% | x1.0 50.0%, x1.2 57.1% | x1.0 59.5%, x1.2 69.0% |
| Forward, by cutoff (shipped / GBM x1.2) | 69.7, 70.9, 77.4, 78.1 | | 64.3, 65.7, 69.2, 71.6 |

(1) The "held" figures of the new models on LBO and LPO are about 80% by construction (cross-fitted, nominal 80%). The shipped ranges are wider on purpose (thinCellFactor 1.2) and hold about 89%.

**Mondrian groups.**
- LBO, GBM with the disagree group: ready 80.2%, off-plan 79.8%; bedrooms 0 to 3: 81.6%, 80.0%, 78.7%, 79.1%; k = 0 to 4: 79.5%, 82.4%, 80.3%, 79.3%, 78.0%; disagree 80.0%, agree 79.9%.
- Forward, pooled 4 cutoffs, mixed x1.2: ready 60.8%, off-plan 69.6%; bedrooms 0 to 3: 62.5%, 63.2%, 68.3%, 70.9%. GBM x1.2: 65.3%, 69.0%; 65.9%, 64.6%, 71.3%, 67.4%. Every group is under 72%.
- Shipped on the same forward cases: 69.5%, 76.6%; 72.7%, 71.3%, 78.2%, 70.3%. The shipped tier is also under 80% forward (known, and stated as "about 7 of 10" for the following six months).
- Full tables: `ml/eval_b_lbo.txt`, `ml/eval_b_lpo.txt`, `ml/eval_fwd.txt`.

**Sharpness on the forward cases** (`ml/sharp.py`). Each model's range is scaled until it holds as often as the shipped range does on the same 1,005 cases (73.7%):
- Mixed needs a median half-width of 11.2%, GBM 10.8%. The shipped range does it with 10.0%.
- For the shipped `evidence_disagrees` cases (109), holding 80% needs a half-width of 22.1% (mixed) or 23.2% (GBM). Only 50.5% and 42.2% of those cases would stay under the 20% limit.

**Who would be served today** (`ml/population.py`, 8,825 too-few combinations):
- Mixed with the disagree group (x1.0 or x1.2) would show all 8,066 studio-to-3-bed combinations (91.4%), against 5,909 (67.0%) now.
- That adds every refused case: 1,944 `evidence_disagrees`, 147 `range_too_wide` and 66 `own_sales_only`.
- The 759 with 4 or more bedrooms stay refused.
- Measured forward coverage on such cases: `evidence_disagrees` 62.4% to 73.3% (109 cases); other refusals 50.0% to 69.0% (48 cases).

## 5. Decision

The owner's rule:
- ship only if held-out tests improve typical and 80th-percentile error, or raise the share served;
- keep about 80% or more in every Mondrian group;
- do not reduce forward coverage.

| Condition | Mixed (b) | GBM residual (c) | k-NN (d) |
|---|---|---|---|
| Typical and 80th pct better, LBO / LPO | own yes (small); indirect LBO typical no | yes, both (0.2 to 0.9 points) | no |
| Better on forward | no (6.26 / 13.28 against 6.11 / 12.69) | all cases 5.94 / 12.50 (better); same shown cases 5.63 / 11.75 against 5.59 / 12.03 (typical not better) | not run |
| About 80% in every Mondrian group | hiding tests only; forward 58.6% to 73.3% | hiding tests only; forward under 75% everywhere | |
| Forward coverage not lower than shipped | **no** (65.9% against 73.7%) | **no** (67.4% against 73.7%) | |

**Nothing beats the shipped model, so the product is not changed.**

The gains on the hiding tests come from a finer centre. Forward, the error that matters is market and launch drift, which is common to all methods (median bias +3% to +5% at three of four cutoffs, for every model). The shipped widening already pays for it. Serving the `evidence_disagrees` cases honestly would need ranges wider than the product allows.

The refusals for buildings not in DLD data were not touched.

## 6. Size: what the evidence says

Target: one held-out registered sale of the hidden cell, with its size known as a listing's would be. LBO thinned, 13,372 replicates, `ml/size_test.txt`.

| Sale size against the cell's typical size | Cases | Shipped centre: error, bias | Mixed at typical size | Mixed at the sale's own size |
|---|---|---|---|---|
| All | 13,372 | 5.64 / 13.06, +0.5% | 5.62 / 13.06 | **5.42 / 12.20**, +0.3% |
| 0.8x to 1.25x | 12,376 | 5.37 / 12.20 | 5.35 / 12.14 | 5.18 / 11.65 |
| under 0.8x | 422 | 10.46 / 20.07, +6.7% | 10.41 / 19.67 | 8.93 / 19.30, -2.7% |
| over 1.25x | 574 | 12.64 / 28.23, **-10.5%** | 13.92 / 28.74 | **9.86 / 18.97, +0.5%** |
| over 1.4x | 211 | 20.27 / 37.87, **-17.3%** | 19.63 / 38.90 | **11.82 / 22.78, -1.4%** |

Bias is the truth minus the centre: a negative value means the centre is too high.

Fitted within-cell slopes of ln psf on ln size: studio -0.56 / -0.53, 1-bed -0.45 / -0.32, 2-bed -0.41 / -0.26, 3-bed -0.35 / -0.20 (ready / off-plan). So a unit 30% larger than the building's typical one sells at about 8% to 14% less per sq ft.

**Recommendation** (not done here):
1. A first step costs little and is safe: refuse, or add the size note, when the listing is outside 0.8x to 1.25x of the building cell's typical size. The shipped "below" or "above" is biased by 7% to 17% there.
2. Better: compare at the listing's size with the within-building slope, after a forward test of the size-adjusted range. The truth there has to be single sales or a size-matched median.

## 7. Limits of this work

- The mixed model's LBO fits remove 10% of buildings, not one. That handicaps it on LBO; it does not affect the forward tests.
- The new-model settings were chosen on the LBO harness. The shipped constants used in the forward tests come from the full data. Each choice favours one side.
- Forward cases are few in some groups: 14 with no own sale, 177 three-beds, 109 `evidence_disagrees`, and 226 to 331 per cutoff. Cases from one building or project are not independent.
- k-NN was run on LBO only. The real-thin test C (one sale held out in real 2 to 4 sale cells) was not rerun for the new models. The size test uses thinned rich cells.
- Nothing was implemented in TypeScript, so there is no golden test. The GBM would need tree JSON at runtime. Neither was justified.
- The GBM and mixed-model ranges ignore the uncertainty of the fitted effects. The conformal step absorbs it on average only.

## 8. Files (scratch `model\ml\`)

| File | What |
|---|---|
| `ML_RESEARCH.md` | Literature and web notes with sources |
| `seventh.py`, `seventh2.py`, `seventh2.txt` | Seventh Heaven diagnosis and the candidates' outputs |
| `mm.py` | Mixed model (b) |
| `harness_a.py` | LBO/LPO harness (mirrors `backtest.py` replicates), shipped plus mixed per replicate |
| `eval_a.py`, `eval_b.py`, `eval_b_lbo.txt`, `eval_b_lpo.txt` | Scoring; blend, GBM, CQR, Mondrian with the disagree group |
| `knn.py`, `knn_out.txt` | Learned comparables (d) |
| `fwd.py`, `eval_fwd.py`, `eval_fwd.txt`, `sharp.py` | Forward tests at 4 cutoffs, sharpness check |
| `size_test.py`, `size_test.txt` | Listing-size test |
| `population.py`, `population.txt` | Today's too-few combinations, shown by each rule |
| `out\` | Arrays (npz) per test |
