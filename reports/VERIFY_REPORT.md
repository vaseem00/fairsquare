# Fairsquare: verification of the data rules and the similar-buildings model (stage 3)

Written 19 Nov 2026. I did not write the model. Everything below was checked with scripts of my own in `verify\`, which share no code with stage 2 (`m2\`, `ref\`). "Combination" means one building, one bedroom count and one basis. "Coverage" is the share of cases where the range holds the truth. Internal words such as "model" are used here; none of this is user-visible copy.

## 1. Outcome

Two things were wrong and are fixed. The rest held up.

1. **A stage 1 data rule let bulk deals into the snapshot, and it damaged the main product.** Keeping every block of like units moved the same-building median of Paradise View - 2 (ready, 1 bedroom) from about AED 1,500 to 851 per sq ft: 77 units were registered on two days at exactly AED 851. New rule 10a leaves such blocks out. The snapshot is rebuilt and committed (`a191a29`): 404,366 sales, 4,348 buildings.
2. **The model's ranges were too narrow for really thin buildings.** The stage 2 backtest thins buildings that sell a lot. Buildings that really have 2 to 4 sales are noisier. The ranges of the two classes that use the building's own evidence are now 1.2 times wider.

What held up:

- **No leakage found.** My independent re-implementation, written from the spec alone, reproduces all 35 golden cases (largest relative difference 1.9e-15) and the headline errors with different folds and different random draws.
- **Constants are stable in time.** Fitted with data to 17 May 2026 and applied to 16 Nov 2026 they give the same errors and 80.1% and 82.8% coverage.
- **The refusal for buildings not in the data is right.** On buildings that first appeared after my own start dates, a community reference was 7% to 10% low and its range held the truth 65% to 68% of the time.

The model is fit for one scenario and refused in the other:

| Scenario | Verdict | Final numbers |
|---|---|---|
| Building in the data, 1 to 4 own sales | fit, with the wider range | typical error 3.1%, 8 in 10 within 7.1%; typical range -6.4% to +9.2% |
| Building in the data, no sale in 12 months | fit, mostly "broad" tier | 5.1% and 11.9%; typical range -11.0% to +17.7% |
| Building in the data, 4 or more bedrooms | refused (not testable) | 759 combinations |
| Building not in the data, area or community known | refused | typical error 10% to 13%, bias -5% to -10% |
| Building not in the data, project siblings, off-plan | allowed by the rule, but rests on 33 to 70 cases and has no route in the product yet | see F7 |

**Final implementation spec:** `MODEL_REPORT.md` section 11, with `golden\constants.json`, `golden\golden-cases.json` (35 cases, snapshot `a191a29`), `golden\area-aliases.json`, `golden\resolver-cases.json`, and the reference `ref\similar.ts` and `ref\resolve.ts`.

## 2. Findings

Each finding has its evidence and its outcome. "Fixed" means scripts, constants, golden cases and reports were changed and re-run.

### F1. Really thin buildings are noisier than thinned rich ones. Fixed: ranges 1.2 times wider.

**The risk.** Stage 2 calibrated the 80% range on buildings with 10 or more sales, cut down at random to 1 to 4. Real too-few buildings are a different population: 58% of small combinations are ready against 30% of rich ones, and stage 1's size rule cleans only combinations with 5 or more sales.

**Test B, small combinations (5 to 9 sales).** Hand over 1 to 4 sales, score against the median of the rest. Compared with rich combinations cut down to the same size and scored the same way. (The truth here is a median of 1 to 8 sales, so both columns sit below 80%; the gap is what counts.)

| Before the fix | Small, real | Rich, cut to size |
|---|---|---|
| Typical error / 80th percentile, 1 to 4 own sales | 4.6% / 10.1% | 3.9% / 8.7% |
| Coverage, 1 to 4 own sales | 68.9% | 73.1% |
| Coverage, no own sales | 74.0% | 79.6% |

**Test C, really thin combinations (2 to 4 sales, 3,160 of them).** Hold one sale out, use the others as own evidence, check whether the range holds the held-out sale. Compared with rich combinations cut to 2 to 4 sales, same procedure.

| Before the fix | Thin, real | Rich, cut to size |
|---|---|---|
| Typical error / 80th percentile against the held-out sale | 7.6% / 15.8% | 5.6% / 12.6% |
| Coverage of the held-out sale | 50.3% | 58.9% |
| Ready / off-plan | 48.1% / 54.7% | 55.9% / 60.2% |
| No own evidence used (2 to 4 sales) | 58.7% | 65.2% |
| Real 1-sale combinations, no own evidence used | 56.8% | 65.2% |

The ranges had to be 1.09 to 1.24 times wider for the real groups to match the simulated ones (own evidence: 1.09 to 1.14 in test B, 1.20 to 1.24 in test C; no own evidence: 1.03 to 1.22). A single sale is also more spread inside a thin combination: robust standard deviation 0.096 against 0.081 (ready) and 0.063 against 0.055 (off-plan).

**Outcome.** `thinCellFactor` 1.2 multiplies the lower and upper multipliers of the `own` and `indirect` classes (the floor is unchanged). After the fix, on the final snapshot:

| After the fix | Real | Simulated before the fix (the 80% calibration) |
|---|---|---|
| Test B, 1 to 4 own sales | 74.4% | 73.1% |
| Test B, no own sales | 80.8% | 79.6% |
| Test C, own evidence | 58.5% | 58.9% |
| Test C, no own evidence (2 to 4 sales) | 65.9% | 65.2% |
| Test C, real 1-sale combinations, no own evidence | 62.9% | 65.2% |

The right-hand column was measured before the snapshot was rebuilt (F2); the rebuild moves it by less than a point. So real thin combinations now behave like the simulated ones on which 80% was calibrated. The last row is still a little short. On the simulated cases the wider range holds the truth about 85% of the time; that is the price.

Limits of this fix: the true median of a thin building cannot be observed. Tests B and C use noisy stand-ins (a median of few sales, or one sale). The factor is one number for both classes and both bases, set from four comparisons, not fitted per segment.

### F2. Stage 1 kept bulk deals as "like-unit blocks". Fixed in the repository (commit `a191a29`).

**Evidence.** I compared the 12-month medians of every building, bedroom and basis combination before stage 1 and after it. Paradise View - 2 (ready, 1 bedroom) went from 55 sales at AED 1,500 to 132 sales at AED 851: 77 units registered on 10 and 11 March 2026, every one at exactly AED 851 per sq ft. Other moves of the same kind: Verdana 1 -37%, Al Ghurair Residence 1 -27%, One by Binghatti -23%, Maison Elysee II -19%, Binghatti Apex -16%, Binghatti Ghost +39%.

Stage 1's reason for keeping like-unit blocks was that their price "sits at the median of the building's other sales (ratio 1.00)". That is a median. Of the 9,426 block rows that can be checked against 5 or more other sales of the same building, bedrooms and basis within a year, 13.0% (1,221) were under 0.8x or over 1.25x, against 5.5% of ordinary sales. The far ones sit at 0.36x to 0.59x.

**Outcome.** New rule 10a in `src\lib\ingest\data-dubai.ts`: a block of like units is left out when its AED per sq ft is under 0.8x or over 1.25x the median of the building's other sales (rows in no block, same bedrooms, same completion, within 365 days), when 5 or more exist. A block with nothing to compare with stays. Counted as `portfolio_deal`.

- Snapshot: 405,649 to 404,366 kept (-1,283). `portfolio_deal` 11,828 to 17,638 over all years.
- 8,638 like-unit block rows stay; 0.4% of the checkable ones are outside the band.
- Combinations whose 12-month median differs by more than 5% from the pre-stage-1 snapshot: 37 before the fix, 22 after. Largest remaining: 16.9%.
- Unit test added (six scenarios); REAL_DATA.md rule list, review table and counts updated.

Still open: Hera Tower (ready, 2 bedrooms) has 21 block rows at AED 900,000 for units of 1,165 to 1,212 sq ft, at 0.81x to 0.85x of its 9 other sales. They are inside the band and stay, so its median is 763 where the other sales give 912. See open question 2.

### F3. The known example holds.

Aykon City (2) -Tower C, ready, 2 bedrooms, 12 months to 16 Nov 2026: **43 sales, median AED 1,760.93 per sq ft (1,761)** in the pre-stage-1 snapshot, in `b982861` and in `a191a29`. Unchanged.

### F4. Spot-check of 30 combinations before and after the cleaning changes.

Pre-stage-1 snapshot (397,009) against the final one (404,366). All combinations with 5 or more sales in both: 4,727. Median unchanged in 4,313 (91%). Changed by more than 1%: 150; more than 2%: 79; more than 5%: 22. Mean change +0.03%. Combinations that reached 5 sales: 23; that fell under 5: 33 (the 12 I listed lost one or two rows each).

The 30 spot-checked (`verify\clean_out.txt`, `verify\clean_check.json`): the known example; the 10 largest median changes; the 9 largest count changes; 10 at random. The count changes are large off-plan launches (Binghatti Vintage studios 759 to 1,157 sales, median +0.8%; Azizi Venice buildings +0.9% to -3.2%), which is what the loosened rule was meant to do. The 10 random ones: 8 unchanged, 2 changed by 0.6% and 1.4%. The largest remaining median changes (Kempinski Residences +16.9%, Binghatti Flare 02 +16.7%, Hera Tower -16.4%, Stories by Mirfa +14.9%) come from small combinations of 5 to 13 sales where the size rule removed rows or a block within the band came in. I did not find another case like Paradise View - 2.

Reconciliation: 397,009 - 1,414 (size unlike the building's) + 8,771 (8,638 like-unit blocks, 98 above the old ceiling, 35 under the old floor) = 404,366.

### F5. Leakage hunt: nothing material.

| Where leakage could enter | What I found |
|---|---|
| The hidden building's sales in area, community or project references | No. My implementation excludes the building from every reference and gets the same errors (S1 10.3% / 22.6%; S2 7.0% / 17.4%; siblings 3.0% / 7.6%). |
| Variance tables, range multipliers | Cross-fitted over project groups. With my own folds (different seed) and my own refit the constants agree: every reference spread within 1%; own-sales spreads within 0.006; older-sales and other-bedroom spreads within 0.03, the largest gaps in the buckets with the fewest cases; multipliers within 0.05 except project (1.61 against 1.73). Cross-fitted coverage 79.8% and 79.6%. |
| Same project split across train and test | No: folds are whole project groups. Leave-project-out is reported beside leave-building-out and I reproduce it (3.2% / 7.2% with own sales, 6.3% / 13.2% without). |
| Future sales used for a past date | No in the arithmetic. One small exception: the cleaning rules (size rule, blocks) see the whole 36 months, so a 2025 comparison date uses rows cleaned with 2026 knowledge. Not material. |
| Time index, hedonic coefficients | Fitted per fold; not in the shipped model anyway. |
| Hyper-parameters (floors, the 0.20 cut, the spread statistic, minimum counts) | Chosen on all folds. A handful of numbers on 13,000 rows; my out-of-time refit (F6) shows no visible effect. |
| Survivorship from cleaning | Real: combinations with 5 or more sales are cleaned by the size rule, thinner ones are not. This is part of F1 and is covered by the factor. |

Small mismatches against the written spec (fixed in `MODEL_REPORT.md`):
- The spec did not say that `rangeLowPsf`, `rangeHighPsf` and `verdict` are null when the result is not shown; the reference returns null. My first pass returned numbers for 9 of 35 golden cases. The spec now says null.
- The report said 2,701 test combinations; counting by the product's used count (after the 0.5x to 2x rule) gives 2,694 (2,690 on the final snapshot). Stage 2 counted raw rows. No effect on results.
- `run.ts` wrote the commit `b982861` into the golden file as a literal; now `a191a29`.

### F6. Time hold-out on the most recent 6 months.

Constants fitted only with data to 17 May 2026 (T0), by my own fitting code.

(a) Applied unchanged to the 16 Nov 2026 backtest: typical error 3.1%, 80th percentile 7.1%, coverage 80.1% (1 to 4 own sales); 5.1%, 11.9%, 82.8% (no own sales). Stable.

(b) Real thin combinations at T0, scored against the median of what sold in the following 183 days:

| Start | Future sales needed | Real thin, 1 to 4 own sales | Coverage, constants of T0 (no factor) | Coverage, shipped constants | Rich combinations thinned, same target, constants of T0 |
|---|---|---|---|---|---|
| 17 May 2026 | 5 or more | 188 cases, 4.7% / 9.0% | 66.5% | 76.6% | 67.0% |
| 17 May 2026 | 10 or more | 66 cases, 4.1% / 8.9% | 68.2% | 75.8% | 70.6% |
| 16 Nov 2025 | 5 or more | 251 cases, 5.0% / 10.7% | 66.9% | 69.7% | 67.0% |
| 16 Nov 2025 | 10 or more | 96 cases, 3.6% / 8.5% | 78.1% | 80.2% | 71.5% |

Reading:
- **The range does not hold the next half-year's median 80% of the time.** It holds it 66% to 78% before the factor and 70% to 80% with it.
- This is not about thinness: rich combinations thinned and scored against the same future target fall short by the same amount (67% to 72%). The shortfall is the target moving: ready prices moved -3.8% in the 6 months after May 2026 and +3.3% after Nov 2025, and a median of 5 to 9 future sales is itself noisy. This corrects stage 2's explanation (it blamed new launches).
- The same is true of the same-building product: its 12-month median is not next half-year's median either. The copy must keep saying the comparison is with registered sales of the 12 months to the data date.

Known building, bedroom type never sold in 36 months (evidence from other bedroom types only), shipped constants: 34 cases, 6.6% / 15.9%, coverage 72.7% (May 2026); 65 cases, 8.4% / 14.0%, coverage 77.8% (Nov 2025). Thin evidence; see open question 4.

### F7. Buildings not in the data: the refusal is confirmed.

Buildings with no sale up to T0, scored on the 183 days after, reference from the data at T0. Range "as calibrated" is the one from hidden existing buildings.

| Start | Reference | Cases | Typical error / 80th pct | Bias | Coverage as calibrated |
|---|---|---|---|---|---|
| 17 May 2026 | area | 175 | 10.0% / 19.8% | -5.1% | 81.8% |
| 17 May 2026 | community | 140 | 10.8% / 23.7% | -7.3% | 67.9% |
| 16 Nov 2025 | area | 444 | 13.2% / 26.9% | -7.4% | 69.5% |
| 16 Nov 2025 | community | 357 | 13.1% / 23.6% | -9.9% | 65.3% |
| 17 May 2026 | project siblings, off-plan | 10 | 4.5% / 8.5% | +1.0% | 100% (shipped range) |
| 16 Nov 2025 | project siblings, off-plan | 23 | 4.9% / 15.6% | -2.0% | 78.3% (shipped range) |

- New buildings sell above existing ones of the same community; a community or area reference alone would say "above" far too often. **Never showing those classes is right.**
- Project siblings: the shipped multiplier (4.2) was set on stage 2's forward cases, so its coverage there is in-sample. My 33 cases overlap theirs in time and are not independent. Nothing contradicts the rule, and nothing confirms it out of sample. No ready case exists. Open question 3.

### F8. Decision rule: how often each outcome is wrong (my split, shipped constants, final snapshot)

Listings priced like single registered sales around the true median; "same-building rule" is the 5% band.

| | Share of results | Same-building rule agrees | says in line | says the opposite |
|---|---|---|---|---|
| 1 to 4 own sales: "above" | 15.8% | 67.2% | 31.5% | 1.4% |
| "below" | 19.3% | 67.3% | 31.4% | 1.3% |
| "within" | 64.9% | 79.1% in line | | |
| No own sales: "above" | 12.6% | 59.5% | 38.0% | 2.5% |
| "below" | 15.0% | 64.1% | 33.6% | 2.3% |

By the true gap (1 to 4 own sales, all shown): a listing exactly at the building's median is called "above" 6.9% and "below" 7.7% of the time; 5% above: "above" 21.5%; 10% above: 58.9%; 20% above: 93.3%. With no own sales a listing 10% above is called "above" 33.7% of the time.

Before the wider ranges these were: agrees 62% (stage 2: 62.4%), at the median 10% each side, 10% above called "above" 69%. So the fix trades sensitivity for fewer false calls. About a third of "above" and "below" results still fall on listings the same-building rule would call in line. The direction is almost never reversed.

### F9. Area resolver: 40 listing-style strings of my own

`verify\v_resolver.ts`, results in `verify\resolver_check.json`.

- **Right DLD area: 36 of 40** after the fix below (35 before). **Wrong area: 0.**
- Not resolved (the product then keeps "Not covered yet"): 4. Two misspellings ("Jumeriah Village Circle", "Buisness Bay"): there is no fuzzy matching, by design. "The Views": no alias and no master project of that name in the data. "Marina Residences, Palm Jumeirah": "marina" and "Palm Jumeirah" point to two areas, so it refuses, which is the safe result.
- Two of my own expectations were wrong and the resolver was right: DAMAC Hills 2 is filed under Madinat Hind 4 (2,071 sales), and Dubai Investment Park flats are in "Second" (4,813 sales against 1 in "First").
- Strings that must not resolve ("Sharjah, Al Majaz", "Mohammed Bin Rashid City") did not.
- Fixed: "Al Barsha 1" did not resolve; aliases "al barsha 1" and "barsha 1" added (253 aliases now). The 44 stage 2 resolver cases are unchanged.
- Risk noted, not changed: the bare words "marina" and "downtown" resolve on their own. A listing from another emirate ("Marina Square, Al Reem Island") would resolve to Dubai Marina. Harmless today, because an area alone never produces a result. It must be handled before any use of the area alone (open question 5).

### F10. Things I checked that need no change

- Golden cases regenerated on the final snapshot: the TypeScript reference against stage 2's Python port on all 8,825 too-few combinations, 0 mismatches (largest relative difference 3.7e-15); my implementation against the 35 golden cases, 0 mismatches.
- Stage 2's own numbers barely move on the rebuilt snapshot (typical and 80th-percentile errors by at most 0.15 points, 90th percentiles by up to 0.6): S1 10.3% / 22.6%; S2 7.0% / 17.4%; 1 to 4 own sales 3.1% / 7.0%; none 5.1% / 11.7%.
- 3-bedroom coverage, the weak segment in stage 2 (74% to 77%), is 84.1% and 82.9% with the wider ranges on the simulated cases.

## 3. Final numbers

Snapshot `a191a29`: 404,366 sales, 4,348 buildings, 13,575 combinations, 2023-11-17 to 2026-11-16.

**Backtest, simulated thin combinations (2,690 with 10 or more sales; my split; shipped constants).** Error triple: typical / 80th / 90th percentile.

| Case | Errors | Coverage of the shipped range | Typical range |
|---|---|---|---|
| 1 to 4 own sales, thinned | 3.1% / 7.1% / 10.1% | 85.3% | -6.4% to +9.2% |
| 1 to 4 own sales, other evidence intact | 2.9% / 6.6% / 9.6% | 85.6% | -6.1% to +8.8% |
| No own sales, thinned | 5.1% / 11.9% / 17.0% | 86.8% (86.2% among those shown) | -11.0% to +17.7% |
| No own sales, intact | 4.0% / 8.9% / 12.4% | 86.7% | -7.6% to +11.6% |
| Leave-project-out, 1 to 4 own / none | 3.2% / 7.2% and 6.3% / 13.2% | 85.7% / 86.2% | |
| By own sales k = 1, 2, 3, 4 | 3.6 / 8.3; 3.1 / 7.1; 2.9 / 6.6; 2.8 / 6.2 | 84.3% to 86.5% | |

The nominal level is 80% on really thin combinations (F1); on these simulated ones it is about 85%.

**Who gets a result (8,825 real too-few combinations).**

| Group | Combinations | Shown | Close | Broad | Shown, weighted by 36-month sales | Typical half-width |
|---|---|---|---|---|---|---|
| All | 8,825 | 90.4% | 54.1% | 36.3% | 97.8% | 10.1% |
| 1 to 4 sales in 12 months | 5,469 | 93.2% | 72.9% | 20.3% | 98.1% | 9.2% |
| No sale in 12 months | 3,356 | 85.8% | 23.4% | 62.4% | 97.0% | 13.4% |
| Ready | 5,163 | 91.5% | 46.9% | 44.6% | 97.2% | 10.7% |
| Off-plan | 3,662 | 88.8% | 64.2% | 24.6% | 98.0% | 9.2% |
| Studio to 3 bedrooms | 8,066 | 98.9% | 59.2% | 39.7% | 99.9% | 10.0% |
| 4 or more bedrooms | 759 | 0% | | | | |

Stage 2 reported 69.4% close and 21.2% broad; the wider ranges move 15 points from close to broad. Not shown: 759 for bedrooms, 92 because the range is too wide. Requests that resolve only to an area or a community: 0% shown.

**Shipped range constants** (`golden\constants.json`; floor, lower, upper): own 0.03, 1.504, 2.004; indirect 0.03, 1.621, 2.258; project 0, 4.2, 4.2; community 0.06, 1.152, 2.212 (never shown); area 0.06, 1.113, 2.558 (never shown). Before the factor: own 1.253 and 1.670; indirect 1.351 and 1.882.

## 4. What was changed

Repository (branch `real-data`, commit `a191a29`, local only):
- `src\lib\ingest\data-dubai.ts`: rule 10a and its four constants.
- `tests\unit\ingest\data-dubai.test.ts`: one new test (six scenarios).
- `docs\REAL_DATA.md`: rule 10a, the review table, the counts.
- `data\open-data\sales.csv.gz`, `buildings.csv.gz`, `manifest.json`: rebuilt with `npm run data:build` from the same two raw files.

Scratch model folder:
- `ref\make_constants.py`: `thinCellFactor` 1.2; `range80BeforeThinCellFactor` kept for reference.
- `m2\model.py`: reads the shipped ranges from `golden\constants.json`, so the Python port and the TypeScript reference use the same numbers.
- `ref\make_aliases.py`: two aliases. `ref\run.ts`: commit name.
- Everything refitted on the rebuilt snapshot, in the order of `MODEL_REPORT.md` section 13: `work\clean.mts`, `prep.py`, `bt_build.py` (both dates), `bt_final.py --nofwd`, `model_fwd2.py`, `bt_final.py`, `make_constants.py`, `model.py`, `run.ts`, `bt_eval.py`, `report_tables.py`, `charts.py`.
- `golden\constants.json`, `golden-cases.json`, `area-aliases.json`, `resolver-cases.json`, `ref\artifact.json`: regenerated.
- `MODEL_REPORT.md`: stage 3 section added at the top; sections 5, 8 and 11 and the appendix updated. `DATA_REPORT.md`: stage 3 note added at the top.
- The stage 2 state is kept in `verify\before\`.

My scripts (`verify\`): `vlib.py` (implementation from the spec), `vbt.py` (backtest and refit), `v_golden.py`, `v_a.py` (headline, own folds, wrong calls), `v_b.py` (tests B to E), `v_c2.py` (factor), `v_clean.py`, `v_blocks.py`, `v_resolver.ts`. Outputs: `a_out.txt`, `b_out.txt`, `c2_out.txt`, `clean_out.txt`, and the `.json` files beside them.

## 5. Checks run, and not run

Passed:
- `npx tsc --noEmit` exit 0; `npx eslint .` exit 0.
- Full vitest with `--maxWorkers=2`: 90 files, 1,199 tests passed (run after the rule and its test, before the commit).
- `npm run data:build` exit 0: 1,820,003 read, 404,366 kept, 4,348 buildings.
- 35 of 35 golden cases with my implementation; TypeScript reference against the Python port on 8,825 combinations, 0 mismatches.

Not run or not verified:
- The full snapshot was not loaded into PGlite or Postgres. Playwright was not run. No server was started.
- The rebuilt test fixtures: the fixture tests pass unchanged, so the sample file has no block that rule 10a removes; I did not rebuild the fixture files.
- Stage 2's charts 14 to 19 were regenerated and not looked at.
- Sections 3, 6 and 7 of `MODEL_REPORT.md` still show stage 2's run on the earlier snapshot; the rerun differs by at most 0.15 points in typical and 80th-percentile errors and is in `m2\eval_d1.txt`, `m2\final_d1.txt` and the appendix.
- The thin-building factor was set and checked on the same tests B and C (one seed). It is a correction, not a cross-validated fit.
- Nothing was pushed or deployed. No external request was made.

## 6. Open questions for the lead

1. **The wider range is my call.** It keeps the claim honest for really thin buildings and costs 15 points of "close" results (69% to 54%). The alternative is to keep the narrow range and state a lower level. I recommend the wider one.
2. **Rule 10a band.** 0.8x to 1.25x leaves Hera Tower's 21 flat-price sales in (0.81x to 0.85x of its other sales). A tighter band (0.85x to 1.18x) would take out about 6% of the remaining like-unit block rows. Keep 0.8x to 1.25x?
3. **Project-sibling results for unknown buildings** rest on 70 in-sample cases and my 33 overlapping ones, and no project matcher exists. I recommend not building that route in this release: every building not in the data keeps "Not covered yet".
4. **A bedroom type the building has never sold** is shown from its other bedroom types only. Forward coverage 73% and 78% on 34 and 65 cases. Show it, or refuse until the building has sold that type?
5. **Resolver.** Bare "marina" and "downtown", and listings from other emirates. Needed only if the area alone is ever used.
6. **80% or 90% range** (stage 2's question 2) still stands. With the wider range, a third of "above" and "below" results fall on listings the same-building rule would call in line.
7. **Deploying the rebuilt snapshot** changes same-building results for some buildings against live (stage 1's question 1). Against the pre-stage-1 snapshot, 22 combinations move by more than 5%.
8. Stage 2's questions 4 and 6 to 10 (4 or more bedrooms, the edge at 5 sales, size note, where the table is built, unknown basis, who refits) are unchanged.
