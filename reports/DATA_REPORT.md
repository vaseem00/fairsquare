# Fairsquare data report: cleaning and analysis of the DLD transactions

Written 19 Nov 2026 for the modelling stage. Source: the two Data.Dubai "Transactions" files downloaded on 17 Nov 2026 (1,820,003 rows). All prices are in AED per sq ft unless a line says otherwise. "Window" means the 36 months the snapshot keeps (2023-11-17 to 2026-11-16); "the last 12 months" means the product's comparison window (2025-11-16 to 2026-11-16).

## Stage 3 correction (read first)

The verification stage (`VERIFY_REPORT.md`, finding F2) found that keeping every block of like units let bulk deals into the snapshot: Paradise View - 2 had 77 one-bedroom units registered on two days at exactly AED 851 per sq ft, which moved that building's median from about 1,500 to 851. The statement below that like-unit blocks "sit at the building's median" is true of their median only: 13% of those rows were under 0.8x or over 1.25x the building's other sales, against 5.5% of ordinary sales.

New rule 10a leaves out a block of like units whose AED per sq ft is under 0.8x or over 1.25x the median of the building's other sales (rows in no block, same bedrooms, same completion, within 365 days; 5 or more needed). The snapshot was rebuilt in commit `a191a29`: **404,366 kept sales** (not 405,649), 4,348 buildings; `portfolio_deal` 17,638 (not 11,828); 8,638 like-unit block rows stay (not 9,933); reconciliation 397,009 - 1,414 + 8,771 = 404,366. The known example is unchanged (Aykon City (2) -Tower C, ready 2-bed: 43 sales, median 1,761). The analysis figures in the sections below were computed on the earlier build and were not recomputed; the file `clean\sales_clean.csv.gz` is the rebuilt one.

## 1. In plain language

**The data is in better shape than the earlier notes suggested.** Every transaction id is distinct, every date is a readable YYYY-MM-DD date, and every flat sale has a building name. The 28% of rows with no building name are villas, land and whole buildings, never flats, so no flat sale is lost for that reason and nothing needs to stand in for the building name.

**Four cleaning rules changed, and each change is backed by a check against the data.**
1. The old "portfolio" rule threw away 15,507 sales in the window because 3 or more units of one building sold at one price on one day. Two thirds of them (9,964) are identical units sold at a list price. Their price per sq ft sits exactly at the median of the building's other sales. They now stay. Only blocks of unlike units (one price for different sizes or bedrooms) are still left out.
2. A new rule leaves out a sale whose size is under half or over twice the usual size for that building and bedroom count. These rows have a wrong room label or a wrong area, and their price per sq ft is off.
3. The smallest size kept is now 150 sq ft (was 200), the same floor a listing has.
4. The highest price kept is now AED 20,000 per sq ft (was 11,148). The old ceiling cut real sales off the top of the most expensive buildings.

Kept sales went from **397,009 to 405,649** and buildings from **4,346 to 4,348**. Section 4 explains every row of the difference.

**Where a building is, and which project it belongs to, explains most of its price.** Of the variation in price per sq ft, the DLD area explains about 56%, the master project a further 6%, and the project a further 15%. Once the project is known, the building adds almost nothing (0.3%), because most projects are one building and towers of one project sell at nearly the same level. About 8% is left unexplained: unit-level differences such as floor, view and condition, which the source does not record.

**The same-building comparison cannot run for most building and bedroom combinations.** In the last 12 months, 4,752 combinations of building, bedrooms and basis have 5 or more sales. Another **5,465 have 1 to 4 sales**, and **3,358 have none in 12 months although they sold earlier in the window**. That is 8,823 too-few combinations against 4,752 that work. 1,823 of the 4,348 buildings have no working combination at all.

**Similar buildings are a usable stand-in only when they are close relatives.** When the median of other buildings in the same project is used in place of a building's own median, half of the buildings land within 3.2% and 80% within 8.3%. That is as good as the noise inside one building. But only 18% of the too-few combinations have such a sibling. The master project and the area cover 89% and 96%, but unadjusted they are weak: half within 10.5% to 11.3%, 80% within 23.7% to 25.6%. A plain "area median" is not good enough to show as a comparison. The model has to do better than this baseline or show a wide range.

**Weak or unmeasured results, stated plainly.**
- The time index built from the transactions moves in the same direction as the official DLD flat index but grows about half as fast (Jan 2019 to May 2024: +23% against +48%). They measure different things (section 6.6). The official index ends in May 2024, so it cannot be used for the window anyway.
- How late sales are registered cannot be measured from one download (section 3.8).
- The earlier note of about 2,851 impossible dates does not match these files: 4 rows have a Hijri-looking year and 142 more are dated before 1990.
- The source has no floor, level, view or unit number, so "similar building level" cannot be matched.

## 2. What was read

| | Rows |
|---|---|
| transactions_2026-11-17_17-54-54_0001.csv | 910,002 |
| transactions_2026-11-17_17-54-54_0002.csv | 910,001 |
| Total | 1,820,003 |
| Rows with the wrong number of fields | 0 |
| Distinct transaction ids | 1,820,003 |
| Ids repeated inside a file / present in both files | 0 / 0 |

Both files have the same 47 columns (the 46 documented ones and `load_timestamp`, one value for every row). They are two halves of one download, not overlapping downloads.

Transaction groups: Sales 1,390,944, Mortgages 360,357, Gifts 68,702. Property types: Unit 1,308,026, Villa 313,235, Land 161,858, Building 36,884. Registration types: Existing Properties 1,152,519, Off-Plan Properties 667,484.

### 2.1 Every column

Missing means empty after trimming. Distinct counts the cleaned values.

