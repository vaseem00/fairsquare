# Adjusted comparable sales: final report

19 Nov 2026. For the owner of Fairsquare. Technical record: `MODEL.md`. The stage 1 analysis text is in the stage 4 hand-over; it is not saved as a file (section 10).

Nothing in the app changed. No commit, push or deploy was made.

## 1. Short answer

| Where | Recommendation | Why |
|---|---|---|
| A. Type with 5+ sales in 12 months (tier 1 today) | **Go, as the first answer. Keep the tier-1 median as the fallback.** | Closer to the real sale on the same cases at every cutoff. The range held 8 of 10. It answers 86% of these cases; the median answers the rest |
| B. Building in the data, 0 to 4 sales of the type (tier 2 today) | **Go, as the first answer where it speaks. Do not replace tier 2.** | Honest range (87% held against 59% for the shipped range on single sales). Centre a little closer, but only just at the last cutoff. It answers 32.7% of B; tier 2 answers 62.5% |
| C. Building not in the data | **No-go. Keep the project route.** | Tie on the centre. At the last cutoff it was not better. Its range failed in one group at two cutoffs |
| Seventh Heaven test case | **No answer.** | The method refuses it: the range would be AED 596 to 2,842 per sq ft |

One product decision is yours. Today's 5% band flags half of correctly priced units. The new range flags 1 in 6, and catches fewer small mispricings. Section 5 has the numbers.

## 2. What the method does

For one listing (building, bedrooms, ready or off-plan, size, asking price):

1. **It picks registered sales**, nearest first: the same building and bedroom count; the same building with other bedroom counts; sibling buildings of the same project; the community as a last resort.
2. **It adjusts each sale to this unit.** To the data date, with a monthly price index for the area. To the unit's size, with a size slope measured in that building and segment. A larger unit sells for less per sq ft: about 3% to 4% less for 10% more size.
3. **It weighs them.** Recent sales of a similar size in the same building count most. A sale loses half its weight every 8 months.
4. **The weighted middle is the comparison price for this unit.**
5. **It gives a range**, set so that about 8 of 10 later registered sales fell inside it in past data.
6. **It refuses** when the evidence is thin, far in size, led by other buildings, or the range would be wider than plus or minus 20%.

The page can list every sale used, with its date, size, price and both adjustments.

## 3. How it was tested

- The target is always one real later sale of one unit.
- Four test dates: 17 Nov 2024, 17 May 2025, 16 Nov 2025, 17 May 2026. At each date the method saw only earlier sales, then met the sales of the next 183 days: 280,010 sales.
- No same-day sibling of a tested sale can be a comparable: every comparable is on or before the test date, every tested sale after it.
- The last two dates were used for no choice. The first two were used to choose settings.
- A second, independent build of the method reproduced the stage 2 numbers. An audit looked for leaks and found none.
- "Typical error" is the middle error: half the sales are closer, half are further.

**Stage 4 fixes.** Two code paths disagreed on one classification; a refusal was decided by rounding; some defaults were stale. All fixed, and the test was run again. The refusal rule was tightened, using the first two dates only: no answer when sibling buildings lead, when there is no own sale of the type, or when the total weight is under 2. That cost answers in B (43.8% to 32.7% over the four dates) and removed the weak groups.

## 4. Tested numbers

### A. Type with 5+ sales in 12 months

| | Sales | Tier-1 median today | New method, where it answers | Median on the same cases | Answered | Range held |
|---|---|---|---|---|---|---|
| All | 47,840 | 6.0% typical | 4.4% | 5.4% | 86.5% | 83.6% |
| Ready | 13,972 | 9.0% | 6.0% | 8.2% | 76.8% | 81.1% |
| Off-plan | 33,868 | 5.0% | 3.9% | 4.6% | 90.6% | 84.4% |
| Last date only | 11,983 | 5.2% | 3.9% | 4.7% | 87.8% | 83.6% |
| Last date, ready | 2,710 | 8.2% | 6.3% | 7.3% | 76.5% | 77.6% |
| One sale per building and type | 11,947 | 7.4% | 5.2% | 6.6% | 81.0% | 82.6% |

By size against the building's usual size for the type:

