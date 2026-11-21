"""Backtest library: the ingredients of one comparison per replicate, applying constants, refitting constants.
Used by backtest.py and refit.py."""
import math, json, copy
import numpy as np
import vlib as L

LEV = ("project", "community", "area"); NEED = {"project": 1, "community": 2, "area": 3}
BS = ("ready", "off_plan")

def level_refs(tab, C, b, area, master, proj, bed, basis, ex, exclude_proj=0):
    """Reference at every level separately: {level: (est, spread, nb, ns)}."""
    key = (area, master, proj, bed, basis, ex, exclude_proj)
    cache = tab.__dict__.setdefault("_lr", {})
    r = cache.get(key)
    if r is not None: return r
    out = {}
    cm = tab.comp.get((area, bed, basis))
    if cm is not None:
        cb, lm, ns = cm; B = tab.B; keep = cb != ex
        if exclude_proj: keep &= B["proj"][cb] != exclude_proj
        cb = cb[keep]; lm = lm[keep]; ns = ns[keep]
        for name in LEV:
            if name == "project":
                if not proj or exclude_proj: continue
                mk = B["proj"][cb] == proj
            elif name == "community":
                if not master: continue
                mk = B["master"][cb] == master
            else: mk = np.ones(len(cb), bool)
            if mk.sum() >= NEED[name]:
                x = lm[mk]
                sp = 0.0 if name == "project" else float((L.qlin(x, .9) - L.qlin(x, .1)) / C["spreadDivisor"])
                out[name] = (float(L.med_plain(x)), sp, int(mk.sum()), int(ns[mk].sum()))
    cache[key] = out
    return out

def first_level(refs):
    for name in LEV:
        if name in refs: return name
    return None

def ingredients(tab, C, bed, basis, b=None, bcells=None, scope=None, exclude_proj=0):
    B = tab.B
    if b is not None:
        area = int(B["area"][b]); master = int(B["master"][b]); proj = int(B["proj"][b]); ex = b
        if bcells is None: bcells = tab.by_b.get(b, {})
    else:
        area, master, proj = scope; ex = -1; bcells = bcells or {}
    refs = level_refs(tab, C, b, area, master, proj, bed, basis, ex, exclude_proj)
    row = dict(bed=bed, basis=basis, refs=refs, own=None, o1=None, o2=None, ob=None)
    c = bcells.get((bed, basis))
    if c:
        if 1 <= c["n12"] <= 4: row["own"] = (math.log(c["med12"]), c["n12"])
        if c["nOld1"] > 0: row["o1"] = (math.log(c["medOld1"]), c["nOld1"])
        if c["nOld2"] > 0: row["o2"] = (math.log(c["medOld2"]), c["nOld2"])
    fl = first_level(refs)
    if fl:
        sw = 0.0; swd = 0.0; n = 0
        for (j, bj), cj in bcells.items():
            if bj != basis or j == bed or cj["nRaw12"] < 1: continue
            rj = level_refs(tab, C, b, area, master, proj, j, basis, ex, exclude_proj); fj = first_level(rj)
            if not fj: continue
            w = cj["nRaw12"] / (cj["nRaw12"] + C["otherBedroomsWeightK"]); sw += w; swd += w * (math.log(cj["med12"]) - rj[fj][0]); n += cj["nRaw12"]
        if sw > 0: row["ob"] = (refs[fl][0] + swd / sw, n)
    return row

