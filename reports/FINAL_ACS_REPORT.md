# Adjusted registered sales: final report for the owner

19 Nov 2026. Branch `real-data`, three local commits on top of the live `f091a20`: `608cb18` (backend), `6ffd8b7` (interface), `a197a77` (review fixes). Nothing is pushed or deployed. No Railway call and no real Anthropic call was made.

## 1. What changes for the user

- **Building with 5 or more sales, and the new answer can be given.** The headline reads "Within / Above / Below the range of adjusted sales", with no percentage. The page shows the range, the asking price on it, one dot per adjusted sale, and the plain 12-month median as one line.
- **Every sale used is listed** with its date, size, registered AED per sq ft, the change for date, for size and (for another bedroom type) for bedrooms, the adjusted figure and how much it counts.
- **Building with too few sales, and the new answer can be given.** The headline stays "Too few sales to compare yet". A section under it shows the range from three years of the building's sales (and its project's, when used), with the list behind one tap.
- **Everywhere else the page is exactly today's**: the 12-month median with the 5% rule, the second tier, the project route, "too few" alone, or "not covered".
- **Old stored comparisons render as stored.** Nothing is recomputed.

New since the review:
- When the asking price is above (or below) every adjusted sale, the page says so in figures, even when the outcome is "within", and says why the range reaches further than the sales.
- A note appears when sales of other bedroom types count for more than the building's own sales of the listing's type.
- The outcome is decided on the asking price as printed, so "AED 1,800" beside "1,450 to 1,800" always reads "within".
- The stamp now reads, for example, "WITHIN / 1,130 TO 1,680 / AED PER SQ FT FROM 13 REGISTERED SALES".

## 2. What the real snapshot shows (local server, data to 16 Nov 2026)

| Listing | New answer | What the page shows |
|---|---|---|
| Elite Residence, ready 2-bed, 1,329 sq ft, AED 1,960,000 | range 1,130 to 1,680 from 13 sales | "Within the range" (asking 1,475; median 1,430) |
| Bella Rose, ready 1-bed, 867 sq ft (25% over the usual 694) | range 940 to 1,390 from 38 sales | "Within", with the size note, and "higher than all 38 adjusted sales; the highest is AED 1,276" |
| Azizi Venice 12 A, off-plan 1-bed, 750 sq ft, AED 1,400,000 | range 1,450 to 1,800 from 10 sales | "Above the range" (asking 1,867) |
| Ozone 1 Residence, off-plan studio, 430 sq ft (4 sales in 12 months) | range 1,350 to 1,710 from 31 sales | "Too few sales", then the section: within |
| **Aykon City (2) -Tower C, ready 2-bed, 812 sq ft, AED 1,450,000** | **declines: range too wide** | today's page: "In line with registered sales", +1.4% on a median of 43 sales |
| **Bahar 4, ready 1-bed, 1,100 sq ft, AED 1,950,000** | **declines: size too far from the sizes sold** | "Too few sales", then the second tier: 1,490 to 1,800, within |
| **Seventh Heaven, ready 1-bed, 2,904 sq ft, AED 4,100,000** | **declines: range too wide** | "Too few sales" alone (the second tier also declines) |
| A building not in the data | does not run | "Not covered yet" |

The task named Aykon City Tower C as a case where the new answer shows. On the real data it does not: it declines and the page is today's. I used Elite Residence as the 5+ case that answers.

Of 22 ready building and bedroom pairs with 5+ sales that I probed at the usual size, the new answer showed for 10 and declined for 12 (all 12 for a wide range). The reviewer's larger sample: 1,079 shown and 728 declined for a wide range, of 3,012 requests.

## 3. Tested accuracy against today

Forward in time, four past data dates, later sale prices as the truth. Errors are typical / 80th / 90th percentile, in percent. Studio to 3-bed. These are the stage 1 backtest figures; the backtest was not rerun after the review fixes (see section 7).

**5+ sales, on the sales the new answer covers (47,840 sales, 84.0% answered):**
- New answer: 4.28 / 10.63 / 16.04. Today's median on the same sales: 5.28 / 13.02 / 19.15.
- The range held the later price in 84.5% of cases; half-width 11.2%.
- Ready only, later dates: 68.7% answered; 5.49 / 12.38 / 18.33 against 6.77 / 14.58 / 20.34.
- Off-plan only, later dates: 90.5% answered; 3.47 / 9.04 / 13.49 against 4.27 / 10.89 / 16.25.

**Too few sales (38,845 sales):**
- The new answer covers 29.1%: 5.06 / 11.29 / 16.26; held 88.4%.
- Where both answer (8,681): second tier 5.44 / 12.22 / 18.30, new answer 4.73 / 10.33 / 14.93.
- At the last date alone the two are level: 5.14 / 10.63 against 5.03 / 10.61.

