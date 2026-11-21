"""Refits the fitted values of the similar-buildings constants on the committed snapshot
(REAL_DATA.md section 15.7) and writes <MODEL_WORK>/constants-refit.json: the shipped constants with
- referenceVariance and evidenceVariance measured again (leave building out, robust variances), and
- range80 of the classes `own` and `indirect` set again to the multipliers that hold 80% of the
  cross-fitted test cases, times thinCellFactor (really thin buildings are noisier than thinned ones).
Everything else is kept: the rule (maxHalfWidth, the consistency rules, neverShownClasses), the floors
and the multipliers of the classes that are never shown. `version` goes up by one and `fittedOn`
names the snapshot.

It prints the old and the new values side by side. Read them before replacing anything: values that
move a lot mean the market or the data changed, and the backtest must be read again.

    py -3.12 scripts/model/refit.py [seed]
Then: copy the file over src/lib/similar/constants.json, run backtest.py, served.mjs and
backtest-summary.mjs, raise SIMILAR_MIN_CONSTANTS_VERSION if stored ranges of the old version must
be withdrawn, npm run data:build, and the tests.
"""
import copy, json, math, os, sys
import vlib as L, vbt as V

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 31337
S, B = L.load_snapshot(); C = L.constants(); MAN = L.manifest(); T = L.dnum(MAN["dataThrough"])
W = V.World(S, B, T, SEED)
cells = W.test_cells(10)
rows_ref, rows3 = W.collect(C, cells)
out3, Call, _, _ = V.crossfit(rows_ref, rows3, C)
fit = Call.pop("range80_fit")
new = copy.deepcopy(C)
new["referenceVariance"] = Call["referenceVariance"]; new["evidenceVariance"] = Call["evidenceVariance"]
f = C.get("thinCellFactor", 1.0)
before = copy.deepcopy(C.get("range80BeforeThinCellFactor", C["range80"]))
for cls in ("own", "indirect"):
    before[cls] = fit[cls]
    new["range80"][cls] = [fit[cls][0], fit[cls][1] * f, fit[cls][2] * f]
new["range80BeforeThinCellFactor"] = before
new["version"] = C["version"] + 1
new["fittedOn"] = {"dataThrough": MAN["dataThrough"], "snapshotSha256": MAN["snapshotSha256"],
                   "note": f"Refit by scripts/model/refit.py (seed {SEED}) on {len(cells)} combinations with 10 or more sales; own and indirect multipliers times thinCellFactor {f}."}
print(f"test combinations: {len(cells)}")
print("standard deviations, shipped / refit")
for lev in V.LEV:
    for bs in V.BS:
        a = C["referenceVariance"][lev][bs]; m = new["referenceVariance"][lev][bs]
        print(f"  reference {lev:9s} {bs:8s} a {math.sqrt(a[0]):.4f} / {math.sqrt(m[0]):.4f}   b {math.sqrt(a[1]):.3f} / {math.sqrt(m[1]):.3f}")
for name in ("own", "older12to24", "older24to36", "otherBedrooms"):
    for bs in V.BS:
        a = C["evidenceVariance"][name][bs]; m = new["evidenceVariance"][name][bs]
        print(f"  {name:13s} {bs:8s} " + "  ".join(f"{math.sqrt(a[k]):.3f}/{math.sqrt(m[k]):.3f}" for k in sorted(a)))
for cls in ("own", "indirect"):
    print(f"  range80 {cls:8s} shipped {[round(x, 3) for x in C['range80'][cls]]}  refit {[round(x, 3) for x in new['range80'][cls]]}")
out = os.path.join(L.WORK, "constants-refit.json")
json.dump(new, open(out, "w"), indent=2)
print("written", out)