def apply(row, C, q=None, use=("own", "o1", "o2", "ob"), levels=LEV):
    bs = BS[row["basis"]]; EV = C["evidenceVariance"]; ests = []
    lev = None
    for name in levels:
        if name in row["refs"]: lev = name; break
    if lev:
        est, sp, nb, ns = row["refs"][lev]; a2, b2 = C["referenceVariance"][lev][bs]; ests.append((est, a2 + b2 * sp * sp))
    own = ind = False
    if row["own"] and "own" in use: ests.append((row["own"][0], EV["own"][bs][str(row["own"][1])])); own = True
    if row["o1"] and "o1" in use: ests.append((row["o1"][0], EV["older12to24"][bs][str(L.bucket(row["o1"][1]))])); ind = True
    if row["o2"] and "o2" in use: ests.append((row["o2"][0], EV["older24to36"][bs][str(L.bucket(row["o2"][1]))])); ind = True
    if row["ob"] and lev and "ob" in use and levels == LEV: ests.append((row["ob"][0], EV["otherBedrooms"][bs][str(L.bucket(row["ob"][1]))])); ind = True
    if not ests: return None
    den = sum(1 / v for _, v in ests); centre = sum(e / v for e, v in ests) / den; s = 1 / math.sqrt(den)
    cls = "own" if own else "indirect" if ind else lev
    fl, ql, qh = (q or C["range80"])[cls]; sp_ = math.sqrt(s * s + fl * fl)
    W = (ql + qh) / 2 * sp_
    shown = (row["bed"] <= C["maxBedrooms"]) and (cls not in C["neverShownClasses"]) and (W <= C["maxHalfWidth"])
    return dict(centre=centre, s=s, sp=sp_, low=centre - ql * sp_, high=centre + qh * sp_, W=W, cls=cls, level=lev, shown=shown, close=shown and W <= C["closeHalfWidth"])

def robvar(e):
    e = np.asarray(e, dtype=float)
    if len(e) < 15: return None
    q = np.quantile(e, [.25, .75]); return float(((q[1] - q[0]) / 1.349) ** 2)

def fit_variances(rows_ref, rows3, C0):
    """rows_ref: one row per test cell (truth = full median). rows3: S3 replicates (truth3). Returns a constants dict (variances only)."""
    C = copy.deepcopy(C0)
    for lev in LEV:
        for bi, bs in enumerate(BS):
            rr = [r for r in rows_ref if r["basis"] == bi and lev in r["refs"]]
            e = np.array([r["truth"] - r["refs"][lev][0] for r in rr]); x = np.array([r["refs"][lev][1] ** 2 for r in rr])
            if lev == "project" or len(rr) < 60:
                v = robvar(e)
                if v is not None: C["referenceVariance"][lev][bs] = [v, 0.0]
                continue
            qs = np.quantile(x, np.linspace(0, 1, 7)); xb = []; vb = []
            for i in range(6):
                m = (x >= qs[i]) & ((x < qs[i + 1]) if i < 5 else (x <= qs[i + 1]))
                if m.sum() >= 15: xb.append(x[m].mean()); vb.append(robvar(e[m]))
            xb = np.array(xb); vb = np.array(vb)
            b2 = max(0.0, float(((xb - xb.mean()) * (vb - vb.mean())).sum() / max(((xb - xb.mean()) ** 2).sum(), 1e-12))); a2 = float(vb.mean() - b2 * xb.mean())
            if a2 < 0: a2 = 0.0; b2 = float((xb * vb).sum() / (xb * xb).sum())
            C["referenceVariance"][lev][bs] = [a2, b2]
    for src, name, nb in (("own", "own", 4), ("o1", "older12to24", 6), ("o2", "older24to36", 6), ("ob", "otherBedrooms", 6)):
        for bi, bs in enumerate(BS):
            prev = None; tabv = {}
            for k in range(1, nb + 1):
                e = [r[src][0] - r["truth"] for r in rows3 if r["basis"] == bi and r[src] and (r[src][1] if src == "own" else L.bucket(r[src][1])) == k]
                v = robvar(e)
                if v is None: v = prev
                if v is not None and prev is not None: v = min(v, prev)
                if v is not None: tabv[str(k)] = v; prev = v
            for k in range(1, nb + 1):
                if str(k) not in tabv: tabv[str(k)] = C["evidenceVariance"][name][bs][str(k)]
            C["evidenceVariance"][name][bs] = tabv
    return C

def conformal(z, nom=0.80):
    z = np.sort(np.asarray(z)); n = len(z); a = (1 - nom) / 2
    lo = -float(np.quantile(z, max(0.0, a - (1 - a) / n), method="lower")); hi = float(np.quantile(z, min(1.0, (1 - a) * (1 + 1 / n)), method="higher"))
    return lo, hi

def fit_q(preds, C, nom=0.80):
    """preds: list of (class, err = truth - centre, s). Floors kept from C (hyper-parameters)."""
    Q = {}
    for cls in ("project", "community", "area", "own", "indirect"):
        fl = C["range80"][cls][0]
        z = [e / math.sqrt(s * s + fl * fl) for c, e, s in preds if c == cls]
        if len(z) >= 50:
            lo, hi = conformal(z, nom); Q[cls] = [fl, lo, hi]
        else: Q[cls] = list(C["range80"][cls])
    return Q

