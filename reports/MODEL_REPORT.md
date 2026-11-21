# Fairsquare: the similar-buildings model (stage 2)

Written 19 Nov 2026. Data: the cleaned snapshot of commit `b982861` (405,649 flat sales, 4,348 buildings, 2023-11-17 to 2026-11-16). "Combination" means one building, one bedroom count and one basis (ready or off-plan). "The 12 months" means 2025-11-16 to 2026-11-16. Errors are percentages of the building's true median AED per sq ft. Internal words such as "model" and "estimate of the median" are used here; none of this is user-visible copy.

## Stage 3 corrections (read first)

This report was checked by an independent verification stage (`VERIFY_REPORT.md`). Three things changed after it was written:

1. **Snapshot.** The data rules gained rule 10a (bulk blocks of like units priced unlike the building's other sales are left out). The snapshot is now commit `a191a29`: 404,366 sales, 4,348 buildings, 13,575 combinations, 8,825 of them too few. Everything was refitted on it.
2. **Wider ranges for known buildings.** Really thin buildings are noisier than the thinned rich buildings of the backtest. The lower and upper multipliers of the `own` and `indirect` classes are multiplied by `thinCellFactor` = 1.2. Typical ranges are now -6.4% to +9.2% (1 to 4 own sales) and -11.0% to +17.7% (none). On the simulated cases of this report the wider range holds the truth about 85% of the time; on really thin buildings it is calibrated to behave like the 80% range did on simulated ones.
3. **Spec.** When a result is not shown, `rangeLowPsf`, `rangeHighPsf` and `verdict` are null.

Sections 1, 5, 8, 11 and 13 and the appendix below are updated. Sections 3, 6 and 7 still show the first run on the earlier snapshot (`b982861`, 405,649 sales) with the ranges before the factor; on the rebuilt snapshot typical and 80th-percentile errors differ by at most 0.15 points (`m2/eval_d1.txt`, `m2/final_d1.txt`). The wrong-call rates of section 6 with the wider ranges are in `VERIFY_REPORT.md`, finding F8: "above" now agrees with the same-building rule 67% of the time (was 62%), and a listing exactly at the building's median is called "above" or "below" about 15% of the time (was 20%).

## 1. In plain language

**What it does.** When the same-building comparison cannot run, the model builds a range for where that building's median should sit. It combines up to five pieces of evidence, each weighted by how reliable the backtest found it:

1. the few same-bedroom sales the building has in the 12 months (1 to 4);
2. its older same-bedroom sales (12 to 24 and 24 to 36 months back);
3. how its other bedroom types sit against similar buildings;
4. the medians of similar buildings: sibling buildings of the same project, else the same community (DLD master project), else the same DLD area. Same bedrooms and same basis always.

The listing is "above" or "below" only when the asking price is outside the range. Otherwise it is "within the range".

**How good it is, for a building that is in the data but has too few sales.** Good.

| Case (building hidden in the test) | Typical error | 8 in 10 within | Range holds the truth |
|---|---|---|---|
| 1 to 4 own sales, plus the building's other evidence | 3.1% | 7.1% | 85% with the wider range of stage 3 (80.0% before it) |
| No own sale in 12 months, other evidence only | 5.1% | 11.9% | 87% with the wider range (81.7% before it) |
| For comparison: one more real sale from the building itself | 4.8% | 12% | |

The rule shows the comparison for **90.4% of the 8,825 too-few combinations** (98.9% of those with studio to 3 bedrooms; 97.8% when weighted by 36-month sales). Combinations with 4 or more bedrooms are never shown: only 11 such test cases exist, so nothing could be checked.

**How good it is for a building that is not in the data. Not good enough, and the rule refuses.** This is the case the owner asked about, so the result is stated bluntly:

- Hiding a known building and using only its area gives a typical error of 10.4%, and 2 in 10 are more than 22.8% off. Knowing the community barely helps (10.7% and 22.0%). No candidate, including boosted trees, got the typical error under 9%. Price differences between buildings of one community are simply that large, and the listing gives nothing else to go on.
- The honest test is worse. I stood at 16 Nov 2025 with only the sales known then, and looked at buildings that first appeared in the following year (1,826 building, bedroom and basis combinations over two start dates, 16 Nov 2025 and 16 Nov 2024). **Real new buildings sold 8% to 12% above the reference of existing buildings.** A range calibrated on hidden existing buildings held the truth only 61% to 66% of the time, against 80% claimed. Almost all misses were on the high side.
- A listing in such a building would be told "above the range of similar buildings" far too often. To keep the 80% claim true for new buildings too, the range has to stretch to about -16% to +45%. That is too wide to show.

So the rule is: **a reference from the community or the area alone is never shown.** A building that is not in the data gets the second tier only when its project is identified and that project has sibling buildings with off-plan sales (range about -16% to +19%, "broad" tier). Everything else keeps today's "Not covered yet".

**What ships.** One small model: medians, a weighted mean and a table of constants. No time index (it did not help). No size adjustment (gain too small and unstable). Plain TypeScript over one precomputed table of 13,575 rows. A reference implementation reproduces the Python results on all 8,827 too-few combinations (largest difference 3e-15), with 35 golden cases.

**Weak spots, in short** (section 10 has all of them):
- The good numbers come from thinning buildings that have many sales. Real thin buildings may behave differently, and their true median cannot be observed.
- Against the *following* year's sales, the range for buildings with 1 to 4 own sales held 71% (2025 start) and 63% (2024 start), not 80%. Part is market movement, part is new buildings whose prices climb after launch.
- When the comparison says "above", the same-building rule would have agreed 62% of the time, said "in line" 36% of the time, and said "below" 1.4% of the time.
- 3-bedroom ranges hold 74% to 77%, a little under the claim.

## 2. What was tested, and how

### 2.1 Target and test design
Target: the product median (0.5x to 2x rule when 5 or more sales) of same-bedroom, same-basis sales of the building in the 12 months.

Test cells: the 2,701 combinations with 10 or more such sales (4,748 with 5 or more, reported separately). For each, the building is hidden and its median is predicted from what the scenario allows.

- **Leave-building-out (LBO):** every sale of the hidden building is removed from every reference.
- **Leave-project-out (LPO):** every building of the same DLD project number is removed too. This is the harder test: no sibling towers.
- **Folds:** 5 folds over project groups. Every fitted number (variance tables, range multipliers, hedonic coefficients, time index, shrinkage weights, the choice among configurations) comes from the other four folds. The cleaning rules of stage 1 work inside one building, so they leak nothing across buildings.
- **No future data:** nothing dated after the comparison date is used. Two comparison dates were run: 16 Nov 2026 (main) and 16 Nov 2025.

Three scenarios:

| | Known about the listing | Evidence allowed |
|---|---|---|
| **S1** | DLD area, bedrooms, basis, size | Other buildings of the area |
| **S2** | Area and community, or the project | Other buildings, by level |
| **S3** | The building itself | The above, plus k = 0 to 4 of its own same-bedroom sales drawn at random, its older same-bedroom sales, its other bedroom types |

For S3 the truth is the median of the sales that were *not* handed over as evidence. S3 was run two ways: with the building's other evidence intact (optimistic), and with all of it thinned at the rate max(k, 1) / n, so the building looks as thin overall as the cell (the headline). Real too-few combinations look like the thinned version: of the 3,358 with no sale in 12 months, only 1,477 have other-bedroom evidence.

### 2.2 Forward check on real cases
The backtest hides buildings that have plenty of sales. Real cases differ, so a second test was added. Stand at a start date with only the sales registered by then; predict; compare with the median of what actually sold in the following 12 months (10 or more sales). Two start dates: 16 Nov 2025 and 16 Nov 2024. The target is one year later, so market movement is included (same cells moved +1.2% ready and +1.3% off-plan from the 2025 start; +9.0% ready and +1.6% off-plan from the 2024 start).

### 2.3 Candidates
Simplest first, all scored the same way:

1. Median of all sales of the area (same bedrooms, same basis).
2. Median of the building medians of the area (each building counts once).
3. **First available level**: project siblings (1 or more buildings), else community (2 or more), else area (3 or more). A comparable building needs 3 or more sales in the 12 months.
4. Shrinkage (empirical Bayes) across project, community and area; weights chosen on the training folds.
5. Weighted comparables: buildings weighted by same project, same community, size similarity; for known buildings also by the price level of other bedroom types, shared nearest metro and build period.
6. Each of the above with sales first moved to the window's level by a monthly index (Dubai by basis, and by area shrunk to Dubai). The index is fitted per fold from repeat buildings.
7. Hedonic regression of log AED per sq ft: bedrooms x basis, size, parking, month, with area, community and project effects (and a building effect in S3).
8. Boosted trees on all of the above, as a ceiling only. scikit-learn's import hung on this PC (application control), so a small boosted-tree learner was written in numpy. It never ships.
9. For S3: precision-weighted combination ("EB") of the reference and the building's own evidence.

Size: a listing size was simulated by drawing one sale of the hidden cell.

## 3. Results for every candidate

Leave-building-out, 16 Nov 2026, cells with 10 or more sales. Chart: `charts/14_candidates.png`. Full tables by segment and for leave-project-out are in the appendix.

**S1, area only (2,701 cells)**

| Candidate | Median abs error | 80th pct | 90th pct | Bias |
|---|---|---|---|---|
| Sale median of the area | 10.2% | 23.3% | 34.1% | +0.4% |
| **Building medians of the area** | 10.4% | 22.8% | 31.7% | -1.9% |
| Same with time index (Dubai / area) | 10.5% / 10.6% | 22.5% / 22.7% | 31.8% / 31.6% | -2.1% |
| With a size term | 10.2% | 22.7% | 31.7% | -2.0% |
| Comparables weighted by size | 9.8% | 22.3% | 31.3% | -1.6% |
| Hedonic | 12.2% | 24.9% | 35.6% | -1.2% |
| Boosted trees (ceiling) | 9.7% | 21.3% | 31.0% | +0.4% |

**S2, community or project known (2,596 cells)**

| Candidate | Median abs error | 80th pct | 90th pct | Bias |
|---|---|---|---|---|
| Building medians of the area | 10.4% | 22.9% | 31.8% | -2.0% |
| **First available level** | 7.1% | 17.5% | 26.2% | -0.3% |
| Same with time index (Dubai) | 7.1% | 17.4% | 26.0% | -0.8% |
| Shrinkage (EB) | 7.3% | 17.5% | 26.1% | -0.5% |
| First available + size term | 6.9% | 17.0% | 25.2% | -0.5% |
| Weighted comparables | 7.1% | 17.3% | 26.0% | -0.4% |
| Hedonic | 8.2% | 18.2% | 27.2% | -0.9% |
| Boosted trees (ceiling) | 6.7% | 16.2% | 24.2% | -0.1% |

S2 is two very different groups:

| | Cells | First available level | Boosted trees |
|---|---|---|---|
| Project siblings exist | 890 | 3.0% / 7.7% / 11.2% | 3.7% / 8.8% / 12.2% |
| Community only | 1,706 | 10.7% / 22.0% / 30.4% | 9.1% / 20.3% / 28.4% |

Under leave-project-out there are no siblings and S2 is 10.5% / 21.8% / 30.8%: the community tells little more than the area.

**S3, building known**

| Candidate | 1 to 4 own sales, thinned (10,804 rows) | No own sale, thinned (2,701 rows) |
|---|---|---|
| Reference only | 7.2% / 17.8% / 26.1% | 7.2% / 17.7% / 26.1% |
| Own sales' median only | 3.2% / 8.3% / 12.6% | none |
| EB: reference + own | 3.2% / 7.8% / 11.5% | 7.2% / 17.7% / 26.1% |
| EB: + older same-bedroom | 3.0% / 7.2% / 10.4% | 5.4% / 13.3% / 20.0% |
| **EB: + older + other bedrooms** | 3.0% / 7.1% / 10.3% | 5.0% / 11.7% / 16.6% |
| EB: + the other basis of the building | 3.0% / 7.2% / 10.4% | 5.0% / 11.6% / 16.6% |
| Same, older sales time-adjusted (Dubai index) | 3.1% / 7.1% / 10.3% | 5.0% / 11.6% / 16.5% |
| Weighted comparables + own + older | 3.1% / 7.2% / 10.5% | 5.4% / 11.9% / 17.5% |
| Hedonic + building effect | 5.1% / 10.7% / 14.7% | 6.6% / 13.7% / 18.7% |
| Boosted trees (ceiling) | 3.0% / 6.9% / 10.2% | 4.6% / 11.0% / 16.2% |

By number of own sales (chosen model, thinned): k=0 5.1% / 11.6%; k=1 3.6% / 8.3%; k=2 3.2% / 7.2%; k=3 2.8% / 6.6%; k=4 2.7% / 6.3%. With the other evidence intact: 3.0% / 6.7% (1 to 4 own sales) and 4.0% / 9.1% (none).

**What the results say**
- **Time adjustment does not help.** It moves the typical error by 0.0 to 0.1 points in every scenario. Its only effect is on bias when older sales are used (-1.2% to -0.6%). It is left out. The index of stage 1 also disagreed with the official one on the size of growth.
- **The hedonic regression is the worst candidate everywhere.** One bedroom effect and one size slope for all of Dubai fit worse than medians taken inside the same bedrooms and basis.
- **Boosted trees are not far ahead.** Level with the chosen model for 1 to 4 own sales (3.0% against 3.0%), 0.5 points better with no own sales, 0.7 points better in S1, and 1.5 points better for community-only S2. Not enough to justify a model that cannot be explained, and the one place it leads is a case that is refused anyway.
- **The other basis of the same building adds nothing** in the backtest and made the forward test worse (section 7). The product rule "never pool" stands.
- **Size**: weighting or adjusting by the listing's size gains 0.2 to 0.6 points. The fitted slope changes sign between levels (-0.20 at community level, +0.2 to +0.4 at area level). Left out.

## 4. The chosen model

**Reference + the building's own evidence, precision-weighted.** It is the simplest candidate within 0.6 points of the best non-ceiling candidate in every scenario, and it runs on medians and one weighted mean.

Each piece of evidence gives an estimate of ln(median AED per sq ft) and a variance measured in the backtest (how far that piece alone lands from the truth, by basis and by count). The result is the mean weighted by 1 / variance; its spread is s = 1 / sqrt(sum of 1 / variance).

| Evidence | Estimate | Spread measured (standard deviation of the log, ready / off-plan) |
|---|---|---|
| Reference: project siblings | median of their medians | 0.057 / 0.040 |
| Reference: community | median of the building medians | sqrt(0.110² + (1.04 x spread)²) / sqrt(0.089² + (0.71 x spread)²) |
| Reference: area | same | sqrt(0.101² + (0.98 x spread)²) / sqrt(0.098² + (0.66 x spread)²) |
| Own sales, k = 1, 2, 3, 4 | their median | 0.094, 0.073, 0.064, 0.056 / 0.054, 0.045, 0.035, 0.034 |
| Older sales, 12 to 24 months (1, 2, 3-4, 5-9, 10-19, 20+ sales) | their median | 0.099 to 0.062 / 0.068 to 0.044 |
| Older sales, 24 to 36 months | their median | 0.165 to 0.095 / 0.107 to 0.061 |
| Other bedroom types (by total sales) | reference + how far the other types sit from their own references | 0.143 to 0.089 / 0.103 to 0.074 |

"Spread" for community and area is (90th - 10th percentile of the comparable buildings' log medians) / 2.563. This statistic sorted errors better than the median absolute deviation: with it, coverage in the narrowest ranges was 80% to 84%; with the other it fell to 67% to 75%.

Ready is harder than off-plan at every step. Older sales from 24 to 36 months back are about as informative as the reference of a tight community; the weights handle that without a time index.

## 5. Ranges

The range is [centre - q_low x s', centre + q_high x s'] in logs, with s' = sqrt(s² + floor²). Per evidence class, the floor and the two multipliers come from the held-out errors (split conformal, each tail 10%). The floor is the value that keeps coverage even between strong and weak evidence; without it the narrowest ranges covered only 73%.

| Evidence class | Floor | q_low | q_high | Source of q_high |
|---|---|---|---|---|
| own (1 to 4 own sales) | 0.03 | 1.504 | 2.004 | leave-building-out (1.253 / 1.670) x 1.2 for really thin buildings |
| indirect (no own sales, older or other-bedroom evidence) | 0.03 | 1.621 | 2.258 | leave-building-out (1.351 / 1.882) x 1.2 |
| project (siblings only) | 0 | 4.2 | 4.2 | forward test on new buildings (47 cases; leave-building-out alone gave 1.73 / 1.89) |
| community | 0.06 | 1.152 | 2.212 | forward test (leave-building-out alone: 1.339) |
| area | 0.06 | 1.113 | 2.558 | forward test (leave-building-out alone: 1.520) |

The upper multiplier is larger than the lower one in every class: buildings are more often well above their evidence than well below it.

**Coverage of the nominal 80% range** (cross-fitted; chart `charts/15_coverage_by_segment.png`):

| Scenario | All | Truth below / above the range | Typical range |
|---|---|---|---|
| S3, 1 to 4 own sales, thinned (LBO) | 79.9% | 10.2% / 9.9% | -5.5% to +7.9% |
| S3, 1 to 4 own sales, intact (LBO) | 79.7% | 9.9% / 10.3% | -5.2% to +7.5% |
| S3, no own sales, thinned (LBO) | 81.7% | 10.0% / 8.3% | -9.3% to +14.3% |
| S3, no own sales, intact (LBO) | 80.0% | 9.4% / 10.6% | -6.3% to +9.5% |
| S3, 1 to 4 own sales, thinned (LPO) | 80.6% | 9.5% / 9.9% | -5.9% to +8.5% |
| S3, no own sales, thinned (LPO) | 80.8% | 9.3% / 9.9% | -10.3% to +16.1% |
| S2, project siblings (LBO, hidden existing buildings) | 96.3% | 1.6% / 2.1% | -15.7% to +18.6% |
| S1 and S2 community (LBO, hidden existing buildings) | 87% to 88% | 10% / 2% | -16% to +43% or +49% |

By segment, S3 with 1 to 4 own sales: basis 79.0% (ready) and 80.3% (off-plan); bedrooms 80.9%, 80.5%, 79.1%, **76.5% (3 or more)**; area price tier 80.5%, 81.3%, 77.8%; by number of own sales 78.9% to 81.0%; by reference level 81.5% (project), 78.9% (community), 78.9% (area); **comparable sales under 30: 75.7%**. S3 with no own sales: 82.1% and 79.0% by basis; **74.1% for 3 or more bedrooms**; **71.1% where the reference is the area (97 cells)**.

**Out of time.** All constants were also fitted as of 16 Nov 2025 and applied unchanged to 16 Nov 2026: coverage 80.1% (1 to 4 own sales, thinned), 82.3% (no own sales), 79.6% and 80.6% (intact), with the same errors (3.1% / 7.2% and 5.1% / 12.0%). The constants are stable over a year.

## 6. Decision rule

In order; the first that applies ends it:

1. Bedrooms above 3: **not shown** (not validated).
2. No evidence at all (no reference and nothing from the building): **not shown**.
3. Evidence class is community or area (nothing from the building, no project siblings): **not shown**.
4. Half-width W = (q_low + q_high) / 2 x s' above 0.20: **not shown**. At 0.20 the top of the range is about 1.5 times the bottom.
5. Otherwise shown. **Close** tier when W is 0.10 or less, **broad** tier otherwise.

Why 0.20: in the backtest the 80th-percentile error passes 20% once W passes 0.20 (chart `charts/19_error_by_range_width.png`; S1 under leave-building-out calibration: 17.7% at W 0.175 to 0.20, 21.4% at 0.20 to 0.25, 25.2% at 0.25 to 0.30, 35.8% beyond).

**What each tier delivers in the backtest (LBO, thinned)**

| | Share | Typical error | 80th pct | Coverage |
|---|---|---|---|---|
| 1 to 4 own sales: close | 94.0% | 3.0% | 7.0% | 79.6% |
| 1 to 4 own sales: broad | 5.6% | 4.6% | 10.0% | 84.3% |
| No own sales: close | 42.2% | 3.4% | 8.1% | 79.6% |
| No own sales: broad | 42.8% | 6.4% | 12.6% | 81.4% |
| No own sales: not shown | 15.0% | 9.1% | 19.0% | |

**Judging a listing.** The range is rounded to the nearest AED 10 per sq ft and the listing is judged against exactly the rounded range: above it, below it, or within.

**How often each outcome is wrong.** Two measurements (chart `charts/17_verdict_by_true_gap.png`).

(a) By the true gap between the asking price and the building's real median, S3 with 1 to 4 own sales, close tier:

| Asking against the true median | -20% | -10% | -5% | 0 | +5% | +10% | +20% |
|---|---|---|---|---|---|---|---|
| Says "above" | 0.3% | 1.2% | 3.6% | 10.0% | 30.3% | 70.8% | 95.9% |
| Says "below" | 97.8% | 79.4% | 40.3% | 10.4% | 3.5% | 1.5% | 0.5% |

Broad tier: a listing 10% above is called "above" 38% of the time, 20% above 82%. A listing exactly at the building's median is called "above" or "below" about 20% of the time in both tiers. That is what an 80% range means.

(b) For listings priced like registered sales (asking drawn from the spread of single sales around their own building's median: half within 3.5%, 80% within 9.4%), against what the same-building rule (5% band) would say:

| Second tier says | Share | Same-building rule: below | in line | above |
|---|---|---|---|---|
| S3, 1 to 4 own sales: "below" | 22.3% | 63.5% | 35.2% | 1.3% |
| "within" | 58.0% | 8.4% | 80.9% | 10.7% |
| "above" | 19.7% | 1.4% | 36.1% | 62.4% |
| S3, no own sales: "below" | 17.7% | 59.2% | 38.7% | 2.2% |
| "within" | 66.5% | 11.6% | 74.8% | 13.6% |
| "above" | 15.7% | 2.8% | 39.6% | 57.6% |

Reading: the direction is almost never reversed (1.3% to 2.8%). But about 36% to 40% of "above" and "below" outcomes fall on listings the same-building rule would call "in line". Real asking prices are spread wider than sale prices, so fewer of them sit near the line; there is no listing data to measure that.

With a 90% range instead: "above" agrees 70.9%, "in line" 27.7%, reversed 1.4%; the "above" and "below" share falls from 42% to 28%, and the close tier from 94% to 58%. This is a product choice (open question 2).

## 7. Forward check on real cases

Constants as fitted on 16 Nov 2025. Truth: the following year's median. Chart: `charts/16_unknown_building_backtest_vs_new.png`.

| Real case | Start | Cells | Typical error | 80th pct | Bias | Range held the truth |
|---|---|---|---|---|---|---|
| Known building, 1 to 4 own sales | 2025 | 167 | 3.6% | 9.5% | -2.0% | 70.7% |
| | 2024 | 174 | 6.4% | 14.1% | -4.4% | 63.2% |
| (their own sales' median alone) | 2025 / 2024 | | 4.1% / 7.0% | 9.7% / 14.3% | | |
| Known building, bedroom type new, basis sold before | 2025 | 52 | 7.7% | 15.8% | -4.5% | 73.1% |
| | 2024 | 35 | 8.3% | 13.1% | +1.2% | 68.6% |
| Known building, never sold on this basis (mostly just completed) | 2025 | 120 | 15.1% | 28.4% | -14.6% | not shown |
| | 2024 | 149 | 29.2% | 38.7% | -29.2% | not shown |
| **New building, area only** | 2025 | 719 | 13.3% | 27.4% | -7.8% | 66.2% before, 84.7% after widening; not shown |
| | 2024 | 1,107 | 14.6% | 26.0% | -10.9% | 61.4% before, 83.6% after; not shown |
| **New building, community known** | 2025 | 671 | 13.1% | 24.6% | -9.9% | 66.3% before, 80.6% after; not shown |
| | 2024 | 1,039 | 14.6% | 24.8% | -12.4% | 64.5% before, 81.5% after; not shown |
| New building, project siblings | 2025 | 47 | 7.6% | 15.8% | -2.0% | 48.9% before, 78.7% after |
| | 2024 | 23 | 5.1% | 14.5% | -0.6% | 60.9% before, 87.0% after |

"Before" is the range calibrated on hidden existing buildings only. "After" uses the upper multipliers of section 5, which were set from these same cases (larger of the two start dates), so "after" is in-sample.

What this shows:
- **New buildings are a different population.** They sell 8% to 12% above existing buildings of the same community, bedrooms and basis. Market movement explains about 1.3 points of it. Hiding an existing building does not reproduce this.
- Limiting the comparables to buildings launched in the last 12, 18 or 24 months did not fix it (bias -4% to -9%, coverage 66% to 70%).
- **A building just completed** sells ready units 15% to 29% above the ready reference of its community. Using its own off-plan sales as evidence made this worse (bias -18.6%): off-plan prices were set years earlier. The rule refuses these because the building has no evidence of its own on that basis.
- **Known buildings with 1 to 4 own sales**: the typical error holds up (3.6%), but coverage against next year's median is 71% and 63%, not 80%. These are mostly new launches whose first registered sales are cheaper than the later ones. The range is stated for the 12 months to the data date; it is not a statement about next year.

## 8. Who gets a result

All 8,827 combinations that are too few today (1 or more sales in 36 months, fewer than 5 used in the 12 months). Chart: `charts/18_too_few_served.png`.

| Group | Combinations | Shown | Close | Broad | Shown, weighted by 36-month sales | Typical half-width |
|---|---|---|---|---|---|---|
| All | 8,825 | 90.4% | 54.1% | 36.3% | 97.8% | 10.1% |
| 1 to 4 sales in 12 months | 5,469 | 93.2% | 72.9% | 20.3% | 98.1% | 9.2% |
| No sale in 12 months, sold earlier | 3,356 | 85.8% | 23.4% | 62.4% | 97.0% | 13.4% |
| Ready | 5,163 | 91.5% | 46.9% | 44.6% | 97.2% | 10.7% |
| Off-plan | 3,662 | 88.8% | 64.2% | 24.6% | 98.0% | 9.2% |
| Studio to 3 bedrooms | 8,066 | 98.9% | 59.2% | 39.7% | 99.9% | 10.0% |
| 4 or more bedrooms | 759 | 0% | | | | |

Not shown: 759 for bedrooms, 92 because the range is too wide. (Before the wider ranges of stage 3: 69.4% close, 21.2% broad.)

Not counted, because the data cannot count them:
- A listing for a bedroom type or basis the building never sold in 36 months. Bedroom type new: usually shown through the other bedroom types. Basis never sold: never shown.
- **Buildings not in the data: 0% shown** for requests that resolve only to an area or a community (781 area x bedroom x basis combinations and 633 community ones were tried). Shown only with project siblings and off-plan basis.

## 9. Area resolver

For a listing whose building was not matched. With the rule above it decides little today (community and area references are never shown), but it is needed to scope a project match and for any later use.

Table: `golden/area-aliases.json`, 251 aliases: 65 DLD area names, 30 master project names that differ from them, 135 common names written by hand, 21 ambiguous names. Each hand-written row was checked against the project names DLD files under that area and master project. Example: "JVC" maps to area "Al Barsha South Fourth", master project "Jumeirah Village Circle".

Algorithm (`ref/resolve.ts`):
1. Normalise: lower case, accents removed, "&" to "and", every run of other characters to one space.
2. Find every alias that occurs as whole words.
3. Drop an alias that lies inside a longer one ("downtown" inside "downtown jebel ali").
4. Ambiguous names (Meydan, MBR City, Dubailand, Jebel Ali, Al Barsha and others span several DLD areas) never resolve on their own.
5. More than one DLD area left: not resolved. One area: keep the master project when exactly one is named, else the area only.
6. Not resolved: no second tier; the result stays "Not covered yet".

Coverage of the 405,649 kept sales: 98.5% are in a DLD area that has a common-name alias; 86.8% are in a community (area and master project) that has one; 10.1% have no master project at all (Bukadra, Dubai Investment Park Second and others resolve to the area only). Every official DLD name also resolves. Areas with no common name: 5,957 sales (Zaabeel First, Al Safouh Second, Trade Center First and Second and smaller ones). 44 test inputs with expected results: `golden/resolver-cases.json`.

Not measured: how listing sites actually write areas. There is no listing data. The alias list is a best effort and will need additions from real unresolved inputs.

Matching a listing to a DLD **project** (the only route that shows a result for an unknown building) is not specified here and not tested. It could reuse the building matcher on the 3,138 project names inside the resolved area, at the strong threshold only. Until that exists, every unknown building keeps "Not covered yet".

## 10. Limitations

1. **Thin cells are simulated.** The test thins buildings that sell a lot. Buildings that are thin in reality (older, larger units, rarely traded) may be more varied. Their true median cannot be observed, so this cannot be checked directly.
2. **Forward coverage is below the claim** for known buildings (71% and 63% against next year). See section 7.
3. **New buildings**: the widened multipliers for project, community and area were set on the forward cases themselves and on one or two years. The project class rests on 47 and 23 cases.
4. **3 bedrooms**: coverage 74% to 77%. **4 or more**: not validated, not shown. **Fewer than 30 comparable sales**: coverage 72% to 76%.
5. **"In line" listings flagged**: section 6. The 5% band of the same-building product is narrower than any second-tier range, so the two tiers will sometimes disagree on the same listing as a building crosses 5 sales.
6. **No size adjustment.** A listing much larger or smaller than the building's usual unit is compared with medians as they are. The existing size note should also show on the second tier.
7. **No time adjustment.** Older sales carry a bias of about -0.5% to -1.2% in a market that rose about 2% a year. In a fast market this would grow; the constants should then be refitted.
8. **Sources are treated as independent** in the weighted mean. They are not; the floor and the multipliers absorb it on average.
9. **Ready and unknown basis**: a listing with no completion status is compared as ready. In a building with only off-plan sales the second tier will not show.
10. **One download**, no listing data, no floor, view or condition. About 8% of price variation stays unexplained whatever is done.
11. **The simulated listing size** was drawn from the hidden cell, which is slightly generous to the size-based candidates. They were not chosen.
12. **Building facts** (project number, master project) are the most common value per building. 13 buildings carry more than one project number.

## 11. Implementation spec

Reference implementation: `ref/similar.ts` (types, `buildArtifact`, `compareSimilar`). Constants: `golden/constants.json`. Golden cases: `golden/golden-cases.json` (35, on the snapshot of commit `a191a29`). Reproduce numbers to 1e-9 relative. An independent implementation written from this section alone reproduces all 35 (`verify/v_golden.py`).

### 11.1 Precomputed (once per snapshot)
One table, `cells`: one row per building x bedrooms x basis with at least one kept sale in the 36 months (13,575 rows; 2.7 MB as JSON). It can be built by `npm run data:build` into the snapshot folder, or by the loader from the `sales` table after each load. The second keeps one source of truth.

| Field | Meaning |
|---|---|
| building | building id (reference: index into a buildings list with key `building|area_dld`, area, master project, project number from `buildings.csv.gz`) |
| bed, basis | 0 to 7; `ready` or `off_plan` |
| nRaw12 | sales with date >= dataThrough - 365 days |
| n12, med12 | count used and product median of those sales (psf = price_aed / size_sqft; with 5 or more sales drop those under 0.5x or over 2x the median, once, recompute) |
| nOld1, medOld1 | sales with dataThrough - 730 <= date < dataThrough - 365: raw count and product median |
| nOld2, medOld2 | sales with dataThrough - 1095 <= date < dataThrough - 730: same |

Product median: sort ascending; (v[(n-1)>>1] + v[n>>1]) / 2.

No monthly index and no per-area tables are needed.

### 11.2 Per request
Input: bedrooms, basis, asking AED per sq ft, and either the building, or a scope {areaDld, masterProject?, projectNumber?} from the resolver.

1. **Comparable cells**: same bedrooms, same basis, same DLD area, nRaw12 >= 3, not the listing's building.
2. **Reference**: first level with enough comparable buildings: project (same project number, 1 or more), community (same master project, 2 or more; only when the master project is not empty), area (3 or more). ref = median of ln(med12) over them (mean of the two middle logs for an even count). spread = 0 for project; else (q90 - q10) / 2.563 of those logs, quantiles by linear interpolation at position q x (n - 1). variance = a2 + b2 x spread², with [a2, b2] from `referenceVariance[level][basis]`.
3. **Building evidence** (known building only):
   - own: the cell's n12 is 1 to 4: estimate ln(med12), variance `evidenceVariance.own[basis][n12]`.
   - older12to24: nOld1 > 0: ln(medOld1), variance by bucket of nOld1. older24to36 the same with nOld2. Buckets: 1 = 1, 2 = 2, 3 = 3 to 4, 4 = 5 to 9, 5 = 10 to 19, 6 = 20 or more.
   - otherBedrooms (needs a reference for the listing's bedrooms): for every other bedroom count j of the building on the same basis with nRaw12 >= 1 and a reference of its own (step 2 for j): w = nRaw12 / (nRaw12 + 3), d = ln(med12_j) - ref_j. offset = sum(w x d) / sum(w); n = sum of nRaw12. Estimate ref + offset, variance by bucket of n.
4. **Combine**: centre = sum(estimate / variance) / sum(1 / variance); s = 1 / sqrt(sum(1 / variance)). Nothing to combine: not shown (`no_evidence`).
5. **Class**: `own` if own evidence was used; else `indirect` if older or other-bedroom evidence was used; else the reference level (`project`, `community`, `area`).
6. **Range**: [floor, qLow, qHigh] = `range80[class]` (the shipped values already include `thinCellFactor`; do not apply it again); s' = sqrt(s² + floor²); low = centre - qLow x s'; high = centre + qHigh x s'; W = (qLow + qHigh) / 2 x s'.
7. **Rule**: bedrooms > 3: `bedrooms_not_validated`. Class community or area: `no_building_evidence`. W > 0.20: `range_too_wide`. Otherwise shown; tier `close` when W <= 0.10, else `broad`.
8. **Output**: rangeLow = round(exp(low) / 10) x 10, rangeHigh likewise. Verdict: asking > rangeHigh: above; asking < rangeLow: below; else within. Also return the level, the number of comparable buildings and their sales (sum of nRaw12), and each piece of building evidence with its count, so the copy can state the evidence. When the result is not shown, `rangeLowPsf`, `rangeHighPsf` and `verdict` are null (the unrounded `lowPsf`, `highPsf` and `halfWidth` are still returned when a centre exists).

When not shown, the existing result shows unchanged ("Too few sales to compare yet" or "Not covered yet").

Cost: 0.03 ms per request in the reference with the table in memory. From Postgres: one query for the cells of the DLD area with the listing's basis (at most a few hundred rows), then arithmetic.

### 11.3 Constants
All in `golden/constants.json`: `minComparableSales` 3; `levelMinBuildings` 1 / 2 / 3; `maxBedrooms` 3; `countBuckets` [1, 2, 3, 5, 10, 20]; `spreadDivisor` 2.563; `otherBedroomsWeightK` 3; `referenceVariance`; `evidenceVariance`; `range80`; `maxHalfWidth` 0.20; `closeHalfWidth` 0.10; `neverShownClasses` [community, area]; `displayRounding` 10. `thinCellFactor` (1.2) and `range80BeforeThinCellFactor` record how `range80` was widened in stage 3; `range80LeaveBuildingOutOnly` is kept for reference. Neither of the two reference tables may be used.

The constants belong to this snapshot's market. Refit them (scripts in section 13) when the data is refreshed with more than a few months of new sales, or at least twice a year.

### 11.4 What the copy may state (facts the result carries)
The level and counts ("registered sales in N similar buildings of the same project / community / area"), the own-evidence counts, the range, the tier, and that the building itself has too few registered sales in the 12 months. The centre must not be shown as a figure. The wording, and the "not a valuation" line, are for the copy stage.

## 12. Open questions for the lead

1. **Unknown buildings stay "Not covered yet".** The evidence says a community or area reference misleads for new buildings. An alternative that makes no claim about the building is a descriptive panel: "registered sales in N buildings of this community, medians from X to Y", with no above or below. The result object already carries what it needs. This is a product and legal decision.
2. **80% or 90% range for the outcome.** 80% as specified: 42% of sale-like listings get "above" or "below", 62% of those agree with the same-building rule. 90%: 28% and 71% to 73%, with wider ranges on screen.
3. **Widen the ranges of known buildings for the forward shortfall?** Using the forward multipliers for the own and indirect classes too would widen ranges by about a third and move many results from close to broad. I kept the leave-building-out values because the stated target is the 12 months to the data date.
4. **4 or more bedrooms** are refused for lack of test cases (759 combinations, 2% of sales). Agree?
5. **Project matching** for unknown buildings is unspecified and untested. Build it, or leave unknown buildings out of the second tier for now?
6. **The edge at 5 sales.** A building with 4 sales shows a range of about -6% to +9%; with 5 it shows the 5% band. Outcomes can flip as a sale is added. Should the copy explain the change of method?
7. **Size note** on second-tier results (limitation 6).

## 13. How this was produced

Scratch folder `model\`. Nothing was changed in the repository; no commit was made in this stage.

| File | What |
|---|---|
| `m2/prep.py` | cleaned analysis file to arrays |
| `m2/bt_build.py` | backtest ingredients for every candidate (both hide modes, three time modes, S3 replicates); run for 16 Nov 2026 and 16 Nov 2025 |
| `m2/gbt.py` | boosted trees in numpy |
| `m2/bt_eval.py` | every candidate scored (`m2/eval_d1.txt`, `eval_d1.json`) |
| `m2/bt_cal.py`, `m2/bt_final.py` | chosen model, variance fits, ranges, tiers, outcomes, out-of-time (`m2/final_d1.txt`, `final_d1.json`; `final_lobo.*` = calibration on hidden existing buildings only) |
| `m2/model.py` | production-form Python port, statistics on all too-few combinations (`population.json`) |
| `m2/model_fwd2.py` | forward check (`forward_c2025.json`) |
| `m2/report_tables.py`, `m2/charts.py` | appendix tables, charts 14 to 19 |
| `ref/similar.ts`, `ref/run.ts` | reference implementation, cross-check, golden cases |
| `ref/resolve.ts`, `ref/make_aliases.py`, `ref/make_constants.py` | resolver, alias table, constants file |
| `golden/` | `constants.json`, `golden-cases.json` (35), `area-aliases.json`, `resolver-cases.json` (44) |

Order to refit: `node work/clean.mts`, `m2/prep.py`, `bt_build.py 1415 d1`, `bt_build.py 1050 d2`, `bt_final.py --nofwd`, `model_fwd2.py c2025`, `bt_final.py`, `make_constants.py` (applies `thinCellFactor`), `model.py`, `node ref/run.ts <snapshot dir> <model dir>`.

Checks run: the TypeScript reference against the Python port on all 8,827 too-few combinations (0 mismatches, largest relative difference 2.9e-15); constants fitted a year earlier applied to the current date; leave-project-out beside leave-building-out; two forward start dates. Not run: nothing was loaded into Postgres, no product test was touched, and the reference has no unit tests of its own beyond the golden cases.

## Appendix: all result tables

Regenerated in stage 3 on the snapshot of commit `a191a29`. Coverage figures here are for the ranges before `thinCellFactor`.


#### S1: building unknown, area known (leave-building-out)

Each cell: median absolute % error / 80th percentile / 90th percentile / bias (median signed %).

| Segment | Cells | Sale median of the area | Building medians of the area | Same, time index (area) | Similar, size-weighted | Hedonic | Boosted trees |
|---|---|---|---|---|---|---|---|
| All | 2,697 | 10.1 / 23.2 / 33.9 / +0.4 | 10.3 / 22.6 / 31.5 / -1.9 | 10.5 / 22.5 / 31.4 / -2.2 | 9.6 / 22.1 / 31.2 / -1.6 | 12.0 / 24.7 / 35.4 / -1.2 | 9.9 / 21.2 / 30.4 / -0.0 |
| Area price tier: lower | 917 | 12.0 / 24.6 / 36.6 / +1.0 | 11.9 / 24.5 / 33.9 / -1.9 | 12.0 / 24.5 / 33.6 / -2.0 | 10.4 / 23.3 / 33.2 / -1.3 | 12.2 / 26.4 / 38.3 / -1.0 | 11.3 / 22.4 / 32.7 / +0.4 |
| Area price tier: middle | 943 | 8.0 / 17.3 / 25.4 / +0.4 | 8.0 / 17.5 / 23.5 / -0.9 | 8.0 / 17.2 / 23.8 / -1.2 | 7.9 / 17.2 / 23.4 / -0.9 | 10.5 / 20.7 / 27.6 / -1.7 | 7.9 / 16.3 / 22.5 / -0.2 |
| Area price tier: upper | 837 | 11.7 / 27.5 / 40.2 / -0.1 | 11.6 / 27.7 / 36.2 / -3.5 | 11.9 / 27.7 / 35.9 / -3.9 | 11.5 / 26.8 / 37.5 / -3.2 | 13.3 / 28.9 / 41.5 / -1.0 | 11.4 / 25.9 / 35.1 / -0.3 |
| Ready | 811 | 12.4 / 28.0 / 39.3 / -2.6 | 13.3 / 28.7 / 37.5 / -3.9 | 13.4 / 28.0 / 37.1 / -4.2 | 12.8 / 25.9 / 38.7 / -3.1 | 16.3 / 35.3 / 48.7 / +4.3 | 13.0 / 26.9 / 37.1 / +0.6 |
| Off-plan | 1,886 | 9.3 / 21.5 / 30.9 / +1.2 | 9.4 / 20.2 / 28.0 / -1.5 | 9.4 / 19.9 / 27.9 / -1.6 | 8.7 / 20.5 / 28.3 / -1.3 | 10.7 / 22.1 / 28.9 / -2.4 | 8.8 / 19.4 / 27.0 / -0.3 |
| Studio | 591 | 8.4 / 19.8 / 30.1 / +0.3 | 9.1 / 19.5 / 27.3 / -1.3 | 9.2 / 19.7 / 27.3 / -1.4 | 8.3 / 18.8 / 26.2 / -0.9 | 11.2 / 21.9 / 33.4 / +1.3 | 8.2 / 17.5 / 25.8 / -0.4 |
| 1 bed | 1,133 | 10.7 / 24.1 / 34.8 / +1.2 | 10.8 / 22.9 / 31.8 / -2.4 | 10.8 / 22.7 / 32.4 / -2.6 | 9.7 / 22.3 / 31.2 / -2.0 | 11.2 / 23.7 / 33.1 / -1.6 | 10.0 / 21.1 / 30.4 / +0.3 |
| 2 bed | 777 | 11.0 / 24.0 / 35.0 / -0.2 | 10.4 / 24.4 / 33.1 / -2.0 | 10.5 / 24.5 / 32.5 / -2.1 | 10.3 / 23.6 / 32.6 / -1.9 | 12.9 / 26.4 / 36.3 / -1.3 | 11.1 / 23.4 / 32.5 / +0.0 |
| 3 bed or more | 196 | 12.3 / 22.5 / 32.1 / -2.1 | 12.3 / 24.8 / 31.3 / -3.8 | 12.5 / 24.8 / 31.3 / -4.8 | 10.8 / 24.6 / 34.8 / -1.0 | 16.4 / 31.6 / 45.5 / -5.0 | 12.3 / 24.8 / 37.3 / -0.4 |
| Comparable sales under 30 | 100 | 8.8 / 24.1 / 33.1 / -1.6 | 11.7 / 26.1 / 33.5 / -0.7 | 12.6 / 26.0 / 34.5 / -1.5 | 12.9 / 25.0 / 29.7 / -1.9 | 12.5 / 29.1 / 37.0 / -3.3 | 14.3 / 28.9 / 32.9 / +3.2 |
| Comparable sales 30 to 99 | 123 | 8.3 / 20.7 / 31.5 / -2.3 | 11.2 / 24.1 / 36.8 / -2.3 | 11.0 / 23.8 / 36.5 / -3.2 | 10.1 / 24.8 / 38.1 / -2.0 | 11.7 / 27.1 / 44.7 / -1.5 | 10.5 / 23.6 / 35.1 / -0.8 |
| Comparable sales 100 to 299 | 480 | 9.9 / 21.4 / 29.6 / -1.4 | 10.6 / 21.5 / 29.5 / -1.9 | 10.6 / 21.4 / 28.4 / -2.1 | 8.9 / 21.5 / 29.5 / -1.6 | 14.7 / 28.1 / 42.7 / -0.9 | 11.6 / 21.0 / 32.4 / +0.2 |
| Comparable sales 300 or more | 1,994 | 10.4 / 23.8 / 35.0 / +1.0 | 10.2 / 22.8 / 31.8 / -1.9 | 10.4 / 22.9 / 31.9 / -2.2 | 9.6 / 22.1 / 31.4 / -1.6 | 11.5 / 23.6 / 32.4 / -1.2 | 9.5 / 21.1 / 29.7 / -0.0 |
| Comparable buildings 1 to 4 | 132 | 6.6 / 20.7 / 30.4 / -0.3 | 8.5 / 22.2 / 29.9 / +0.2 | 8.7 / 20.6 / 30.4 / -0.5 | 9.1 / 20.3 / 29.1 / +0.5 | 9.9 / 20.8 / 28.8 / -0.6 | 9.4 / 24.4 / 30.3 / +1.0 |
| Comparable buildings 5 to 19 | 656 | 8.5 / 18.9 / 27.5 / -0.6 | 8.6 / 18.6 / 26.3 / -0.9 | 8.8 / 18.4 / 26.1 / -1.2 | 8.0 / 19.9 / 27.0 / -1.0 | 12.1 / 23.7 / 34.5 / -2.9 | 9.2 / 18.1 / 25.9 / -0.4 |
| Comparable buildings 20 to 49 | 897 | 10.4 / 23.1 / 32.2 / +0.5 | 10.4 / 22.0 / 31.6 / -2.3 | 10.7 / 21.8 / 31.5 / -2.7 | 10.1 / 20.8 / 31.0 / -1.5 | 12.0 / 24.7 / 35.3 / -1.6 | 10.2 / 21.0 / 31.0 / +0.3 |
| Comparable buildings 50 or more | 991 | 12.0 / 27.1 / 39.1 / +2.2 | 11.7 / 25.5 / 35.0 / -3.0 | 11.7 / 25.6 / 34.8 / -3.2 | 10.6 / 24.9 / 33.9 / -2.8 | 12.0 / 26.2 / 36.9 / +0.8 | 10.5 / 23.3 / 32.5 / +0.0 |

#### S2: building unknown, community or project known (leave-building-out)

Each cell: median absolute % error / 80th percentile / 90th percentile / bias (median signed %).

| Segment | Cells | Building medians of the area | First available level (chosen reference) | Same, time index (Dubai) | Shrinkage (EB) | Similar, weighted comparables | Hedonic | Boosted trees |
|---|---|---|---|---|---|---|---|---|
| All | 2,592 | 10.4 / 22.8 / 31.7 / -2.0 | 7.0 / 17.4 / 26.0 / -0.3 | 7.0 / 17.3 / 25.8 / -0.8 | 7.1 / 17.4 / 26.1 / -0.2 | 7.1 / 17.3 / 25.8 / -0.4 | 8.1 / 18.2 / 27.1 / -1.0 | 6.6 / 15.7 / 23.4 / -0.1 |
| Area price tier: lower | 908 | 11.9 / 24.5 / 34.0 / -1.8 | 7.8 / 17.3 / 25.9 / -0.7 | 7.9 / 17.4 / 25.7 / -1.2 | 8.3 / 17.4 / 25.7 / -0.5 | 7.8 / 17.7 / 25.6 / -0.6 | 7.9 / 17.8 / 25.8 / -1.2 | 6.4 / 15.8 / 23.7 / -0.2 |
| Area price tier: middle | 917 | 8.0 / 17.5 / 23.6 / -1.0 | 5.8 / 14.4 / 20.4 / +0.0 | 5.9 / 14.7 / 20.1 / -0.4 | 5.7 / 14.2 / 20.1 / -0.0 | 6.1 / 14.2 / 20.3 / -0.1 | 7.3 / 16.1 / 21.8 / -1.4 | 5.9 / 13.6 / 18.5 / -0.2 |
| Area price tier: upper | 767 | 11.9 / 28.5 / 36.7 / -3.8 | 7.5 / 22.1 / 32.2 / -0.4 | 7.4 / 22.6 / 32.6 / -0.8 | 7.6 / 22.9 / 32.4 / -0.4 | 7.5 / 21.9 / 31.3 / -0.5 | 10.5 / 23.7 / 35.7 / -0.1 | 7.8 / 19.8 / 30.1 / +0.1 |
| Ready | 797 | 13.4 / 28.8 / 37.6 / -3.8 | 10.0 / 22.7 / 32.1 / -2.0 | 9.7 / 23.3 / 32.2 / -2.5 | 10.2 / 23.4 / 32.4 / -2.0 | 9.9 / 22.7 / 32.7 / -1.9 | 11.7 / 24.9 / 37.1 / +0.0 | 9.2 / 20.2 / 29.5 / +0.9 |
| Off-plan | 1,795 | 9.4 / 20.2 / 28.1 / -1.5 | 5.9 / 14.7 / 22.5 / +0.0 | 5.9 / 14.7 / 22.6 / -0.4 | 5.9 / 14.7 / 22.4 / +0.0 | 6.0 / 14.8 / 22.1 / -0.0 | 7.1 / 16.2 / 22.5 / -1.3 | 5.8 / 14.1 / 20.7 / -0.4 |
| Studio | 575 | 8.8 / 19.1 / 27.5 / -1.3 | 6.4 / 16.7 / 26.1 / -0.4 | 6.5 / 16.7 / 25.6 / -0.7 | 6.5 / 16.5 / 24.9 / -0.4 | 6.4 / 16.4 / 25.8 / -0.4 | 8.1 / 17.2 / 26.1 / -0.6 | 6.1 / 15.6 / 23.2 / -0.4 |
| 1 bed | 1,091 | 10.9 / 23.1 / 32.2 / -2.5 | 7.4 / 18.1 / 26.4 / -0.2 | 7.5 / 18.2 / 26.5 / -0.8 | 7.6 / 17.9 / 26.5 / -0.2 | 7.6 / 17.7 / 26.2 / -0.2 | 7.7 / 17.9 / 26.4 / -1.0 | 6.7 / 15.3 / 21.9 / +0.0 |
| 2 bed | 741 | 10.4 / 24.4 / 33.1 / -2.1 | 6.7 / 16.9 / 24.8 / -0.5 | 6.4 / 17.0 / 24.3 / -0.8 | 6.8 / 17.3 / 25.3 / -0.2 | 6.8 / 17.5 / 25.2 / -0.4 | 8.9 / 18.2 / 27.1 / -1.2 | 6.9 / 16.0 / 24.1 / -0.2 |
| 3 bed or more | 185 | 12.5 / 24.8 / 31.3 / -3.6 | 6.9 / 17.6 / 28.9 / +0.2 | 7.3 / 17.4 / 28.7 / -0.6 | 7.1 / 18.3 / 30.5 / +0.0 | 7.4 / 17.9 / 24.7 / -0.8 | 9.7 / 23.7 / 35.2 / -0.9 | 8.0 / 17.9 / 26.8 / -0.3 |
| Comparable sales under 30 | 467 | 9.5 / 24.3 / 35.2 / -3.4 | 4.3 / 10.2 / 16.9 / -0.1 | 4.4 / 10.3 / 17.3 / -0.7 | 4.4 / 10.7 / 17.2 / -0.1 | 4.2 / 10.9 / 16.7 / -0.3 | 6.5 / 15.4 / 21.1 / -0.3 | 5.0 / 11.8 / 17.2 / +0.4 |
| Comparable sales 30 to 99 | 427 | 9.5 / 21.4 / 31.3 / -4.1 | 3.4 / 10.2 / 17.3 / +0.0 | 3.5 / 10.1 / 17.5 / -0.6 | 3.3 / 10.5 / 17.3 / +0.0 | 3.6 / 10.7 / 18.8 / -0.2 | 5.5 / 14.3 / 19.6 / -1.6 | 5.0 / 10.7 / 16.0 / +0.6 |
| Comparable sales 100 to 299 | 507 | 12.7 / 24.8 / 33.0 / -3.6 | 7.4 / 18.9 / 26.3 / -0.6 | 7.7 / 19.1 / 25.8 / -1.1 | 7.8 / 19.0 / 26.0 / -0.5 | 7.6 / 19.1 / 26.6 / -0.6 | 9.2 / 20.1 / 28.8 / -0.8 | 7.0 / 17.3 / 25.0 / -0.8 |
| Comparable sales 300 or more | 1,191 | 10.1 / 22.2 / 29.6 / +0.0 | 10.0 / 20.8 / 29.0 / -0.6 | 9.9 / 20.3 / 28.9 / -0.8 | 10.0 / 20.9 / 29.0 / -0.4 | 9.6 / 20.3 / 29.1 / -0.2 | 9.7 / 20.1 / 29.4 / -1.0 | 8.3 / 18.1 / 25.9 / -0.3 |
| Comparable buildings 1 to 4 | 948 | 8.9 / 21.9 / 32.0 / -4.2 | 3.3 / 9.0 / 13.9 / +0.0 | 3.4 / 8.7 / 14.2 / -0.5 | 3.3 / 9.1 / 13.5 / +0.0 | 3.2 / 9.1 / 14.0 / -0.1 | 5.4 / 12.9 / 17.3 / -0.6 | 4.2 / 9.8 / 14.8 / +0.0 |
| Comparable buildings 5 to 19 | 534 | 11.1 / 23.1 / 32.9 / +1.2 | 9.6 / 20.2 / 30.3 / +0.1 | 9.4 / 20.2 / 30.0 / -0.2 | 10.3 / 20.3 / 30.8 / +0.7 | 9.4 / 20.7 / 29.5 / +0.1 | 9.8 / 22.1 / 29.2 / -1.8 | 8.8 / 19.2 / 28.3 / +0.4 |
| Comparable buildings 20 to 49 | 561 | 10.8 / 22.3 / 29.1 / -0.5 | 9.7 / 20.5 / 26.8 / -1.9 | 9.6 / 20.3 / 27.1 / -2.1 | 10.0 / 20.7 / 27.2 / -1.6 | 9.6 / 20.1 / 26.4 / -1.7 | 10.7 / 20.4 / 28.8 / -2.0 | 9.5 / 17.8 / 26.2 / -0.1 |
| Comparable buildings 50 or more | 536 | 11.1 / 25.2 / 33.6 / -1.9 | 11.3 / 24.5 / 32.8 / -2.5 | 11.3 / 24.3 / 33.5 / -2.7 | 11.3 / 24.5 / 32.6 / -2.5 | 11.0 / 23.8 / 32.5 / -1.9 | 10.5 / 23.8 / 35.8 / +0.2 | 8.3 / 20.0 / 29.0 / -0.8 |

#### S3: building known, 1 to 4 own sales, the building's other evidence thinned (leave-building-out)

Each cell: median absolute % error / 80th percentile / 90th percentile / bias (median signed %).

| Segment | Cells | Reference only | Own sales only | Chosen: reference + own + older + other bedrooms | Similar buildings #4 + own + older | Hedonic + building effect | Boosted trees |
|---|---|---|---|---|---|---|---|
| All | 10,788 | 7.1 / 17.7 / 26.0 / -0.3 | 3.3 / 8.4 / 12.8 / +0.0 | 3.0 / 7.0 / 10.2 / -0.6 | 3.1 / 7.2 / 10.6 / -0.4 | 5.0 / 10.6 / 15.0 / -0.1 | 3.0 / 6.9 / 10.2 / -0.0 |
| Area price tier: lower | 3,636 | 7.8 / 17.4 / 25.2 / -0.5 | 3.2 / 7.9 / 12.2 / +0.0 | 3.1 / 7.0 / 10.2 / -0.7 | 3.1 / 7.3 / 10.7 / -0.5 | 4.9 / 9.9 / 14.5 / -0.5 | 3.0 / 6.8 / 10.3 / -0.1 |
| Area price tier: middle | 3,792 | 6.0 / 14.6 / 21.3 / -0.1 | 2.8 / 7.8 / 12.0 / -0.0 | 2.8 / 6.7 / 9.6 / -0.7 | 2.9 / 6.8 / 9.9 / -0.5 | 4.4 / 9.4 / 13.4 / -0.4 | 2.7 / 6.4 / 9.3 / -0.1 |
| Area price tier: upper | 3,360 | 7.6 / 21.9 / 31.3 / -0.3 | 4.1 / 9.6 / 14.4 / -0.0 | 3.2 / 7.3 / 10.7 / -0.4 | 3.4 / 7.6 / 11.2 / -0.3 | 6.1 / 12.7 / 16.5 / +0.9 | 3.5 / 7.5 / 11.1 / +0.3 |
| Ready | 3,244 | 9.9 / 22.3 / 31.6 / -2.2 | 4.8 / 10.8 / 15.8 / -0.2 | 4.0 / 8.5 / 12.2 / -1.4 | 4.3 / 9.0 / 12.9 / -1.3 | 5.9 / 12.2 / 16.8 / +1.0 | 4.0 / 8.4 / 11.8 / +0.2 |
| Off-plan | 7,544 | 6.0 / 15.1 / 23.1 / +0.0 | 2.7 / 7.2 / 11.3 / +0.0 | 2.7 / 6.2 / 9.1 / -0.4 | 2.7 / 6.3 / 9.5 / -0.2 | 4.6 / 10.0 / 14.1 / -0.4 | 2.7 / 6.2 / 9.2 / -0.1 |
| Studio | 2,364 | 6.6 / 16.8 / 25.7 / -0.2 | 3.2 / 8.3 / 12.6 / +0.1 | 2.9 / 6.8 / 10.0 / -0.5 | 3.1 / 7.1 / 10.7 / -0.5 | 4.7 / 9.8 / 14.1 / +0.3 | 2.9 / 6.7 / 9.8 / +0.1 |
| 1 bed | 4,532 | 7.6 / 18.4 / 26.4 / -0.2 | 3.3 / 8.2 / 12.5 / -0.0 | 3.0 / 6.9 / 10.0 / -0.7 | 3.0 / 7.1 / 10.3 / -0.5 | 4.7 / 9.9 / 13.9 / -0.6 | 3.0 / 6.8 / 10.3 / -0.1 |
| 2 bed | 3,108 | 6.8 / 17.4 / 25.2 / -0.5 | 3.6 / 9.0 / 13.8 / -0.0 | 3.1 / 7.4 / 10.5 / -0.5 | 3.3 / 7.5 / 10.9 / -0.4 | 5.2 / 11.0 / 15.2 / +0.5 | 3.1 / 7.3 / 10.2 / -0.1 |
| 3 bed or more | 784 | 6.9 / 16.6 / 27.3 / -0.0 | 2.7 / 7.2 / 11.1 / +0.1 | 3.1 / 6.6 / 10.5 / -0.1 | 2.6 / 6.5 / 10.2 / -0.1 | 7.5 / 15.2 / 19.6 / +0.9 | 3.1 / 6.8 / 11.0 / +0.2 |
| Comparable sales under 30 | 1,944 | 4.5 / 10.8 / 17.4 / -0.2 | 3.6 / 8.9 / 13.5 / +0.0 | 3.3 / 7.3 / 10.9 / -0.8 | 3.1 / 7.2 / 11.1 / -0.6 | 5.5 / 11.3 / 16.6 / +0.4 | 3.3 / 7.2 / 11.1 / -0.2 |
| Comparable sales 30 to 99 | 1,724 | 3.5 / 10.1 / 17.7 / +0.1 | 2.9 / 7.4 / 12.0 / +0.0 | 2.4 / 5.8 / 8.9 / -0.2 | 2.7 / 6.2 / 9.4 / -0.4 | 4.9 / 10.5 / 14.2 / -0.7 | 2.5 / 5.8 / 8.8 / -0.0 |
| Comparable sales 100 to 299 | 2,088 | 7.6 / 18.9 / 26.4 / -0.7 | 3.0 / 8.4 / 12.9 / +0.0 | 3.0 / 7.8 / 11.3 / -0.5 | 3.1 / 8.0 / 12.0 / -0.3 | 5.3 / 10.7 / 15.2 / +0.2 | 3.0 / 7.5 / 11.2 / +0.1 |
| Comparable sales 300 or more | 5,032 | 9.8 / 20.9 / 28.8 / -0.5 | 3.4 / 8.5 / 12.6 / -0.0 | 3.2 / 7.0 / 9.9 / -0.7 | 3.3 / 7.1 / 10.2 / -0.4 | 4.8 / 10.2 / 14.6 / -0.1 | 3.1 / 6.9 / 9.9 / +0.0 |
| Comparable buildings 1 to 4 | 3,844 | 3.2 / 9.3 / 13.8 / +0.0 | 2.8 / 7.5 / 11.8 / +0.0 | 2.5 / 6.1 / 9.2 / -0.4 | 2.6 / 6.4 / 9.5 / -0.4 | 4.7 / 10.0 / 14.2 / -0.2 | 2.6 / 6.0 / 9.1 / -0.1 |
| Comparable buildings 5 to 19 | 2,228 | 9.7 / 20.2 / 29.1 / +0.0 | 3.2 / 8.8 / 14.3 / +0.1 | 3.1 / 7.8 / 11.2 / -0.3 | 3.3 / 7.9 / 11.9 / -0.3 | 5.3 / 11.2 / 15.8 / +0.3 | 3.3 / 7.6 / 11.6 / +0.4 |
| Comparable buildings 20 to 49 | 2,464 | 9.6 / 20.4 / 26.8 / -1.7 | 3.4 / 8.2 / 11.9 / -0.1 | 3.3 / 7.1 / 9.9 / -1.1 | 3.4 / 7.3 / 10.2 / -0.8 | 4.9 / 10.2 / 14.5 / -0.7 | 3.2 / 7.0 / 9.9 / -0.2 |
| Comparable buildings 50 or more | 2,168 | 11.4 / 24.5 / 32.1 / -2.9 | 4.0 / 9.6 / 14.4 / -0.0 | 3.4 / 7.6 / 10.7 / -0.7 | 3.5 / 7.8 / 11.3 / -0.2 | 5.4 / 11.2 / 15.9 / +0.7 | 3.5 / 7.5 / 10.6 / +0.2 |

#### S3: building known, no own sale in 12 months, other evidence thinned (leave-building-out)

Each cell: median absolute % error / 80th percentile / 90th percentile / bias (median signed %).

| Segment | Cells | Reference only | Chosen: reference + own + older + other bedrooms | Similar buildings #4 + own + older | Hedonic + building effect | Boosted trees |
|---|---|---|---|---|---|---|
| All | 2,697 | 7.1 / 17.6 / 26.0 / -0.3 | 5.0 / 11.7 / 17.1 / -1.1 | 5.4 / 12.2 / 17.2 / -0.7 | 6.6 / 13.6 / 19.1 / -0.3 | 4.7 / 10.9 / 16.2 / +0.0 |
| Area price tier: lower | 909 | 7.7 / 17.3 / 25.4 / -0.6 | 5.7 / 12.1 / 18.4 / -1.5 | 5.8 / 12.7 / 18.0 / -1.1 | 6.5 / 13.0 / 19.1 / -0.8 | 4.9 / 11.7 / 17.4 / -0.4 |
| Area price tier: middle | 948 | 5.9 / 14.6 / 21.2 / -0.0 | 5.0 / 10.6 / 14.8 / -0.9 | 5.0 / 11.3 / 16.2 / -0.5 | 5.6 / 12.0 / 16.7 / -0.6 | 4.4 / 10.1 / 13.7 / +0.1 |
| Area price tier: upper | 840 | 7.6 / 21.9 / 31.5 / -0.4 | 4.5 / 12.3 / 18.2 / -0.7 | 5.5 / 13.0 / 18.9 / -0.6 | 7.7 / 16.2 / 21.4 / +0.9 | 4.8 / 11.9 / 17.4 / +0.6 |
| Ready | 811 | 9.9 / 22.5 / 31.8 / -2.1 | 6.2 / 13.0 / 19.2 / -2.5 | 6.6 / 13.4 / 18.3 / -1.5 | 7.8 / 16.1 / 21.7 / +1.9 | 5.7 / 12.9 / 18.0 / +0.0 |
| Off-plan | 1,886 | 6.0 / 15.0 / 22.9 / +0.0 | 4.6 / 11.1 / 16.1 / -0.6 | 5.1 / 11.6 / 16.8 / -0.5 | 6.0 / 12.5 / 17.9 / -0.9 | 4.4 / 10.3 / 15.4 / +0.1 |
| Studio | 591 | 6.7 / 16.8 / 25.9 / -0.4 | 5.4 / 12.0 / 16.8 / -1.4 | 5.9 / 12.7 / 18.3 / -1.1 | 6.4 / 12.5 / 20.0 / +0.4 | 4.7 / 11.0 / 16.5 / +0.1 |
| 1 bed | 1,133 | 7.4 / 18.1 / 26.2 / -0.2 | 5.1 / 11.8 / 17.6 / -1.1 | 5.5 / 12.2 / 16.6 / -0.6 | 6.2 / 13.0 / 18.7 / -0.8 | 4.8 / 10.9 / 15.6 / -0.0 |
| 2 bed | 777 | 6.8 / 17.4 / 25.0 / -0.4 | 5.0 / 11.5 / 16.3 / -0.8 | 5.1 / 11.8 / 17.4 / -0.7 | 6.6 / 14.4 / 18.6 / +0.2 | 4.6 / 11.1 / 16.1 / +0.1 |
| 3 bed or more | 196 | 7.0 / 17.7 / 29.3 / -0.0 | 4.7 / 10.8 / 17.7 / +0.2 | 5.5 / 12.9 / 19.8 / +0.0 | 9.2 / 17.3 / 22.7 / +0.7 | 5.0 / 10.1 / 17.2 / +0.3 |
| Comparable sales under 30 | 486 | 4.3 / 10.4 / 17.2 / -0.0 | 4.2 / 9.5 / 14.3 / -0.4 | 4.6 / 10.5 / 15.2 / -0.8 | 6.9 / 13.9 / 19.1 / +0.3 | 4.1 / 9.0 / 13.8 / +0.2 |
| Comparable sales 30 to 99 | 431 | 3.4 / 10.3 / 17.3 / +0.0 | 3.5 / 9.2 / 12.3 / -0.4 | 4.3 / 10.2 / 14.5 / -0.7 | 5.4 / 12.9 / 17.2 / -1.5 | 3.4 / 8.4 / 12.2 / -0.2 |
| Comparable sales 100 to 299 | 522 | 7.4 / 18.9 / 26.2 / -0.6 | 5.0 / 12.1 / 18.3 / -1.4 | 5.2 / 13.2 / 19.1 / -0.8 | 7.1 / 13.6 / 18.8 / -0.3 | 4.8 / 11.7 / 17.2 / -0.0 |
| Comparable sales 300 or more | 1,258 | 9.9 / 20.6 / 28.9 / -0.6 | 6.3 / 13.2 / 18.4 / -1.5 | 6.2 / 13.3 / 18.1 / -0.7 | 6.6 / 13.8 / 20.1 / +0.2 | 5.8 / 12.6 / 17.6 / +0.1 |
| Comparable buildings 1 to 4 | 961 | 3.3 / 9.1 / 14.0 / +0.0 | 3.1 / 8.5 / 11.9 / -0.3 | 3.8 / 9.6 / 13.6 / -0.5 | 5.6 / 12.2 / 16.8 / -0.6 | 3.2 / 8.0 / 11.4 / +0.1 |
| Comparable buildings 5 to 19 | 557 | 9.6 / 20.1 / 29.6 / -0.1 | 6.0 / 13.5 / 18.9 / -1.2 | 6.8 / 14.2 / 19.7 / -0.3 | 7.0 / 14.5 / 20.1 / -0.2 | 5.6 / 13.3 / 17.8 / +0.6 |
| Comparable buildings 20 to 49 | 616 | 9.5 / 20.3 / 26.7 / -1.6 | 6.3 / 13.6 / 19.4 / -2.5 | 6.2 / 13.4 / 18.3 / -1.4 | 7.1 / 14.1 / 19.2 / -0.8 | 5.6 / 12.5 / 18.0 / -0.6 |
| Comparable buildings 50 or more | 542 | 11.3 / 24.6 / 32.4 / -2.6 | 6.8 / 13.5 / 19.3 / -1.9 | 6.4 / 13.6 / 18.9 / -0.7 | 7.2 / 14.8 / 21.4 / +1.4 | 6.7 / 13.1 / 18.4 / +0.3 |

#### S1 area only (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 2,673 | 99.1% | 10.14 | 23.18 | 33.91 | +0.41 | 27.9% | 49.3% |
| building medians (area) | 2,614 | 96.9% | 10.34 | 22.63 | 31.55 | -1.93 | 27.5% | 48.6% |
| building medians (area), index Dubai | 2,614 | 96.9% | 10.42 | 22.49 | 31.65 | -2.11 | 27.3% | 48.6% |
| building medians (area), index area | 2,614 | 96.9% | 10.54 | 22.47 | 31.41 | -2.18 | 27.6% | 48.3% |
| area + size term | 2,614 | 96.9% | 10.21 | 22.56 | 31.28 | -2.06 | 28.0% | 49.0% |
| similar: size-weighted | 2,614 | 96.9% | 9.57 | 22.14 | 31.23 | -1.61 | 29.9% | 51.7% |
| similar: size-weighted, index | 2,614 | 96.9% | 9.70 | 22.00 | 31.12 | -1.99 | 29.2% | 51.1% |
| hedonic | 2,694 | 99.9% | 11.99 | 24.69 | 35.36 | -1.19 | 22.9% | 43.2% |
| boosted trees (ceiling) | 2,614 | 96.9% | 9.94 | 21.23 | 30.44 | -0.04 | 28.7% | 50.2% |

#### S2 community and/or project known (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 2,578 | 99.5% | 10.17 | 23.31 | 34.26 | +0.41 | 27.9% | 49.3% |
| building medians (area) | 2,526 | 97.5% | 10.38 | 22.82 | 31.74 | -2.00 | 27.3% | 48.4% |
| first available level | 2,567 | 99.0% | 7.02 | 17.39 | 26.04 | -0.29 | 40.2% | 61.4% |
| first available level, index Dubai | 2,567 | 99.0% | 6.96 | 17.33 | 25.79 | -0.75 | 40.1% | 61.7% |
| first available level, index area | 2,567 | 99.0% | 6.93 | 17.39 | 25.77 | -0.74 | 40.0% | 61.8% |
| shrinkage (EB) | 2,577 | 99.4% | 7.13 | 17.36 | 26.06 | -0.20 | 40.0% | 60.5% |
| shrinkage (EB), index Dubai | 2,577 | 99.4% | 7.12 | 17.42 | 25.94 | -0.75 | 39.8% | 61.3% |
| first available + size term | 2,567 | 99.0% | 6.66 | 17.09 | 25.66 | -0.22 | 40.9% | 63.0% |
| similar: weighted comparables | 2,526 | 97.5% | 7.09 | 17.31 | 25.80 | -0.37 | 40.3% | 61.4% |
| similar: weighted comparables, index | 2,526 | 97.5% | 7.09 | 17.38 | 25.50 | -0.79 | 40.2% | 61.4% |
| hedonic | 2,591 | 100.0% | 8.13 | 18.19 | 27.08 | -0.97 | 34.1% | 57.0% |
| boosted trees (ceiling) | 2,567 | 99.0% | 6.65 | 15.72 | 23.42 | -0.07 | 40.5% | 64.2% |

#### S2a project siblings exist (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 889 | 99.9% | 7.72 | 19.70 | 27.95 | -2.01 | 36.7% | 59.3% |
| building medians (area) | 859 | 96.5% | 8.75 | 21.19 | 31.24 | -4.32 | 32.7% | 54.1% |
| first available level | 890 | 100.0% | 3.03 | 7.60 | 11.17 | +0.00 | 68.5% | 87.6% |
| first available level, index Dubai | 890 | 100.0% | 3.00 | 7.37 | 10.95 | -0.51 | 68.0% | 88.0% |
| first available level, index area | 890 | 100.0% | 2.99 | 7.38 | 10.94 | -0.52 | 67.6% | 88.2% |
| shrinkage (EB) | 890 | 100.0% | 3.03 | 7.60 | 11.17 | +0.00 | 68.5% | 87.6% |
| shrinkage (EB), index Dubai | 890 | 100.0% | 3.00 | 7.37 | 10.95 | -0.51 | 68.0% | 88.0% |
| first available + size term | 890 | 100.0% | 2.93 | 7.40 | 11.13 | -0.01 | 68.4% | 87.4% |
| similar: weighted comparables | 859 | 96.5% | 2.92 | 7.58 | 11.17 | -0.11 | 68.8% | 87.7% |
| similar: weighted comparables, index | 859 | 96.5% | 2.99 | 7.44 | 10.98 | -0.66 | 67.9% | 87.7% |
| hedonic | 890 | 100.0% | 5.00 | 11.21 | 15.76 | -0.67 | 50.0% | 75.8% |
| boosted trees (ceiling) | 890 | 100.0% | 3.87 | 8.57 | 12.18 | +0.08 | 59.2% | 83.9% |

#### S2b community only (no sibling) (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 1,689 | 99.2% | 11.59 | 25.47 | 37.12 | +2.66 | 23.3% | 44.0% |
| building medians (area) | 1,667 | 97.9% | 11.07 | 23.45 | 31.90 | -0.23 | 24.5% | 45.4% |
| first available level | 1,677 | 98.5% | 10.66 | 21.88 | 30.16 | -1.36 | 25.2% | 47.4% |
| first available level, index Dubai | 1,677 | 98.5% | 10.59 | 21.77 | 30.11 | -1.41 | 25.3% | 47.8% |
| first available level, index area | 1,677 | 98.5% | 10.65 | 21.89 | 30.25 | -1.54 | 25.4% | 47.8% |
| shrinkage (EB) | 1,687 | 99.1% | 10.88 | 21.96 | 30.41 | -1.03 | 25.0% | 46.2% |
| shrinkage (EB), index Dubai | 1,687 | 99.1% | 10.70 | 21.84 | 30.09 | -1.41 | 25.0% | 47.2% |
| first available + size term | 1,677 | 98.5% | 9.98 | 21.46 | 29.85 | -1.09 | 26.2% | 50.1% |
| similar: weighted comparables | 1,667 | 97.9% | 10.59 | 21.43 | 29.82 | -1.03 | 25.6% | 47.9% |
| similar: weighted comparables, index | 1,667 | 97.9% | 10.50 | 21.43 | 29.84 | -1.36 | 26.0% | 47.9% |
| hedonic | 1,701 | 99.9% | 10.70 | 22.46 | 31.68 | -1.37 | 25.8% | 47.1% |
| boosted trees (ceiling) | 1,677 | 98.5% | 9.20 | 19.81 | 28.45 | -0.30 | 30.5% | 53.7% |

#### S3, 1 to 4 own sales, building thinned (leave-building-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 10,620 | 98.4% | 7.07 | 17.69 | 25.96 | -0.27 | 39.8% | 61.2% |
| own same-bed sales only | 10,788 | 100.0% | 3.27 | 8.36 | 12.76 | +0.00 | 63.9% | 84.3% |
| EB: reference + own | 10,788 | 100.0% | 3.22 | 7.74 | 11.59 | -0.17 | 65.5% | 86.9% |
| EB: + older same-bed | 10,788 | 100.0% | 3.03 | 7.13 | 10.40 | -0.55 | 68.3% | 89.2% |
| EB: + other bedrooms | 10,788 | 100.0% | 3.22 | 7.61 | 11.19 | -0.21 | 65.9% | 87.5% |
| EB: + older + other bedrooms | 10,788 | 100.0% | 3.04 | 7.02 | 10.17 | -0.60 | 68.6% | 89.6% |
| EB: + older + other beds + other basis | 10,788 | 100.0% | 3.04 | 7.06 | 10.29 | -0.61 | 68.4% | 89.4% |
| similar buildings #0 + own + older | 10,788 | 100.0% | 3.08 | 7.26 | 10.67 | -0.53 | 67.4% | 88.6% |
| similar buildings #1 + own + older | 10,788 | 100.0% | 3.12 | 7.28 | 10.60 | -0.58 | 67.0% | 88.7% |
| similar buildings #2 + own + older | 10,788 | 100.0% | 3.11 | 7.30 | 10.66 | -0.49 | 67.3% | 88.6% |
| similar buildings #3 + own + older | 10,788 | 100.0% | 3.11 | 7.22 | 10.69 | -0.53 | 67.4% | 88.6% |
| similar buildings #4 + own + older | 10,788 | 100.0% | 3.12 | 7.19 | 10.63 | -0.42 | 67.6% | 88.9% |
| similar buildings #5 + own + older | 10,788 | 100.0% | 3.10 | 7.21 | 10.50 | -0.53 | 67.3% | 88.9% |
| hedonic + building effect | 10,776 | 99.9% | 5.03 | 10.58 | 14.98 | -0.07 | 49.8% | 78.0% |
| hedonic + building effect (both bases) | 10,776 | 99.9% | 5.44 | 11.51 | 15.88 | -0.41 | 47.0% | 74.7% |
| boosted trees (ceiling) | 10,788 | 100.0% | 3.02 | 6.90 | 10.19 | -0.01 | 69.3% | 89.6% |

#### S3, 1 to 4 own sales, other evidence intact (leave-building-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 10,620 | 98.4% | 7.07 | 17.69 | 25.96 | -0.27 | 39.8% | 61.2% |
| own same-bed sales only | 10,788 | 100.0% | 3.27 | 8.36 | 12.76 | +0.00 | 63.9% | 84.3% |
| EB: reference + own | 10,788 | 100.0% | 3.22 | 7.74 | 11.59 | -0.17 | 65.5% | 86.9% |
| EB: + older same-bed | 10,788 | 100.0% | 2.86 | 6.61 | 9.58 | -0.70 | 70.1% | 91.0% |
| EB: + other bedrooms | 10,788 | 100.0% | 3.25 | 7.48 | 10.90 | -0.26 | 65.7% | 88.1% |
| EB: + older + other bedrooms | 10,788 | 100.0% | 2.87 | 6.56 | 9.42 | -0.74 | 70.5% | 91.3% |
| EB: + older + other beds + other basis | 10,788 | 100.0% | 2.89 | 6.60 | 9.56 | -0.76 | 70.2% | 91.0% |
| similar buildings #0 + own + older | 10,788 | 100.0% | 2.82 | 6.51 | 9.52 | -0.63 | 70.9% | 90.8% |
| similar buildings #1 + own + older | 10,788 | 100.0% | 2.89 | 6.56 | 9.49 | -0.67 | 70.4% | 91.0% |
| similar buildings #2 + own + older | 10,788 | 100.0% | 2.79 | 6.51 | 9.47 | -0.59 | 71.0% | 90.9% |
| similar buildings #3 + own + older | 10,788 | 100.0% | 2.79 | 6.47 | 9.42 | -0.60 | 71.2% | 91.2% |
| similar buildings #4 + own + older | 10,788 | 100.0% | 2.79 | 6.56 | 9.44 | -0.57 | 70.9% | 91.1% |
| similar buildings #5 + own + older | 10,788 | 100.0% | 2.87 | 6.62 | 9.53 | -0.62 | 70.1% | 90.9% |
| hedonic + building effect | 10,776 | 99.9% | 5.06 | 10.72 | 15.22 | +0.30 | 49.7% | 77.2% |
| hedonic + building effect (both bases) | 10,776 | 99.9% | 5.58 | 11.92 | 16.53 | -0.31 | 46.0% | 72.8% |
| boosted trees (ceiling) | 10,788 | 100.0% | 2.80 | 6.30 | 9.33 | -0.05 | 72.2% | 91.4% |

#### S3, no own sales, building thinned (leave-building-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 2,655 | 98.4% | 7.10 | 17.62 | 25.98 | -0.31 | 40.0% | 61.1% |
| EB: reference + own | 2,655 | 98.4% | 7.10 | 17.62 | 25.98 | -0.31 | 40.0% | 61.1% |
| EB: + older same-bed | 2,672 | 99.1% | 5.44 | 13.14 | 19.83 | -1.32 | 47.0% | 70.3% |
| EB: + other bedrooms | 2,655 | 98.4% | 6.02 | 14.63 | 21.47 | -0.33 | 44.2% | 67.0% |
| EB: + older + other bedrooms | 2,672 | 99.1% | 5.04 | 11.67 | 17.09 | -1.07 | 49.7% | 74.7% |
| EB: + older + other beds + other basis | 2,672 | 99.1% | 5.05 | 11.66 | 17.12 | -1.08 | 49.7% | 74.7% |
| similar buildings #0 + own + older | 2,644 | 98.0% | 5.34 | 12.16 | 17.59 | -1.03 | 48.1% | 72.5% |
| similar buildings #1 + own + older | 2,644 | 98.0% | 5.45 | 12.43 | 17.36 | -1.25 | 47.4% | 71.9% |
| similar buildings #2 + own + older | 2,644 | 98.0% | 5.55 | 12.16 | 18.18 | -0.86 | 46.8% | 72.5% |
| similar buildings #3 + own + older | 2,644 | 98.0% | 5.57 | 12.15 | 17.88 | -0.86 | 46.6% | 72.8% |
| similar buildings #4 + own + older | 2,644 | 98.0% | 5.44 | 12.16 | 17.24 | -0.73 | 47.5% | 72.8% |
| similar buildings #5 + own + older | 2,644 | 98.0% | 5.26 | 12.16 | 17.06 | -0.96 | 49.0% | 72.9% |
| hedonic + building effect | 2,694 | 99.9% | 6.56 | 13.57 | 19.13 | -0.28 | 40.5% | 67.4% |
| hedonic + building effect (both bases) | 2,694 | 99.9% | 6.94 | 14.16 | 19.72 | -0.67 | 38.6% | 65.7% |
| boosted trees (ceiling) | 2,672 | 99.1% | 4.74 | 10.95 | 16.22 | +0.05 | 51.8% | 77.2% |

#### S3, no own sales, other evidence intact (leave-building-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 2,655 | 98.4% | 7.10 | 17.62 | 25.98 | -0.31 | 40.0% | 61.1% |
| EB: reference + own | 2,655 | 98.4% | 7.10 | 17.62 | 25.98 | -0.31 | 40.0% | 61.1% |
| EB: + older same-bed | 2,676 | 99.2% | 4.23 | 10.28 | 15.74 | -1.34 | 55.2% | 79.3% |
| EB: + other bedrooms | 2,655 | 98.4% | 5.24 | 12.02 | 16.95 | -0.47 | 48.1% | 73.7% |
| EB: + older + other bedrooms | 2,676 | 99.2% | 4.00 | 8.94 | 12.52 | -1.23 | 58.7% | 84.2% |
| EB: + older + other beds + other basis | 2,676 | 99.2% | 4.03 | 9.03 | 12.55 | -1.24 | 58.3% | 83.9% |
| similar buildings #0 + own + older | 2,650 | 98.3% | 3.83 | 8.84 | 12.45 | -1.11 | 59.4% | 83.9% |
| similar buildings #1 + own + older | 2,650 | 98.3% | 3.94 | 9.34 | 13.00 | -1.19 | 58.5% | 82.4% |
| similar buildings #2 + own + older | 2,650 | 98.3% | 3.65 | 8.60 | 12.09 | -1.06 | 61.1% | 84.8% |
| similar buildings #3 + own + older | 2,650 | 98.3% | 3.77 | 8.54 | 11.97 | -1.05 | 61.0% | 84.9% |
| similar buildings #4 + own + older | 2,650 | 98.3% | 3.70 | 8.68 | 11.97 | -0.96 | 61.1% | 84.6% |
| similar buildings #5 + own + older | 2,650 | 98.3% | 3.88 | 9.35 | 12.99 | -0.97 | 59.1% | 82.6% |
| hedonic + building effect | 2,694 | 99.9% | 5.30 | 11.00 | 15.84 | +0.34 | 48.0% | 75.4% |
| hedonic + building effect (both bases) | 2,694 | 99.9% | 5.82 | 12.17 | 17.28 | -0.28 | 44.7% | 71.1% |
| boosted trees (ceiling) | 2,676 | 99.2% | 3.69 | 8.30 | 11.90 | +0.11 | 62.3% | 85.8% |

#### S1 area only (leave-project-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 2,650 | 98.3% | 11.02 | 24.18 | 35.18 | +0.48 | 25.7% | 46.5% |
| building medians (area) | 2,583 | 95.8% | 11.01 | 23.40 | 32.70 | -2.22 | 25.6% | 46.3% |
| building medians (area), index Dubai | 2,583 | 95.8% | 11.04 | 23.34 | 32.71 | -2.37 | 25.6% | 46.6% |
| building medians (area), index area | 2,583 | 95.8% | 11.04 | 23.48 | 32.61 | -2.38 | 25.7% | 46.3% |
| area + size term | 2,583 | 95.8% | 10.81 | 23.24 | 32.37 | -2.28 | 26.2% | 46.8% |
| similar: size-weighted | 2,583 | 95.8% | 10.26 | 23.23 | 32.50 | -1.94 | 27.2% | 49.1% |
| similar: size-weighted, index | 2,583 | 95.8% | 10.45 | 23.03 | 32.64 | -2.28 | 26.7% | 48.6% |
| hedonic | 2,678 | 99.3% | 12.22 | 25.26 | 36.07 | -1.18 | 22.6% | 42.7% |
| boosted trees (ceiling) | 2,583 | 95.8% | 10.09 | 21.99 | 30.72 | -0.29 | 27.1% | 49.7% |

#### S2 community and/or project known (leave-project-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 2,448 | 99.3% | 11.13 | 24.70 | 36.29 | +0.86 | 25.0% | 46.0% |
| building medians (area) | 2,405 | 97.5% | 11.14 | 23.67 | 33.53 | -2.01 | 24.9% | 45.6% |
| first available level | 2,425 | 98.3% | 10.42 | 21.77 | 30.76 | -2.46 | 25.3% | 48.0% |
| first available level, index Dubai | 2,425 | 98.3% | 10.50 | 21.56 | 30.66 | -2.67 | 25.4% | 48.3% |
| first available level, index area | 2,425 | 98.3% | 10.54 | 21.57 | 30.66 | -2.67 | 25.5% | 48.5% |
| shrinkage (EB) | 2,444 | 99.1% | 10.40 | 21.77 | 30.72 | -2.45 | 25.3% | 48.0% |
| shrinkage (EB), index Dubai | 2,444 | 99.1% | 10.48 | 21.56 | 30.59 | -2.63 | 25.4% | 48.3% |
| first available + size term | 2,425 | 98.3% | 9.87 | 21.49 | 30.49 | -2.45 | 27.2% | 50.4% |
| similar: weighted comparables | 2,405 | 97.5% | 10.39 | 21.42 | 30.35 | -2.53 | 25.4% | 48.4% |
| similar: weighted comparables, index | 2,405 | 97.5% | 10.55 | 21.76 | 30.83 | -2.89 | 25.5% | 47.8% |
| hedonic | 2,465 | 100.0% | 10.89 | 22.48 | 31.56 | -2.34 | 25.0% | 46.7% |
| boosted trees (ceiling) | 2,425 | 98.3% | 9.47 | 20.20 | 28.71 | -0.24 | 28.2% | 52.4% |

#### S2b community only (no sibling) (leave-project-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| pooled sale median (area) | 2,448 | 99.3% | 11.13 | 24.70 | 36.29 | +0.86 | 25.0% | 46.0% |
| building medians (area) | 2,405 | 97.5% | 11.14 | 23.67 | 33.53 | -2.01 | 24.9% | 45.6% |
| first available level | 2,425 | 98.3% | 10.42 | 21.77 | 30.76 | -2.46 | 25.3% | 48.0% |
| first available level, index Dubai | 2,425 | 98.3% | 10.50 | 21.56 | 30.66 | -2.67 | 25.4% | 48.3% |
| first available level, index area | 2,425 | 98.3% | 10.54 | 21.57 | 30.66 | -2.67 | 25.5% | 48.5% |
| shrinkage (EB) | 2,444 | 99.1% | 10.40 | 21.77 | 30.72 | -2.45 | 25.3% | 48.0% |
| shrinkage (EB), index Dubai | 2,444 | 99.1% | 10.48 | 21.56 | 30.59 | -2.63 | 25.4% | 48.3% |
| first available + size term | 2,425 | 98.3% | 9.87 | 21.49 | 30.49 | -2.45 | 27.2% | 50.4% |
| similar: weighted comparables | 2,405 | 97.5% | 10.39 | 21.42 | 30.35 | -2.53 | 25.4% | 48.4% |
| similar: weighted comparables, index | 2,405 | 97.5% | 10.55 | 21.76 | 30.83 | -2.89 | 25.5% | 47.8% |
| hedonic | 2,465 | 100.0% | 10.89 | 22.48 | 31.56 | -2.34 | 25.0% | 46.7% |
| boosted trees (ceiling) | 2,425 | 98.3% | 9.47 | 20.20 | 28.71 | -0.24 | 28.2% | 52.4% |

#### S3, 1 to 4 own sales, building thinned (leave-project-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 10,412 | 96.5% | 10.41 | 21.56 | 30.15 | -2.63 | 25.6% | 48.5% |
| own same-bed sales only | 10,788 | 100.0% | 3.27 | 8.36 | 12.76 | +0.00 | 63.9% | 84.3% |
| EB: reference + own | 10,788 | 100.0% | 3.37 | 8.22 | 12.29 | -0.35 | 63.6% | 85.3% |
| EB: + older same-bed | 10,788 | 100.0% | 3.14 | 7.40 | 10.78 | -0.71 | 67.0% | 88.4% |
| EB: + other bedrooms | 10,788 | 100.0% | 3.38 | 8.01 | 11.80 | -0.37 | 64.1% | 86.0% |
| EB: + older + other bedrooms | 10,788 | 100.0% | 3.12 | 7.31 | 10.45 | -0.76 | 67.3% | 89.1% |
| EB: + older + other beds + other basis | 10,788 | 100.0% | 3.13 | 7.35 | 10.55 | -0.77 | 67.0% | 88.9% |
| similar buildings #0 + own + older | 10,788 | 100.0% | 3.15 | 7.33 | 10.78 | -0.67 | 66.8% | 88.4% |
| similar buildings #1 + own + older | 10,788 | 100.0% | 3.13 | 7.36 | 10.70 | -0.72 | 67.0% | 88.5% |
| similar buildings #2 + own + older | 10,788 | 100.0% | 3.18 | 7.41 | 10.85 | -0.63 | 66.5% | 88.4% |
| similar buildings #3 + own + older | 10,788 | 100.0% | 3.18 | 7.40 | 10.80 | -0.69 | 66.6% | 88.4% |
| similar buildings #4 + own + older | 10,788 | 100.0% | 3.16 | 7.35 | 10.77 | -0.57 | 66.7% | 88.5% |
| similar buildings #5 + own + older | 10,788 | 100.0% | 3.12 | 7.29 | 10.73 | -0.66 | 66.9% | 88.4% |
| hedonic + building effect | 10,712 | 99.3% | 5.38 | 11.02 | 15.45 | -0.28 | 47.2% | 76.2% |
| hedonic + building effect (both bases) | 10,712 | 99.3% | 5.77 | 11.92 | 16.40 | -0.72 | 44.6% | 73.1% |
| boosted trees (ceiling) | 10,788 | 100.0% | 3.19 | 7.16 | 10.41 | -0.00 | 67.1% | 89.3% |

#### S3, 1 to 4 own sales, other evidence intact (leave-project-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 10,412 | 96.5% | 10.41 | 21.56 | 30.15 | -2.63 | 25.6% | 48.5% |
| own same-bed sales only | 10,788 | 100.0% | 3.27 | 8.36 | 12.76 | +0.00 | 63.9% | 84.3% |
| EB: reference + own | 10,788 | 100.0% | 3.37 | 8.22 | 12.29 | -0.35 | 63.6% | 85.3% |
| EB: + older same-bed | 10,788 | 100.0% | 2.94 | 6.81 | 9.76 | -0.88 | 69.5% | 90.5% |
| EB: + other bedrooms | 10,788 | 100.0% | 3.40 | 7.87 | 11.41 | -0.45 | 64.3% | 86.9% |
| EB: + older + other bedrooms | 10,788 | 100.0% | 2.93 | 6.69 | 9.54 | -0.93 | 70.0% | 91.0% |
| EB: + older + other beds + other basis | 10,788 | 100.0% | 2.94 | 6.74 | 9.71 | -0.95 | 69.7% | 90.7% |
| similar buildings #0 + own + older | 10,788 | 100.0% | 2.87 | 6.64 | 9.71 | -0.72 | 70.4% | 90.6% |
| similar buildings #1 + own + older | 10,788 | 100.0% | 2.91 | 6.65 | 9.72 | -0.79 | 70.3% | 90.6% |
| similar buildings #2 + own + older | 10,788 | 100.0% | 2.86 | 6.62 | 9.65 | -0.63 | 70.8% | 90.6% |
| similar buildings #3 + own + older | 10,788 | 100.0% | 2.83 | 6.62 | 9.52 | -0.66 | 70.8% | 90.8% |
| similar buildings #4 + own + older | 10,788 | 100.0% | 2.85 | 6.65 | 9.60 | -0.63 | 70.5% | 90.7% |
| similar buildings #5 + own + older | 10,788 | 100.0% | 2.92 | 6.68 | 9.76 | -0.74 | 70.1% | 90.5% |
| hedonic + building effect | 10,712 | 99.3% | 5.08 | 10.79 | 15.30 | +0.29 | 49.5% | 77.2% |
| hedonic + building effect (both bases) | 10,712 | 99.3% | 5.64 | 12.01 | 16.56 | -0.35 | 45.9% | 72.8% |
| boosted trees (ceiling) | 10,788 | 100.0% | 2.96 | 6.52 | 9.38 | +0.02 | 70.6% | 91.2% |

#### S3, no own sales, building thinned (leave-project-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 2,603 | 96.5% | 10.33 | 21.43 | 30.34 | -2.56 | 25.9% | 48.5% |
| EB: reference + own | 2,603 | 96.5% | 10.33 | 21.43 | 30.34 | -2.56 | 25.9% | 48.5% |
| EB: + older same-bed | 2,639 | 97.8% | 7.23 | 16.09 | 23.09 | -2.94 | 37.2% | 61.7% |
| EB: + other bedrooms | 2,603 | 96.5% | 8.49 | 17.79 | 24.89 | -1.37 | 32.7% | 56.3% |
| EB: + older + other bedrooms | 2,639 | 97.8% | 6.43 | 13.92 | 19.36 | -2.09 | 41.5% | 67.5% |
| EB: + older + other beds + other basis | 2,639 | 97.8% | 6.40 | 13.87 | 19.47 | -2.07 | 41.5% | 67.5% |
| similar buildings #0 + own + older | 2,627 | 97.4% | 6.40 | 13.68 | 19.21 | -1.81 | 41.5% | 68.3% |
| similar buildings #1 + own + older | 2,627 | 97.4% | 6.59 | 13.78 | 19.39 | -2.29 | 40.4% | 67.0% |
| similar buildings #2 + own + older | 2,627 | 97.4% | 6.35 | 13.41 | 19.74 | -1.49 | 42.3% | 68.7% |
| similar buildings #3 + own + older | 2,627 | 97.4% | 6.36 | 13.43 | 19.22 | -1.65 | 41.7% | 68.6% |
| similar buildings #4 + own + older | 2,627 | 97.4% | 6.16 | 13.32 | 18.78 | -1.34 | 43.2% | 69.0% |
| similar buildings #5 + own + older | 2,627 | 97.4% | 6.38 | 13.55 | 18.86 | -1.99 | 41.9% | 67.9% |
| hedonic + building effect | 2,678 | 99.3% | 7.38 | 15.13 | 20.80 | -0.42 | 36.3% | 63.1% |
| hedonic + building effect (both bases) | 2,678 | 99.3% | 7.67 | 15.58 | 21.16 | -0.89 | 35.0% | 61.7% |
| boosted trees (ceiling) | 2,639 | 97.8% | 5.84 | 12.53 | 17.77 | +0.05 | 45.1% | 72.3% |

#### S3, no own sales, other evidence intact (leave-project-out, no time adjustment)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| reference only (first available) | 2,603 | 96.5% | 10.33 | 21.43 | 30.34 | -2.56 | 25.9% | 48.5% |
| EB: reference + own | 2,603 | 96.5% | 10.33 | 21.43 | 30.34 | -2.56 | 25.9% | 48.5% |
| EB: + older same-bed | 2,646 | 98.1% | 5.18 | 12.40 | 19.68 | -2.47 | 48.9% | 72.8% |
| EB: + other bedrooms | 2,603 | 96.5% | 6.72 | 14.22 | 19.19 | -1.60 | 38.4% | 65.4% |
| EB: + older + other bedrooms | 2,646 | 98.1% | 4.65 | 10.02 | 14.28 | -1.96 | 52.9% | 79.9% |
| EB: + older + other beds + other basis | 2,646 | 98.1% | 4.70 | 10.16 | 14.33 | -1.96 | 52.5% | 79.5% |
| similar buildings #0 + own + older | 2,638 | 97.8% | 4.35 | 9.55 | 13.74 | -1.58 | 54.9% | 81.6% |
| similar buildings #1 + own + older | 2,638 | 97.8% | 4.55 | 10.14 | 14.46 | -1.82 | 53.4% | 79.5% |
| similar buildings #2 + own + older | 2,638 | 97.8% | 4.00 | 9.21 | 13.04 | -1.30 | 58.3% | 82.9% |
| similar buildings #3 + own + older | 2,638 | 97.8% | 4.07 | 9.13 | 12.96 | -1.31 | 58.6% | 83.0% |
| similar buildings #4 + own + older | 2,638 | 97.8% | 3.97 | 9.27 | 13.02 | -1.18 | 58.2% | 82.8% |
| similar buildings #5 + own + older | 2,638 | 97.8% | 4.41 | 10.01 | 14.34 | -1.62 | 54.5% | 79.9% |
| hedonic + building effect | 2,678 | 99.3% | 5.36 | 11.12 | 15.92 | +0.33 | 48.1% | 75.5% |
| hedonic + building effect (both bases) | 2,678 | 99.3% | 5.86 | 12.30 | 17.27 | -0.31 | 44.7% | 71.2% |
| boosted trees (ceiling) | 2,646 | 98.1% | 4.00 | 9.01 | 13.17 | +0.18 | 57.9% | 83.5% |

#### S3 with older sales time-adjusted by the Dubai index by basis (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| thin k1-4: EB: reference + own | 10,788 | 100.0% | 3.18 | 7.59 | 11.47 | -0.52 | 65.9% | 86.9% |
| thin k1-4: EB: + older same-bed | 10,788 | 100.0% | 2.99 | 7.01 | 10.35 | -0.49 | 68.2% | 89.2% |
| thin k1-4: EB: + other bedrooms | 10,788 | 100.0% | 3.25 | 7.49 | 11.07 | -0.55 | 66.1% | 87.7% |
| thin k1-4: EB: + older + other bedrooms | 10,788 | 100.0% | 3.01 | 6.95 | 10.08 | -0.54 | 68.1% | 89.8% |
| thin k1-4: EB: + older + other beds + other basis | 10,788 | 100.0% | 3.02 | 6.98 | 10.15 | -0.55 | 67.9% | 89.6% |
| thin k0: EB: reference + own | 2,655 | 98.4% | 7.11 | 17.47 | 25.74 | -0.76 | 39.9% | 61.5% |
| thin k0: EB: + older same-bed | 2,672 | 99.1% | 5.36 | 13.26 | 19.96 | -0.78 | 47.8% | 71.1% |
| thin k0: EB: + other bedrooms | 2,655 | 98.4% | 6.21 | 14.73 | 21.34 | -0.71 | 43.8% | 66.8% |
| thin k0: EB: + older + other bedrooms | 2,672 | 99.1% | 4.83 | 11.79 | 17.18 | -0.68 | 50.7% | 74.7% |
| thin k0: EB: + older + other beds + other basis | 2,672 | 99.1% | 4.83 | 11.78 | 17.23 | -0.69 | 50.7% | 74.7% |

#### S3 with older sales time-adjusted by the area index, shrunk (leave-building-out)

| Candidate | Cells | Has a result | Median abs % error | 80th pct | 90th pct | Bias % | Within 5% | Within 10% |
|---|---|---|---|---|---|---|---|---|
| thin k1-4: EB: reference + own | 10,788 | 100.0% | 3.18 | 7.62 | 11.57 | -0.51 | 65.7% | 86.8% |
| thin k1-4: EB: + older same-bed | 10,788 | 100.0% | 3.01 | 6.98 | 10.39 | -0.51 | 68.2% | 89.2% |
| thin k1-4: EB: + other bedrooms | 10,788 | 100.0% | 3.29 | 7.52 | 11.18 | -0.56 | 65.8% | 87.6% |
| thin k1-4: EB: + older + other bedrooms | 10,788 | 100.0% | 3.06 | 7.00 | 10.14 | -0.55 | 68.3% | 89.7% |
| thin k1-4: EB: + older + other beds + other basis | 10,788 | 100.0% | 3.07 | 7.04 | 10.21 | -0.56 | 68.2% | 89.6% |
| thin k0: EB: reference + own | 2,655 | 98.4% | 7.06 | 17.55 | 25.64 | -0.75 | 39.9% | 61.5% |
| thin k0: EB: + older same-bed | 2,672 | 99.1% | 5.30 | 13.13 | 19.99 | -0.72 | 48.1% | 71.1% |
| thin k0: EB: + other bedrooms | 2,655 | 98.4% | 6.20 | 14.80 | 21.43 | -0.76 | 44.2% | 66.9% |
| thin k0: EB: + older + other bedrooms | 2,672 | 99.1% | 4.94 | 11.81 | 17.22 | -0.67 | 50.4% | 74.6% |
| thin k0: EB: + older + other beds + other basis | 2,672 | 99.1% | 4.94 | 11.78 | 17.23 | -0.68 | 50.4% | 74.7% |
