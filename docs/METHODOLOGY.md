# Methodology

This page summarises the research question, the method, how it was tested and what it can and cannot do. The detailed write-ups are in [`../reports/`](../reports), and the exact specification of each step is linked from the sections below.

All figures are for the snapshot with data through **16 November 2026** (403,867 flat sales, 4,348 buildings). They are test results on past data, not guarantees about future sales.

## 1. The question

A buyer sees a Dubai apartment listed at an asking price. **How does that asking price compare with what similar apartments registered at the Dubai Land Department?**

This is a price *check*, not a valuation. The output is a range of registered AED per square foot, a verdict (within, above or below the range) and the sales behind it.

## 2. The difficulty

- A building often has only a few sales of one bedroom type in a year. A median of two or three sales is mostly noise.
- Sales happened on different dates, in a moving market, for flats of different sizes.
- Some "sales" are not independent: a developer's launch-day price list is one decision, not forty.
- Names do not match: the name in a listing is often not the name in the register.

## 3. The baseline

The first version compared the asking price per square foot with the **median of same-bedroom sales in the same building over the last 12 months**, and called anything within 5% "in line". It needs at least 5 sales and says "too few sales" otherwise. It is simple and explainable, and it is what every later method is tested against.

## 4. Methods, in the order they were built

### 4.1 Second tier: similar buildings
When a building has too few sales, borrow strength from its project, then its community, then its area, with variance estimated from the data. A range is shown only when a refusal rule passes (for example, the building's own sales must not disagree with the evidence).
Spec: `app/docs/REAL_DATA.md` section 15. Code: `app/scripts/model/`.

### 4.2 Machine-learning candidates (tested, not shipped)
Three alternatives were tested on the same harness and seeds:

- an empirical-Bayes mixed model of ln(AED per sq ft);
- LightGBM on that model's residuals, with conformal ranges;
- a k-nearest-neighbour comparable-sales reference with fitted similarity weights.

On tests that **hide a building** and predict it, the boosted model was slightly better. **On tests that go forward in time, it failed**: its ranges held the later price 58.6% to 67.4% of the time, against 73.7% for the shipped range. To match the shipped coverage it needed wider ranges, and some cases needed a half-width above the 20% limit the product allows. Nothing improved both accuracy and forward coverage, so nothing shipped. Report: [`reports/ML_REPORT.md`](../reports/ML_REPORT.md), research notes in [`reports/ML_RESEARCH.md`](../reports/ML_RESEARCH.md).

One clear finding came out of it: for a unit much larger than the building's typical size, price per square foot falls with size, and ignoring that overstates it.

### 4.3 Adjusted comparable sales (ACS), the method that ships first
Instead of one median, **adjust each registered sale to the listing**:

- to the **data date**, with a monthly time index built per area from the sales themselves;
- to the **listing's size**, with size slopes fitted by segment;
- to the **bedroom type**, when sales of another type are used;

then take a **weighted median**, where sales nearer to the listing (in rings of evidence around its building, own building first), more recent sales and sizes closer to the listing's count for more. The weights are in `reports/MODEL.md`. The range around it is **calibrated forward in time**: the multiplier is chosen so that, replayed at past dates, it would have held about 80% of later sale prices, separately for each kind of evidence. The method **declines** to answer when the evidence is thin or the range would be wider than 20% either way.
Spec and results: [`reports/MODEL.md`](../reports/MODEL.md), [`reports/ACS_REPORT.md`](../reports/ACS_REPORT.md), [`reports/FINAL_ACS_REPORT.md`](../reports/FINAL_ACS_REPORT.md). Product integration: `app/docs/REAL_DATA.md` section 16.

### 4.4 Last resorts
- **Project route:** for an off-plan listing in a building not yet in the data, a range from the other buildings of the same project.
- **Nearby registered sales:** when a building has no usable sales, adjusted sales from other buildings in the same community, corrected for date, size and building age. This is the least accurate step, and it is labelled as such. Spec: `app/scripts/model/nearby/SPEC.md`.

## 5. How it was tested

- **Forward in time.** The model is fitted on data up to a cutoff, and scored on sales that happened in the following 183 days. Four past cutoffs were used. Only the first two were used to *choose* rules, the later ones to check them.
- **Hide-a-building and hide-a-project** tests for the buildings the data has never seen.
- **Coverage is reported with accuracy.** A range is only useful if it holds about as often as it claims.
- **A frozen reference implementation in Python** is compared number by number with the TypeScript that runs in the product (golden cases, to 1e-9).
- **Every cleaning rule** was kept only if it improved later predictions.

## 6. Results (snapshot through 16 November 2026)

**Adjusted comparable sales against the 12-month median**, on buildings with 5 or more sales, on the sales ACS answers (47,840 sales, 84.0% answered). Errors are typical / 80th / 90th percentile, in percent of the later price per sq ft:

| | typical | 80th | 90th |
|---|---:|---:|---:|
| ACS | 4.28 | 10.63 | 16.04 |
| 12-month median, same sales | 5.28 | 13.02 | 19.15 |

The ACS range held the later price in 84.5% of cases.

**The whole chain** (ACS first, the older answers as fallback), typical / 80th error: 5+ sales **6.01 / 15.17 → 4.99 / 13.01**. For buildings with too few sales, the share answered rose from 60.6% to 67.1%, and the error from 8.26 / 20.51 to 7.82 / 19.88.

**Fallbacks:** the nearby method has a typical miss of about 10% to 13% and holds about 7 sales in 10. It is never shown without that caveat.

**The verdict trade-off.** When ACS answers, the range decides the verdict. Measured at later dates, how often the verdict was right:

| The listing is priced | 12-month median rule | Range rule |
|---|---:|---:|
| at the registered level | 50.6% | 76.5% |
| 10% over | 71.6% | 28.5% |
| 20% over | 88.7% | 72.9% |

The range rule calls far fewer correctly priced listings wrong, and also catches far fewer 10%-over listings. Which is better for buyers depends on how far real asking prices sit from sale prices, which sales data cannot show. This is an open design choice, not a solved one.

## 7. Limits

These are in the reports in more detail. The main ones:

- **Registered is not asking.** The data cannot say how far asking prices sit from the prices that finally register.
- **Wide ranges.** Ranges are often 15% to 20% either way, so "within" is the common answer.
- **Other bedroom types can lead** a result for a building with few sales of the requested type. The page says so, and the weakest tested group held 73.2%.
- **After a price fall**, ready-flat ranges miss on one side.
- **Developer re-pricing** of a whole project is invisible to sales data.
- **Tie order and near-ties** make the TypeScript and Python differ in 3.3% of one tested sample's rounded ranges. Documented, not fixed.
- **Postgres performance was never measured**, only an in-process database.
- **The copy has had no legal review.**
- **The fit expires.** The model stops answering when data is more than 122 days old, and the constants need refitting at least twice a year.

## 8. Reproducing it

1. Obtain the data: [`DATA_COLLECTION.md`](DATA_COLLECTION.md).
2. Build the snapshot: `npm run data:build` (in `app/`).
3. Run the backtests and refits in the order given in [`app/scripts/model/README.md`](../app/scripts/model/README.md).

The reports are written in the first person of the working session that produced them and refer to scratch folders that are not part of this repository. Paths in them are historical.
