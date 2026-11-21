"""Nearby registered sales: the last-resort comparison for a listing whose own building gives no usable evidence.
Backtest library (numpy only). Reads the ACS work folder (ACS_WORK or .data/model/acs: data.npz, bt/ctx_<cut>.pkl) and
writes to .data/model/nearby (or NEARBY_WORK).

The method (see SPEC.md in this folder for the exact arithmetic):
  comparables = registered sales of OTHER buildings, same bedrooms and basis, in the listing's community (master project)
  and/or DLD area, in the `win` days to the data date; each moved to the data date with the ACS time index of its own
  area x basis and to the listing's size with the ACS segment size slope; weight = level x size closeness x recency
  [x vintage closeness], then each building's total weight is capped; centre = weighted median; the range comes from the
  weighted 10% and 90% points of the same adjusted values, stretched by fitted multipliers.
"""
import os, sys, math, pickle
import numpy as np

CODE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(CODE)))
sys.path.insert(0, os.path.join(REPO, "scripts", "model", "acs"))
import lib as L  # noqa: E402  (ACS helpers: paths, dates, load)

OUT = os.environ.get("NEARBY_WORK") or os.path.join(REPO, ".data", "model", "nearby")
os.makedirs(OUT, exist_ok=True)
MON = L.MON
CUTS = L.CUTS
QS = (0.1, 0.25, 0.5, 0.75, 0.9)

# Default parameters (the tuned values are written by tune.py into constants.json; these are the starting point).
P0 = dict(win=730, age_half=6.0, size_half=0.25, cap=1.0, r_area=0.3, r_proj=1.0, vint_half=0.0, time=1, size=1)


def wq_rows(v, u, ps=QS):
    """Weighted quantiles (ACS spec E: midpoint rule, linear interpolation, flat outside), for K weight rows at once.
    v: (n,) ascending. u: (K, n) weights >= 0 with at least one > 0 per row. Returns (K, len(ps))."""
    c = np.cumsum(u, axis=1); W = c[:, -1:]
    pp = (c - 0.5 * u) / W
    K, n = u.shape; out = np.empty((K, len(ps)))
    ar = np.arange(K)
    for j, p in enumerate(ps):
        gt = pp > p
        idx = gt.argmax(axis=1)  # first pp > p
        none = ~gt.any(axis=1)   # p >= every pp -> last value
        first = (idx == 0) & ~none  # p < pp[0] -> first value
        i1 = np.where(none, n - 1, idx); i0 = np.maximum(i1 - 1, 0)
        p0 = pp[ar, i0]; p1 = pp[ar, i1]; d = np.where(p1 > p0, p1 - p0, 1.0)
        val = v[i0] + (p - p0) / d * (v[i1] - v[i0])
        val = np.where(none, v[n - 1], np.where(first, v[0], val))
        out[:, j] = val
    return out


