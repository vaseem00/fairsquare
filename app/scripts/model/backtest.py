"""The backtest of the similar-buildings comparison (REAL_DATA.md section 15.6), on the committed snapshot
with the shipped constants and the shipped rule. Writes <MODEL_WORK>/backtest-run.json; then
`node scripts/model/backtest-summary.mjs` turns it (with served.json) into src/lib/similar/backtest.json.

Every figure is of the ranges the rule SHOWS. The tests:
  A  leave building out / leave project out: each combination with 10 or more sales is hidden in turn;
     the building keeps k of its sales (k = 0 to 4) and the range is scored against the median of the rest.
     "thinned": the building's other sales are cut down too, so it looks as sparse as a real thin building.
  B  combinations with 5 to 9 sales, the same way, and rich ones cut to the same size.
  C  really thin combinations (2 to 4 sales): one sale held out as the target; and real one-sale combinations.
  D  real too-few combinations half a year and a year ago, scored against the median of the next 183 days.
  calls  listings priced like single registered sales: what the range says against the same-building rule.
The random draws are seeded (default 31337), so a run repeats exactly.

    py -3.12 scripts/model/backtest.py [seed]
"""
import json, math, os, sys, time
import numpy as np
import vlib as L, vbt as V
from rule import show2

t0 = time.time()
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 31337
S, B = L.load_snapshot(); C = L.constants(); MAN = L.manifest(); T = L.dnum(MAN["dataThrough"])
res = {"seed": SEED, "dataThrough": MAN["dataThrough"], "snapshotSha256": MAN["snapshotSha256"], "constantsVersion": C["version"], "tests": {}}

def stats(a, truth):
    if not a: return dict(n=0)
    t = np.array([r[truth] for r, p in a]); lo = np.array([p["low"] for r, p in a]); hi = np.array([p["high"] for r, p in a]); c = np.array([p["centre"] for r, p in a])
    ae = np.abs(np.exp(c - t) - 1)
    return dict(n=len(a), coveragePct=round(float(((t >= lo) & (t <= hi)).mean() * 100), 1), truthBelowPct=round(float((t < lo).mean() * 100), 1), truthAbovePct=round(float((t > hi).mean() * 100), 1),
                typicalErrorPct=round(float(np.median(ae) * 100), 1), p80ErrorPct=round(float(np.quantile(ae, .8) * 100), 1), p90ErrorPct=round(float(np.quantile(ae, .9) * 100), 1),
                typicalRangePct=[round(float((math.exp(-np.median(c - lo)) - 1) * 100), 1), round(float((math.exp(np.median(hi - c)) - 1) * 100), 1)],
                closePct=round(float(np.mean([p["close"] for r, p in a]) * 100), 1))

def rep(label, rows, truth="truth"):
    """Studios to 3 bedrooms only (more are never shown). `shown`: what the rule shows; `refused`: why not."""
    recs = [(r, V.apply(r, C)) for r in rows if r["bed"] <= C["maxBedrooms"]]
    shown = []; refused = {}; by_reason = {}
    for r, p in recs:
        ok, why = show2(r, p, C)
        if ok: shown.append((r, p))
        else:
            refused[why] = refused.get(why, 0) + 1
            if p: by_reason.setdefault(why, []).append((r, p))
    o = dict(cases=len(recs), shownPct=round(100 * len(shown) / max(len(recs), 1), 1), shown=stats(shown, truth), refused=refused,
             refusedWouldHaveHeldPct={k: stats(v, truth).get("coveragePct") for k, v in by_reason.items() if len(v) >= 30})
    res["tests"][label] = o
    s = o["shown"]
    print(f"{label:66s} cases={o['cases']:6d} shown {o['shownPct']:5.1f}% held {s.get('coveragePct')} (median below {s.get('truthBelowPct')}, above {s.get('truthAbovePct')}) error {s.get('typicalErrorPct')}/{s.get('p80ErrorPct')}/{s.get('p90ErrorPct')} range {s.get('typicalRangePct')} | refused {refused} would have held {o['refusedWouldHaveHeldPct']}", flush=True)
    return shown

def single(rows):
    out = []
    for r in rows:
        r2 = dict(r); r2["truth"] = r["one"]; out.append(r2)
    return out

