"""Error tables of a result set.  python ana.py <set> [cut ...]  ->  per variant: population x basis rows."""
import os, sys
import numpy as np
import nlib as N
from variants import SETS


def load(name, cuts):
    ds = []
    for c in cuts:
        z = np.load(os.path.join(N.OUT, "res", f"{name}_{c}.npz")); d = {k: z[k] for k in z.files}; d["cut"] = np.full(len(d["truth"]), N.CUTS.index(c)); ds.append(d)
    return {k: np.concatenate([d[k] for d in ds]) for k in ds[0]}


def line(lab, e):
    s = N.stats(e)
    return f"  {lab:34s} n={s['n']:6d} med={s['med']} p80={s['p80']} p90={s['p90']} bias={s['bias']}" if s["n"] else f"  {lab:34s} n=0"


if __name__ == "__main__":
    name = sys.argv[1]; cuts = sys.argv[2:] or N.CUTS
    d = load(name, cuts)
    sale = d["ismed"] == 0
    pops = [("known ready", (d["known"] == 1) & (d["basis"] == 0)), ("known offplan", (d["known"] == 1) & (d["basis"] == 1)),
            ("new ready", (d["known"] == 0) & (d["basis"] == 0)), ("new offplan", (d["known"] == 0) & (d["basis"] == 1))]
    for v in SETS[name]:
        c = d[f"{v}__centre"]; e = d["truth"] - c
        print(v, "answered", round(100 * np.isfinite(c).mean(), 1))
        for lab, m in pops:
            print(line(lab + " sale", e[m & sale])); print(line(lab + " bldg-median", e[m & ~sale]))