| Size | Sales | Median today (bias) | New method, where it answers | Answered | Range held |
|---|---|---|---|---|---|
| Under 0.8x | 714 | 13.3% (10% too low) | 4.2% | 40.9% | 86.3% |
| 0.8x to 1.25x | 44,955 | 5.8% | 4.4% | 89.2% | 83.5% |
| 1.25x to 1.4x | 1,305 | 11.1% (7% too high) | 3.8% | 58.4% | 84.8% |
| Over 1.4x | 866 | 18.1% (13% too high) | 4.3% | 29.2% | 79.4% |

- Worst 1 in 5 cases (80th percentile), where it answers: 10.8% against 13.3% for the median.
- With the median as fallback, over all A sales: 4.95% against 6.0%. Last date: 4.4% against 5.2%.
- Median width of the range: plus or minus 10.9% (ready 12.9%, off-plan 10.3%).
- Large and small units are the clearest gain, but the method answers only 3 to 6 in 10 of them.

### B. Building in the data, 0 to 4 sales of the type

| | Sales | Tier 2 today, all | Tier 2 answers | Tier-2 range held (single sale) | New method answers | Its error | Its range held | Both answer: tier 2 / new |
|---|---|---|---|---|---|---|---|---|
| All | 38,845 | 11.0% | 62.5% | 58.7% | 32.7% | 5.3% | 86.9% | 5.6% / 4.9% (9,335) |
| Ready | 21,768 | 15.1% | 39.4% | 51.7% | 26.1% | 6.5% | 83.1% | 9.4% / 6.5% (2,901) |
| Off-plan | 17,077 | 7.2% | 91.8% | 62.5% | 41.2% | 4.4% | 90.0% | 4.7% / 4.3% (6,434) |
| Last date only | 7,919 | 8.8% | 60.7% | 61.4% | 29.5% | 5.4% | 86.8% | 5.35% / 5.19% (1,811) |
| Last date, ready | 4,853 | 10.8% | 42.5% | 57.8% | 19.5% | 6.6% | 82.0% | 7.3% / 6.5% (576) |
| Last date, off-plan | 3,066 | 6.2% | 89.6% | 64.2% | 45.2% | 4.6% | 90.1% | 4.8% / 4.6% (1,235) |

- The tier-2 range was built for the middle of a type, not for one unit. That explains its 59%.
- At the last date the centre gain is small, and the new method ran 2% high (prices had fallen). On the too-few types that sold 5+ times afterwards, it lost at the last date across all such sales (7.8% against 7.2% shipped) and was about level on the sales it answers (4.8%, against 5.1% shipped and 4.7% for LightGBM).
- Either method answers 71.1% of B (studio to 3-bed). The new method answers 38.5% of what tier 2 answers.
- Median width: plus or minus 14.4%.
- It rarely answers unusual sizes in B (3% to 11%).
- Why it refuses in B: leading sales are from other buildings 27.2%; too few 20.5%; range too wide 14.5%; 4+ bedrooms 3.0%; size too far 2.7%.

### C. Building not in the data

| | Sales | New method answers | Its error | Project route on the same sales | Range held |
|---|---|---|---|---|---|
| Off-plan with project siblings | 6,129 | 41.4% | 4.8% (5.0% on the 2,483 the route also answers) | 5.5% | 93.5% |
| Last date only | 1,218 | 31.0% | 6.0% (325 sales) | 5.7% | 92.0% |
| Community only | 62,294 | 0% (refused; 10% to 20% error) | | | |
| Nothing nearby | 16,675 | 0% | | | |

- On every sale the project route answers (5,929): 6.8% against 6.7%. A tie.
- Where it answers, it runs 4% to 6% low: new buildings sold above their older siblings.
- One group of the range held 65% and 62% at two of the four dates.
- It answers 3% of C. The project route answers at most 7%.

### All listings together

| | Today | New method alone | New method first, today's tiers as fallback |
|---|---|---|---|
| Share of held-out sales answered | 65.9% | 53.0% | 67.1% |
| Of today's answers, given by the new method | | | 78.5% |

Range over all answered cases: 83.9% held (82.9%, 81.0%, 88.0%, 83.9% by date). Every group of the range with 100+ cases held 78% or more over the four dates. The lowest: ready, other bedrooms leading, old sales: 78.1%.

## 5. The decision the page makes

