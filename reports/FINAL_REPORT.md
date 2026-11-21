# Fairsquare: the second comparison, final report

19 Nov 2026. Branch `real-data`, committed locally, not pushed and not deployed.

## 1. What was built

Fairsquare compares a listing's asking price with registered sales in the same building. That stays the product and is unchanged.

When a building has fewer than 5 sales of the listed type in 12 months, the page said "Too few sales to compare yet" and stopped. Now it can add a second, weaker section under that message: **"A range from more registered sales"**.

The range is built from four kinds of registered sales:

1. the 1 to 4 sales the building has in the last 12 months;
2. its sales of the same type from the two years before;
3. its other bedroom types;
4. other buildings of the same project, community or DLD area, with the same bedrooms and the same ready or off-plan basis.

The page shows a range in AED per sq ft, says if the asking price is within, above or below it, lists every source with its count, and names the other buildings. It shows no single figure, no percentage and no stamp. It ends with "Not a valuation".

## 2. When it declines

The second section does not show, and the page stays exactly as it was, when:

- the listing has more than 3 bedrooms (too few test cases);
- nothing comes from the building itself. This covers every building that is not in DLD data: **"Not covered yet" never gets a range**;
- the only evidence is the same 1 to 4 sales the page has just called too few;
- the building's own sales disagree: its yearly medians are more than 1.25 times apart, or its 12-month median is outside the range;
- the range is wider than about 20% either side.

On today's data, 8,825 building and bedroom combinations are "too few". The section shows for 5,966 of them (67.6%), and for 74.0% of studios to 3-beds.

## 3. How it was tested, and the honest accuracy

The test hides a building that has many sales, leaves it only a few, builds the range, and checks if the range holds the building's real median. 2,690 building and bedroom combinations were tested this way.

| Case | Range held the real median | Typical error of the middle |
|---|---|---|
| Building has 1 to 4 sales in 12 months | 89.3% | 2.8% |
| Building has no sale in 12 months, older sales or other bedroom types only | 86.2% | 4.6% |

Weaker results, stated as they are:

- **Against the next six months:** 78.5% and 76.0% on real too-few buildings (191 and 271 cases). Prices moved 3% to 4% in each half-year.
- **Really thin buildings:** 63% to 81%, on a harder target (one held-out sale). The test is less exact here.
- **A bedroom type the building never sold:** 67.9% and 72.5%, on only 28 and 51 cases.
- **3-beds with no own sale:** 82.1%.

The pages say "about 8 of 10", "about 7 of 10" against the following six months, and "about 6 to 8 of 10" for really thin buildings. Each number is the lower measured share, rounded down.

Not tested: listings (only registered sales exist), the effect of floor, view or condition, and 4-beds and larger.

## 4. What the review found and what changed

Three reviewers checked the first version. All 24 findings were verified. The important ones:

| Finding | What was wrong | What was done |
|---|---|---|
| Range contradicted the building's own sales | Ellington House 3-bed: 4 sales with a median of AED 3,647, but a "narrow" range of 2,620 to 3,140. 1,075 of 5,096 shown ranges did not hold their own building's median. | New rule (section 2, fourth point). Tested: those ranges held the median only 55.7% of the time. They are now refused. |
| A verdict from the same 2 sales called "too few" | The page said "too few", then said "above that range" from those same sales, and claimed it "looked at more registered sales". | Refused. A second check in the page code shows nothing in this case, whatever is stored. |
| Database ids shown as building names | The list read "4301, 2236" on real data. No test caught it. | Fixed. Names come from the buildings table. Tests now check exact names, and one browser test runs on the server's own answer. |
| "Similar buildings" were often far apart | In 39% of cases the highest median was more than twice the lowest. | The pages no longer say "similar". They say "other buildings in" the place, state the span of their medians, and say they are not matched on size or price level. |
| Range from sibling buildings alone | Shown for 31 combinations, tested on 33 cases, while the page said it needs the building's own sales. | Never shown now. |
| No way to withdraw stored ranges | Shared pages would keep an old range for good. | Two switches: `SIMILAR_TIER=off` hides everything, and ranges made by an older rule are hidden. |
| Refit scripts only in a temp folder | The tier switches off around 5 Jun 2027 unless refitted. | Scripts and a how-to are in `scripts/model/`. `data:build` now stops with an error when the fit is too old. |