| Column | Missing | Distinct | Problems and ranges |
|---|---|---|---|
| `actual_worth` | 0 (0.00%) | 409,531 | min 1.00, median 1,380,000, 99.9% 229,100,000, max 13,786,936,424.00; unreadable 0, zero 0, negative 0 |
| `area_id` | 0 (0.00%) | 259 |  |
| `area_name_ar` | 0 (0.00%) | 258 |  |
| `area_name_en` | 0 (0.00%) | 258 | 2 with double spaces |
| `building_name_ar` | 512,478 (28.16%) | 5,079 | 58,938 values with Latin letters only; 26,696 with double spaces; 998 with edge spaces |
| `building_name_en` | 511,977 (28.13%) | 5,076 | 8,166 with double spaces |
| `has_parking` | 0 (0.00%) | 2 |  |
| `instance_date` | 0 (0.00%) | 6,772 |  |
| `master_project_ar` | 230,883 (12.69%) | 161 | 22,914 with double spaces |
| `master_project_en` | 230,840 (12.68%) | 162 | 22,641 with double spaces |
| `meter_rent_price` | 1,782,622 (97.95%) | 30,575 | min 0.01, median 7,244, 99.9% 5,495,000, max 11,094,155.56; unreadable 0, zero 0, negative 0 |
| `meter_sale_price` | 0 (0.00%) | 987,544 | min 0.00, median 12,020, 99.9% 151,400, max 81,250,000.00; unreadable 0, zero 8, negative 0 |
| `nearest_landmark_ar` | 381,824 (20.98%) | 14 |  |
| `nearest_landmark_en` | 381,824 (20.98%) | 14 |  |
| `nearest_mall_ar` | 593,740 (32.62%) | 5 |  |
| `nearest_mall_en` | 593,740 (32.62%) | 5 |  |
| `nearest_metro_ar` | 582,540 (32.01%) | 56 |  |
| `nearest_metro_en` | 582,540 (32.01%) | 56 |  |
| `no_of_parties_role_1` | 973 (0.05%) | 219 | min 0.00, median 1, 99.9% 16, max 703.00; unreadable 0, zero 3,934, negative 0 |
| `no_of_parties_role_2` | 973 (0.05%) | 31 | min 0.00, median 1, 99.9% 6, max 78.00; unreadable 0, zero 13,408, negative 0 |
| `no_of_parties_role_3` | 973 (0.05%) | 15 | min 0.00, median 2, 99.9% 6, max 17.00; unreadable 0, zero 1,739,166, negative 0 |
| `procedure_area` | 0 (0.00%) | 95,585 | min 0.01, median 110, 99.9% 43,650, max 342,103,430.80; unreadable 0, zero 0, negative 0 |
| `procedure_id` | 0 (0.00%) | 52 |  |
| `procedure_name_ar` | 0 (0.00%) | 52 |  |
| `procedure_name_en` | 0 (0.00%) | 52 |  |
| `project_name_ar` | 473,571 (26.02%) | 3,466 | 6,487 values with Latin letters only; 14,935 with double spaces; 166 with edge spaces |
| `project_name_en` | 473,571 (26.02%) | 3,468 | 45 values with Arabic script (e.g. "ِِAzizi Riviera 60"); 11,610 with double spaces |
| `project_number` | 473,571 (26.02%) | 3,474 | min 2.00, median 1,905, 99.9% 4,571, max 4,593.00; unreadable 0, zero 0, negative 0 |
| `property_sub_type_ar` | 353,789 (19.44%) | 19 |  |
| `property_sub_type_en` | 353,789 (19.44%) | 19 |  |
| `property_sub_type_id` | 353,789 (19.44%) | 19 |  |
| `property_type_ar` | 0 (0.00%) | 4 |  |
| `property_type_en` | 0 (0.00%) | 4 |  |
| `property_type_id` | 0 (0.00%) | 4 |  |
| `property_usage_ar` | 0 (0.00%) | 10 | 6,355 values with Latin letters only |
| `property_usage_en` | 0 (0.00%) | 10 | 6,355 values with Arabic script (e.g. "أخرى") |
| `reg_type_ar` | 0 (0.00%) | 2 |  |
| `reg_type_en` | 0 (0.00%) | 2 |  |
| `reg_type_id` | 0 (0.00%) | 2 |  |
| `rent_value` | 1,782,622 (97.95%) | 15,586 | min 2.00, median 1,000,000, 99.9% 23,990,000, max 262,080,000.00; unreadable 0, zero 0, negative 0 |
| `rooms_ar` | 381,476 (20.96%) | 17 | 21 values with Latin letters only |
| `rooms_en` | 381,476 (20.96%) | 17 |  |
| `transaction_id` | 0 (0.00%) | 1,820,003 |  |
| `trans_group_ar` | 0 (0.00%) | 3 |  |
| `trans_group_en` | 0 (0.00%) | 3 |  |
| `trans_group_id` | 0 (0.00%) | 3 |  |
| `load_timestamp` | 0 (0.00%) | 1 |  |

### 2.2 Rows per year (2015 on)

| Year | Rows |
|---|---|
| 2015 | 58,669 |
| 2016 | 59,146 |
| 2017 | 64,546 |
| 2018 | 50,280 |
| 2019 | 53,112 |
| 2020 | 49,286 |
| 2021 | 82,822 |
| 2022 | 120,008 |
| 2023 | 165,240 |
| 2024 | 224,344 |
| 2025 | 266,911 |
| 2026 | 186,027 |

Dates: every one of the 1,820,003 values has the form YYYY-MM-DD. 4 rows have years 1416 to 1422 (Hijri years typed into a Gregorian field) and 142 rows are dated 1966 to 1989; 5,756 are dated before 2000 in all. None is dated after the download. None of this touches the 36-month window. 2026 is a part year (to 16 Nov).

## 3. Problems looked for, and what was found

### 3.1 Encoding
- `property_usage_en` holds the Arabic word for "Other" on 6,355 rows (land 4,036, villas 2,052, buildings 267; no flats).
- `project_name_en` starts with stray Arabic vowel marks on 45 rows (for example "Azizi Riviera 60" with two marks in front). Without cleaning, that project would be two different names. **Fixed**: Arabic-script characters are removed from the English name columns.
- The Arabic columns hold Latin-only values on 58,938 building names and 6,487 project names. Not used by the product.
- Double spaces: 8,166 building names, 11,610 project names, 22,641 master project names. Already handled (whitespace is collapsed).

### 3.2 Sizes and prices
- `actual_worth` runs from AED 1 to AED 13,786,936,424; `procedure_area` from 0.01 to 342,103,430.8 sq m. The extremes are land and bulk deals, not flats.
- `meter_sale_price` (AED per sq m) equals `actual_worth / procedure_area` within 1% on 959,303 of 959,306 flat sales rows. Recomputing it, as the build does, is right and loses nothing.
- Sizes are square metres; the build multiplies by 10.7639. Typical flat sizes after conversion look right for each bedroom count:

| Bedrooms | Sales in the window (old rules) | Smallest | 1% | Median sq ft | 99% | Largest |
|---|---|---|---|---|---|---|
| Studio | 103,583 | 201 | 303 | 411 | 658 | 3,891 |
| 1 bed | 179,657 | 200 | 475 | 772 | 1,296 | 9,251 |
| 2 bed | 101,229 | 214 | 744 | 1,242 | 2,482 | 7,406 |
| 3 bed | 24,802 | 204 | 1,085 | 1,857 | 5,239 | 14,335 |
| 4 bed | 2,885 | 436 | 1,779 | 3,448 | 10,254 | 13,962 |
| 5 bed | 314 | 807 | 2,460 | 7,643 | 13,968 | 14,349 |
| 6 bed | 46 | 3,155 | 3,161 | 8,243 | 14,620 | 14,861 |

