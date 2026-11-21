"""Range calibration for ACS: normalised split conformal with Mondrian groups, forward in time.
For a cutoff T the multipliers come only from targets of EARLIER cutoffs whose sale day is <= T.
Group = basis | evidence class | thin | old | far (acs.group_key). Scale = acs.scale.
Drift guard ("worst window"): per group and side, the largest of the per-calibration-cutoff quantiles (cutoffs with 150+ rows)
and the pooled quantile."""
import os, math, json
import numpy as np
import lib as L, bt, acs as A

CUTS = bt.CUTS6
RC0 = dict(floor=0.05, d0=0.07, k0=3.0, thinW=4.0, oldAge=12.0, farLsr=math.log(1.15), minGroup=300, minWindow=150)


def load_all():
    R = []
    for ci, cut in enumerate(CUTS):
        z = np.load(os.path.join(bt.OUT, f"res_{cut}.npz")); d = {k: z[k] for k in z.files if z[k].ndim == 1}
        d["cut"] = np.full(len(d["ti"]), ci); d["wt"] = np.where(d["scen"] == 0, float(z["nA_all"]) / max((d["scen"] == 0).sum(), 1), 1.0); R.append(d)
    D = {k: np.concatenate([r[k] for r in R]) for k in R[0]}
    D["T"] = np.array([L.dnum(c) for c in CUTS])
    W = D["main_W"]; W1, W2, W3, W4 = D["main_W1"], D["main_W2"], D["main_W3"], D["main_W4"]
    # Stage 4 fix: the one class function of the method (acs.ev_class). The stage-2 code here chose among rings 3, 2, 4 only.
    D["cls"] = A.ev_class_vec(W, W1, W2, W3, W4, D["scen"] != 2)
    D["e"] = D["truth"] - D["main_centre"]; D["ok"] = np.isfinite(D["e"])
    return D


def feats(D, RC):
    thin = (D["main_W"] < RC["thinW"]).astype(np.int64); far = (np.nan_to_num(D["main_lsr_w"], nan=0.0) > RC["farLsr"]).astype(np.int64)
    old = (np.nan_to_num(D["main_age_w"], nan=0.0) > RC["oldAge"]).astype(np.int64)
    g = (((D["basis"].astype(np.int64) * 7 + D["cls"]) * 2 + thin) * 2 + old) * 2 + far
    d2 = (D["main_neff"] * D["main_disp"] ** 2 + RC["k0"] * RC["d0"] ** 2) / (D["main_neff"] + RC["k0"])
    s = np.sqrt(RC["floor"] ** 2 + d2) if RC.get("norm", True) else np.ones(len(g))
    return g, s


def gname(g):
    return f"{g // 56}|{(g // 8) % 7}|{(g // 4) % 2}|{(g // 2) % 2}|{g % 2}"


def wquant(z, w, p):
    o = np.argsort(z); z = z[o]; c = np.cumsum(w[o]); return float(z[min(np.searchsorted(c, p * c[-1]), len(z) - 1)])


def fit_q(D, g, s, calib, RC, guard=True, nom=0.8):
    """{group name or prefix: [qlo, qhi]} from the calibration rows (bool mask)."""
    z = D["e"] / s; a = (1 - nom) / 2; out = {}
    levels = [(g, 5), (g // 2, 4), (g // 4, 3), (g // 8, 2)]
    for arr, parts in levels:
        for u in np.unique(arr[calib]):
            m = calib & (arr == u)
            if m.sum() < RC["minGroup"]: continue
            lo = -wquant(z[m], D["wt"][m], a); hi = wquant(z[m], D["wt"][m], 1 - a)
            if guard:
                for ci in np.unique(D["cut"][m]):
                    mm = m & (D["cut"] == ci)
                    if mm.sum() < RC["minWindow"]: continue
                    lo = max(lo, -wquant(z[mm], D["wt"][mm], a)); hi = max(hi, wquant(z[mm], D["wt"][mm], 1 - a))
            name = gname(int(u) * 2 ** (5 - parts)); name = "|".join(name.split("|")[:parts])
            out[name] = [max(lo, 0.0), max(hi, 0.0)]
    return out


def apply_q(D, g, s, Q, rows):
    """lo, hi (ln) for the rows (index array); nan when no group."""
    lo = np.full(len(rows), np.nan); hi = np.full(len(rows), np.nan); cache = {}
    for j, i in enumerate(rows):
        gi = int(g[i]); q = cache.get(gi, 0)
        if q == 0:
            parts = gname(gi).split("|"); q = None
            for cut in (5, 4, 3, 2):
                q = Q.get("|".join(parts[:cut]))
                if q is not None: break
            cache[gi] = q
        if q is None: continue
        lo[j] = D["main_centre"][i] - q[0] * s[i]; hi[j] = D["main_centre"][i] + q[1] * s[i]
    return lo, hi


def forward_ranges(D, RC, guard=True, test=(2, 3, 4, 5)):
    """Ranges for the test cutoffs, each calibrated on earlier cutoffs only. Returns lo, hi arrays (nan elsewhere) and the Q per cutoff."""
    g, s = feats(D, RC); lo = np.full(len(g), np.nan); hi = np.full(len(g), np.nan); Qs = {}
    base = D["ok"] & (D["bed"] <= 3)
    for ci in test:
        calib = base & (D["cut"] < ci) & (D["day"] <= D["T"][ci])
        Q = fit_q(D, g, s, calib, RC, guard); Qs[ci] = Q
        rows = np.where(D["ok"] & (D["cut"] == ci))[0]
        l, h = apply_q(D, g, s, Q, rows); lo[rows] = l; hi[rows] = h
    return lo, hi, Qs, g, s


def apply_rule(D, rule, lo, hi):
    """The refusal rule for arrays: reason code per row (0 = shown) and the half-width. Same tests and order as acs.decide.
    Codes: 1 no comparable, 2 bedrooms, 3 class refused, 4 too few, 5 size too far, 6 no multipliers, 7 range too wide."""
    c = D["main_centre"]; N = len(c)
    hw = (np.exp(hi) - np.exp(lo)) / (2 * np.exp(c))
    reason = np.zeros(N, np.int64); lsr = np.nan_to_num(D["main_lsr_w"], nan=0.0); known = D["scen"] != 2
    tr_ = D["size"] / D["typ"]; typbad = np.isfinite(tr_) & ((tr_ < rule["typLo"]) | (tr_ > rule["typHi"]))
    few = (D["main_n"] < rule["minComps"]) | (D["main_W"] < rule["minWeight"] - A.EPS)
    few |= known & ((D["main_W"] < rule["minWeightKnown"] - A.EPS) | (D["main_n1"] < rule["minOwn"]))
    for code, m in ((7, hw > rule["maxHalfWidth"]), (6, ~np.isfinite(lo)), (5, (lsr > rule["maxLsr"]) | typbad), (4, few), (3, np.isin(D["cls"], rule["refuseClasses"])),
                    (2, D["bed"] > rule["maxBedrooms"]), (1, ~D["ok"])):
        reason[m] = code
    return reason, hw