The test: price each sold unit at its real sale price, then 10% and 20% off, and see what the page would say.

| Cases | Method | Says "above" or "below" at the true price | Catches 10% off | Catches 20% off | Wrong direction at 10% off |
|---|---|---|---|---|---|
| A | Tier-1 median, today's 5% band | 51.7% | 74.4% | 93.3% | 7.1% |
| A | Tier-1 median with an honest range (plus or minus 16.8%) | 12.8% | 27.3% | 66.1% | 2.0% |
| A | New method (plus or minus 10.9%) | 16.4% | 45.9% | 84.1% | 2.3% |
| A, ready | Today's 5% band | 66.1% | 67.4% | 89.8% | 11.0% |
| A, ready | New method | 19.0% | 39.0% | 77.4% | 2.7% |
| A, off-plan | Today's 5% band | 46.7% | 76.8% | 94.5% | 5.7% |
| A, off-plan | New method | 15.5% | 48.3% | 86.4% | 2.2% |
| A, unusual size | Today's 5% band | 68.6% | 65.6% | 83.0% | 16.6% |
| A, unusual size | New method | 15.9% | 46.3% | 83.7% | 2.6% |
| A, last date | New method | 16.3% | 44.2% | 82.4% | 2.1% |
| B, both answer | Tier-2 range as shipped | 33.0% | 60.2% | 90.2% | 4.0% |
| B, both answer | New method | 11.5% | 33.3% | 77.0% | 1.5% |
| B, both answer, last date | New method | 11.7% | 33.4% | 73.2% | 1.4% |

- The 5% band is narrower than the noise of one sale (4.8% typical). It is wrong about half of correctly priced units.
- Against a median with an honest range, the new method catches far more (45.9% against 27.3% at 10% off) and flags a few more correctly priced units (16.4% against 12.8%). Its range is narrower: plus or minus 10.9% against 16.8%.
- The choice is between a sensitive band that is often wrong, and a range that is right 8 times in 10 and misses half of the 10% cases.
- After a price fall the method catches fewer overpriced listings. Last date, A: 19% of those 10% over, 70% of those 20% over.

## 6. Seventh Heaven, Al Barari

Ready 1-bed, 2,904 sq ft, asking AED 4,100,000 (AED 1,412 per sq ft). Data to 16 Nov 2026.

**Result: no answer. The range is too wide.** Today's tier refuses it as well.

- Middle of the adjusted sales: AED 1,466 per sq ft. The asking price is 3.7% below it.
- Range: AED 596 to 2,842 per sq ft, plus or minus 77%. The limit is 20%.
- 53 sales used: 14 one-beds of the building (weight 0.74) and 39 two-beds and other types (weight 2.62).

Why:
1. The usual 1-bed in the building is 1,989 sq ft. This unit is 1.46 times that.
2. 8 of the 22 one-bed sales are too small to compare (under two thirds of the size), including the only one of the last 12 months (8 Oct 2026, 1,920 sq ft, AED 1,927).
3. The 14 left are 15 to 36 months old.
4. The recent two-beds fill the gap and disagree: adjusted values from AED 970 to 2,234.

One-bed sales of the building, adjusted to this unit:

| Date | Size, sq ft | AED/sq ft | Time | Size | Adjusted AED/sq ft | Weight |
|---|---|---|---|---|---|---|
| 26 Aug 2025 | 2,177 | 1,516 | +1.2% | -17.3% | 1,269 | 0.066 |
| 21 Jul 2025 | 3,887 | 1,454 | +0.1% | +21.2% | 1,764 | 0.058 |
| 30 Jun 2025 | 3,158 | 1,052 | -0.4% | +5.7% | 1,107 | 0.211 |
| 20 Jun 2025 | 2,008 | 1,803 | -0.4% | -21.6% | 1,409 | 0.022 |
| 28 Feb 2025 | 2,000 | 1,635 | +1.9% | -21.8% | 1,304 | 0.015 |
| 18 Dec 2024 | 3,154 | 1,205 | +3.6% | +5.6% | 1,318 | 0.122 |
| 4 Dec 2024 | 1,989 | 1,571 | +4.9% | -22.1% | 1,284 | 0.011 |
| 9 Sep 2024 | 2,720 | 1,021 | +9.5% | -4.2% | 1,071 | 0.096 |
| 20 Mar 2024 | 2,905 | 930 | +14.5% | 0.0% | 1,064 | 0.063 |
| 18 Mar 2024 | 2,944 | 1,053 | +14.5% | +0.9% | 1,216 | 0.062 |
| 21 Feb 2024 | 1,989 | 1,458 | +15.3% | -22.1% | 1,310 | 0.005 |
| 25 Jan 2024 | 2,000 | 1,300 | +17.2% | -21.8% | 1,192 | 0.005 |
| 8 Jan 2024 | 1,966 | 1,450 | +18.2% | -22.7% | 1,326 | 0.004 |
| 21 Nov 2023 | 1,967 | 1,474 | +19.1% | -22.6% | 1,359 | 0.003 |