- Sizes far from the building's usual size for those bedrooms: 1,311 window rows are under half or over twice it (for example a "2 bed" of 2,648 sq ft where 2 beds are 1,146 sq ft, at AED 604 per sq ft against 1,146). Their price per sq ft has a median ratio of 0.82 to the building's and 54% are outside 0.8 to 1.25 (all sales: 6%). **New rule 10b leaves them out.**
- Price per sq ft outside the old bounds, window: 1,047 under 279 (median 3% of their building's level: part payments and slips) and 102 over 11,148. Of the 59 high rows with a building to compare with, 43 are within twice its median: Aman Residences (up to 17,327), Bulgari Lighthouse, BV Residences, The Alba. **The ceiling is now 20,000.**
- Inside the bounds, 820 window sales are under half and 235 over twice the median of their building, bedrooms and basis (0.27% of 390,143). The product already leaves these out when a comparison runs. They stay in the snapshot.

### 3.3 Multi-unit and portfolio deals
- By transaction id: none. Every id is distinct, so rule 9 (a repeated id is a multi-unit deal) excludes nothing in these files. It stays as a guard for other files.
- By one price on one day in one building (window, old rules): 3,152 groups of 3 or more (15,507 rows) and 10,113 pairs (20,226 rows). Rows by group size: 3: 4,821, 4: 2,604, 20+: 1,774, 5-9: 4,257, 10-19: 2,051.
- Test: if a block row carried the price of the whole block, its price per sq ft would be far from the building's other sales. It is not:

| Group | Rows | Median ratio to the building's other sales | 10% to 90% | Outside 0.5x to 2x | Outside 0.8 to 1.25 |
|---|---|---|---|---|---|
| 3 or more, like units (same bedrooms, sizes within 5%) | 9,964 | 1.00 | 0.87 to 1.07 | 0.9% | 9.1% |
| 3 or more, unlike units | 5,543 | 0.97 | 0.80 to 1.06 | 0.4% | 11.3% |
| Pairs, like units | 18,498 | 1.00 | 0.90 to 1.09 | 0.5% | 5.9% |
| Pairs, unlike units | 1,728 | 0.99 | 0.81 to 1.13 | 0.5% | 12.4% |
| Any single sale against its own cell (control) | 57,398 sampled | 1.00 | 0.89 to 1.12 | 0.3% | 6.1% |

  Like-unit blocks are ordinary sales (developers register identical units at a list price on one day: 7,805 of the 9,964 rows are off-plan). Unlike-unit blocks carry one price for different sizes (the largest: 188 studios of 401 to 591 sq ft in one building at AED 550,000 each on one day), so their price per sq ft says little about a unit; they run 3% low and twice as often far from the building's level. **Rule 10 now leaves out only the unlike-unit blocks.**
- Many buyers or sellers: 647 window sales have 5 or more parties on one side. Their price per sq ft is at the building's level (ratio 1.00). No rule.
- Same DLD area, date and price across different buildings: 1,700 groups of 3 or more (8,812 rows). Mostly round prices that coincide. Not acted on.

### 3.4 Rooms, sub-type and usage that disagree
- Every `Flat` row has usage `Residential` (1,167,272 rows in all groups). The usage test in rule 3 excludes nothing today.
- Flat rows with a room label that is not a bedroom count, all years: PENTHOUSE 1,064, Single Room 682, empty 226, Shop 8, Office 4, 8 to 9 B/R 7. Penthouses are large (median 3,108 sq ft in the window) and have no bedroom count; Single Room rows are 122 sq ft hotel-style units.
- Unit rows that are not flats and stay out: Hotel Apartment 25,387 sales (6,506 in the window), Office, Shop, Hotel Rooms, Stacked Townhouses (362).

### 3.5 Building names
- All 959,306 flat sales rows have a building name. By property type, a missing building name means a villa, land or a whole building.
- Spelling variants: none. Across all years the flats use 4,692 building keys (normalised name plus DLD area), and no key has two raw spellings. DLD writes building names from a reference list.
- The same name in more than one DLD area: 25 normalised names (for example "Diamond" in Al Hebiah Fourth and Palm Jumeirah, "Indigo Tower" in Al Thanyah Fifth and Wadi Al Safa 5, and block codes such as "C1" or "Building A"). The key includes the area, so they stay apart.
- Look-alike names inside one area: 1,166 pairs differ by one or two letters or a generic word. 966 share a project number and are sibling towers (Tower A / Tower B). The 26 pairs not explained by a tower letter or number were read one by one: all are different buildings (Bloom Towers A / Bloom Heights A, Azizi Amber / Azizi Ameer, Saria by Beyond / Aria by Beyond), except possibly "Burj Khalifa" (355 sales) and "Burj Khalifa Residences" (8 sales). **No merging is needed.** These pairs are a risk for matching a listing to a building, not for the data.

### 3.6 Projects and master projects
- Window sales use 2,262 project numbers. Buildings per project: 1: 1,784, 2: 240, 3: 122, 4: 51, 5-9: 49, 10+: 16. The largest have 20 to 55 low-rise blocks (Al Thamam, Urbana, Polo Residences, Al Waha).
- A project number always has one name. Two names have two numbers each (INDIGO TOWER, BOTANICA): different projects with one name. Use the number, not the name, as the project key.
- 26,664 kept sales (6.6%) have no project number, in 874 of 4,348 buildings; 40,835 (10.1%) have no master project, in 294 buildings. 13 buildings carry more than one project number. No building has two master projects or two nearest metros.
- Nearest metro, mall and landmark are coarse reference values (37 metro names, 5 malls, 14 landmarks) and are empty on 41%, 42% and 30% of kept sales. `has_parking` is 1 on 98.1% of kept sales.

### 3.7 Ready and off-plan
- `reg_type_en` and the procedure agree on every sales row: Sell and Delayed Sell are always "Existing Properties", Sell - Pre registration is always "Off-Plan Properties". The fallback in rule 11 is never needed in these files.
- Delayed Sell (14,379 window sales) could have carried old contract prices. It does not: against the Sell median of the same building, bedrooms and half-year, its ratio is 1.00 (10% to 90%: 0.83 to 1.20; 7,244 rows compared; control 0.88 to 1.12). It stays, as ready.
- Off-plan is 72.8% of kept sales. Of the buildings, 1,667 have only off-plan sales in the window, so a listing marked ready (or unmarked) in one of them has no ready sales to compare with.

### 3.8 Late registration
Not measurable from these files. Each row has one date, and the transaction id (`1-<procedure>-<year>-<number>`) does not run in date order: within a procedure and year, the median gap between a row's date and the latest date among the lower-numbered rows is about half a year (181 days for Sell, 325 for Sell - Pre registration), and 940 window rows carry another year in the id than in the date. What can be seen:
- Kept sales per week: 1,814 in the last 9 weeks, 2,204 in the 17 weeks before, 2,754 in the 26 weeks before that. The fall is steady over the whole year, not a cliff at the end.
- It is all off-plan: ready sales went up (495 to 596 a week) while off-plan fell (1,709 to 1,218).
- The last day in the data (Monday 16 Nov 2026) has 667 sales under the old rules, a normal Monday.

So the last weeks do not look cut short, but a slower market and late off-plan registration cannot be told apart here. To measure the delay, compare two downloads taken some weeks apart. (Chart: `charts/12_weekly_registrations.png`.)

## 4. Every cleaning rule: verdict and counts

Counts are rows excluded by the new build over all 1,820,003 rows (a row is counted once, under the first rule it fails), with the old build beside them.

| Rule | Reason code | Old build | New build | Verdict | Why |
|---|---|---|---|---|---|
| 1. Sales group only | `not_sales` | 429,059 | 429,059 | keep | Mortgages and Gifts are not sales. |
| 2. Sell, Sale, Sell - Pre registration, Delayed Sell | `procedure_excluded` | 72,906 | 72,906 | keep | See the table of dropped procedures below. |
| 3. Flat, and Residential when usage is given | `not_flat`, `not_residential` | 406,301, 0 | 406,301, 0 | keep | Every flat is Residential. Hotel Apartment stays out (open question 2). |
| 4. Studio to 7 bedrooms | `rooms_excluded` | 1,936 | 1,936 | keep | Penthouse, Single Room and empty labels have no bedroom count. |
| 5. Building name | `no_building_name` | 0 | 0 | keep | No flat lacks one. Project, project number and master project are not needed as a stand-in key. |
| 6. Size and price above zero | `no_size_or_price` | 0 | 0 | keep | No such flat rows in these files. |
| 7. Size 150 to 15,000 sq ft (was 200 to 15,000) | `size_out_of_range` | 845 | 579 | loosen | 150 to 200 sq ft rows are real small units at their building's price level. |
| 8. AED 279 to 20,000 per sq ft (was 279 to 11,148) | `psf_out_of_range` | 2,500 | 2,367 | loosen | The old ceiling cut real sales in the most expensive buildings. |
| Date readable, not after the download | `bad_date`, `date_out_of_range` | 0, 0 | 0, 0 | keep | No such rows; the guard stays. |
| 9. Repeated transaction id | `multi_unit_deal` | 0 | 0 | keep as a guard | All ids are distinct. |
| 10. 3 or more at one price, one building, one day: only when the units are unlike | `portfolio_deal` | 49,062 | 11,828 | loosen | Like-unit blocks are ordinary sales (section 3.3). |
| 10b. Size under 0.5x or over 2x the building's median for those bedrooms (5 or more sales) | `size_unlike_building` | (no rule) | 4,593 | add | Wrong room label or area (section 3.2). |
| 11. Completion from reg_type_en |  |  |  | keep | Agrees with the procedure on every row. |
| 12. 36 months to the latest kept date | `outside_window` | 460,385 | 484,785 | keep |  |
| Text: collapse spaces |  |  |  | keep |  |
| Text: remove Arabic script from English name columns |  | (no rule) | 45 project names | add | One project, one name. |
| **Kept** |  | **397,009** | **405,649** |  |  |

Why the kept count changed (old snapshot against new, by transaction):

| Change | Rows |
|---|---|
| Came in: blocks of like units at one price (rule 10 loosened) | +9,933 |
| Came in: AED 11,148 to 20,000 per sq ft (rule 8 ceiling) | +98 |
| Came in: 150 to 200 sq ft (rule 7 floor) | +35 |
| Went out: size unlike the building's (rule 10b) | -1,426 |
| Net | +8,640 (397,009 to 405,649) |

Notes on the reconciliation:
- 129 window rows are 150 to 200 sq ft, but only 35 came in. The other 94 are under half the usual size for their building and bedrooms (84 of the 129 are studios in buildings whose studios are about twice as large; 45 are labelled 1 to 3 bedrooms), so rule 10b leaves them out, although their price per sq ft is normal. The lower floor therefore changes little.
- Rule 10b looks at all years (units do not change size), so it excludes 4,593 rows in all, of which 1,426 were kept sales of the old snapshot.
- Buildings: 4,346 to 4,348. Two more buildings now have kept sales.
- The numbers in the build report differ from the window counts because a row outside the window is counted under `outside_window` only when it passed every earlier rule.

Sales dropped by rules 2 and 4 in the window, and how their price per sq ft compares with the kept sales of the same building, bedrooms and basis:

| Dropped | Rows | Compared | 10% | Median ratio | 90% |
|---|---|---|---|---|---|
| procedure: Sell Development | 2,948 | 539 | 0.75 | 0.98 | 1.21 |
| procedure: Development Registration Pre-Registration | 1,919 | 112 | 0.97 | 1.01 | 1.24 |
| procedure: Lease to Own Registration | 1,651 | 1,497 | 0.86 | 1.00 | 1.17 |
| procedure: Sale On Payment Plan | 1,295 | 1,044 | 0.85 | 1.06 | 1.85 |
| procedure: Development Registration | 896 | 424 | 0.74 | 0.91 | 1.05 |
| rooms: (empty) | 197 | 0 |  |  |  |
| procedure: Delayed Development | 157 | 0 |  |  |  |
| rooms: PENTHOUSE | 126 | 0 |  |  |  |
| procedure: Delayed Sell Lease to Own Registration | 93 | 75 | 0.82 | 0.96 | 1.11 |
| procedure: Delayed Sell Development | 58 | 2 | 0.86 | 0.87 | 0.89 |
| procedure: Sell Development - Pre Registration | 42 | 5 | 1.00 | 1.04 | 1.20 |
| rooms: Single Room | 21 | 0 |  |  |  |
| procedure: Lease to Own on Development Registration | 16 | 3 | 0.81 | 0.97 | 1.02 |
| procedure: Lease to Own Registration Pre-Registration | 6 | 4 | 1.08 | 1.16 | 1.25 |
| rooms: 9 B/R | 2 | 0 |  |  |  |
| rooms: Shop | 1 | 0 |  |  |  |
| procedure: Lease Development Registration | 1 | 0 |  |  |  |
| rooms: Office | 1 | 0 |  |  |  |

Lease to Own Registration sits at the building's level but mixes purchases financed by Ijara with refinancing, where the price is an agreed figure, not a sale price. Sale On Payment Plan runs high and wide. Development procedures are developer-level transfers. All stay out.

## 5. The cleaned dataset

### 5.1 Files
| File | What | Rows |
|---|---|---|
| `app\data\open-data\sales.csv.gz` | The committed snapshot the server loads (8.6 MB) | 405,649 |
| `app\data\open-data\buildings.csv.gz` | One row of facts per building (110 KB), committed | 4,348 |
| `app\data\open-data\manifest.json` | Source, licence, date range, counts, both SHA-256 values | |
| `(local scratch folder)` | **Analysis file for the modelling stage**: the same 405,649 sales with every useful column (23 MB). Not for the repository. | 405,649 |
| `(local scratch folder)` | A copy of the committed buildings file | 4,348 |
| `(local scratch folder)` | Monthly index by DLD area group and basis (section 6.6) | |

### 5.2 Data dictionary: `clean/sales_clean.csv.gz`
UTF-8 CSV, gzip, one header line, one row per kept sale. Fields are quoted only when they hold a comma or a quote.

| Column | Type | Meaning | Empty on |
|---|---|---|---|
| `ref` | text | `dld:<transaction_id>`; unique; the key of `sales.external_ref` in the database | 0 |
| `date` | YYYY-MM-DD | Registration date (`instance_date`), 2023-11-17 to 2026-11-16 | 0 |
| `building` | text | DLD building name, spaces collapsed | 0 |
| `dld_key` | text | `normalise(building)|normalise(area_dld)`: the building's identity (`buildings.dld_key`) | 0 |
| `area_dld` | text | Official DLD area name (70 values) | 0 |
| `master_project` | text | DLD master project (community) name | 40,835 |
| `project` | text | DLD project name | 26,664 |
| `project_number` | whole number | DLD project number: use this as the project key | 26,664 |
| `bedrooms` | 0 to 7 | 0 = studio | 0 |
| `size_sqft` | number, 2 decimals | `procedure_area` (sq m) x 10.7639; 150 to 15,000 | 0 |
| `price_aed` | whole number | `actual_worth`, rounded | 0 |
| `psf` | number, 2 decimals | `price_aed / size_sqft`; 279 to 20,000 | 0 |
| `completion` | `ready` or `off_plan` | From `reg_type_en`. Never pool the two. | 0 |
| `procedure` | `sell`, `pre_registration`, `delayed_sell` | The DLD procedure. `pre_registration` is exactly the off-plan rows. | 0 |
| `parking` | 1 or 0 | DLD `has_parking` | 0 |
| `nearest_metro` | text | DLD reference value | 165,381 |
| `nearest_mall` | text | DLD reference value (5 values) | 170,358 |
| `nearest_landmark` | text | DLD reference value (14 values) | 123,290 |
| `parties_role_1`, `parties_role_2`, `parties_role_3` | whole numbers | `no_of_parties_role_1..3` as given. DLD does not say which role is the buyer. | 0 |
| `building_first_sale` | YYYY-MM-DD | Earliest flat sale of the building in the source files, all years | 0 |
| `building_first_ready_sale` | YYYY-MM-DD | Earliest ready sale of the building, all years: about when it was handed over | sales of the 1,667 buildings with no ready sale |
| `building_sales` | whole number | Kept sales of the building in the window | 0 |

### 5.3 Data dictionary: `buildings.csv.gz` (committed, loaded into `buildings`)
| Column | Database column | Meaning |
|---|---|---|
| `building`, `area_dld` | `name` (display form), `area_dld`, `dld_key` | The most common spelling and area of the building's kept sales |
| `project_number` | `project_number` | Most common project number; empty for 874 buildings |
| `project`, `master_project` | `project`, `master_project` | Most common names; master project empty for 294 buildings |
| `nearest_metro`, `nearest_mall`, `nearest_landmark` | same names | Given for 2,740, 2,686 and 3,159 buildings |
| `first_sale` | `first_sale_date` | Earliest flat sale in the files, all years. 2,597 buildings first sold before the window. |
| `first_ready_sale` | `first_ready_sale_date` | Earliest ready sale, all years; given for 2,681 buildings |
| `last_sale` | `last_sale_date` | Latest kept sale |
| `sales`, `off_plan_sales`, `parking_sales` | `off_plan_share` = off_plan_sales / sales | Kept sales in the window |

`sales.csv.gz` has the columns `ref,date,building,area_dld,project,master_project,bedrooms,size_sqft,price_aed,completion,project_number,parking`. In the database, `sales.has_parking` is new (migration 0006); every new column is nullable, and rows loaded earlier stay valid and are filled on the next load.

## 6. Analysis of the cleaned flat sales

405,649 sales, 4,348 buildings, 70 DLD areas, 2023-11-17 to 2026-11-16.

### 6.1 Distributions (AED per sq ft)
All kept sales: 5% 849, 25% 1,336, **median 1,711**, 75% 2,290, 95% 3,330. (Chart: `charts/01_psf_distribution_by_basis.png`.)

By basis: ready 110,204 sales (27.2%), median 1,366; off-plan 295,445 sales (72.8%), median 1,811. The gap is mostly which buildings sell off-plan (newer, dearer projects): inside one building, off-plan sales are only 2.7% lower than ready sales after bedrooms, size and month are held equal.

By procedure: delayed_sell 14,292 (median 1,673), pre_registration 295,445 (median 1,811), sell 95,912 (median 1,322).

By bedrooms (chart: `charts/02_psf_by_bedrooms.png`):

| Bedrooms | Sales | 25% | Median | 75% | Median size sq ft | Median price AED |
|---|---|---|---|---|---|---|
| Studio | 100,279 | 1,416 | 1,698 | 1,993 | 411 | 684,000 |
| 1 bed | 177,104 | 1,303 | 1,633 | 2,255 | 772 | 1,239,999 |
| 2 bed | 100,450 | 1,304 | 1,849 | 2,441 | 1,242 | 2,259,360 |
| 3 bed | 24,612 | 1,399 | 2,105 | 2,778 | 1,857 | 3,916,186 |
| 4 bed | 2,837 | 1,825 | 2,760 | 4,063 | 3,446 | 9,579,000 |
| 5 bed | 321 | 1,709 | 3,891 | 5,425 | 7,789 | 30,000,000 |
| 6 bed | 46 | 2,508 | 3,509 | 5,174 | 8,243 | 28,142,369 |

By size:

| Size sq ft | Sales | 25% | Median | 75% |
|---|---|---|---|---|
| 150 to 400 | 41,970 | 1,590 | 1,777 | 2,019 |
| 400 to 600 | 70,948 | 1,344 | 1,656 | 2,031 |
| 600 to 800 | 95,393 | 1,344 | 1,648 | 2,260 |
| 800 to 1000 | 69,297 | 1,250 | 1,560 | 2,265 |
| 1000 to 1300 | 59,078 | 1,290 | 1,812 | 2,395 |
| 1300 to 1700 | 41,229 | 1,271 | 1,857 | 2,456 |
| 1700 to 2500 | 20,549 | 1,374 | 2,080 | 2,859 |
| 2500 to 15000 | 7,185 | 1,588 | 2,654 | 4,461 |

By DLD area, the 25 with the most sales (chart: `charts/03_psf_by_area.png`). Area medians run from 600 to 10,811 across the 66 areas with 50 or more sales (10% to 90%: 1,132 to 3,054).

| DLD area | Sales | Buildings | Off-plan | 25% | Median | 75% |
|---|---|---|---|---|---|---|
| Al Barsha South Fourth | 42,165 | 369 | 69% | 1,183 | 1,395 | 1,614 |
| Business Bay | 26,568 | 168 | 66% | 1,934 | 2,419 | 2,818 |
| Madinat Al Mataar | 24,929 | 351 | 90% | 1,396 | 1,645 | 1,900 |
| Wadi Al Safa 5 | 19,348 | 124 | 86% | 1,121 | 1,337 | 1,551 |
| Marsa Dubai | 17,364 | 242 | 42% | 1,636 | 2,424 | 3,579 |
| Jabal Ali First | 16,864 | 226 | 71% | 1,099 | 1,325 | 1,621 |
| Hadaeq Sheikh Mohammed Bin Rashid | 13,513 | 111 | 75% | 2,112 | 2,310 | 2,543 |
| Madinat Dubai Almelaheyah | 13,005 | 73 | 99% | 2,282 | 2,730 | 3,134 |
| Al Merkadh | 12,620 | 128 | 49% | 1,737 | 1,958 | 2,182 |
| Wadi Al Safa 3 | 12,278 | 104 | 84% | 1,204 | 1,449 | 1,761 |
| Al Barshaa South Third | 11,537 | 102 | 69% | 1,210 | 1,391 | 1,590 |
| Al Khairan First | 11,101 | 114 | 68% | 2,247 | 2,441 | 2,664 |
| Al Thanyah Fifth | 10,575 | 75 | 63% | 1,394 | 1,990 | 2,463 |
| Bukadra | 10,259 | 27 | 100% | 2,295 | 2,425 | 2,540 |
| Al Hebiah First | 10,107 | 79 | 80% | 1,410 | 1,880 | 1,980 |
| Al Barsha South Fifth | 9,961 | 65 | 87% | 1,323 | 1,529 | 1,733 |
| Me'Aisem First | 9,945 | 72 | 68% | 1,104 | 1,321 | 1,529 |
| Burj Khalifa | 9,525 | 134 | 39% | 2,220 | 2,750 | 3,328 |
| Palm Deira | 8,971 | 145 | 100% | 2,136 | 2,490 | 2,894 |
| Al Barshaa South Second | 8,750 | 22 | 93% | 1,451 | 1,615 | 1,886 |
| Al Hebiah Fourth | 8,644 | 80 | 56% | 880 | 1,222 | 1,463 |
| Wadi Al Safa 4 | 7,390 | 62 | 99% | 1,584 | 1,749 | 1,896 |
| Al Jadaf | 6,615 | 59 | 76% | 1,595 | 1,875 | 2,132 |
| Al Yelayiss 2 | 6,433 | 56 | 68% | 1,158 | 1,297 | 1,507 |
| Al Hebiah Fifth | 5,510 | 98 | 78% | 1,475 | 1,667 | 1,812 |

By master project, the 15 with the most sales ("(no master)" rows are sales with no master project, grouped by their area):

| Master project | Sales | Buildings | Off-plan | 25% | Median | 75% |
|---|---|---|---|---|---|---|
| Jumeirah Village Circle | 42,165 | 369 | 69% | 1,183 | 1,395 | 1,614 |
| Business Bay | 21,525 | 154 | 63% | 1,867 | 2,337 | 2,727 |
| Dubai Land Residence Complex | 17,476 | 109 | 85% | 1,094 | 1,304 | 1,537 |
| Dubai World Central | 16,115 | 185 | 98% | 1,507 | 1,660 | 1,833 |
| Dubai Hills Estate | 12,927 | 97 | 75% | 2,125 | 2,316 | 2,541 |
| Arjan | 11,447 | 101 | 70% | 1,215 | 1,394 | 1,592 |
| Dubai Creek Harbour | 11,101 | 114 | 68% | 2,247 | 2,441 | 2,664 |
| (no master) Bukadra | 10,259 | 27 | 100% | 2,295 | 2,425 | 2,540 |
| Dubai Marina | 10,161 | 151 | 29% | 1,455 | 1,989 | 2,584 |
| Majan | 10,156 | 52 | 85% | 1,210 | 1,442 | 1,751 |
| Motor City | 10,107 | 79 | 80% | 1,410 | 1,880 | 1,980 |
| Jumeirah Village Triangle | 9,961 | 65 | 87% | 1,323 | 1,529 | 1,733 |
| International Media Production Zone | 9,628 | 64 | 70% | 1,100 | 1,322 | 1,532 |
| Dubai Maritime City | 9,393 | 33 | 99% | 2,393 | 2,789 | 3,190 |
| DownTown Dubai | 9,207 | 132 | 37% | 2,205 | 2,763 | 3,338 |

By project number, the 10 with the most sales:

| Project number | Sales | Buildings | Off-plan | Median |
|---|---|---|---|---|
| 2948 | 3,105 | 6 | 100% | 2,165 |
| 3349 | 2,966 | 3 | 100% | 2,558 |
| 3070 | 2,920 | 7 | 100% | 1,895 |
| 3073 | 2,596 | 7 | 100% | 1,641 |
| 3334 | 2,141 | 4 | 100% | 2,010 |
| 3435 | 2,105 | 4 | 100% | 2,595 |
| 2957 | 1,859 | 4 | 100% | 2,673 |
| 3480 | 1,552 | 2 | 100% | 1,725 |
| 3321 | 1,488 | 1 | 100% | 1,666 |
| 3160 | 1,472 | 3 | 100% | 2,450 |

Sales per group: an area has a median of 3,472 kept sales, a master project 1,713, a project 61, a building 48. 1,611 buildings have under 30 kept sales in 36 months.

### 6.2 What explains price per sq ft
The measure is the share of the variance of log(price per sq ft) over all 405,649 kept sales.

Each factor alone (chart: `charts/05_variance_single_factor.png`):

| Factor | Groups | Share explained | Adjusted for the number of groups |
|---|---|---|---|
| building | 4,348 | 89.3% | 89.1% |
| project | 3,138 | 88.9% | 88.8% |
| master project | 112 | 63.8% | 63.8% |
| area | 70 | 55.0% | 55.0% |
| nearest metro | 38 | 28.8% | 28.8% |
| basis (ready / off-plan) | 2 | 10.2% | 10.2% |
| parking | 2 | 5.8% | 5.8% |
| bedrooms | 7 | 2.5% | 2.5% |
| month | 37 | 1.5% | 1.5% |
| log size (linear) | 1 | 1.1% | 1.1% |

Added one after another, in this order (chart: `charts/04_variance_shares.png`). Each model is additive: location level + month + bedrooms + basis + log size.

| Step | Adds | Running total |
|---|---|---|
| time (month) | 1.5% | 1.5% |
| then basis | 9.7% | 11.2% |
| then bedrooms | 3.3% | 14.5% |
| then size | 0.0% | 14.5% |
| then area | 56.0% | 70.5% |
| then master project | 6.2% | 76.7% |
| then project | 15.2% | 91.9% |
| then building | 0.3% | 92.2% |

Not explained: **7.8%**. The leftover spread of a single sale around the full model is 11.7% (standard deviation of the log); half of all sales are within 5.7% of the model and 80% within 12.2%.

How to read it:
- **Location carries the price.** Area 56%, master project +6%, project +15%. With no location at all, time, basis, bedrooms and size explain 14.5%.
- **Project and building are nearly the same level.** 1,784 of 2,262 projects are one building, and towers of one project sell alike. For a building with too few sales, sibling towers of the same project number are the best stand-in.
- **Size matters only inside a location.** Alone it explains 1.1% and adds nothing before location (0.0% in the table), because large flats sit in dear areas. Inside one building, a unit 10% larger sells for about 3.2% less per sq ft (elasticity -0.3166); it lifts the building-level model from 91.3% to 92.2%. Against the median size of the same building and bedrooms (chart: `charts/13_size_effect_within_building.png`): a unit 25% larger sells at 0.926 of the cell median, one 25% smaller at 1.054.
- **Time is small inside 36 months.** Month alone explains 1.5%; dropping it from the building-level model costs 0.5%.
- **Bedrooms**, with size held equal inside a building: 1 bed +4%, 2 beds +17%, 3 beds +35% against a studio of the same size. The size effect pulls the other way (a typical 2 bed is 3 times the size of a studio), so read the two together, not one alone.
- **Parking, nearest mall and landmark carry no usable signal.** Inside a building, parking is worth +1.1% and adds nothing to the fit. Nearest metro adds 1.9% on top of the area and is empty on 41% of sales.
- Delayed Sell inside a building: -0.6% against other ready sales. No adjustment needed.

One model with a separate level for every building, bedroom count and basis, plus month and size, explains 93.7%: that is the ceiling this data allows.

### 6.3 Spread inside one building
For the 4,752 combinations of building, bedrooms and basis with 5 or more sales in the last 12 months (chart: `charts/07_within_building_spread.png`):
- Width of the middle half of sales, as a share of the median: typical 8.5% (a quarter of combinations under 5.1%, a quarter over 13.7%, a tenth over 20.3%). Ready 10.5%, off-plan 7.2%.
- One sale against the median of the other sales of its combination: half are within 4.8%, 80% within 12%, 90% within 18%. Only 52% of single sales are inside the product's 5% "in line" band.

This is the yardstick for the second tier: a stand-in that is off by 5% to 12% is no worse than one more sale from the building itself.

### 6.4 How building medians relate to project, master project and area medians
For every combination with 5 or more sales in the last 12 months (4,752), its own median was set against the median of the sales in **other** buildings of the same project number, master project, DLD area or nearest metro, same bedrooms, same basis, same 12 months, when those others had 5 or more sales. No weighting and no adjustment: this is the baseline the model must beat. (Charts: `charts/08_building_vs_similar.png`, `charts/09_stand_in_error_by_level.png`.)

| Stand-in | Has a stand-in | Half within | 80% within | 90% within | Within 5% | Within 10% | Within 20% | Median ratio | Too-few combinations that have one |
|---|---|---|---|---|---|---|---|---|---|
| Same project | 29% | 3.2% | 8.3% | 12.2% | 66% | 85% | 97% | 1.000 | 18% |
| Same master project | 91% | 10.5% | 23.7% | 34.8% | 27% | 48% | 74% | 1.015 | 89% |
| Same area | 99% | 11.3% | 25.6% | 38.5% | 25% | 46% | 71% | 1.017 | 96% |
| Same nearest metro | 61% | 14.6% | 31.6% | 45.1% | 20% | 37% | 62% | 1.014 | 65% |
| First available: project, else master project, else area | 99% | 8.5% | 21.2% | 31.7% | 35% | 56% | 78% |  |  |

- No level is biased much (median ratio 1.00 to 1.02): the other buildings are a little dearer on average.
- Ready is harder than off-plan at every level (area: half within 12.9% for ready, 10.2% for off-plan).
- Building medians follow their area closely in rank (correlation of logs 0.845; master project 0.87; project 0.973), but a tenth of buildings are more than 38.5% away from their area.

### 6.5 The size of the too-few problem
A "combination" is a building, a bedroom count and a basis (ready or off-plan) that has at least one kept sale in the 36 months, so it is known to exist: 13,575 in all. Counts are for the last 12 months (126,528 sales in 4,006 buildings). (Chart: `charts/06_too_few_cells.png`.)

| Sales in the last 12 months | All | Ready | Off-plan |
|---|---|---|---|
| 5 or more: the comparison runs | 4,752 | 2,006 | 2,746 |
| 1 to 4: too few | 5,465 | 3,625 | 1,840 |
| 0, but sold earlier in the window: too few | 3,358 | 1,537 | 1,821 |

- The 1 to 4 group by count: 1 sale 2,170, 2 sales 1,462, 3 sales 1,038, 4 sales 795.
- Of the 3,358 with no sale in 12 months, 1,843 are in buildings where other bedroom types of the same basis did sell in the 12 months; 1,515 are in buildings with no sale of that basis at all.
- Of the 5,465 with 1 to 4 sales, 4,911 are in buildings where other bedroom types of the same basis also sold. **The building's own other sales are evidence the model should use.**
- By bedrooms:

| Bedrooms | 5 or more | 1 to 4 | 0 |
|---|---|---|---|
| Studio | 962 | 788 | 444 |
| 1 bed | 1,899 | 1,573 | 773 |
| 2 bed | 1,418 | 1,619 | 951 |
| 3 bed | 433 | 1,112 | 804 |
| 4 bed | 38 | 303 | 300 |
| 5 bed | 1 | 62 | 74 |

- Buildings: 2,525 of 4,348 have at least one working combination; 1,481 have sales in the 12 months but none with 5; 342 have no sale in 12 months. For ready listings: 1,284 buildings have a working ready combination, 1,397 have ready sales but none with 5, and 1,667 have off-plan sales only.
- Demand: there is no listing data to weight by, so sales stand in for listings. 9.0% of the last 12 months' sales are in too-few combinations (11,388 of 126,528). Over the 36 months, 29.8% of sales are in combinations that are too few today (20.1% in the 1 to 4 group, 9.7% in the 0 group). Resale listings lean towards older, ready buildings, where combinations are thinner (ready: 5,162 too few against 2,006 working), so the share of listings that hit "too few" is likely higher than the sales share. This is a proxy, not a measurement.
- Buildings not in the data at all ("Not covered yet") cannot be counted from this data.

### 6.6 Time index
Method: a monthly index from repeat buildings. Every combination of building, bedrooms and basis gets its own level, and the month effects are what is left (a time-dummy model with fixed effects, fitted on single sales). A new, dearer building entering the data does not move it. It was fitted on flat sales from 2011 on (827,757 rows passing rules 1 to 8) so that it overlaps the official index. File: `clean/time_index.csv` (month, area group, basis, index with Dec 2023 = 1, sales).

Inside the window, all Dubai (Dec 2023 = 1):

| Month | Ready index | Ready sales | Off-plan index | Off-plan sales |
|---|---|---|---|---|
| 2023-11 | 0.994 | 3,066 | 0.998 | 4,484 |
| 2023-12 | 1.000 | 3,166 | 1.000 | 4,773 |
| 2024-01 | 1.015 | 2,887 | 1.007 | 5,322 |
| 2024-02 | 1.031 | 3,234 | 1.011 | 5,575 |
| 2024-03 | 1.037 | 3,355 | 1.010 | 6,237 |
| 2024-04 | 1.052 | 2,579 | 1.007 | 6,445 |
| 2024-05 | 1.056 | 3,788 | 1.016 | 9,186 |
| 2024-06 | 1.060 | 3,044 | 1.000 | 6,944 |
| 2024-07 | 1.060 | 3,599 | 1.013 | 8,347 |
| 2024-08 | 1.082 | 3,131 | 1.023 | 8,394 |
| 2024-09 | 1.067 | 3,605 | 1.019 | 9,683 |
| 2024-10 | 1.095 | 3,961 | 1.023 | 10,927 |
| 2024-11 | 1.101 | 3,561 | 1.017 | 7,289 |
| 2024-12 | 1.119 | 3,135 | 1.006 | 8,344 |
| 2025-01 | 1.137 | 2,977 | 1.027 | 6,419 |
| 2025-02 | 1.137 | 3,490 | 1.029 | 7,214 |
| 2025-03 | 1.152 | 3,346 | 1.018 | 7,815 |
| 2025-04 | 1.161 | 3,806 | 1.026 | 9,208 |
| 2025-05 | 1.165 | 3,931 | 1.032 | 9,364 |
| 2025-06 | 1.169 | 3,202 | 1.047 | 8,933 |
| 2025-07 | 1.168 | 3,672 | 1.056 | 11,835 |
| 2025-08 | 1.174 | 2,881 | 1.073 | 12,131 |
| 2025-09 | 1.177 | 3,153 | 1.075 | 13,471 |
| 2025-10 | 1.179 | 3,827 | 1.071 | 11,685 |
| 2025-11 | 1.184 | 3,614 | 1.071 | 11,519 |
| 2025-12 | 1.194 | 3,452 | 1.084 | 11,591 |
| 2026-01 | 1.210 | 2,998 | 1.072 | 8,651 |
| 2026-02 | 1.217 | 3,584 | 1.079 | 8,796 |
| 2026-03 | 1.200 | 2,301 | 1.080 | 8,264 |
| 2026-04 | 1.196 | 2,107 | 1.074 | 8,817 |
| 2026-05 | 1.164 | 1,745 | 1.063 | 6,380 |
| 2026-06 | 1.152 | 2,220 | 1.060 | 8,529 |
| 2026-07 | 1.144 | 2,471 | 1.060 | 8,522 |
| 2026-08 | 1.143 | 2,282 | 1.061 | 7,274 |
| 2026-09 | 1.145 | 2,320 | 1.055 | 6,292 |
| 2026-10 | 1.152 | 2,767 | 1.053 | 5,477 |
| 2026-11 | 1.148 | 1,407 | 1.052 | 2,953 |

- Ready flats: +15.2% from Dec 2023 to Oct 2026, with a peak in Feb 2026 and -2.3% over the last 12 months. Off-plan: +5.3% and -1.7%. Nov 2026 is a part month.
- **Inside the 12-month comparison window the whole-market drift is about 2%, smaller than the 5% band.** A time adjustment can matter only by area: across the 12 largest areas and the rest, ready flats moved between -10.4% and +6.6% in the last 12 months, and between -3.7% and +36.0% from Dec 2023 to Oct 2026. Whether adjusting helps is for the backtest to say.

By DLD area group (chart: `charts/11_time_index_by_area.png`):

| Area group | Basis | Sales in the window | Dec 2023 to Oct 2026 | Last 12 months | Months with under 30 sales |
|---|---|---|---|---|---|
| Al Barsha South Fourth | ready | 13,511 | 8.9% | -8.2% | 0 |
| Al Barsha South Fourth | off-plan | 30,711 | 9.1% | -3.7% | 0 |
| Business Bay | ready | 9,171 | -3.7% | -10.4% | 0 |
| Business Bay | off-plan | 18,344 | 2.1% | -3.1% | 0 |
| Madinat Al Mataar | ready | 2,596 | 36.0% | 5.0% | 1 |
| Madinat Al Mataar | off-plan | 23,104 | 9.0% | -0.4% | 0 |
| Wadi Al Safa 5 | ready | 2,697 | 35.4% | 0.3% | 1 |
| Wadi Al Safa 5 | off-plan | 16,829 | 4.8% | 0.5% | 0 |
| Marsa Dubai | ready | 10,455 | 6.9% | -5.5% | 0 |
| Marsa Dubai | off-plan | 7,325 | -8.6% | -2.0% | 4 |
| Jabal Ali First | ready | 4,976 | 22.5% | -2.3% | 0 |
| Jabal Ali First | off-plan | 12,182 | 6.5% | -0.3% | 0 |
| Hadaeq Sheikh Mohammed Bin Rashid | ready | 3,500 | 17.8% | -2.9% | 0 |
| Hadaeq Sheikh Mohammed Bin Rashid | off-plan | 10,189 | 1.7% | -5.5% | 1 |
| Madinat Dubai Almelaheyah | off-plan | 12,976 | 3.6% | 0.7% | 0 |
| Al Merkadh | ready | 6,535 | 9.2% | -3.8% | 0 |
| Al Merkadh | off-plan | 6,512 | -4.7% | -7.5% | 4 |
| Wadi Al Safa 3 | ready | 2,090 | 29.7% | 6.6% | 12 |
| Wadi Al Safa 3 | off-plan | 10,988 | 2.1% | -3.7% | 1 |
| Al Barshaa South Third | ready | 3,624 | 29.3% | 0.6% | 0 |
| Al Barshaa South Third | off-plan | 8,098 | 10.8% | -1.2% | 0 |
| Al Khairan First | ready | 3,695 | 8.2% | -4.4% | 0 |
| Al Khairan First | off-plan | 7,580 | 2.7% | -4.1% | 0 |
| (all other areas) | ready | 50,660 | 20.4% | 0.4% | 0 |
| (all other areas) | off-plan | 138,252 | 5.9% | -1.5% | 0 |

Small groups are noisy (Wadi Al Safa 3 ready has 12 months with under 30 sales). The modelling stage should pool small areas or shrink them towards the all-Dubai line.

Against the official DLD residential sale index, flats (monthly, Mar 2011 to May 2024; chart: `charts/10_time_index_vs_official.png`):

| Overlap | Our series | Our growth | Official growth | Correlation of levels | of monthly changes | of 12-month changes |
|---|---|---|---|---|---|---|
| Jan 2012 to May 2024 (149 months) | ready, repeat buildings | 30.0% | 82.6% | 0.43 | 0.25 | 0.77 |
| Jan 2012 to May 2024 (149 months) | all, repeat buildings | 30.2% | 82.6% | 0.49 | 0.24 | 0.76 |
| Jan 2012 to May 2024 (149 months) | raw monthly median | 105.1% | 82.6% | 0.80 | 0.17 | 0.48 |
| Jan 2019 to May 2024 (65 months) | ready, repeat buildings | 23.1% | 48.0% | 0.95 | 0.19 | 0.69 |
| Jan 2019 to May 2024 (65 months) | all, repeat buildings | 21.9% | 48.0% | 0.96 | 0.24 | 0.71 |
| Jan 2019 to May 2024 (65 months) | raw monthly median | 54.6% | 48.0% | 0.83 | 0.12 | 0.52 |
| Nov 2023 to May 2024 (7 months, inside the window) | ready, repeat buildings | 6.2% | 7.9% | 0.98 | -0.27 | n/a |
| Nov 2023 to May 2024 (7 months, inside the window) | all, repeat buildings | 4.7% | 7.9% | 0.98 | -0.45 | n/a |
| Nov 2023 to May 2024 (7 months, inside the window) | raw monthly median | 10.3% | 7.9% | 0.24 | -0.66 | n/a |

**This is a weak match and should be read as one.** The two agree on direction and timing (12-month changes correlate at about 0.7 to 0.8; both turn up in 2021), but the repeat-building index grows about half as fast over long spans and its month-to-month changes barely correlate with the official ones. Likely reasons, none of them tested here: the repeat-building index follows the same buildings as they age, so it leaves out the lift from new, better stock that a market-wide index includes; DLD does not publish its method in the file; and the official series is smoothed. The raw monthly median overshoots the other way because the mix of what sells changes. Consequences: (a) do not splice the official index onto ours; (b) use our index only for short adjustments inside the window, where the two agree most (Nov 2023 to May 2024: ready +6.2% against +7.9%); (c) the official index ends 30 months before the data does.

## 7. What this means for the modelling stage

These are findings to test, not decisions.

1. **Use the hierarchy project number, then master project, then DLD area.** Same-project siblings are as good as the building itself (half within 3.2%), but exist for only 18% of too-few combinations. Treat buildings with no project number (874) or no master project (294) as having no such level.
2. **The baseline to beat** is the unadjusted median of other buildings in the same master project or area: half within 10.5% to 11.3%, 80% within 23.7% to 25.6%. A rule for "too unreliable to show" will be needed: at the area level a tenth of buildings are more than 38.5% off.
3. **Use the building's own evidence first.** Most too-few combinations sit in buildings with other sales: 1 to 4 same-bedroom sales, other bedroom types in the same 12 months (4,911 of the 5,465 thin ones), and older sales in the 36 months. How far the building sits above or below its area can be learned from those. The jump from area (70.5%) to building (92.2%) in section 6.2 is the prize.
4. **Adjust for size or match on it.** Inside a building the elasticity is about -0.3166. Comparing a listing with sales of a very different size biases the result by several percent.
5. **Keep ready and off-plan apart** (product rule). Inside a building the two differ by only 2.7%, so the backtest could check whether the other basis of the same building is better evidence than another building of the same basis. That would need the lead's agreement, because the product says never pool.
6. **Time**: small inside 12 months; test an area-level adjustment, and be careful with thin areas.
7. **Do not spend effort on** parking, nearest mall or nearest landmark. Nearest metro adds little and is often empty.
8. **Not in the data**: floor, view, unit number, condition, furnishing, exact location. About 8% of the variance stays unexplained whatever is done, and one sale is typically 4.8% from its own building's median. A range, not a single figure, is the honest output.
9. `building_first_ready_sale` is a rough age (given for 2,681 buildings). Age was not analysed here.

## 8. Limits of this work
- One download. Corrections by DLD, late registration and anything that needs two points in time are unseen.
- The window medians behind the rule checks use the data itself as the yardstick. A building where most rows are wrong would not be caught.
- The 26 look-alike building names were judged by reading them, not against an outside source.
- The demand figures use sales as a stand-in for listings.
- The index comparison could not explain the gap to the official index.
- Rule 10b compares sizes across all years. A building whose units were re-measured would lose its older rows; none was looked for.
- Hotel apartments, penthouses and Lease to Own sales stay out. Each is a product decision, listed below.

## 9. Open questions for the lead
1. The same-building comparison now sees 8,640 more sales (net) than the live snapshot. Results for some buildings will shift when this is deployed. Is a note needed for people with saved listings?
2. Hotel Apartment sales (6,506 in the window) are left out, but listing sites show hotel apartments as apartments. Keep them out, or add them as their own type?
3. Lease to Own Registration (1,651 window sales at the building's price level) is left out because it mixes purchases with refinancing. Agree?
4. The listing form accepts up to AED 6,000 per sq ft, while the data now keeps sales up to 20,000. Listings in the most expensive buildings still cannot be compared.

## 10. How this was produced
- Scripts (scratch, not in the repository): `work/profile.mjs` (both raw files, streamed), `work/rules.mts` and `work/check2.mts` (rule checks), `work/clean.mts` (analysis file and reconciliation), `work/long.mts` (2011 on, for the index), `work/eda.py` and `work/eda2.py` (numpy and matplotlib). Their raw results are in `work/profile.json`, `work/rules.json`, `work/reconcile.json`, `work/eda.json`, `work/eda2.json`.
- Product code: rules in `src/lib/ingest/data-dubai.ts` and `fields.ts`; snapshot files in `snapshot.ts`; loader in `load.ts`; schema and migration `drizzle/0006_similar_building_facts.sql`. Rebuilt with:
  `npm run data:build -- --in ../raw-data/transactions_2026-11-17_17-54-54_0001.csv --in ../raw-data/transactions_2026-11-17_17-54-54_0002.csv --dataset-url https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open --downloaded 2026-11-17 --dataset-title Transactions`
- Snapshot SHA-256: sales `849206e2bc03d73c20d46db9b7de6c0cb833cccefe9bd9ac627cee0e3d5e5b18`, buildings `374289c89caa1af28314e0a748699280cf822d4ba82bf8a6c531532a93c65c9a`.
- Charts: `charts/01` to `charts/13` (PNG).
