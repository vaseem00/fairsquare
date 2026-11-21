"""The fit and the reference outputs of adjusted registered sales, at the data date lib.TEND.

  python scripts/model/acs/make.py [--version N]

Reads the work folder (data.npz from prep.py; bt/res_<cut>.npz from bt.py and full.py; final5_tables.json from e6.py when
it is there), the committed snapshot (data/open-data/sales.csv.gz) and the golden case list (tests/fixtures/acs/cases.json).
Writes into the work folder:
  constants.json      the fit: copy it over src/lib/acs/constants.json after reading it
  acs-model.json.gz   the production model as acs.py builds it (the reference of the TypeScript build)
  expected.json.gz    what acs.py answers for each golden case
  cases.json          the golden cases that still name a building of the snapshot
  older-sales.csv.gz, families.json.gz    the inputs of the build parity test
Copy the last five into tests/fixtures/acs/ (scripts/model/README.md).

The production profile: the pool is the snapshot's sales in file order (ascending ref), collapsed per building and
basis; buildings are named by the app's key; ring 4 (the community) and buildings that are not in the data are left out
(neither can be part of a shown answer). The range multipliers come from the forward errors of all six cutoffs; ready
flats at a nominal 85%, off-plan at 80%."""
import sys, os, json, math, gzip, csv
import numpy as np
from s5lib import *
import acs as A, lib as L
from appkey import dld_key

NOMINAL = {0: 0.85, 1: 0.80}
REPO = L.REPO; OUT = L.HERE
SRC = json.load(open(os.path.join(REPO, "src", "lib", "acs", "constants.json"), encoding="utf-8"))
VERSION = int(sys.argv[sys.argv.index("--version") + 1]) if "--version" in sys.argv else int(SRC["version"])
MAN = json.load(open(os.path.join(REPO, "data", "open-data", "manifest.json"), encoding="utf-8"))
assert MAN["dataThrough"] == L.TEND, f"lib.TEND is {L.TEND}; the snapshot ends {MAN['dataThrough']}: move TEND, CUTS (lib.py) and PRE (bt.py) first"
S, B, M = L.load(); T = L.dnum(L.TEND); W0 = T - 1095
bi = {k: i for i, k in enumerate(M["buildings"])}

# ---- the snapshot rows, in file order
rows = []
with gzip.open(os.path.join(REPO, "data", "open-data", "sales.csv.gz"), "rt", encoding="utf-8", newline="") as f:
    for r in csv.DictReader(f): rows.append((r["ref"], L.dnum(r["date"]), bi[r["building"] + "|" + r["area_dld"]], int(r["bedrooms"]), 1 if r["completion"] == "off_plan" else 0, float(r["size_sqft"]), float(r["price_aed"]), r["building"], r["area_dld"]))
sd = np.array([r[1] for r in rows], np.int64); sb = np.array([r[2] for r in rows], np.int64); sbed = np.array([r[3] for r in rows], np.int64); sbas = np.array([r[4] for r in rows], np.int64)
ssz = np.array([r[5] for r in rows]); spr = np.array([r[6] for r in rows])
inw = np.where((S["day"] >= W0) & (S["day"] <= T))[0]
mine = sorted(zip(S["b"][inw].tolist(), S["day"][inw].tolist(), S["bed"][inw].tolist(), S["basis"][inw].tolist(), np.round(S["size"][inw], 2).tolist(), S["price"][inw].tolist()))
snap = sorted(zip(sb.tolist(), sd.tolist(), sbed.tolist(), sbas.tolist(), np.round(ssz, 2).tolist(), spr.tolist()))
assert mine == snap, "the long-history file and the snapshot do not hold the same sales in the snapshot's window"
print("snapshot rows", len(rows), "| the long-history file has the same sales in that window")
old = np.where(S["day"] < W0)[0]
S2 = dict(day=np.concatenate([S["day"][old], sd]), b=np.concatenate([S["b"][old], sb]), bed=np.concatenate([S["bed"][old], sbed]), basis=np.concatenate([S["basis"][old], sbas]),
          size=np.concatenate([S["size"][old], ssz]), price=np.concatenate([S["price"][old], spr]))
S2["psf"] = S2["price"] / S2["size"]; S2["lp"] = np.log(S2["psf"]); S2["ls"] = np.log(S2["size"]); S2["cell"] = (S2["b"] * 8 + S2["bed"]) * 2 + S2["basis"]
S2["area"] = B["area"][S2["b"]]; S2["master"] = B["master"][S2["b"]]
c = A.Ctx.build(S2, B, T); c.params = dict(A.P0)