class Cut:
    """Everything known at one cutoff T: the pool of sales in (T - 1095, T], time adjustments, lookups."""

    def __init__(self, cut, S, B, win=1095):
        self.cut = cut; self.T = T = L.dnum(cut)
        c = pickle.load(open(os.path.join(L.HERE, "bt", f"ctx_{cut}.pkl"), "rb"))
        self.seg = np.asarray(c.seg); self.tau = np.asarray(c.tau); self.theta = {k: np.asarray(v) for k, v in c.theta.items()}
        del c
        ii = np.where((S["day"] <= T) & (S["day"] > T - win))[0]
        self.ii = ii
        self.b = S["b"][ii]; self.bed = S["bed"][ii]; self.basis = S["basis"][ii]; self.lp = S["lp"][ii]; self.ls = S["ls"][ii]
        self.day = S["day"][ii]; self.age = (T - self.day) / MON
        self.area = B["area"][self.b]; self.master = B["master"][self.b]; self.proj = B["proj"][self.b]; self.fam = B["fam"][self.b]
        mo = np.minimum(((T - self.day) / MON).astype(np.int64), 47)
        self.tadj = np.zeros(len(ii)); key = self.area * 2 + self.basis
        for kk in np.unique(key):
            m = key == kk; a = int(kk) // 2; s = int(kk) % 2
            th = self.theta.get(f"{a}|{s}"); th = self.tau[s] if th is None else th
            self.tadj[m] = th[0] - th[mo[m]]
        # building facts as known at T
        NB = len(B["area"])
        self.known = np.zeros(NB, bool); self.known[self.b] = True  # any kept sale in the 36 months to T
        f = B["first"].astype(np.float64); fr = B["firstr"].astype(np.float64)
        self.vint = np.where(f <= T, (T - f) / 365.25, np.nan)      # years since the first sale (launch)
        self.rvint = np.where(fr <= T, (T - fr) / 365.25, np.nan)   # years since the first ready sale (handover); nan = none yet
        # lookups: rows by (area, bed, basis) and by (master > 0, bed, basis)
        self.by_area = self._slices((self.area * 8 + self.bed) * 2 + self.basis)
        self.by_master = self._slices((self.master * 8 + self.bed) * 2 + self.basis, self.master > 0)
        # 12-month own counts per cell (to tell thin cells)
        m12 = self.day > T - 365
        cell = (self.b * 8 + self.bed) * 2 + self.basis
        u, cnt = np.unique(cell[m12], return_counts=True); self.n12 = dict(zip(u.tolist(), cnt.tolist()))
        u, med = _group_median(cell, self.ls); self.typ_ls = dict(zip(u.tolist(), med.tolist()))

    def _slices(self, key, mask=None):
        pos = np.arange(len(key)); idx = pos if mask is None else pos[mask]; k = key[idx]
        o = np.argsort(k, kind="stable"); idx = idx[o]; k = k[o]
        uk, st = np.unique(k, return_index=True); en = np.append(st[1:], len(k))
        return {int(u): idx[s:e] for u, s, e in zip(uk, st, en)}

    def rows(self, area, master, bed, basis, mode="both"):
        ra = self.by_area.get((area * 8 + bed) * 2 + basis) if (area >= 0 and mode in ("both", "area")) else None
        rm = self.by_master.get((master * 8 + bed) * 2 + basis) if (master > 0 and mode in ("both", "comm")) else None
        if ra is None and rm is None: return np.zeros(0, np.int64)
        if ra is None: return rm
        if rm is None: return ra
        return np.union1d(ra, rm)


RB = (0.0, 0.5, 1.0, 2.0, 4.0, 8.0, 12.0)   # ready: years since the first ready sale (handover), lower bin edges
RK = (0.25, 0.75, 1.5, 3.0, 6.0, 10.0, 15.0)  # the age each bin's value is placed at (linear between, flat outside)
OB = (0.0, 0.25, 0.5, 1.0, 2.0, 3.0)        # off-plan: years since the first sale (launch)
OK_ = (0.125, 0.375, 0.75, 1.5, 2.5, 4.0)


def fit_vintage(C, win=730):
    """The vintage curve g[basis](age): how far a building's level sits from the buildings of its community and bedroom
    type, by age. Pool sales of the `win` days to T; y = ln psf + time adjustment - seg * ln size; fixed effect =
    (community, else DLD area) x bedrooms x basis x ... ; every building x bedrooms cell has total weight 1.
    Returns dict(ready=[values at RK], offplan=[values at OK_], vref=median handover age of ready cells), last bin = 0."""
    out = {}
    m0 = C.age * MON < win
    for basis, edges, name in ((0, RB, "ready"), (1, OB, "offplan")):
        r = np.where(m0 & (C.basis == basis))[0]
        age = (C.rvint if basis == 0 else C.vint)[C.b[r]]; age = np.nan_to_num(age, nan=0.0)
        seg = C.seg[basis, np.minimum(C.bed[r], 4)]
        y = C.lp[r] + C.tadj[r] - seg * C.ls[r]
        scope = np.where(C.master[r] > 0, C.master[r], 100000 + C.area[r])
        g, G = L.ids(scope, C.bed[r]); cell, NC = L.ids(C.b[r], C.bed[r])
        w = 1.0 / np.bincount(cell, minlength=NC)[cell]
        bn = np.searchsorted(np.asarray(edges), age, side="right") - 1; nbins = len(edges)
        # size enters through seg already; add ln size demeaned inside the group so that groups of unlike sizes do not bias g
        X = np.stack([(bn == k).astype(float) for k in range(nbins - 1)], 1)
        Xd = np.stack([L.demean(X[:, j], g, G, w) for j in range(nbins - 1)], 1); yd = L.demean(y, g, G, w)
        sw = np.sqrt(w); co = np.linalg.lstsq(Xd * sw[:, None], yd * sw, rcond=None)[0]
        res = yd - Xd @ co; kp = np.abs(res) < 4 * 1.4826 * np.median(np.abs(res))
        co = np.linalg.lstsq((Xd * sw[:, None])[kp], (yd * sw)[kp], rcond=None)[0]
        out[name] = [float(x) for x in co] + [0.0]
        if basis == 0:
            ub, fi = np.unique(cell, return_index=True); out["vref"] = float(np.median(age[fi]))
    return out


