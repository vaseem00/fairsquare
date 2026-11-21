"""Shared helpers for the adjusted-registered-sales backtest and refit (scripts/model/README.md). numpy only.

CODE is this folder. REPO is the repository. HERE is the work folder every script reads and writes: .data/model/acs
(ignored by git), or the folder named by the environment variable ACS_WORK."""
import json, os
from datetime import date
import numpy as np

CODE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(CODE)))
HERE = os.environ.get("ACS_WORK") or os.path.join(REPO, ".data", "model", "acs")
os.makedirs(HERE, exist_ok=True)
TAB = os.path.join(HERE, "tables"); os.makedirs(TAB, exist_ok=True)
EPOCH = date(2020, 1, 1).toordinal()
MON = 30.4375
# The data date of the fit (TEND) and the four test cutoffs, each 183 days apart, the last one 183 days before TEND.
# A refit moves all of them (and PRE in bt.py) with the new data date.
CUTS = ["2024-11-17", "2025-05-17", "2025-11-16", "2026-05-17"]
TEND = "2026-11-16"
HZ = 183

def dnum(s):
    return date(int(s[:4]), int(s[5:7]), int(s[8:10])).toordinal() - EPOCH

def dstr(d):
    return date.fromordinal(int(d) + EPOCH).isoformat()

def load():
    z = np.load(os.path.join(HERE, "data.npz"))
    S = {k: z[k] for k in ("day", "b", "bed", "basis", "size", "price", "insnap", "blockn", "gid")}
    S["day"] = S["day"].astype(np.int64); S["b"] = S["b"].astype(np.int64); S["bed"] = S["bed"].astype(np.int64); S["basis"] = S["basis"].astype(np.int64)
    S["psf"] = S["price"] / S["size"]; S["lp"] = np.log(S["psf"]); S["ls"] = np.log(S["size"])
    B = {k[2:]: z[k].astype(np.int64) for k in ("B_area", "B_master", "B_proj", "B_fam", "B_first", "B_firstr")}
    M = json.load(open(os.path.join(HERE, "data_meta.json"), encoding="utf-8"))
    S["cell"] = (S["b"] * 8 + S["bed"]) * 2 + S["basis"]
    S["area"] = B["area"][S["b"]]; S["master"] = B["master"][S["b"]]; S["proj"] = B["proj"][S["b"]]; S["fam"] = B["fam"][S["b"]]
    return S, B, M

def ids(*keys):
    """Dense group ids for the combination of integer key arrays."""
    k = keys[0].astype(np.int64)
    for x in keys[1:]:
        x = x.astype(np.int64); k = k * (int(x.max()) + 2) + (x + 1)
    u, inv = np.unique(k, return_inverse=True)
    return inv, len(u)

def demean(v, g, G, w=None):
    if w is None:
        return v - (np.bincount(g, v, minlength=G) / np.maximum(np.bincount(g, minlength=G), 1))[g]
    return v - (np.bincount(g, v * w, minlength=G) / np.maximum(np.bincount(g, w, minlength=G), 1e-12))[g]

def wmedian(v, w):
    o = np.argsort(v); v = v[o]; w = w[o]; c = np.cumsum(w)
    return float(v[np.searchsorted(c, 0.5 * c[-1])])

def q(v, p):
    return float(np.quantile(v, p)) if len(v) else float("nan")

def err_stats(e):
    """e: signed log errors (truth - prediction). Returns n, median |e| %, 80th pct |e| %, median bias %."""
    e = np.asarray(e); e = e[np.isfinite(e)]
    if len(e) == 0: return dict(n=0, med=None, p80=None, bias=None)
    a = np.abs(e)
    return dict(n=int(len(e)), med=float(round(100 * (np.exp(np.median(a)) - 1), 2)), p80=float(round(100 * (np.exp(np.quantile(a, .8)) - 1), 2)),
                bias=float(round(100 * (np.exp(np.median(e)) - 1), 2)))

def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows: out.append("| " + " | ".join("" if x is None else (f"{x:,}" if isinstance(x, int) else str(x)) for x in r) + " |")
    return "\n".join(out)

def write_csv(name, headers, rows):
    import csv
    with open(os.path.join(TAB, name), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(headers); w.writerows(rows)

def fe_slope(y, x, g, G, cl=None, trim=True):
    """OLS slope of y on x after removing group means (g). One robust pass drops |resid| > 4 robust sd.
    Returns beta, cluster-robust se (clusters cl), n used, sxx."""
    yd = demean(y, g, G); xd = demean(x, g, G)
    keep = np.ones(len(y), bool)
    for it in range(2 if trim else 1):
        sxx = float((xd[keep] ** 2).sum())
        if sxx <= 0: return float("nan"), float("nan"), 0, 0.0
        b = float((xd[keep] * yd[keep]).sum()) / sxx
        r = yd - b * xd
        if it == 0 and trim:
            s = 1.4826 * np.median(np.abs(r[keep]));
            keep = np.abs(r) <= 4 * max(s, 1e-9)
            yd = demean(np.where(keep, y, 0), g, G, keep.astype(float)); xd = demean(np.where(keep, x, 0), g, G, keep.astype(float))
            yd[~keep] = 0; xd[~keep] = 0
    se = float("nan")
    if cl is not None:
        sc = np.bincount(cl[keep], (xd * r)[keep])
        se = float(np.sqrt((sc ** 2).sum()) / sxx)
    return b, se, int(keep.sum()), sxx
