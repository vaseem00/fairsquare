"""The project route for buildings NOT in the data (REAL_DATA.md section 15.8): its out-of-sample backtest
and the fit of its range. Reads the committed snapshot; writes <MODEL_WORK>/project-route.json. No network.

A case: at a cutoff T, a building whose first valid flat sale in DLD history (buildings.csv first_sale) is
after T, off-plan, studio to 3 bedrooms, with 5 or more sales of that type in the 183 days after T. Its
truth is the product median of those sales.

The reference is built from data up to T only, as the product builds it from the loaded cells: the
buildings of the same project in the same DLD area (same key, `projectKey` in src/lib/domain/project.ts),
same bedrooms, off-plan, 3 or more sales in the 12 months to T; the median of their ln(median). The
error is ln(truth) - reference.

Which cases the product can serve (the resolver refuses a listing that names a numbered project already
in the data, `building_in_data`): the building's project number had no sale before T, or its project name
has no trailing number (the listing then names the project itself).

The range is [reference + lowLog, reference + highLog], lowLog and highLog the 10th and 90th points of the
errors. Out of sample: each cutoff is scored with the points fitted on the EARLIER cutoffs only (an
expanding window). The shipped points are then fitted on all cutoffs.

    .data/model/venv/Scripts/python scripts/model/project_route.py
"""
import json, math, os, re, sys, unicodedata
from collections import Counter, defaultdict
import numpy as np
import vlib as L

CUTS = ["2024-11-17", "2025-05-17", "2025-11-16", "2026-05-17"]
HORIZON = 183
MIN_TARGET = 5
MIN_BUILDINGS, MIN_SALES = 1, 3
Q = 0.1
MINOR = {"the", "a", "an", "of", "by", "at", "and"}
TRAILING = re.compile(r"(?:\s+(?:phase\s+)?(?:[0-9]+|[ivx]+|[a-h]))+$")

