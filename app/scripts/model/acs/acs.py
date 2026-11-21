"""Adjusted comparable sales (ACS): the comparison price of ONE listing from registered sales adjusted to it.

EXACT SPEC (the TypeScript reference acs/ref/acs.ts implements the per-request part from the same artifact).

Inputs of a request: building (index, or -1 with a scope: project family, community, DLD area), bedrooms, basis
(0 ready, 1 off-plan), size in sq ft, asking price per sq ft (optional). The data date T is the artifact's.

A. ARTIFACT (built once per data date T from kept flat sales with day <= T; class Ctx)
 A1 pool: kept sales with T-1095 < day <= T, then collapsed:
    (i) one-price batches (rule A): inside building x basis sort AED/sq ft ascending; a cluster is the run of values
        <= 1.001 x the run's lowest value; a cluster is a batch when it has 5+ rows, the rows are unlike units
        (more than one bedroom count, or max size > 1.05 x min size) and they fall on 3 or fewer distinct days.
        Each batch becomes one row per bedroom count: day = latest day, size = median size, psf = median psf, cnt = rows.
    (ii) exact duplicates (same building, day, bedrooms, basis, size, price) become one row, cnt = rows.
    Pool order: ascending original row order (batch rows take the position of their first row).
 A2 time index: tindex.Index(k=20, lam=50, 48 months) on all (uncollapsed) sales; theta[area x basis][m];
    month m of a sale = min(floor((T - day) / 30.4375), 47). Time adjustment (ln) = theta[0] - theta[m] of the SALE's
    own area and basis (Dubai x basis when the area x basis has no index).
 A3 segment slope seg[basis][min(bed,4)]: tindex.fit_slopes (within building x bedrooms x basis x half-year, 1095 days).
 A4 cell slope statistics: on the pool, x = ln size, y = ln psf as deviations from the mean of
    cell x floor((T - day) / 183); per cell sxx = sum x^2, sxy = sum x*y.
 A5 other-bedrooms fit per basis on the pool: ln psf = FE(building x half-year) + prem[min(bed,4)] + beta2 * ln size,
    one robust pass (drop |residual| >= 4 x 1.4826 x median |residual|), prem[0] = 0.

B. COMPARABLES (gather). L = ln(size of the listing); for a pool row c: lsr = L - ln size_c, age = (T - day_c) / 30.4375.
 ring 1: same building, bedrooms, basis.                          keep size_lo <= exp(lsr) <= size_hi
 ring 3: same project family (> 0), same bedrooms and basis, other building.      same size limits
 ring 2: same building and basis, other bedrooms, |min(bed_c,4) - min(bed,4)| <= 2. keep 0.4 <= exp(lsr) <= 2.5
 ring 4: same community (> 0), same bedrooms and basis, other building, other family (or family 0). same limits as ring 1
 In every ring keep the nmax latest rows (ties: pool order).

C. ADJUSTED VALUE of a comparable (ln AED per sq ft)
 a = ln psf_c + time_c + size_c
 ring 1: size_c = beta1 * lsr,  beta1 = clamp((sxy + lam * seg) / (sxx + lam), slope_lo, slope_hi) (seg when the cell has no statistics)
 rings 3, 4: size_c = seg * lsr
 ring 2: size_c = beta2 * lsr + prem[min(bed,4)] - prem[min(bed_c,4)]

D. WEIGHTS
 base: ring 1: 1; ring 3: r3; ring 4: r4; ring 2: r2 (x bed2 when two bedrooms apart)
       x 0.5 ** ((|lsr| / size_half) ** 2)        (rings 1, 3, 4 only)
 u = base x 0.5 ** (age / age_half)
 cap (rings 3 and 4, per other building): when one building's total u in the ring exceeds cap, scale its u by cap / total.
 community gate: when the rows of rings 1, 2, 3 together have a total u of gate4 - 1e-9 or more, ring 4 gets u = 0 (the community is
 a last resort; an estimate that leans on it is refused, see F).
 budget ("the best comparables first, until there is enough"): sort the rows by u, largest first (ties: gather order, which is
 ring 1, 3, 2, 4 and latest first inside a ring); prev_i = sum of u of the rows before row i;
 w_i = min(u_i, max(W0 - prev_i, 0)). Rows with w = 0 are dropped. W = sum of w (at most W0).

E. CENTRE = weighted median of a (function wq, p = 0.5): sort by a (ties: gather order); p_i = (cumsum(w)_i - w_i / 2) / sum(w);
 linear interpolation of a over p, flat outside [p_first, p_last]. The comparison price is exp(centre).

F. RANGE AND REFUSAL: see `decide` (constants in the artifact under "range").
"""
import json, math, os
import numpy as np
import lib as L, tindex as TI

