"""The chosen method put together from the result set 'f', and the calibration of its range.
  combine(d, kind, hp, inp): per target row the estimate the product would give.
     kind 'in'  = the building is in the data (age known);  'out' = it is not.
     hp   False = only the building's own sales hidden;     True = its whole project hidden too.
     inp  'both' = community and DLD area known (community first, area as the fallback); 'area' = DLD area only; 'comm' = community only.
"""
import math
import numpy as np
import nlib as N
from ana import load

FE = ("centre", "q10", "q25", "q75", "q90", "W", "nb", "nb_eff", "nsale", "lsr_w", "age_w", "comm_w")
MB = 3          # the community answers alone when it has at least this many other buildings that count
FLOOR = 0.05    # smallest scale of either side of the range (ln)
NOM = 0.80


def combine(d, kind, hp=False, inp="both", mb=MB):
    hs = "_hp" if hp else ""
    g = lambda ms: {f: d[f"{kind}{ms}{hs}__{f}"] for f in FE}
    if inp == "area":
        o = g("_a"); o["scope"] = np.ones(len(d["truth"]), np.int64); return o
    c = g("_c")
    if inp == "comm":
        o = c; o["scope"] = np.zeros(len(d["truth"]), np.int64); return o
    b = g("_b"); use_c = np.isfinite(c["centre"]) & (c["nb"] >= mb)
    o = {f: np.where(use_c, c[f], b[f]) for f in FE}; o["scope"] = np.where(use_c, 0, 1); return o


def scales(o, floor=FLOOR):
    lo = np.maximum(o["centre"] - o["q10"], floor); hi = np.maximum(o["q90"] - o["centre"], floor)
    return lo, hi


def conformal(score, level):
    """Split-conformal quantile with the finite-sample correction."""
    s = np.sort(score[np.isfinite(score)]); n = len(s)
    if n == 0: return float("nan")
    k = min(n - 1, int(math.ceil((n + 1) * level)) - 1)
    return float(s[k])


def fit_q(o, truth, groups, m, nom=NOM):
    """Multipliers [qlo, qhi] per group from the rows m: range = [centre - qlo * s_lo, centre + qhi * s_hi]."""
    lo, hi = scales(o); r = truth - o["centre"]; q = {}; side = 1 - (1 - nom) / 2
    for gk in np.unique(groups[m]):
        mm = m & (groups == gk) & np.isfinite(r)
        q[str(gk)] = [conformal(-r[mm] / lo[mm], side), conformal(r[mm] / hi[mm], side), int(mm.sum())]
    return q


def apply_q(o, groups, q):
    lo, hi = scales(o); ql = np.full(len(lo), np.nan); qh = np.full(len(lo), np.nan)
    for gk, v in q.items():
        mm = groups == gk; ql[mm] = v[0]; qh[mm] = v[1]
    L_ = o["centre"] - ql * lo; H_ = o["centre"] + qh * hi
    hw = (np.exp(H_) - np.exp(L_)) / (2 * np.exp(o["centre"]))
    return L_, H_, hw