def metrics(err):
    """err = truth - centre in logs. Percent errors of the centre against the truth."""
    e = np.exp(-np.asarray(err)) - 1; ae = np.abs(e)
    if len(e) == 0: return dict(n=0)
    return dict(n=len(e), mdape=round(float(np.median(ae)) * 100, 2), p80=round(float(np.quantile(ae, .8)) * 100, 2), p90=round(float(np.quantile(ae, .9)) * 100, 2), bias=round(float(np.median(e)) * 100, 2))

def coverage(recs):
    """recs: list of (truth, pred dict)."""
    if not recs: return dict(n=0)
    t = np.array([r[0] for r in recs]); lo = np.array([r[1]["low"] for r in recs]); hi = np.array([r[1]["high"] for r in recs])
    return dict(n=len(recs), cover=round(float(((t >= lo) & (t <= hi)).mean()) * 100, 1), truth_below=round(float((t < lo).mean()) * 100, 1), truth_above=round(float((t > hi).mean()) * 100, 1),
                range=f"{(math.exp(-float(np.median(np.array([r[1]['centre'] for r in recs]) - lo))) - 1) * 100:+.1f}% to {(math.exp(float(np.median(hi - np.array([r[1]['centre'] for r in recs])))) - 1) * 100:+.1f}%")

class World:
    def __init__(self, S, B, T, seed):
        self.S = S; self.B = B; self.T = T; self.tab = L.Table(S, B, T)
        m = (S["day"] <= T) & (S["day"] >= T - 1095); idx = np.where(m)[0]
        o = np.argsort(S["b"][idx], kind="stable"); idx = idx[o]; bb = S["b"][idx]
        ub, st = np.unique(bb, return_index=True); en = np.append(st[1:], len(bb))
        self.bsales = {int(u): idx[s:e] for u, s, e in zip(ub, st, en)}
        self.rng = np.random.default_rng(seed)
        # folds over project groups (own seed)
        NB = len(B["key"]); grp = np.where(B["proj"] > 0, B["proj"], 10 ** 6 + np.arange(NB))
        ug = np.unique(grp); gf = dict(zip(ug.tolist(), np.random.default_rng(seed + 1).integers(0, 5, len(ug)).tolist()))
        self.fold = np.array([gf[g] for g in grp.tolist()])

    def thinned_cells(self, b, bed, basis, own_idx, rate, rest_window_hidden=True):
        """The building's cells with the target cell's window sales replaced by own_idx, and every other same-basis sale kept with probability `rate`."""
        S = self.S; T = self.T; sb = self.bsales[b]; sb = sb[S["basis"][sb] == basis]
        inW = S["day"][sb] >= T - 365; target = (S["bed"][sb] == bed) & inW
        oth = sb[~target]
        if rate < 1.0: oth = oth[self.rng.random(len(oth)) < rate]
        use = np.concatenate([oth, np.asarray(own_idx, dtype=np.int64)])
        out = {}
        for j in np.unique(S["bed"][use]):
            ii = use[S["bed"][use] == j]; out[(int(j), basis)] = L.cell_from_sales(S["psf"][ii], S["day"][ii], T)
        return out

    def test_cells(self, nmin=10, nmax=10 ** 9):
        return [k for k, c in self.tab.cells.items() if nmin <= c["n12"] <= nmax]

    def window_sales(self, key):
        ii = self.tab.sales_idx[key]; return ii[self.S["day"][ii] >= self.T - 365]

    def collect(self, C, cells, thin_modes=(1, 0), ks=(0, 1, 2, 3, 4), lpo=False, sub_n=None):
        """rows_ref (one per cell) and rows3 (replicates). sub_n: callable giving a target n to subsample the cell to first (matched-thinness tests)."""
        S = self.S; rows_ref = []; rows3 = []
        for key in cells:
            b, bed, basis = key; own = self.window_sales(key)
            _, tr = L.pmed(S["psf"][own]); n = len(own)
            exp = int(self.B["proj"][b]) if lpo else 0
            r = ingredients(self.tab, C, bed, basis, b=b, bcells={}, exclude_proj=exp)
            r.update(truth=math.log(tr), n=n, b=b, fold=int(self.fold[b]), k=-1, thin=-1)
            rows_ref.append(r)
            for thin in thin_modes:
                for k in ks:
                    perm = self.rng.permutation(own); nn = n
                    if sub_n is not None:
                        nn = sub_n(); perm = perm[:nn]
                    if nn - k < 1: continue
                    ownk = perm[:k]; rest = perm[k:]
                    _, t3 = L.pmed(S["psf"][rest])
                    rate = max(k, 1) / nn if thin else 1.0
                    if sub_n is not None and thin: rate = max(k, 1) / n
                    bc = self.thinned_cells(b, bed, basis, ownk, rate)
                    r3 = ingredients(self.tab, C, bed, basis, b=b, bcells=bc, exclude_proj=exp)
                    r3.update(truth=math.log(t3), n=nn, b=b, fold=int(self.fold[b]), k=k, thin=thin, nrest=len(rest), one=math.log(S["psf"][rest[0]]))
                    rows3.append(r3)
        return rows_ref, rows3