# ---------- A ----------
W = V.World(S, B, T, SEED)
cells = W.test_cells(10)
res["testCombinations"] = len(cells)
lbo3 = None
for lpo in (False, True):
    rows_ref, rows3 = W.collect(C, cells, lpo=lpo)
    tag = "LPO" if lpo else "LBO"
    rep(f"{tag} own thinned", [r for r in rows3 if r["k"] >= 1 and r["thin"] == 1])
    rep(f"{tag} indirect thinned", [r for r in rows3 if r["k"] == 0 and r["thin"] == 1])
    rep(f"{tag} own intact", [r for r in rows3 if r["k"] >= 1 and r["thin"] == 0])
    rep(f"{tag} indirect intact", [r for r in rows3 if r["k"] == 0 and r["thin"] == 0])
    if not lpo:
        lbo3 = rows3
        for bs, bn in ((0, "ready"), (1, "off-plan")):
            rep(f"LBO own thinned, {bn}", [r for r in rows3 if r["k"] >= 1 and r["thin"] == 1 and r["basis"] == bs])
            rep(f"LBO indirect thinned, {bn}", [r for r in rows3 if r["k"] == 0 and r["thin"] == 1 and r["basis"] == bs])
        for bed in range(0, C["maxBedrooms"] + 1):
            rep(f"LBO own thinned, {bed} bedrooms", [r for r in rows3 if r["k"] >= 1 and r["thin"] == 1 and r["bed"] == bed])
            rep(f"LBO indirect thinned, {bed} bedrooms", [r for r in rows3 if r["k"] == 0 and r["thin"] == 1 and r["bed"] == bed])
        z = [r for r in rows3 if r["k"] == 0 and r["thin"] == 1]
        rep("LBO indirect thinned: other bedroom types only", [r for r in z if r["ob"] and not r["o1"] and not r["o2"]])
        rep("LBO indirect thinned: sales 24 to 36 months back, none 12 to 24", [r for r in z if r["o2"] and not r["o1"]])
print("A done", round(time.time() - t0, 1), flush=True)

# ---------- B, C ----------
W2 = V.World(S, B, T, SEED + 100)
rg = np.random.default_rng(SEED + 200)
def replicate(Wd, key, pool_idx, k, rate, n_cell):
    b, bed, basis = key; perm = rg.permutation(pool_idx); ownk = perm[:k]; rest = perm[k:]
    _, t3 = L.pmed(Wd.S["psf"][rest])
    bc = Wd.thinned_cells(b, bed, basis, ownk, rate)
    r = V.ingredients(Wd.tab, C, bed, basis, b=b, bcells=bc)
    r.update(truth=math.log(t3), one=math.log(Wd.S["psf"][rest[0]]), n=len(pool_idx), k=k, b=b, nrest=len(rest), ncell=n_cell)
    return r
small = W2.test_cells(5, 9); rich = W2.test_cells(10)
ns = np.array([W2.tab.cells[k]["n12"] for k in small])
rowsB = {("small", k): [] for k in range(5)}; rowsB.update({("rich", k): [] for k in range(5)})
for key in small:
    own = W2.window_sales(key)
    for k in range(5):
        if len(own) - k < 2: continue
        rowsB[("small", k)].append(replicate(W2, key, own, k, max(k, 1) / len(own), len(own)))
for key in rich:
    own = W2.window_sales(key); n = len(own)
    for k in range(5):
        nn = int(rg.choice(ns))
        if nn - k < 2: continue
        sub = rg.permutation(own)[:nn]
        rowsB[("rich", k)].append(replicate(W2, key, sub, k, max(k, 1) / n, n))
rep("B small (5 to 9 sales), own", [r for k in range(1, 5) for r in rowsB[("small", k)]])
rep("B rich cut to 5 to 9, own", [r for k in range(1, 5) for r in rowsB[("rich", k)]])
rep("B small (5 to 9 sales), indirect", rowsB[("small", 0)])
rep("B rich cut to 5 to 9, indirect", rowsB[("rich", 0)])
thin = [k for k, c in W2.tab.cells.items() if 2 <= c["nRaw12"] <= 4 and k[1] <= 3]
nt = np.array([W2.tab.cells[k]["nRaw12"] for k in thin])
rowsC = {"thin": [], "rich": [], "thin0": [], "rich0": []}
for key in thin:
    own = W2.window_sales(key)
    rowsC["thin"].append(replicate(W2, key, own, len(own) - 1, 1.0, len(own)))
    rowsC["thin0"].append(replicate(W2, key, own, 0, 1.0, len(own)))
for key in rich:
    if key[1] > 3: continue
    own = W2.window_sales(key); n = len(own); nn = int(rg.choice(nt)); sub = rg.permutation(own)[:nn]
    rowsC["rich"].append(replicate(W2, key, sub, nn - 1, nn / n, n))
    rowsC["rich0"].append(replicate(W2, key, sub, 0, nn / n, n))
