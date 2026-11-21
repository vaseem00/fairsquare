# Adjusted comparable sales: stage 1 analysis

19 Nov 2026. Written in stage 4 from the stage 1 scripts and tables, because stage 1 did not save its report. Every number is read from a stage 1 output file (tables\*.json, e_out.txt). Nothing was re-run for this text.

Errors are for one real sale predicted from another sale or from a group of sales: typical (median) / 80th percentile, then bias, in percent. Cutoffs: 2024-11-17, 2025-05-17, 2025-11-16, 2026-05-17.

## 1. Data
- prep.py builds a long-history file of flat sales from 2011 under the product's cleaning rules: 809,627 kept sales. The 36 months to 16 Nov 2026 hold 403,867 sales in 4,348 buildings.
- Sales of the last 12 months: 126,189, in 13,575 building x bedrooms x basis types. 8,821 types have under 5 sales in 12 months; 4,754 have 5 or more.
- Building facts: DLD area, community, project number, project family.

## 2. Size (a_size.py, tables\a_size.json)
Inside one building, bedroom count, basis and half-year, a larger unit sells for less per sq ft.
- All: 393,025 sales, slope -0.365 (se 0.010): -3.4% per 10% more size. Ready -0.440 (-4.1%). Off-plan -0.332 (-3.1%).
- Ready studio / 1 / 2 / 3-bed: -0.548 / -0.445 / -0.406 / -0.313. Off-plan: -0.539 / -0.321 / -0.260 / -0.200. 4+ bedrooms: +0.066 ready (829 sales), -0.048 off-plan (1,722): no usable slope.
- The slope differs by building: the middle half of per-type slopes runs from -0.64 to -0.13 (ready) and -0.64 to -0.08 (off-plan); 15% are positive.
- Close to a straight line in logs between 0.7x and 1.4x. Below 0.6x it breaks: ready units at 0.55x sell 9.8% lower where the line says 30% higher. Hence the 0.67x to 1.5x limits.
- Forward test (166,508 sales, from the type's median): no size adjustment 6.12 / 15.35; segment slope 5.87 / 14.34; per-type slope shrunk to the segment (0.03) 5.50 / 13.77, the best tried.
- Units 1.25 to 1.4x typical (4,329): no adjustment 11.03 / 23.86, bias -7.2; segment slope 9.20 / 18.23, bias +1.3.
- Stable over time: ready 1-bed -0.403, -0.429, -0.441, -0.444 at the four cutoffs.

## 3. Time (b_index.py, b_official.py)
A monthly index per DLD area x basis with building x bedrooms x basis effects fixed, shrunk to Dubai x basis where thin (k = 20 sales per month), smoothed (50).
One sale predicted from an earlier sale of the same type, no adjustment against with the index:
- 1 to 3 months (250,994 pairs): 4.96 / 12.31, +0.2 against 4.96 / 12.30, +0.2
- 4 to 6 (323,761): 6.23 / 15.60, +0.8 against 6.19 / 15.41, +0.6
- 10 to 12 (138,902): 8.65 / 20.64, +2.8 against 7.95 / 19.15, +0.5
- 13 to 18 (179,666): 10.47 / 24.17, +5.1 against 8.77 / 20.37, +0.1
- 19 to 24 (133,475): 13.21 / 29.87, +9.2 against 9.57 / 21.32, -0.3
- 31 to 42 (104,731): 28.08 / 53.82, +26.3 against 12.74 / 27.16, -0.1
- Ready, 13 to 42 (285,670): 21.88 / 44.48, +19.1 against 11.79 / 25.72, +0.8
- Off-plan, 13 to 42 (228,763): 9.20 / 22.18, +4.2 against 8.36 / 18.98, -0.7
The index removes the bias of old sales and does not help inside 3 months.
- Dubai change over the 12 months to each cutoff: ready +12.8%, +11.0%, +7.8%, +1.9%; off-plan +4.3%, +3.4%, +4.9%, +3.5%.
- Stable when later data arrives: an area's value changes by a median 0.2 to 0.4 points (90th percentile up to 1.2).
- Against the official DLD flat index (to May 2024): 12-month changes correlate 0.75; the official series moves about 6 months later (0.86 at that lag). May 2021 to May 2024: +35.5% against the official +68.3%. The official index follows the mix sold; this one follows the same buildings.
- Ready flats lose about 3.6% to 3.8% per year of building age against the area.

## 4. Rings (c_pairs.py)
One sale predicted from one other sale; raw, then with time and size adjustment:
- Ring 1, same building, bedrooms, basis (205,934 pairs): 8.57 / 23.77, +2.5 then 7.28 / 18.10, +0.3
- Ring 1x, other basis (26,693): 21.72 / 42.51, +18.4 then 12.25 / 26.59, +1.3
- Ring 2, other bedrooms (193,474): 14.91 / 33.50, +4.5 then 9.91 / 22.18, +0.5
- Ring 3, same project, other building (97,094): 9.69 / 25.51, +3.7 then 8.35 / 19.90, +1.2
- Ring 4, same community (298,515): 22.00 / 50.67, +13.5 then 17.94 / 40.99, +7.0
- Ring 5, same area (131,079): 26.25 / 62.09, +6.7 then 25.61 / 60.46, +2.0
Rings 1, 3 and 2 are usable after adjustment. The community is twice as far and stays biased. The area is not usable. Ready pairs are worse than off-plan in every ring (ring 1: 10.54 / 24.14 against 6.13 / 15.15). Off-plan sells 4% to 10% below ready in the same building and bedroom count, and the gap moved, so ring 1x was left out.

## 5. How many comparables exist (d_coverage.py)
For the 8,821 too-few types with a 36-month pool:
- Latest own sale 0 to 6 months old: 37.3%; 6 to 12: 24.7%; 12 to 24: 25.9%; 24 to 36: 12.1%.
- First ring reaching 3 comparables: ring 1 79.1%, ring 2 18.0%, ring 3 1.2%, community 1.7%. Reaching 5: 63.2%, 30.6%, 2.7%, 3.2%.
A too-few type nearly always has own sales, but old ones. The time adjustment and the other bedrooms of the building make an answer possible; the project and the community rarely decide it.

## 6. Hazards (e_hazards.py, e_out.txt)
- One-price batches: 518 batches of 5+ unlike units at one AED per sq ft on 3 or fewer days, 4,227 rows in 323 buildings (1,406 in the last 12 months). Median 0.99x the building's level, but 23.3% outside 0.9x to 1.1x. The method collapses each batch to one row per bedroom count.
- Flat per-sq-ft price lists over more days: 7,376 groups, 64,864 rows, 95% off-plan. Real list prices; they stay in.
- The other hazard tables were not read again for this text.

## 7. What stage 1 handed on
Rings 1, 3, 2 with adjustment, the community as a last resort, no area ring; a time index per area x basis pooled to Dubai where thin; a size slope per type shrunk to the segment, limits 0.67x to 1.5x; batches collapsed. Open then: the weights, the range, when to refuse.

## 8. Not done in stage 1
No floor, view or condition data exists (noise floor 4.8% typical). Registration lag was simulated by thinning the last 61 days (index shift under 0.4 points), not measured. The charts were not regenerated.
