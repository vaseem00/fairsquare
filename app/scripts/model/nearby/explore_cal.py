"""Exploration of the range: which scale and which groups. Fit on the tuning cutoffs (0, 1), read on the later ones (2, 3)."""
import sys
import numpy as np
import nlib as N, fin as F
from ana import load

d = load("f", N.CUTS); sale = d["ismed"] == 0; tune = d["cut"] <= 1; late = d["cut"] >= 2
truth = d["truth"]


def show(kind, pop, hp=False, inp="both", scale="q", gdef="bs", label=""):
    o = F.combine(d, kind, hp, inp); ok = np.isfinite(o["centre"]) & sale & pop & (o["nb"] >= 3) & (d["bed"] <= 3)
    if scale == "const":
        o = dict(o); o["q10"] = o["centre"] - 1.0; o["q90"] = o["centre"] + 1.0
    elif scale == "iqr":
        s = np.sqrt(F.FLOOR ** 2 + ((o["q75"] - o["q25"]) / 1.349) ** 2); o = dict(o); o["q10"] = o["centre"] - s; o["q90"] = o["centre"] + s
    ev = np.where(o["nb"] >= 6, "m", "f")
    sc = np.where(o["scope"] == 0, "c", "a")
    bs = np.where(d["basis"] == 0, "R", "O")
    if gdef == "b": g = bs
    elif gdef == "bs": g = np.char.add(bs, sc)
    elif gdef == "bse": g = np.char.add(np.char.add(bs, sc), ev)
    q = F.fit_q(o, truth, g, ok & tune)
    lo, hi, hw = F.apply_q(o, g, q)
    print(f"--- {label or kind} hp={hp} inp={inp} scale={scale} groups={gdef}")
    for gk in sorted(q):
        for nm, mm in (("tune", tune), ("c3", d["cut"] == 2), ("c4", d["cut"] == 3)):
            m = ok & mm & (g == gk)
            if m.sum() == 0: continue
            cov = np.mean((truth[m] >= lo[m]) & (truth[m] <= hi[m])); below = np.mean(truth[m] < lo[m]); above = np.mean(truth[m] > hi[m])
            print(f"   {gk:4s} {nm:4s} n={int(m.sum()):6d} q=({q[gk][0]:.2f},{q[gk][1]:.2f}) cover={100 * cov:5.1f} miss lo/hi={100 * below:4.1f}/{100 * above:4.1f} hw med={100 * np.median(hw[m]):5.1f} p80={100 * np.quantile(hw[m], .8):5.1f}"
                  f" low/high side med={100 * (1 - np.exp(np.median(lo[m] - o['centre'][m]))):.0f}/{100 * (np.exp(np.median(hi[m] - o['centre'][m])) - 1):.0f}")


K = d["known"] == 1; Nw = d["known"] == 0
for scale in ("q", "iqr", "const"):
    show("in", K, scale=scale, gdef="bs")
show("in", K, scale="q", gdef="bse")
show("out", K, scale="q", gdef="bs", label="out on known")
show("out", K, scale="const", gdef="bs", label="out on known")
show("out", Nw, scale="q", gdef="bs", label="out on new")
show("out", Nw, scale="const", gdef="bs", label="out on new")
show("out", K | Nw, scale="q", gdef="bs", label="out on all")
