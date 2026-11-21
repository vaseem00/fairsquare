"""Which scale for the range, chosen on the tuning cutoffs only: fit on one tuning cutoff, score on the other (both ways).
Interval score (Winkler, alpha 0.2, ln units; lower is better), coverage, median half-width."""
import numpy as np
import nlib as N, fin as F
from ana import load

d = load("f", N.CUTS); sale = d["ismed"] == 0; truth = d["truth"]


def grp(o, gdef):
    bs = np.where(d["basis"] == 0, "R", "O")
    if gdef == "bs": return np.char.add(bs, np.where(o["scope"] == 0, "c", "a"))
    far = np.where(o["lsr_w"] < 0.1, "0", np.where(o["lsr_w"] < 0.2, "1", "2"))
    return np.char.add(bs, np.where(o["scope"] == 0, np.char.add("c", far), "a"))


def variant(o, scale):
    o = dict(o)
    if scale == "const": o["q10"] = o["centre"] - 1.0; o["q90"] = o["centre"] + 1.0
    elif scale == "sqrt":
        lo, hi = F.scales(o); o["q10"] = o["centre"] - np.sqrt(lo); o["q90"] = o["centre"] + np.sqrt(hi)
    return o


for kind, pop, lab in (("in", d["known"] == 1, "in"), ("out", d["known"] >= 0, "out")):
    base = F.combine(d, kind)
    ok = np.isfinite(base["centre"]) & sale & pop & (base["nb"] >= 3) & (d["bed"] <= 3) & (base["W"] >= 1) & (base["lsr_w"] <= 0.5)
    for gdef in ("bs", "bsf"):
        g = grp(base, gdef)
        for scale in ("const", "sqrt", "q"):
            o = variant(base, scale); sc = []; cv = []; hwm = []
            for a, b in ((0, 1), (1, 0), (1, 2), (2, 3)):
                q = F.fit_q(o, truth, g, ok & (d["cut"] == a)); lo, hi, hw = F.apply_q(o, g, q)
                m = ok & (d["cut"] == b) & np.isfinite(lo)
                w = (hi - lo)[m] + 10 * np.maximum(lo[m] - truth[m], 0) + 10 * np.maximum(truth[m] - hi[m], 0)
                sc.append(w.mean()); cv.append(100 * np.mean((truth[m] >= lo[m]) & (truth[m] <= hi[m]))); hwm.append(100 * np.median(hw[m]))
            print(f"{lab:4s} groups={gdef:4s} scale={scale:6s} score 0>1 {sc[0]:.4f} 1>0 {sc[1]:.4f} | later 1>2 {sc[2]:.4f} 2>3 {sc[3]:.4f} | cover {cv[0]:.1f} {cv[1]:.1f} {cv[2]:.1f} {cv[3]:.1f} | hw med {hwm[0]:.1f} {hwm[1]:.1f} {hwm[2]:.1f} {hwm[3]:.1f}")