MON = L.MON
# The tuned values (bt/tune.json "best"). Stage 4: the stale stage-2 defaults (W0 3, r3 0.6, r4 0.1, cap 1) are gone.
P0 = dict(nmax=150, size_lo=0.67, size_hi=1.5, age_half=8.0, size_half=0.2, W0=8.0, r3=0.3, r2=0.3, r4=0.03, bed2=0.3,
          lam=0.03, cap=0.5, slope_lo=-1.0, slope_hi=0.2, gate4=0.5)
ORDER = (1, 3, 2, 4)
EPS = 1e-9  # tolerance of the two threshold tests that capped weights can hit exactly (community gate, minimum weight)


def wq(v, w, p):
    """Weighted quantile, midpoint rule, linear interpolation (spec E). v, w: 1-d arrays, w > 0."""
    o = np.argsort(v, kind="stable"); v = v[o]; w = w[o]
    c = np.cumsum(w); pp = (c - 0.5 * w) / c[-1]
    n = len(v)
    if p <= pp[0]: return float(v[0])
    if p >= pp[n - 1]: return float(v[n - 1])
    j = int(np.searchsorted(pp, p, side="right"))  # first pp > p ; pp[j-1] <= p < pp[j]
    return float(v[j - 1] + (p - pp[j - 1]) / (pp[j] - pp[j - 1]) * (v[j] - v[j - 1]))