**The whole chain (new answer first, today's as fallback):**
- 5+ sales: 6.01 / 15.17 becomes 4.99 / 13.01.
- Too few: answered rises from 60.6% to 67.1%; 8.26 / 20.51 becomes 7.82 / 19.88.

**"About 8 of 10"** is the lowest of the 12 tested shares (81.46%), rounded down. Recomputed by the reviewer; all 12 match.

## 4. The verdict rule changed, and what it does

When the new answer shows, the range decides, not the fixed 5% band. Measured on the later dates:

| The listing is priced | Called right today | Called right with the chain |
|---|---|---|
| at the true price | 50.6% | 76.5% |
| 10% over | 71.6% | 28.5% |
| 10% under | 71.6% | 61.7% |
| 20% over | 88.7% | 72.9% |
| 20% under | 93.2% | 91.2% |

In plain words: far fewer correctly priced listings are called "above" or "below", and far fewer listings 10% over are called "above". The ranges are wide (often 15% to 20% either way), so "within" is the common outcome. Which rule serves buyers better depends on how far real asking prices sit from sale prices, which this data cannot show. You chose the range rule before these numbers existed; please confirm it with them in front of you.

## 5. What it declines

Reasons, in the order tested: 4 or more bedrooms; no usable sales; too few sales of the listing's type; size too far from the sizes sold; no calibration for that kind of evidence; range wider than 20% either way. It does not run at all for a building that is not in the data, a building added by hand, with `ACS_TIER=off`, with an unusable or expired fit, or when today is more than 122 days after the data date.

## 6. Operations

- **Switch:** `ACS_TIER=off` returns the site to today's behaviour and hides stored results of the new answer. `SIMILAR_TIER=off` still hides the second tier.
- **Expiry of the fit:** `data:build` exits with code 2 when the data runs more than 200 days past the fit. For the fit of 16 Nov 2026 the last usable data date is 4 Jun 2027. Refit steps are in `scripts/model/README.md`.
- **Expiry by data age (changed in this stage, 183 to 122 days):** with the current snapshot the new answer stops on 19 Mar 2027 unless the data is refreshed. The server then logs `acs_inactive` once and the how-it-works section disappears.
- **Safety net:** an error inside the new step no longer fails the comparison; it logs `acs_failed` and shows today's answer.
- **Boot and memory (this PC, PGlite, real snapshot):** empty database: health after 5.8 s, data load 26.3 s (403,867 sales), 558 MB after the load, 491 MB after 118 comparisons, peak 680 MB before the health check answered. Second start: health after 3.9 s, peak 513 MB after the screenshot run.
- **Time per comparison:** 17 to 39 ms for ordinary buildings; 206 to 219 ms for the largest project family (Azizi Venice, about 11,650 sales read).
- **First deploy:** the server reloads the whole snapshot once (about 27 s locally). The new answer is off until `open_data_loaded` appears in the log.

## 7. Limitations

- **Not rerun after the fixes:** the backtest. The one method change (the outcome uses the asking price rounded to whole AED) moves a result only when the asking price is within AED 0.5 of a range end.
- **Tie order (not fixed, documented).** Sales of equal weight are taken in file order, and the backtest used another order. On 1,747 real requests, 58 (3.3%) get a different rounded range, 3 centres move by more than 1% (largest 4.137%), 2 outcomes flip. The fix needs a full backtest rerun and new golden cases.
- **Near-ties (not fixed, documented).** 4 of 6,932 real requests differ between TypeScript and Python beyond 1e-9; no shown range or outcome changed.
- **Other bedroom types can lead.** Example: Avenue Park Towers II 3-bed, where one 3-bed sale counts 11.8% and 24 two-bed sales 88.2%. The page now says so. The weakest tested group is ready, 5+ sales, other bedrooms leading: 73.2% held on 126 sales.
- **A wide range falls back to a firm verdict.** Seventh Heaven 2-bed: the new answer declines (52.6% wide) and the page says "below" by 23.9% on 10 sales, as decided.
- **Ready ranges after a price fall** miss on one side: at the last date the later price was under the range for 13.7% and over it for 3.4%.
- **One slice under 80% is still served:** ready sales 62 to 122 days after the last test date, 79.71% (843 sales, one date).
- **Postgres was never measured.** All timings are PGlite on this PC.
- **Too-few with the new answer is tested end to end only on the real snapshot run** (Ozone 1); the automated e2e test drives it with a fixture.
- **Copy has had no legal review.** 102 keys pass the mirror and banned-word tests. The "Too few sales to compare yet" headline above a section that does compare is still your decision.
- **Admin counts** still group by the median's result, not the outcome people saw.
- **Not built:** the admin page does not show whether the new answer is active; no confidence intervals; scenario C; suggested offers, AED total gaps and agent messages (held for legal review).
- **Screenshots:** I opened 10 of the 38 real-data screenshots and none of the 134 synthetic ones from this run. Contrast was not measured by hand; axe passed.

## 8. What to watch after a deploy

1. `open_data_loaded` in the Railway log, then one comparison that shows the new answer.
2. Memory during the first start (local peak 680 MB).
3. `acs_failed` and `acs_inactive` in the log: there should be none.
4. Response time of a comparison in a large project family (Azizi Venice) on Postgres.
5. The share of comparisons with `acs.shown` true, and the split within / above / below, from the `check_created` events.
6. Refresh the data before 19 Mar 2027; refit before data passes 4 Jun 2027.

## 9. Checks run in this stage (each alone)

- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 0, no warnings.
- `npx vitest run --maxWorkers=2`: 106 files passed, 1 skipped; 1,585 tests passed, 1 skipped.
- `npm run build`: exit 0.
- `npx playwright test`: 48 of 48 passed. The switch run: 2 of 2 passed.
- `data:build` on the real files: sales, buildings, cells and model byte-identical to the committed ones; only the manifest gained `acs.indexFrom` (2022-11-17).

Screenshots: `(local scratch folder)` (real data, 390 and 1280) and its `synthetic` subfolder (from the e2e run).