def crossfit(rows_ref, rows3, C0, nom=0.80):
    """Cross-fitted predictions with own folds: variances and multipliers from the other four folds. Returns list of (row, pred) for rows3 and the all-fold constants."""
    preds = {}
    cf = {}
    for f in range(5):
        Cf = fit_variances([r for r in rows_ref if r["fold"] != f], [r for r in rows3 if r["fold"] != f], C0); cf[f] = Cf
    # cross-fitted centre and s for every row, then multipliers from the other folds
    base3 = [(r, apply(r, cf[r["fold"]])) for r in rows3]
    baseA = [(r, apply(r, cf[r["fold"]], levels=("area",))) for r in rows_ref]
    baseF = [(r, apply(r, cf[r["fold"]])) for r in rows_ref]
    pool = [(p["cls"], r["truth"] - p["centre"], p["s"], r["fold"]) for r, p in base3 + baseA + baseF if p]
    out3 = []
    Qf = {f: fit_q([(c, e, s) for c, e, s, ff in pool if ff != f], C0, nom) for f in range(5)}
    for r, p in base3:
        if p is None: out3.append((r, None)); continue
        out3.append((r, apply(r, cf[r["fold"]], q=Qf[r["fold"]])))
    Call = fit_variances(rows_ref, rows3, C0)
    poolall = []
    for r in rows3:
        p = apply(r, Call)
        if p: poolall.append((p["cls"], r["truth"] - p["centre"], p["s"]))
    for r in rows_ref:
        for lv in (("area",), LEV):
            p = apply(r, Call, levels=lv)
            if p: poolall.append((p["cls"], r["truth"] - p["centre"], p["s"]))
    Call["range80_fit"] = fit_q(poolall, C0, nom)
    return out3, Call, baseA, baseF

def report(recs, label, out=None):
    """recs: list of (row, pred)."""
    ok = [(r, p) for r, p in recs if p]
    m = metrics([r["truth"] - p["centre"] for r, p in ok]); c = coverage([(r["truth"], p) for r, p in ok])
    sh = [(r, p) for r, p in ok if p["shown"]]
    cs = coverage([(r["truth"], p) for r, p in sh]); ms = metrics([r["truth"] - p["centre"] for r, p in sh])
    line = f"{label:58s} n={len(recs):6d} MdAPE={m.get('mdape')} P80={m.get('p80')} P90={m.get('p90')} bias={m.get('bias')} | cover={c.get('cover')} (truth below {c.get('truth_below')}, above {c.get('truth_above')}) range {c.get('range')} | shown {round(100 * len(sh) / max(len(recs), 1), 1)}% shown: MdAPE={ms.get('mdape')} P80={ms.get('p80')} cover={cs.get('cover')}"
    print(line, flush=True)
    if out is not None: out[label] = dict(n=len(recs), **{k: v for k, v in m.items() if k != "n"}, cover=c.get("cover"), truth_below=c.get("truth_below"), truth_above=c.get("truth_above"), range=c.get("range"), shown=round(100 * len(sh) / max(len(recs), 1), 1), shown_mdape=ms.get("mdape"), shown_p80=ms.get("p80"), shown_cover=cs.get("cover"))
