"""Error by strata (sampled sales).  python strata.py tune|late|all [in|out] [hp]"""
import sys
import numpy as np
import nlib as N, fin as F
from ana import load

which = sys.argv[1] if len(sys.argv) > 1 else "tune"; kind = sys.argv[2] if len(sys.argv) > 2 else "in"; hp = len(sys.argv) > 3
d = load("f", N.CUTS); sale = d["ismed"] == 0
per = {"tune": d["cut"] <= 1, "late": d["cut"] >= 2, "all": d["cut"] >= 0}[which]
o = F.combine(d, kind, hp); e = d["truth"] - o["centre"]; ok = np.isfinite(e) & per
pop = (d["known"] == 1) if kind == "in" else (d["known"] >= 0)


def row(lab, m):
    s = N.stats(e[m & ok & sale & pop]); s2 = N.stats(e[m & ok & ~sale & pop])
    print(f"  {lab:34s} sales n={s['n']:6d} med={s['med']} p80={s['p80']} p90={s['p90']} bias={s['bias']} | bldg n={s2['n']:5d} med={s2['med']} p80={s2['p80']} p90={s2['p90']} bias={s2['bias']}")


print(which, kind, "hp" if hp else "", "| answered (any comparable):", round(100 * np.isfinite(o["centre"][per & sale & pop]).mean(), 1))
for bs, bl in ((0, "ready"), (1, "off-plan")):
    mb = d["basis"] == bs; print(bl); row("all", mb)
    for kn, kl in ((1, "building known at T"), (0, "new building")): row(kl, mb & (d["known"] == kn))
    for b in range(0, 6): row(f"bedrooms {b}" if b < 5 else "bedrooms 5+", mb & ((d["bed"] == b) if b < 5 else (d["bed"] >= 5)))
    row("scope community", mb & (o["scope"] == 0)); row("scope area", mb & (o["scope"] == 1))
    for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 6), (6, 11), (11, 21), (21, 9999)): row(f"buildings {lo}-{hi - 1}", mb & (o["nb"] >= lo) & (o["nb"] < hi))
    for lo, hi in ((0, 0.5), (0.5, 1), (1, 2), (2, 5), (5, 10), (10, 1e9)): row(f"W {lo}-{hi}", mb & (o["W"] >= lo) & (o["W"] < hi) & (o["nb"] >= 3))
    for lo, hi in ((0, 0.1), (0.1, 0.2), (0.2, 0.3), (0.3, 0.5), (0.5, 9)): row(f"size distance {lo}-{hi}", mb & (o["lsr_w"] >= lo) & (o["lsr_w"] < hi) & (o["nb"] >= 3))
    row("thin own cell (n12 < 5), known", mb & (d["known"] == 1) & (d["n12"] < 5)); row("own cell 5+ in 12 months", mb & (d["n12"] >= 5))