The ten heaviest two-bed sales (time, size and bedroom adjustments applied):

| Date | Size, sq ft | AED/sq ft | Adjusted AED/sq ft | Weight |
|---|---|---|---|---|
| 1 Oct 2026 | 2,663 | 2,291 | 1,882 | 0.263 |
| 23 Jul 2026 | 3,449 | 2,030 | 1,825 | 0.216 |
| 7 Jul 2026 | 2,915 | 1,390 | 1,178 | 0.206 |
| 12 May 2026 | 3,437 | 1,440 | 1,291 | 0.176 |
| 28 Apr 2026 | 2,676 | 1,495 | 1,210 | 0.169 |
| 17 Mar 2026 | 2,680 | 2,761 | 2,234 | 0.150 |
| 25 Feb 2026 | 2,669 | 2,323 | 1,876 | 0.141 |
| 17 Feb 2026 | 2,629 | 1,208 | 970 | 0.138 |
| 11 Feb 2026 | 2,691 | 2,267 | 1,799 | 0.136 |
| 13 Jan 2026 | 2,620 | 2,176 | 1,711 | 0.125 |

The other 29 rows weigh 0.005 to 0.065 each.

Other readings from the same sales, none of them shown:

| Reading | Sales | AED/sq ft | Asking against it |
|---|---|---|---|
| All rings | 53 | 1,466 | 3.7% below |
| One-beds of the building only | 14 | 1,192 (range 785 to 1,600) | 18.5% above |
| One-beds within 0.8x to 1.25x of the size | 5 | 1,117 | 26.4% above |
| Slower ageing (half-life 24 months) | 37 | 1,332 (range 962 to 1,707) | 6.0% above |

The readings run from AED 1,117 to 1,466. The data cannot say whether AED 1,412 is fair. The page could still list the 14 one-bed sales with their adjustments, under a line that there is no comparison price for this unit.

## 7. What the page could honestly say

| Where | "About N of 10" | Basis |
|---|---|---|
| A, new method answers | "About 8 of 10 later registered sales of such units fell inside this range." | 83.6% (ready 81.1%, off-plan 84.4%). Ready at the last date: 77.6% |
| B, new method answers | The same sentence, 8 of 10 | 86.9% (ready 83.1%, off-plan 90.0%) |
| C | No sentence | No-go |
| Fallback: tier-1 median | No such sentence for one unit | The median is the middle of the type. A 5% band holds about half of single sales |
| Fallback: tier 2 | No such sentence for one unit | Its range held 59% of single sales; its own claim is about the middle of the type |

- The 8 of 10 is an average across units. It was lower for sales 4 to 6 months after the data date (80.1%) than in the first month (87.6%).
- It is about registered sales. No asking price was ever tested.
- Do not say 9 of 10 for off-plan B. One good period carries it.

## 8. Go / no-go by the agreed rule

Rule: go only if (1) the forward error beats what is live on the same cases, (2) the range holds about 78% or more in every group with 100+ cases, (3) the last untouched date agrees.