def collapse(day, b, bed, basis, size, price):
    """Spec A1. Returns arrays (day, b, bed, basis, size, psf, cnt) in pool order."""
    n = len(day); psf = price / size
    o = np.lexsort((psf, basis, b)); kb = (b[o] * 2 + basis[o]).tolist(); ps = psf[o].tolist()
    cid = np.zeros(n, np.int64); cur = -1; base = 0.0; kprev = None
    for i in range(n):
        if kb[i] != kprev or ps[i] > base * 1.001:
            cur += 1; base = ps[i]; kprev = kb[i]
        cid[i] = cur
    C = cur + 1; cl = np.empty(n, np.int64); cl[o] = cid
    cn = np.bincount(cl, minlength=C)
    smin = np.full(C, np.inf); smax = np.zeros(C); np.minimum.at(smin, cl, size); np.maximum.at(smax, cl, size)
    bmin = np.full(C, 99); bmax = np.full(C, -1); np.minimum.at(bmin, cl, bed); np.maximum.at(bmax, cl, bed)
    d0 = int(day.min()); ud = np.unique(cl * 100000 + (day - d0)); nd = np.bincount(ud // 100000, minlength=C)
    fA = (cn >= 5) & ((bmin != bmax) | (smax > smin * 1.05)) & (nd <= 3)
    inA = fA[cl]
    rows = []  # (first original position, day, b, bed, basis, size, psf, cnt)
    ia = np.where(inA)[0]
    if len(ia):
        key = cl[ia] * 8 + bed[ia]; oo = np.argsort(key, kind="stable"); ia = ia[oo]; key = key[oo]
        uk, st = np.unique(key, return_index=True); en = np.append(st[1:], len(key))
        for s, e in zip(st.tolist(), en.tolist()):
            r = ia[s:e]
            rows.append((int(r.min()), int(day[r].max()), int(b[r[0]]), int(bed[r[0]]), int(basis[r[0]]), float(np.median(size[r])), float(np.median(psf[r])), len(r)))
    ir = np.where(~inA)[0]
    k2 = np.stack([b[ir], day[ir], bed[ir], basis[ir], np.round(size[ir] * 100).astype(np.int64), np.round(price[ir]).astype(np.int64)], 1)
    _, first, cnt = np.unique(k2, axis=0, return_index=True, return_counts=True)
    for f, c in zip(first.tolist(), cnt.tolist()):
        i = int(ir[f]); rows.append((i, int(day[i]), int(b[i]), int(bed[i]), int(basis[i]), float(size[i]), float(psf[i]), c))
    rows.sort(key=lambda r: r[0])
    A = lambda j, t: np.array([r[j] for r in rows], t)
    return A(1, np.int64), A(2, np.int64), A(3, np.int64), A(4, np.int64), A(5, np.float64), A(6, np.float64), A(7, np.int64), int(inA.sum()), int(fA.sum())


class Ctx:
    """The artifact for one data date. Build from data (Ctx.build) or read from JSON (Ctx.load)."""

    @staticmethod
    def build(S, B, T, do_collapse=True, index=True):
        c = Ctx(); c.T = int(T)
        ii = np.where((S["day"] <= T) & (S["day"] > T - 1095))[0]
        if do_collapse:
            c.day, c.b, c.bed, c.basis, c.size, c.psf, c.cnt, c.nA, c.nAb = collapse(S["day"][ii], S["b"][ii], S["bed"][ii], S["basis"][ii], S["size"][ii], S["price"][ii])
        else:
            c.day, c.b, c.bed, c.basis, c.size, c.psf = S["day"][ii], S["b"][ii], S["bed"][ii], S["basis"][ii], S["size"][ii], S["psf"][ii]
            c.cnt = np.ones(len(ii), np.int64); c.nA = c.nAb = 0
        c.raw_rows = int(len(ii))
        c.B_area = B["area"]; c.B_master = B["master"]; c.B_fam = B["fam"]
        c.seg = TI.fit_slopes(S, T)
        if index:
            ix = TI.Index(S, B, T, slopes=c.seg, k=20, lam=50)
            c.tau = ix.tau.copy(); c.theta = {f"{a}|{s}": ix.theta(a, s) for (a, s) in ix.d}
        else:
            c.tau = np.zeros((2, 48)); c.theta = {}
        lp = np.log(c.psf); ls = np.log(c.size)
        # A4 cell slope statistics
        cell = (c.b * 8 + c.bed) * 2 + c.basis
        g, G = L.ids(cell, (T - c.day) // 183)
        xd = L.demean(ls, g, G); yd = L.demean(lp, g, G)
        uc, inv = np.unique(cell, return_inverse=True)
        sxx = np.bincount(inv, xd * xd); sxy = np.bincount(inv, xd * yd)
        keep = sxx > 1e-12
        c.cs_key = uc[keep]; c.cs_sxx = sxx[keep]; c.cs_sxy = sxy[keep]
        # A5 other-bedrooms fit
        c.beta2 = np.zeros(2); c.prem = np.zeros((2, 5)); hy = (T - c.day) // 183; bd = np.minimum(c.bed, 4)
        for s in (0, 1):
            m = c.basis == s; g, G = L.ids(c.b[m], hy[m])
            X = np.stack([ls[m]] + [(bd[m] == k).astype(float) for k in (1, 2, 3, 4)], 1)
            Xd = np.stack([L.demean(X[:, j], g, G) for j in range(5)], 1); yd = L.demean(lp[m], g, G)
            co = np.linalg.lstsq(Xd, yd, rcond=None)[0]; r = yd - Xd @ co; kp = np.abs(r) < 4 * 1.4826 * np.median(np.abs(r))
            co = np.linalg.lstsq(Xd[kp], yd[kp], rcond=None)[0]
            c.beta2[s] = co[0]; c.prem[s, 1:] = co[1:]
        c.range = None
        c._derive(); return c

    def _derive(c):
        T = c.T
        c.lp = np.log(c.psf); c.ls = np.log(c.size); c.age = (T - c.day) / MON
        mo = np.minimum(((T - c.day) / MON).astype(np.int64), 47)
        ar = c.B_area[c.b]; c.tadj = np.zeros(len(c.day))
        key = ar * 2 + c.basis
        for kk in np.unique(key):
            m = key == kk; a = int(kk) // 2; s = int(kk) % 2
            th = c.theta.get(f"{a}|{s}"); th = c.tau[s] if th is None else np.asarray(th)
            c.tadj[m] = th[0] - th[mo[m]]
        c.cs = {int(k): (float(a), float(b_)) for k, a, b_ in zip(c.cs_key, c.cs_sxx, c.cs_sxy)}
        n = len(c.day); pos = np.arange(n)
        def slices(key, mask=None):
            idx = pos if mask is None else pos[mask]; k = key if mask is None else key[mask]
            o = np.lexsort((idx, -c.day[idx], k)); idx = idx[o]; k = k[o]
            uk, st = np.unique(k, return_index=True); en = np.append(st[1:], len(k))
            return {int(u): idx[s:e] for u, s, e in zip(uk, st, en)}
        fam = c.B_fam[c.b]; mas = c.B_master[c.b]
        c.s1 = slices((c.b * 8 + c.bed) * 2 + c.basis)
        c.s2 = slices(c.b * 2 + c.basis)
        c.s3 = slices((fam * 8 + c.bed) * 2 + c.basis, fam > 0)
        c.s4 = slices((mas * 8 + c.bed) * 2 + c.basis, mas > 0)
        c.has_b = np.zeros(len(c.B_area), bool); c.has_b[c.b] = True

    def dump(c, path, names=None):
        o = dict(version=1, dataThrough=L.dstr(c.T), T=c.T, params=c.params, range=c.range,
                 pool=dict(day=c.day.tolist(), b=c.b.tolist(), bed=c.bed.tolist(), basis=c.basis.tolist(), size=c.size.tolist(), psf=c.psf.tolist(), cnt=c.cnt.tolist()),
                 buildings=dict(area=c.B_area.tolist(), master=c.B_master.tolist(), fam=c.B_fam.tolist()),
                 tau=c.tau.tolist(), theta={k: np.asarray(v).tolist() for k, v in c.theta.items()}, seg=c.seg.tolist(),
                 cellSlope=dict(key=c.cs_key.tolist(), sxx=c.cs_sxx.tolist(), sxy=c.cs_sxy.tolist()), beta2=c.beta2.tolist(), prem=c.prem.tolist())
        if names: o["names"] = names
        json.dump(o, open(path, "w", encoding="utf-8"))

    @staticmethod
    def load(path):
        o = json.load(open(path, encoding="utf-8")); c = Ctx(); c.T = o["T"]; c.params = o["params"]; c.range = o["range"]
        p = o["pool"]; I = lambda k: np.array(p[k], np.int64)
        c.day, c.b, c.bed, c.basis, c.cnt = I("day"), I("b"), I("bed"), I("basis"), I("cnt"); c.size = np.array(p["size"]); c.psf = np.array(p["psf"])
        bb = o["buildings"]; c.B_area = np.array(bb["area"], np.int64); c.B_master = np.array(bb["master"], np.int64); c.B_fam = np.array(bb["fam"], np.int64)
        c.tau = np.array(o["tau"]); c.theta = o["theta"]; c.seg = np.array(o["seg"])
        cs = o["cellSlope"]; c.cs_key = np.array(cs["key"], np.int64); c.cs_sxx = np.array(cs["sxx"]); c.cs_sxy = np.array(cs["sxy"])
        c.beta2 = np.array(o["beta2"]); c.prem = np.array(o["prem"]); c.names = o.get("names")
        c._derive(); return c


def gather(c, b, bed, basis, size, P, fam=None, master=None):
    """Spec B. Returns (ring array, pool row array, lsr array, info)."""
    Lz = math.log(size); known = b >= 0
    if known: fam = int(c.B_fam[b]); master = int(c.B_master[b])
    fam = fam or 0; master = master or 0
    bd = min(bed, 4); nmax = P["nmax"]; lo = math.log(P["size_lo"]); hi = math.log(P["size_hi"])
    rg = []; rw = []; info = dict(typ=float("nan"), last_own=float("inf"), n_own=0)
    if known:
        r = c.s1.get((b * 8 + bed) * 2 + basis)
        if r is not None:
            info["typ"] = float(np.median(c.size[r])); info["last_own"] = float(c.age[r[0]]); info["n_own"] = int(len(r))
            lsr = Lz - c.ls[r]; r = r[(lsr >= lo) & (lsr <= hi)][:nmax]
            rg.append(np.full(len(r), 1)); rw.append(r)
    if fam > 0:
        r = c.s3.get((fam * 8 + bed) * 2 + basis)
        if r is not None:
            lsr = Lz - c.ls[r]; r = r[(lsr >= lo) & (lsr <= hi) & (c.b[r] != b)][:nmax]
            rg.append(np.full(len(r), 3)); rw.append(r)
    if known:
        r = c.s2.get(b * 2 + basis)
        if r is not None:
            lsr = Lz - c.ls[r]; bc = c.bed[r]
            r = r[(bc != bed) & (np.abs(np.minimum(bc, 4) - bd) <= 2) & (lsr >= math.log(0.4)) & (lsr <= math.log(2.5))][:nmax]
            rg.append(np.full(len(r), 2)); rw.append(r)
    if master > 0:
        r = c.s4.get((master * 8 + bed) * 2 + basis)
        if r is not None:
            lsr = Lz - c.ls[r]; fc = c.B_fam[c.b[r]]
            r = r[(lsr >= lo) & (lsr <= hi) & (c.b[r] != b) & ((fc != fam) | (fam == 0))][:nmax]
            rg.append(np.full(len(r), 4)); rw.append(r)
    if not rg: return np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0), info
    ring = np.concatenate(rg); rows = np.concatenate(rw)
    return ring, rows, Lz - c.ls[rows], info


def combine(c, b, bed, basis, ring, rows, lsr, P, no_time=False, no_size=False, no_cross=False, equal=False, detail=False, no_size_all=False):
    """Spec C, D, E. Returns a dict of the centre and the evidence features (None when no comparable has weight)."""
    if no_cross:
        m = (ring == 1) | (ring == 2); ring = ring[m]; rows = rows[m]; lsr = lsr[m]
    if len(ring) == 0: return None
    bd = min(bed, 4); seg = float(c.seg[basis, bd]); beta1 = seg
    st = c.cs.get((b * 8 + bed) * 2 + basis) if b >= 0 else None
    if st is not None:
        beta1 = min(max((st[1] + P["lam"] * seg) / (st[0] + P["lam"]), P["slope_lo"]), P["slope_hi"])
    r1 = ring == 1; r2 = ring == 2; r3 = ring == 3; r4 = ring == 4
    bc = np.minimum(c.bed[rows], 4)
    sadj = np.where(r1, beta1 * lsr, np.where(r2, float(c.beta2[basis]) * lsr + (float(c.prem[basis, bd]) - c.prem[basis, bc]), seg * lsr))
    if no_size: sadj = np.where(r2, sadj, 0.0)  # ablation "no same-bedroom size slope": ring 2 keeps its size term
    if no_size_all: sadj = np.where(r2, float(c.prem[basis, bd]) - c.prem[basis, bc], 0.0)  # ablation "no size term at all": ring 2 keeps only the bedroom premium
    tadj = np.zeros(len(rows)) if no_time else c.tadj[rows]
    age = c.age[rows]; a = c.lp[rows] + tadj + sadj
    if equal:
        w = np.ones(len(rows))
    else:
        base = np.where(r1, 1.0, np.where(r3, P["r3"], np.where(r4, P["r4"], np.where(np.abs(bc - bd) >= 2, P["r2"] * P["bed2"], P["r2"]))))
        base = np.where(r2, base, base * 0.5 ** ((np.abs(lsr) / P["size_half"]) ** 2))
        u = base * 0.5 ** (age / P["age_half"])
        for rr in (r3, r4):
            if rr.any():
                bb = c.b[rows]
                for g in np.unique(bb[rr]).tolist():
                    m = rr & (bb == g); t = float(np.cumsum(u[m])[-1])
                    if t > P["cap"]: u = np.where(m, u * (P["cap"] / t), u)
        if r4.any() and (~r4).any() and float(np.cumsum(u[~r4])[-1]) >= P["gate4"] - EPS: u = np.where(r4, 0.0, u)
        o = np.argsort(-u, kind="stable"); us = u[o]; prev = np.concatenate([[0.0], np.cumsum(us)[:-1]])
        w = np.zeros(len(u)); w[o] = np.minimum(us, np.maximum(P["W0"] - prev, 0.0))
    k = w > 0
    if not k.any(): return None
    ring = ring[k]; rows = rows[k]; lsr = lsr[k]; w = w[k]; a = a[k]; age = age[k]; sadj = sadj[k]; tadj = tadj[k]
    W = float(np.cumsum(w)[-1]); centre = wq(a, w, 0.5)
    Wr = {r: (float(np.cumsum(w[ring == r])[-1]) if (ring == r).any() else 0.0) for r in ORDER}
    ns = ring != 2
    out = dict(centre=centre, n=int(len(w)), W=W, neff=W * W / float(np.cumsum(w * w)[-1]),
               disp=(wq(a, w, 0.75) - wq(a, w, 0.25)) / 1.349,
               W1=Wr[1], W2=Wr[2], W3=Wr[3], W4=Wr[4], n1=int((ring == 1).sum()), n2=int((ring == 2).sum()), n3=int((ring == 3).sum()), n4=int((ring == 4).sum()),
               age_w=float(np.cumsum(w * age)[-1]) / W,
               lsr_w=(float(np.cumsum((w * np.abs(lsr))[ns])[-1]) / float(np.cumsum(w[ns])[-1])) if ns.any() else float("nan"),
               age1=float(age[ring == 1].min()) if (ring == 1).any() else float("inf"), beta1=beta1,
               sadj_w=float(np.cumsum(w * np.abs(sadj))[-1]) / W, tadj_w=float(np.cumsum(w * np.abs(tadj))[-1]) / W)
    if detail:
        out["comps"] = [dict(row=int(rows[i]), ring=int(ring[i]), day=int(c.day[rows[i]]), b=int(c.b[rows[i]]), bed=int(c.bed[rows[i]]), size=float(c.size[rows[i]]), psf=float(c.psf[rows[i]]),
                             cnt=int(c.cnt[rows[i]]), ageMonths=float(age[i]), timeLn=float(tadj[i]), sizeLn=float(sadj[i]), adjustedPsf=float(math.exp(a[i])), weight=float(w[i])) for i in range(len(w))]
    return out


def ev_class(f, known=True):
    """Evidence class: 1 when ring 1 has at least half of the weight, else the ring with the largest weight
    (ties: order 1, 3, 2, 4). For a building that is not in the data: 5 (project siblings) instead of 3, 6 (community) instead of 4."""
    W = f["W"]
    if f["W1"] >= 0.5 * W: return 1
    best = max(ORDER, key=lambda r: (f["W%d" % r], -ORDER.index(r)))
    if not known: return 5 if best == 3 else 6
    return best


def ev_class_vec(W, W1, W2, W3, W4, known):
    """ev_class for arrays (the ONLY class function the backtest and the calibration use; cal.load_all calls it).
    known: bool array, False for a building that is not in the data."""
    best = np.full(len(W), 1, np.int64); bw = np.asarray(W1, float).copy()
    for r, x in ((3, W3), (2, W2), (4, W4)):  # ORDER after ring 1; strict > keeps the earlier ring on ties
        m = x > bw; best = np.where(m, r, best); bw = np.where(m, x, bw)
    cls = np.where(W1 >= 0.5 * W, 1, best)
    return np.where(known, cls, np.where(W1 >= 0.5 * W, 1, np.where(best == 3, 5, 6)))


def group_key(basis, f, R, known=True):
    """Mondrian group of the range (spec F): basis | evidence class | thin (W < thinW) | old (weighted mean age > oldAge months)
    | far (weighted mean |lsr| of rings 1, 3, 4 > farLsr)."""
    thin = 1 if f["W"] < R["thinW"] else 0
    old = 1 if f["age_w"] > R["oldAge"] else 0
    far = 1 if (f["lsr_w"] == f["lsr_w"] and f["lsr_w"] > R["farLsr"]) else 0
    return f"{basis}|{ev_class(f, known)}|{thin}|{old}|{far}"


def scale(f, R):
    """Normalising scale of the range: sqrt(floor^2 + dispersion^2 shrunk to the prior)."""
    d2 = (f["neff"] * f["disp"] ** 2 + R["k0"] * R["d0"] ** 2) / (f["neff"] + R["k0"])
    return math.sqrt(R["floor"] ** 2 + d2)


def decide(c, bed, basis, f, asking_psf=None, known=True, size=float("nan"), typ=float("nan")):
    """Spec F. c.range = dict(floor, d0, k0, thinW, oldAge, farLsr, q: {group or prefix: [qlo, qhi]}, minComps, minWeight,
    maxLsr, typLo, typHi, maxHalfWidth, maxBedrooms, refuseClasses, rounding).
      typ = the typical size: the median size of ALL pool rows of the listing's building x bedrooms x basis (none: no test).
      s = sqrt(floor^2 + (neff * disp^2 + k0 * d0^2) / (neff + k0)),  disp = (wq(.75) - wq(.25)) / 1.349, neff = W^2 / sum(w^2)
      group = basis|class|thin|old|far; multipliers [qlo, qhi] from the group, else from the key without its last part,
      and so on down to basis|class. Output `group` is the full key, `groupUsed` the key that supplied the multipliers.
      range (ln) = [centre - qlo * s, centre + qhi * s]; half-width = (exp(high) - exp(low)) / (2 exp(centre))
      refusal, first that applies: no comparable; bedrooms > maxBedrooms; class in refuseClasses; fewer than minComps
      comparables, or W < minWeight - 1e-9, or (building in the data) W < minWeightKnown - 1e-9 or no ring-1 comparable
      with weight (n1 < minOwn); weighted mean |lsr| of rings 1, 3, 4 > maxLsr, or size / typ outside [typLo, typHi];
      no multipliers; half-width > maxHalfWidth.
      shown range = each end rounded to `rounding`; above / below / within: the asking price rounded to whole AED per sq ft
      (halves up) against exactly that range."""
    R = c.range; out = dict(shown=False, reason=None)
    if f is None: out["reason"] = "no_comparables"; return out
    cls = ev_class(f, known); gk = group_key(basis, f, R, known); q = None; parts = gk.split("|"); used = None
    for cut in (5, 4, 3, 2):
        used = "|".join(parts[:cut]); q = R["q"].get(used)
        if q is not None: break
    s = scale(f, R)
    out.update(evidenceClass=cls, group=gk, groupUsed=used if q is not None else None, centrePsf=math.exp(f["centre"]))
    if q is not None:
        lo = f["centre"] - q[0] * s; hi = f["centre"] + q[1] * s; hw = (math.exp(hi) - math.exp(lo)) / (2 * math.exp(f["centre"]))
        out.update(lowPsf=math.exp(lo), highPsf=math.exp(hi), halfWidth=hw)
    if bed > R["maxBedrooms"]: out["reason"] = "bedrooms_not_validated"
    elif cls in R["refuseClasses"]: out["reason"] = "no_close_comparables"
    elif f["n"] < R["minComps"] or f["W"] < R["minWeight"] - EPS or (known and (f["W"] < R["minWeightKnown"] - EPS or f["n1"] < R["minOwn"])):
        out["reason"] = "too_few_comparables"
    elif (f["lsr_w"] == f["lsr_w"] and f["lsr_w"] > R["maxLsr"]) or (typ == typ and (size / typ < R["typLo"] or size / typ > R["typHi"])): out["reason"] = "size_too_far"
    elif q is None: out["reason"] = "no_calibration"
    elif hw > R["maxHalfWidth"]: out["reason"] = "range_too_wide"
    else:
        out["shown"] = True
        step = R["rounding"]; rlo = round(math.exp(lo) / step) * step; rhi = round(math.exp(hi) / step) * step
        out.update(rangeLowPsf=rlo, rangeHighPsf=rhi)
        # The asking price as the page prints it (whole AED per sq ft, halves up), so the outcome never contradicts the figures beside it.
        if asking_psf is not None:
            ask = math.floor(asking_psf + 0.5); out["verdict"] = "above" if ask > rhi else "below" if ask < rlo else "within"
    return out


def estimate(c, b, bed, basis, size, asking_psf=None, fam=None, master=None, P=None, **flags):
    """One request, full output (the sales used and each adjustment)."""
    P = P or c.params
    ring, rows, lsr, info = gather(c, b, bed, basis, size, P, fam, master)
    f = combine(c, b, bed, basis, ring, rows, lsr, P, detail=True, **flags)
    out = dict(features={k: v for k, v in f.items() if k != "comps"} if f else None, comps=f["comps"] if f else [], typicalSize=info["typ"], lastOwnMonths=info["last_own"])
    if c.range is not None: out.update(decide(c, bed, basis, f, asking_psf, b >= 0, size, info["typ"]))
    elif f: out["centrePsf"] = math.exp(f["centre"])
    return out