Because of the new rules, the share of too-few buildings that get a range fell from 90.4% to 67.6%. This is the price of not contradicting the building's own sales.

Smaller fixes: the legend now says "up to 3 other buildings", the list header no longer wraps on a phone, the focused row is visible, the popover has a name, the coverage link has a full tap area, and four garbled code comments were repaired.

## 5. What changed in the data cleaning

Source: 1,820,003 rows in two DLD files. Kept: **404,366** sales in **4,348** buildings (was 397,009 in 4,346), 17 Nov 2023 to 16 Nov 2026.

| Rule | Change | Effect in the 36 months |
|---|---|---|
| Size floor | 200 to 150 sq ft | 35 sales came in |
| AED per sq ft ceiling | 11,148 to 20,000 | 98 came in |
| 3 or more units at one price on one day | Kept when the units are alike, dropped when unlike | 8,638 came in |
| Like-unit batch far from the building's level (new) | Dropped under 0.8x or over 1.25x | 1,283 went out |
| Size unlike the building's (new) | Dropped under half or over twice the usual size | 1,414 went out |
| Arabic characters in English names | Removed | 45 project names |

In this review, one more change: a batch that mixes ready and off-plan rows is now judged per completion, so the result does not depend on row order. The rebuilt sales, buildings and cells files are byte-identical to before; only the manifest changed.

## 6. What changed in the app

- A new section on the too-few result and on shared pages, with a range scale, the sources line, the list of other buildings and the test numbers behind "Narrow range" or "Broad range".
- The share card, the link preview image and the WhatsApp text carry the range when one shows.
- "How Fairsquare compares" has a section "When a building has too few sales". Coverage has one note.
- Covered results, "Not covered yet" and refused too-few results look exactly as before.
- **Not built:** the area question. An area alone never gives a result, so the answer could not change anything. Also not built, held for legal review: suggested offers, AED totals, agent messages.

## 7. Checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` | exit 0 |
| `npx vitest run --maxWorkers=2` | 97 files, 1,407 tests passed |
| `npm run build` | exit 0 |
| `npx playwright test` | 38 passed |

A local production server ran on the real snapshot (PGlite, no AI call). It loaded 404,366 sales and 13,575 cells in 26 s. 30 screenshots at 390 and 1280 are in the `final` folder next to this report; I looked at them. The server is stopped and ports 3190, 3110 and 3111 are free.

Not measured: load time and memory on Railway Postgres.

## 8. What you must decide or get advice on

1. **Legal review before deploy.** The second section gives a range and says "above" or "below" for a building with too few sales. It is worded as registered sales, with "Not a valuation", but a lawyer should confirm it is not a regulated valuation activity. If the answer is no, set `SIMILAR_TIER=off`: nothing shows.
2. **The wording changed from your brief.** You asked for "registered sales in similar buildings". The pages now say "other buildings in" the project, community or area, because the buildings are not matched on size or price level. If you want "similar", the model needs real matching first.
3. **Three buildings with one-price batches** (Hera Tower 2-bed, Safeer Tower 2 studio, Stories by Mirfa studio). Batches at one price move their medians by 11% to 16%. They look like list-price sales, so no rule was changed. Accept this, or ask for a tested rule. Details are in `docs/REAL_DATA.md` section 14.
4. **Refit by 4 Jun 2027.** After that the section switches itself off until the numbers are refitted. Steps are in `scripts/model/README.md`. Python with numpy is needed.
5. **Fewer buildings get a range now** (67.6%, was 90.4%). This is deliberate. Loosening it would bring back ranges that held only 56% to 65% of the time.
6. **The model reports are in a temp folder** (`DATA_REPORT.md`, `MODEL_REPORT.md`, `VERIFY_REPORT.md`, this report and the screenshots). A reboot or cleanup can remove them. Copy the `model` folder somewhere safe.
7. **Deploy is yours.** Nothing was pushed. The first load on Railway rewrites about 395,000 rows in one transaction; watch that load.