| Scenario | (1) Error, same cases | (2) Groups | (3) Last date | Verdict |
|---|---|---|---|---|
| A | 4.37% against 5.41% (41,404). Ready 5.95 against 8.20; off-plan 3.85 against 4.64 | Pass over the pooled groups (lowest 78.1%). One A-only cell fails: ready, other bedrooms leading, 71.8% on 156 sales | 3.90% against 4.68%. Ready range 77.6% | **Go, augment.** Send the failing cell (0.4% of A answers) to the tier-1 median |
| B | 4.90% against 5.62% (9,335). Ready 6.45 against 9.38; off-plan 4.30 against 4.69 | Pass, narrowly: lowest B cell 77.5% on 240 sales (ready, other bedrooms, old) | 5.19% against 5.35%, with a 2% bias. Ready 6.51 against 7.34; off-plan 4.63 against 4.80 | **Go, augment.** Claim the range, not a better centre. Tier 2 stays for the 2 in 3 it cannot answer |
| C | 4.97% against 5.54% (2,483) | Fails at two dates: 64.8% and 61.8% in one group | 5.97% against 5.70%: not better | **No-go** |

"Replace" was tested and fails on share: alone, the method answers 53% of sales against 66% today.

The exclusion of the one A cell was not run as a rule. It removes cases only, so it cannot hurt the other groups.

## 9. What integration would involve

Not built. From the reference code and the artifact:

- **Artifact.** One JSON per data date: 392,208 sale rows, 4,604 buildings, the price index, the slopes and 95 range groups. 19.9 MB; 6.7 MB gzipped. Without names and with rounded values: 12.6 MB; 4.3 MB gzipped. It is built by the Python scripts and needs the long-history file (48 months for the index).
- **Runtime.** `ref\acs.ts`: 250 lines of plain TypeScript, no dependencies, strict mode. It matches the Python on 91 golden cases (70,236 numbers, to 6e-15).
- **Speed.** Parse 0.1 s, index 0.6 s once per server start, 0.34 ms per listing. About 280 MB of process memory in Node. Check this against the Railway plan.
- **Wiring.** Map the app's building keys to the artifact's building index. Run the new method first; on a refusal, fall back to tier 1 or tier 2 and label the answer as the type's middle, not this unit's.
- **Page.** A list of the sales used: date, size, AED per sq ft, time adjustment, size adjustment, adjusted AED per sq ft. Group by "this building, same bedrooms", "this building, other bedrooms", "sibling buildings". Show the heaviest 10 to 15; the rest behind a control.
- **Copy.** Heading: "Registered sales adjusted to this unit". Never "predicted price". Never the words estimate, forecast, valuation (except "Not a valuation"), similar, average. Say "comparison price", "range", "registered sales", "adjusted for date and size".
- **Tests to add.** The golden cases in the app's test runner; the four boundary cases; a check that the refusal reasons map to page states.
- **Data pipeline.** A new artifact with every data refresh. The range multipliers need the backtest re-run when a new half-year of sales is in (the ACS run took about 10 minutes on this PC; preparing targets and baselines was not timed in this stage).

## 10. Untested or weak

- **Listings.** Every test used registered sales. No asking price was tested.
- **Fresh data.** With the last 30 days of sales missing, the share answered falls from 86.6% to 75.6% in A and from 32.7% to 18.6% in B. Only one download exists, so real registration lag is unknown. Compare two downloads before launch.
- **Developer re-pricing.** 7 off-plan projects in mid-2025 were re-priced 12% to 35% up; the range held under 50% there (805 sales, 1.4% of answers). Sales data cannot see this coming.
- **After a price fall** the misses are one-sided: at the last date the real price was below the range 13% of the time and above it 3%.
- **The independent re-build was not repeated** after the stage 4 rule change. The audit re-run on the fixed code matches exactly.
- **The stage 4 rule** was chosen on two dates, after an audit that had seen all four.
- **Per building.** Counted per building, the range held 82%. In 91 of 1,561 buildings with 10+ answers it held under 60%.
- **Scenario C** with the product's own project resolver was not tested.
- **4+ bedrooms** are refused; no gain was found.
- **A ready listing in an off-plan-only building** has no own-type sales to use.
- **No floor, view or condition data.** One sale sits within 4.8% of its building's other sales half the time. No method can go under that.
- **No confidence intervals.** Sales in one building are not independent.
- **Not re-run:** the tuning, the mixed model, LightGBM, the 25% width variant, the cleaning check.
- **`ANALYSIS.md` is not on disk.** The write was refused by the tool in this stage, as in stage 1. Its text is in the stage 4 hand-over.
- **The fallback combination** was scored from the two methods' saved results, not from running code.