def g_of(G, basis, age):
    """Vintage curve value(s) at age (years); nan age = 0 (not handed over / launched yet)."""
    age = np.nan_to_num(np.asarray(age, float), nan=0.0)
    return np.interp(age, RK if basis == 0 else OK_, G["ready" if basis == 0 else "offplan"])


def _group_median(key, v):
    o = np.lexsort((v, key)); k = key[o]; v = v[o]
    uk, st, cnt = np.unique(k, return_index=True, return_counts=True)
    lo = v[st + (cnt - 1) // 2]; hi = v[st + cnt // 2]
    return uk, 0.5 * (lo + hi)


def estimate(C, rows, bed, basis, Ls, P, master=0, proj=0, tv=None, trv=None):
    """The method for one comparable set and K listing sizes (Ls = ln size, shape (K,)).
    rows: pool rows already restricted (same bedrooms and basis, other buildings, scope).
    tv / trv: the listing building's vintage in years before T (launch / handover) when known, else None.
    Returns dict of arrays (K,) or None when there is no comparable."""
    if len(rows) == 0: return None
    win = P["win"]
    if win < 1095: rows = rows[C.age[rows] * MON < win]
    if len(rows) == 0: return None
    seg = float(C.seg[basis, min(bed, 4)]) if P["size"] else 0.0
    cval = C.lp[rows] + (C.tadj[rows] if P["time"] else 0.0) - seg * C.ls[rows]
    if P.get("vadj") and getattr(C, "G", None) is not None:
        # vintage adjustment: every comparable is moved to the listing building's age (gt = curve value at that age)
        ages = (C.rvint if basis == 0 else C.vint)[C.b[rows]]
        cval = cval + (P["gt"] - g_of(C.G, basis, ages))
    o = np.argsort(cval, kind="stable"); rows = rows[o]; cval = cval[o]
    lw = np.ones(len(rows))
    if master > 0: lw = np.where(C.master[rows] == master, 1.0, P["r_area"])
    if proj > 0 and P["r_proj"] != 1.0: lw = np.where(C.proj[rows] == proj, P["r_proj"], lw)
    base = lw * 0.5 ** (C.age[rows] / P["age_half"])
    vh = P.get("vint_half", 0.0)
    if vh > 0:
        if basis == 1 and tv is not None:
            base = base * 0.5 ** (np.abs(np.nan_to_num(C.vint[C.b[rows]], nan=50.0) - tv) / vh)
        elif basis == 0 and trv is not None:
            base = base * 0.5 ** (np.abs(np.nan_to_num(C.rvint[C.b[rows]], nan=0.0) - trv) / vh)
    keep = base > 0
    if not keep.all(): rows = rows[keep]; cval = cval[keep]; base = base[keep]; lw = lw[keep]
    if len(rows) == 0: return None
    ls = C.ls[rows]; gb, g = np.unique(C.b[rows], return_inverse=True); G = len(gb)
    Ls = np.asarray(Ls, float); K = len(Ls)
    lsr = Ls[:, None] - ls[None, :]
    u = base[None, :] * 0.5 ** ((lsr / P["size_half"]) ** 2)
    cap = P["cap"]; Wb = np.empty((K, G))
    for k in range(K):
        tot = np.bincount(g, u[k], minlength=G)
        sc = np.where(tot > cap, cap / np.maximum(tot, 1e-300), 1.0)
        u[k] *= sc[g]; Wb[k] = np.minimum(tot, cap)
    W = Wb.sum(1)
    ok = W > 0
    if not ok.all(): u[~ok] = 1.0  # placeholder; marked invalid below
    qv = wq_rows(cval, u) + (seg * Ls)[:, None]
    nb_eff = W * W / np.maximum((Wb * Wb).sum(1), 1e-300)
    nb = (Wb >= 0.05 * cap).sum(1)          # buildings that count: at least 5% of the cap
    nsale = (u >= 0.05).sum(1)              # sales with real weight
    out = dict(centre=qv[:, 2], q10=qv[:, 0], q25=qv[:, 1], q75=qv[:, 3], q90=qv[:, 4], W=W, nb=nb, nb_eff=nb_eff, nsale=nsale,
               n=np.full(K, len(rows)), lsr_w=(u * np.abs(lsr)).sum(1) / np.maximum(u.sum(1), 1e-300),
               age_w=(u * C.age[rows][None, :]).sum(1) / np.maximum(u.sum(1), 1e-300),
               comm_w=((u * (lw == 1.0)[None, :]).sum(1) / np.maximum(u.sum(1), 1e-300)) if master > 0 else np.zeros(K))
    for k_ in out: out[k_] = np.where(ok, out[k_], np.nan)
    return out


def targets(C, S, B, K=8, seed=1):
    """Target cells of a cutoff: building x bedrooms x basis with sales in (T, T+183]. Per cell up to K sampled sales
    plus the cell median. Returns a list of dicts."""
    T = C.T
    tt = np.where((S["day"] > T) & (S["day"] <= T + L.HZ))[0]
    cell = (S["b"][tt] * 8 + S["bed"][tt]) * 2 + S["basis"][tt]
    o = np.argsort(cell, kind="stable"); tt = tt[o]; cell = cell[o]
    uk, st = np.unique(cell, return_index=True); en = np.append(st[1:], len(cell))
    rng = np.random.default_rng(20261119 + T + seed)
    out = []
    for u, s, e in zip(uk.tolist(), st.tolist(), en.tolist()):
        r = tt[s:e]; b = int(S["b"][r[0]]); bed = int(S["bed"][r[0]]); basis = int(S["basis"][r[0]])
        pick = r if len(r) <= K else rng.choice(r, K, replace=False)
        out.append(dict(b=b, bed=bed, basis=basis, cell=u, n_t=len(r), ls=S["ls"][pick], lp=S["lp"][pick], dt=S["day"][pick] - T, med_dt=float(np.median(S["day"][r])) - T,
                        med_ls=float(np.median(S["ls"][r])), med_lp=float(np.median(S["lp"][r])),
                        known=bool(C.known[b]), n12=C.n12.get(u, 0), typ_ls=C.typ_ls.get(u, float("nan")),
                        area=int(B["area"][b]), master=int(B["master"][b]), proj=int(B["proj"][b]), fam=int(B["fam"][b])))
    return out


def comp_rows(C, t, hide="building", mode="both"):
    """Pool rows usable for target cell t. hide: 'building' (its own sales) or 'project' (also every building of the same
    project number or project family)."""
    r = C.rows(t["area"], t["master"], t["bed"], t["basis"], mode)
    if len(r) == 0: return r
    m = C.b[r] != t["b"]
    if hide == "project":
        if t["fam"] > 0: m &= C.fam[r] != t["fam"]
        if t["proj"] > 0: m &= C.proj[r] != t["proj"]
    return r[m]


def pct(x):
    return 100 * (math.exp(x) - 1)


def stats(e):
    """e = truth - prediction (ln). n, median |e| %, p80, p90, signed median %."""
    e = np.asarray(e, float); e = e[np.isfinite(e)]
    if len(e) == 0: return dict(n=0, med=None, p80=None, p90=None, bias=None)
    a = np.abs(e)
    return dict(n=int(len(e)), med=round(pct(np.median(a)), 1), p80=round(pct(np.quantile(a, .8)), 1), p90=round(pct(np.quantile(a, .9)), 1),
                bias=round(pct(np.median(e)), 1))
