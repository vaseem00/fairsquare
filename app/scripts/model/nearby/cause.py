"""Where the low bias comes from.  python cause.py <set> <variant> [cut ...]
Signed median error (truth - centre, %) of sampled sales by: days after the cutoff; the building's launch / handover age."""
import sys
import numpy as np
import nlib as N
from ana import load

if __name__ == "__main__":
    name, v = sys.argv[1], sys.argv[2]; cuts = sys.argv[3:] or N.CUTS
    d = load(name, cuts); sale = d["ismed"] == 0; e = d["truth"] - d[f"{v}__centre"]; ok = np.isfinite(e) & sale
    def row(lab, m):
        s = N.stats(e[m & ok]); print(f"  {lab:38s} n={s['n']:6d} med={s['med']} bias={s['bias']}")
    for bs, bl in ((0, "ready"), (1, "off-plan")):
        for kn, kl in ((1, "known"), (0, "new")):
            m0 = (d["basis"] == bs) & (d["known"] == kn); print(bl, kl)
            for lo, hi in ((0, 30), (30, 61), (61, 122), (122, 184)): row(f"days after cutoff {lo}-{hi}", m0 & (d["dt"] > lo) & (d["dt"] <= hi))
            if kn:
                age = d["tv"] if bs == 1 else d["trv"]; lab = "launch" if bs == 1 else "handover"
                for lo, hi in ((0, 0.5), (0.5, 1), (1, 2), (2, 4), (4, 8), (8, 99)): row(f"{lab} {lo}-{hi} years before cutoff", m0 & (age >= lo) & (age < hi))
                row(f"no {lab} date", m0 & ~np.isfinite(age))