# ---- the fit: range constants, multipliers, the rule
D = cal.load_all(); g, s = cal.feats(D, EC.RC)
Q = make_q(D, g, s, D["ok"] & (D["bed"] <= 3), EC.RC, nom={0: NOMINAL[0]})
c.range = dict(floor=EC.RC["floor"], d0=EC.RC["d0"], k0=EC.RC["k0"], thinW=EC.RC["thinW"], oldAge=EC.RC["oldAge"], farLsr=EC.RC["farLsr"], q=Q, **EC.RULE, nominal=[NOMINAL[0], NOMINAL[1]])
c.s4 = {}  # the production profile has no ring 4
params = {k: v for k, v in c.params.items() if k not in ("r4", "gate4")}
q12 = {k: v for k, v in Q.items() if k.split("|")[1] in ("1", "2")}
rng_out = dict({k: v for k, v in c.range.items() if k != "q"}, q=q12, refuseClasses=[3])

tested = SRC["tested"]; tables = os.path.join(OUT, "final5_tables.json")
if os.path.exists(tables):
    t = json.load(open(tables, encoding="utf-8")); parts = {"tuning": "tuning", "2025-11-16": L.CUTS[2], "last 2026-05-17": L.CUTS[3]}
    held = {}
    for name, key in (("enough", "A"), ("few", "B")):
        for bn, label in (("ready", "Ready"), ("off-plan", "OffPlan")):
            held[name + label] = {parts[d["part"]]: d["heldPct"] for d in t[key] if d["basis"] == bn and d["part"] in parts}
    allv = [v for d in held.values() for v in d.values()]; later = [v for d in held.values() for k, v in d.items() if k != "tuning"]
    tested = dict(heldOf10=int(min(allv) // 10), heldLaterOf10=int(min(later) // 10), held=held, horizonDays=L.HZ)
    print("tested statement from final5_tables.json:", tested["heldOf10"], "of 10; later cutoffs", tested["heldLaterOf10"], "of 10; lowest share", min(allv))
else:
    print("final5_tables.json is not in the work folder: `tested` is copied from src/lib/acs/constants.json. Run e6.py first for a refit.")
constants = dict(version=VERSION, note=SRC.get("note", ""), fittedOn=dict(dataThrough=L.TEND, snapshotSha256=MAN["snapshotSha256"], cutoffs=L.CUTS, tuningCutoffs=L.CUTS[:2]),
                 params=params, range=rng_out, tested=tested)
json.dump(constants, open(os.path.join(OUT, "constants.json"), "w", encoding="utf-8"), indent=2); open(os.path.join(OUT, "constants.json"), "a").write("\n")
same = lambda a, b: a == b  # 8 and 8.0 are the same number
print("constants.json written, version", VERSION, "| against src/lib/acs/constants.json: params", "same" if same(params, SRC["params"]) else "CHANGED", "| range and multipliers",
      "same" if same(rng_out, SRC["range"]) else "CHANGED", "| tested", "same" if same(tested, SRC["tested"]) else "CHANGED")

# ---- the production model as acs.py builds it
used = np.unique(c.b); kname = {}
for r in rows: kname[r[2]] = (dld_key(r[7], r[8]), r[7], r[8])
used = [int(b) for b in used if int(b) in kname]
assert len({kname[b][0] for b in used}) == len(used), "two buildings of the snapshot have one key"
famcount = {}
for b in used:
    f = int(c.B_fam[b])
    if f > 0: famcount[f] = famcount.get(f, 0) + 1
areas = sorted({kname[b][2] for b in used}); ai = {a: i for i, a in enumerate(areas)}
theta = {}
for b in used:
    a = int(c.B_area[b])
    for sx in (0, 1):
        th = c.theta.get(f"{a}|{sx}")
        if th is not None: theta[f"{ai[kname[b][2]]}|{sx}"] = np.asarray(th).tolist()
bix = {b: i for i, b in enumerate(used)}
cells = [[bix[int(k) // 16], (int(k) // 2) % 8, int(k) % 2, float(a), float(x)] for k, a, x in zip(c.cs_key, c.cs_sxx, c.cs_sxy) if int(k) // 16 in bix]
model = dict(version=2, kind="acs-model", dataThrough=L.dstr(T), epoch="2020-01-01", T=int(T), poolFromDay=int(W0 + 1), params=params, range=rng_out, areas=areas,
             tau=c.tau.tolist(), theta=theta, seg=c.seg.tolist(), beta2=c.beta2.tolist(), prem=c.prem.tolist(),
             buildings=dict(key=[kname[b][0] for b in used], area=[ai[kname[b][2]] for b in used], family=[int(c.B_fam[b]) if famcount.get(int(c.B_fam[b]), 0) > 1 else 0 for b in used]),
             cellSlope=cells)
raw = json.dumps(model, separators=(",", ":")).encode()
open(os.path.join(OUT, "acs-model.json.gz"), "wb").write(gzip.compress(raw, 9, mtime=0))
print("model: %d bytes, buildings %d, areas %d, area x basis indexes %d, cells with a slope %d, multiplier groups %d, buildings with a sibling %d" % (
    len(raw), len(used), len(areas), len(theta), len(cells), len(q12), sum(1 for f in model["buildings"]["family"] if f > 0)))

# ---- the golden cases
def clean(o):
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    if isinstance(o, float) and not math.isfinite(o): return None
    return o
bykey = {kname[b][0]: b for b in used}
src = json.load(open(os.path.join(REPO, "tests", "fixtures", "acs", "cases.json"), encoding="utf-8"))
cases = []; exp = []; gone = 0
for q in src:
    b = bykey.get(q["buildingKey"])
    if b is None: gone += 1; continue
    r = A.estimate(c, b, q["bed"], q["basis"], q["size"], q.get("askingPsf")); f = r["features"]
    e = dict(shown=bool(r.get("shown")), reason=r.get("reason"), evidenceClass=r.get("evidenceClass"), group=r.get("group"), groupUsed=r.get("groupUsed"), centrePsf=r.get("centrePsf"), lowPsf=r.get("lowPsf"), highPsf=r.get("highPsf"),
             halfWidth=r.get("halfWidth"), rangeLowPsf=r.get("rangeLowPsf"), rangeHighPsf=r.get("rangeHighPsf"), verdict=r.get("verdict"), typicalSize=r["typicalSize"],
             features=None if f is None else {k: f[k] for k in ("centre", "n", "W", "neff", "disp", "W1", "W2", "W3", "n1", "n2", "n3", "age_w", "lsr_w", "beta1")},
             comps=[dict(buildingKey=kname[k["b"]][0], date=L.dstr(k["day"]), bed=k["bed"], size=k["size"], psf=k["psf"], count=k["cnt"], ring=k["ring"], ageMonths=k["ageMonths"], timeLn=k["timeLn"], sizeLn=k["sizeLn"], adjustedPsf=k["adjustedPsf"], weight=k["weight"]) for k in r["comps"]])
    if e["evidenceClass"] == 3: e.update(groupUsed=None, lowPsf=None, highPsf=None, halfWidth=None)   # a refused class has no range in production
    cases.append(q); exp.append(clean(e))
json.dump(cases, open(os.path.join(OUT, "cases.json"), "w", encoding="utf-8"), indent=1)
open(os.path.join(OUT, "expected.json.gz"), "wb").write(gzip.compress(json.dumps(exp).encode(), 9, mtime=0))
from collections import Counter
print(len(cases), "golden cases", f"({gone} of the list name a building that is no longer in the snapshot)" if gone else "", dict(Counter(("shown" if r["shown"] else r["reason"]) for r in exp)))

# ---- the inputs of the build parity test (tests/unit/acs/build-parity.test.ts)
names = M["buildings"]; older = np.where((S["day"] < W0) & (S["day"] > T - 1461))[0]
with gzip.open(os.path.join(OUT, "older-sales.csv.gz"), "wt", encoding="utf-8", newline="") as f:
    w = csv.writer(f, lineterminator="\n"); w.writerow(["date", "building", "area_dld", "bedrooms", "completion", "size_sqft", "price_aed"])
    for i in older.tolist():
        bn, an = names[int(S["b"][i])].rsplit("|", 1)
        w.writerow([L.dstr(S["day"][i]), bn, an, int(S["bed"][i]), "off_plan" if S["basis"][i] == 1 else "ready", repr(float(S["size"][i])), int(S["price"][i])])
fam = {names[b]: M["fams"][int(B["fam"][b])] for b in np.unique(S["b"][S["day"] > T - 1461]).tolist() if B["fam"][b] > 0}
open(os.path.join(OUT, "families.json.gz"), "wb").write(gzip.compress(json.dumps(fam, ensure_ascii=False).encode("utf-8"), 9, mtime=0))
print("parity inputs:", len(older), "older sales,", len(fam), "buildings with a project family")
