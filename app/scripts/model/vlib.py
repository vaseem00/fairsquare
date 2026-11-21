"""The similar-buildings comparison in Python (REAL_DATA.md section 15.2), for backtests and refits.
It was written for the independent verification from the specification alone, and it reproduces
src/lib/domain/similar.ts on every golden case. Reads the committed snapshot (sales.csv.gz,
buildings.csv.gz) and the shipped constants. Needs numpy only.

FAIRSQUARE_REPO: the repository root (default: two folders above this file).
MODEL_WORK: where results are written (default: <repo>/.data/model, which git ignores)."""
import csv, gzip, json, math, os
from datetime import date
import numpy as np

REPO = os.environ.get("FAIRSQUARE_REPO") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.environ.get("MODEL_WORK") or os.path.join(REPO, ".data", "model")
os.makedirs(WORK, exist_ok=True)
SNAP = os.environ.get("OPEN_DATA_DIR") or os.path.join(REPO, "data", "open-data")

def manifest():
    return json.load(open(os.path.join(SNAP, "manifest.json"), encoding="utf-8"))
EPOCH = date(2020, 1, 1).toordinal()

def dnum(s):
    y, m, d = s.split("-"); return date(int(y), int(m), int(d)).toordinal() - EPOCH

def load_snapshot(snap=SNAP):
    bkey = {}; facts = []
    with gzip.open(os.path.join(snap, "buildings.csv.gz"), "rt", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            k = r["building"] + "|" + r["area_dld"]
            bkey[k] = len(facts); facts.append(r)
    cols = {k: [] for k in ("day", "b", "bed", "basis", "psf", "size")}
    miss = 0
    with gzip.open(os.path.join(snap, "sales.csv.gz"), "rt", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            k = r["building"] + "|" + r["area_dld"]
            bi = bkey.get(k)
            if bi is None:
                miss += 1; continue
            cols["day"].append(dnum(r["date"])); cols["b"].append(bi); cols["bed"].append(int(r["bedrooms"]))
            cols["basis"].append(0 if r["completion"] == "ready" else 1)
            sz = float(r["size_sqft"]); cols["size"].append(sz); cols["psf"].append(float(r["price_aed"]) / sz)
    S = {k: np.array(v, dtype=(np.float64 if k in ("psf", "size") else np.int64)) for k, v in cols.items()}
    areas = {}; masters = {"": 0}; projs = {"": 0}
    B = dict(key=list(bkey.keys()),
             area=np.array([areas.setdefault(r["area_dld"], len(areas)) for r in facts]),
             master=np.array([masters.setdefault(r["master_project"], len(masters)) for r in facts]),
             proj=np.array([projs.setdefault(r["project_number"], len(projs)) for r in facts]),
             first_sale=np.array([dnum(r["first_sale"]) if r["first_sale"] else -1 for r in facts]),
             area_names=list(areas.keys()), master_names=list(masters.keys()), facts=facts, index=bkey, missing=miss)
    return S, B

def pmed(v):
    """Product median: with 5 or more values, drop those under 0.5x or over 2x the median once, recompute. Returns (n_used, median)."""
    v = np.sort(np.asarray(v, dtype=np.float64)); n = len(v)
    if n == 0: return 0, float("nan")
    m = (v[(n - 1) >> 1] + v[n >> 1]) / 2
    if n >= 5:
        v = v[(v >= 0.5 * m) & (v <= 2 * m)]; n = len(v); m = (v[(n - 1) >> 1] + v[n >> 1]) / 2
    return n, float(m)

def bucket(n):
    return 1 if n == 1 else 2 if n == 2 else 3 if n <= 4 else 4 if n <= 9 else 5 if n <= 19 else 6

def qlin(v, q):
    v = np.sort(v); p = q * (len(v) - 1); lo = int(math.floor(p)); hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (p - lo)

def med_plain(v):
    v = np.sort(v); n = len(v); return (v[(n - 1) >> 1] + v[n >> 1]) / 2

class Table:
    """The cells table as of day T, from sales with day <= T."""
    def __init__(self, S, B, T, mask=None):
        self.B = B; self.T = T
        m = (S["day"] <= T) & (S["day"] >= T - 1095)
        if mask is not None: m &= mask
        idx = np.where(m)[0]
        key = (S["b"][idx] * 8 + S["bed"][idx]) * 2 + S["basis"][idx]
        o = np.argsort(key, kind="stable"); idx = idx[o]; key = key[o]
        uk, st = np.unique(key, return_index=True); en = np.append(st[1:], len(key))
        self.cells = {}          # (b, bed, basis) -> dict
        self.by_b = {}
        self.sales_idx = {}
        day = S["day"]; psf = S["psf"]
        comp = {}
        for k, s, e in zip(uk.tolist(), st.tolist(), en.tolist()):
            b = k // 16; bed = (k // 2) % 8; basis = k % 2; ii = idx[s:e]; d = day[ii]; p = psf[ii]
            w = d >= T - 365; o1 = (d < T - 365) & (d >= T - 730); o2 = (d < T - 730) & (d >= T - 1095)
            n12, med12 = pmed(p[w]); _, m1 = pmed(p[o1]); _, m2 = pmed(p[o2])
            c = dict(nRaw12=int(w.sum()), n12=n12, med12=med12, nOld1=int(o1.sum()), medOld1=m1, nOld2=int(o2.sum()), medOld2=m2)
            self.cells[(b, bed, basis)] = c; self.by_b.setdefault(b, {})[(bed, basis)] = c; self.sales_idx[(b, bed, basis)] = ii
            if c["nRaw12"] >= 3:
                comp.setdefault((int(B["area"][b]), bed, basis), []).append((b, math.log(med12), c["nRaw12"]))
        self.comp = {k: (np.array([x[0] for x in v]), np.array([x[1] for x in v]), np.array([x[2] for x in v])) for k, v in comp.items()}

def cell_from_sales(psf, day, T):
    w = day >= T - 365; o1 = (day < T - 365) & (day >= T - 730); o2 = (day < T - 730) & (day >= T - 1095)
    n12, med12 = pmed(psf[w]); _, m1 = pmed(psf[o1]); _, m2 = pmed(psf[o2])
    return dict(nRaw12=int(w.sum()), n12=n12, med12=med12, nOld1=int(o1.sum()), medOld1=m1, nOld2=int(o2.sum()), medOld2=m2)

def reference(tab, C, area, master, proj, bed, basis, exclude_b=-1, exclude_proj=0, allow_project=True):
    """Step 2. Returns None or dict(level, ref, var, nb, ns)."""
    cm = tab.comp.get((area, bed, basis))
    if cm is None: return None
    cb, lm, ns = cm; B = tab.B
    keep = cb != exclude_b
    if exclude_proj: keep &= B["proj"][cb] != exclude_proj
    cb = cb[keep]; lm = lm[keep]; ns = ns[keep]
    bs = "ready" if basis == 0 else "off_plan"
    lv = []
    if proj and allow_project: lv.append(("project", B["proj"][cb] == proj, 1))
    if master: lv.append(("community", B["master"][cb] == master, 2))
    lv.append(("area", np.ones(len(cb), bool), 3))
    for name, mk, need in lv:
        if mk.sum() >= need:
            x = lm[mk]; ref = float(med_plain(x))
            spread = 0.0 if name == "project" else float((qlin(x, .9) - qlin(x, .1)) / C["spreadDivisor"])
            a2, b2 = C["referenceVariance"][name][bs]
            return dict(level=name, ref=ref, var=a2 + b2 * spread * spread, nb=int(mk.sum()), ns=int(ns[mk].sum()), spread=spread)
    return None

def compare(tab, C, bed, basis, asking=None, b=None, bcells=None, scope=None, exclude_proj=0, q=None, use=("own", "o1", "o2", "ob")):
    """Steps 1 to 8. b: building index (known building); bcells overrides the building's cells (thinning tests).
    scope: (area, master, proj) for an unknown building."""
    B = tab.B; bs = "ready" if basis == 0 else "off_plan"
    if b is not None:
        area = int(B["area"][b]); master = int(B["master"][b]); proj = int(B["proj"][b])
        if bcells is None: bcells = tab.by_b.get(b, {})
        ex = b
    else:
        area, master, proj = scope; bcells = {}; ex = -1
    allowP = not exclude_proj
    R = reference(tab, C, area, master, proj, bed, basis, ex, exclude_proj, allowP)
    ests = []; ev = {}
    if R: ests.append((R["ref"], R["var"]))
    own_used = False; ind_used = False
    c = bcells.get((bed, basis))
    EV = C["evidenceVariance"]
    if c:
        if 1 <= c["n12"] <= 4 and "own" in use:
            ests.append((math.log(c["med12"]), EV["own"][bs][str(c["n12"])])); own_used = True; ev["own"] = c["n12"]
        if c["nOld1"] > 0 and "o1" in use:
            ests.append((math.log(c["medOld1"]), EV["older12to24"][bs][str(bucket(c["nOld1"]))])); ind_used = True; ev["o1"] = c["nOld1"]
        if c["nOld2"] > 0 and "o2" in use:
            ests.append((math.log(c["medOld2"]), EV["older24to36"][bs][str(bucket(c["nOld2"]))])); ind_used = True; ev["o2"] = c["nOld2"]
    if R and "ob" in use:
        sw = 0.0; swd = 0.0; n = 0
        for (j, bj), cj in bcells.items():
            if bj != basis or j == bed or cj["nRaw12"] < 1: continue
            Rj = reference(tab, C, area, master, proj, j, basis, ex, exclude_proj, allowP)
            if Rj is None: continue
            w = cj["nRaw12"] / (cj["nRaw12"] + C["otherBedroomsWeightK"]); sw += w; swd += w * (math.log(cj["med12"]) - Rj["ref"]); n += cj["nRaw12"]
        if sw > 0:
            ests.append((R["ref"] + swd / sw, EV["otherBedrooms"][bs][str(bucket(n))])); ind_used = True; ev["ob"] = n
    if not ests: return dict(shown=False, reason="no_evidence")
    den = sum(1 / v for _, v in ests); centre = sum(e / v for e, v in ests) / den; s = 1 / math.sqrt(den)
    cls = "own" if own_used else "indirect" if ind_used else R["level"]
    fl, ql, qh = (q or C["range80"])[cls]
    sp = math.sqrt(s * s + fl * fl); low = centre - ql * sp; high = centre + qh * sp; W = (ql + qh) / 2 * sp
    out = dict(centre=centre, s=s, sp=sp, low=low, high=high, W=W, cls=cls, level=R["level"] if R else None, nb=R["nb"] if R else 0, ns=R["ns"] if R else 0, ev=ev)
    if bed > C["maxBedrooms"]: out.update(shown=False, reason="bedrooms_not_validated")
    elif cls in C["neverShownClasses"]: out.update(shown=False, reason="no_building_evidence")
    elif W > C["maxHalfWidth"]: out.update(shown=False, reason="range_too_wide")
    else: out.update(shown=True, reason=None, tier="close" if W <= C["closeHalfWidth"] else "broad")
    r = C["displayRounding"]
    out["rlo"] = round(math.exp(low) / r) * r; out["rhi"] = round(math.exp(high) / r) * r
    if asking is not None:
        out["verdict"] = "above" if asking > out["rhi"] else "below" if asking < out["rlo"] else "within"
    return out

def constants():
    """The shipped constants (src/lib/similar/constants.json)."""
    return json.load(open(os.path.join(REPO, "src", "lib", "similar", "constants.json"), encoding="utf-8"))