def norm(s):
    """normaliseArea in src/lib/domain/area.ts."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = "".join(ch for ch in s if ord(ch) < 128).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def project_key(name):
    """projectKey in src/lib/domain/project.ts."""
    n = norm(name)
    stripped = TRAILING.sub("", " " + n).strip() if " " in n else n
    words = [w for w in stripped.split(" ") if w and w not in MINOR]
    return stripped if len(words) >= 2 else None

S, B = L.load_snapshot()
facts = B["facts"]
aliases = json.load(open(os.path.join(L.REPO, "src", "lib", "similar", "area-aliases.json"), encoding="utf-8"))["aliases"]
places = {norm(a["alias"]) for a in aliases} | {norm(f["area_dld"]) for f in facts} | {norm(f["master_project"]) for f in facts if f["master_project"]}
keys = []
for f in facts:
    k = project_key(f["project"]) if f["project_number"] else None
    keys.append(None if k is None or k in places else k)
GROUP = np.array([hash((k, f["area_dld"])) if k else 0 for k, f in zip(keys, facts)], dtype=np.int64)

def cases_at(cut):
    T = L.dnum(cut)
    tab = L.Table(S, B, T)
    sold_before = set(B["proj"][S["b"][S["day"] <= T]].tolist())
    newb = set(np.where(B["first_sale"] > T)[0].tolist())
    groups = defaultdict(list)
    for i in np.where((S["day"] > T) & (S["day"] <= T + HORIZON) & (S["basis"] == 1) & (S["bed"] <= 3))[0].tolist():
        b = int(S["b"][i])
        if b in newb:
            groups[(b, int(S["bed"][i]))].append(S["psf"][i])
    out = []
    for (b, bed), v in sorted(groups.items()):
        if len(v) < MIN_TARGET or not GROUP[b]:
            continue
        proj = int(B["proj"][b])
        served = proj not in sold_before or norm(facts[b]["project"]) == keys[b]
        cm = tab.comp.get((int(B["area"][b]), bed, 1))
        if not served or cm is None:
            continue
        cb, lm, ns = cm
        k = (GROUP[cb] == GROUP[b]) & (cb != b)
        if k.sum() < MIN_BUILDINGS or ns[k].sum() < MIN_SALES:
            continue
        _, truth = L.pmed(v)
        ref = float(L.med_plain(lm[k]))
        out.append(dict(cut=cut, building=B["key"][b], group=keys[b], projectNumber=facts[b]["project_number"], bed=bed, n=len(v),
                        siblings=int(k.sum()), siblingSales=int(ns[k].sum()), e=math.log(truth) - ref))
    return out

def pct(x): return round(100 * x, 1)
def errors(es):
    es = np.asarray(es); a = np.abs(np.expm1(es))
    return dict(typicalErrorPct=pct(np.median(a)), p80ErrorPct=pct(np.quantile(a, .8)), biasMedianPct=pct(math.expm1(np.median(es))), biasMeanPct=pct(math.expm1(np.mean(es))))

C = {cut: cases_at(cut) for cut in CUTS}
rows, test = [], []
for i, cut in enumerate(CUTS[1:], start=1):
    train = [c["e"] for k in CUTS[:i] for c in C[k]]
    lo, hi = float(np.quantile(train, Q)), float(np.quantile(train, 1 - Q))
    for c in C[cut]:
        c["inside"] = lo <= c["e"] <= hi; c["halfWidth"] = (hi - lo) / 2
        test.append(c)
    rows.append(dict(cutoff=cut, train=len(train), test=len(C[cut]), rangePct=[pct(math.expm1(lo)), pct(math.expm1(hi))],
                     coveragePct=pct(np.mean([c["inside"] for c in C[cut]])) if C[cut] else None))
by_group = defaultdict(list)
for c in test: by_group[c["group"]].append(c["inside"])
allc = [c for k in CUTS for c in C[k]]
e_all = np.array([c["e"] for c in allc])
lo, hi = float(np.quantile(e_all, Q)), float(np.quantile(e_all, 1 - Q))
out = dict(
    about="scripts/model/project_route.py: out-of-sample backtest of the project route (REAL_DATA.md section 15.8).",
    dataThrough=L.manifest()["dataThrough"], snapshotSha256=L.manifest()["snapshotSha256"],
    cutoffs=CUTS, horizonDays=HORIZON, minTargetSales=MIN_TARGET, minBuildings=MIN_BUILDINGS, minSales=MIN_SALES, nominalPct=round(100 * (1 - 2 * Q)),
    casesByCutoff={k: len(v) for k, v in C.items()},
    outOfSample=dict(cases=len(test), buildings=len({c["building"] for c in test}), projectNumbers=len({c["projectNumber"] for c in test}),
                     projects=len(by_group), coveragePct=pct(np.mean([c["inside"] for c in test])),
                     coverageGroupsWeightedPct=pct(np.mean([np.mean(v) for v in by_group.values()])),
                     lowestCutoffCoveragePct=min(r["coveragePct"] for r in rows if r["coveragePct"] is not None),
                     meanHalfWidthPct=pct(np.mean([c["halfWidth"] for c in test])), largestProject=Counter(c["group"] for c in test).most_common(1)[0],
                     **errors([c["e"] for c in test]), byCutoff=rows),
    shipped=dict(cases=len(allc), projects=len({c["group"] for c in allc}), lowLog=lo, highLog=hi,
                 rangePct=[pct(math.expm1(lo)), pct(math.expm1(hi))], halfWidthPct=pct((hi - lo) / 2)),
)
o = out["outOfSample"]
out["statement"] = dict(heldOf10=int(math.floor(min(o["coveragePct"], o["coverageGroupsWeightedPct"], o["lowestCutoffCoveragePct"]) / 10)))
# The owner's rule (19 Nov 2026): ship only with at least about 75% out of sample, about 100 test cases, a half-width under about 20%.
out["passes"] = bool(o["coveragePct"] >= 75 and o["cases"] >= 100 and o["meanHalfWidthPct"] < 20)
path = os.path.join(L.WORK, "project-route.json")
json.dump(out, open(path, "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "about"}, indent=1))
print("written", path)
