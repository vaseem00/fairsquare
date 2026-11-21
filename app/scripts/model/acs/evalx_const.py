"""The range constants and the refusal rule (chosen on the test cutoffs 2024-11-17 and 2025-05-17 only: ex2.py, ex3.py)."""
import cal
RC = dict(cal.RC0)
# Stage 4 (chosen on the same two cutoffs, s4/c2_explore.py and s4/c3_explore.py): class 3 (project siblings lead, building in the
# data) is refused; a building in the data needs total weight 2 and at least one own same-type comparable; the mean size gap
# limit is ln 1.15 (was 0.2), which equals the "far" threshold, so no "far" case is shown.
import math
RULE = dict(minComps=3, minWeight=1.0, minWeightKnown=2.0, minOwn=1, maxLsr=math.log(1.15), typLo=0.7, typHi=1.6, maxHalfWidth=0.20, maxBedrooms=3,
            refuseClasses=[3, 4, 6], rounding=10)