one = [k for k, c in W2.tab.cells.items() if c["nRaw12"] == 1 and k[1] <= 3]
rowsC["one0"] = [replicate(W2, key, W2.window_sales(key), 0, 1.0, 1) for key in one]
rep("C real thin (2 to 4), one sale held out as the target", single(rowsC["thin"]))
rep("C rich cut to 2 to 4, the same", single(rowsC["rich"]))
rep("C real one-sale, indirect, that sale as the target", single(rowsC["one0"]))
rep("C rich cut to 2 to 4, indirect, one sale as the target", single(rowsC["rich0"]))
print("B, C done", round(time.time() - t0, 1), flush=True)

# ---------- D ----------
H = 183
for T0 in (T - H, T - 365):
    tagd = (L.date.fromordinal(T0 + L.EPOCH)).isoformat()
    W0 = V.World(S, B, T0, SEED + 300)
    fut = (S["day"] > T0) & (S["day"] <= T0 + H)
    fkey = (S["b"][fut] * 8 + S["bed"][fut]) * 2 + S["basis"][fut]; fpsf = S["psf"][fut]
    o = np.argsort(fkey, kind="stable"); fkey = fkey[o]; fpsf = fpsf[o]; uk, st = np.unique(fkey, return_index=True); en = np.append(st[1:], len(fkey))
    real = {"own": [], "noown": [], "newbed": []}
    for k_, s_, e_ in zip(uk.tolist(), st.tolist(), en.tolist()):
        n_, m_ = L.pmed(fpsf[s_:e_]); key = (k_ // 16, (k_ // 2) % 8, k_ % 2)
        if n_ < 5 or key[1] > 3: continue
        b, bed, basis = key; c = W0.tab.cells.get(key)
        if b not in W0.tab.by_b: continue
        if c is None:
            if not any(kk[1] == basis for kk in W0.tab.by_b[b]): continue
            grp = "newbed"
        elif c["nRaw12"] >= 5: continue
        else: grp = "own" if c["n12"] >= 1 else "noown"
        r = V.ingredients(W0.tab, C, bed, basis, b=b); r.update(truth=math.log(m_), b=b, nfut=n_)
        real[grp].append(r)
    rep(f"D from {tagd}: real too-few, 1 to 4 own sales", real["own"])
    rep(f"D from {tagd}: real too-few, no sale in 12 months", real["noown"])
    rep(f"D from {tagd}: bedroom type not sold in 36 months", real["newbed"])
    rep(f"D from {tagd}: all real too-few", real["own"] + real["noown"] + real["newbed"])
print("D done", round(time.time() - t0, 1), flush=True)

# ---------- calls against the same-building rule ----------
dl = []
for kk in cells:
    ii = W.window_sales(kk); lp = np.log(S["psf"][ii]); dl.append(lp - np.median(lp))
dl = np.concatenate(dl); rgc = np.random.default_rng(SEED + 7)
res["calls"] = {}
for lab, sel in (("own", lambda r: r["k"] >= 1), ("indirect", lambda r: r["k"] == 0), ("all", lambda r: True)):
    rec = [(r, p) for r, p in ((r, V.apply(r, C)) for r in lbo3 if r["thin"] == 1 and sel(r) and r["bed"] <= C["maxBedrooms"]) if show2(r, p, C)[0]]
    t = np.array([r["truth"] for r, p in rec]); rlo = np.array([round(math.exp(p["low"]) / 10) * 10 for r, p in rec]); rhi = np.array([round(math.exp(p["high"]) / 10) * 10 for r, p in rec])
    d = rgc.choice(dl, size=(8, len(t))); ask = np.exp(t[None, :] + d)
    v = np.where(ask > rhi[None, :], 1, np.where(ask < rlo[None, :], -1, 0)); lb = np.where(d >= math.log(1.05), 1, np.where(d <= math.log(0.95), -1, 0))
    o = dict(n=len(rec), abovePct=round(float((v == 1).mean()) * 100, 1), withinPct=round(float((v == 0).mean()) * 100, 1), belowPct=round(float((v == -1).mean()) * 100, 1))
    for n_, x in (("below", -1), ("within", 0), ("above", 1)):
        o["says_" + n_] = {m_: round(float(((v == x) & (lb == y)).sum() / max((v == x).sum(), 1)) * 100, 1) for m_, y in (("sameBuildingBelowPct", -1), ("sameBuildingInLinePct", 0), ("sameBuildingAbovePct", 1))}
    res["calls"][lab] = o; print("calls", lab, json.dumps(o), flush=True)

out = os.path.join(L.WORK, "backtest-run.json")
json.dump(res, open(out, "w"), indent=1)
print("written", out, round(time.time() - t0, 1))
