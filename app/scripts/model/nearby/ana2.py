"""Compact comparison of variants.  python ana2.py <set> [cut ...]
Per variant and population (known/new x ready/off-plan): median |error| % / 80th pct / signed median, on sampled sales (s) and on cell medians (m)."""
import sys
import numpy as np
import nlib as N
from variants import SETS
from ana import load

if __name__ == "__main__":
    name = sys.argv[1]; cuts = sys.argv[2:] or N.CUTS
    d = load(name, cuts); sale = d["ismed"] == 0
    pops = [("KR", (d["known"] == 1) & (d["basis"] == 0)), ("KO", (d["known"] == 1) & (d["basis"] == 1)),
            ("NR", (d["known"] == 0) & (d["basis"] == 0)), ("NO", (d["known"] == 0) & (d["basis"] == 1))]
    print("cuts", cuts, "| cells:", {l: int((m & ~sale).sum()) for l, m in pops})
    print(f"{'variant':16s} " + " ".join(f"{l + ' s med/p80/bias':>18s} {l + ' m med/p80':>12s}" for l, _ in pops))
    for v in SETS[name]:
        e = d["truth"] - d[f"{v}__centre"]; out = []
        for l, m in pops:
            s = N.stats(e[m & sale]); s2 = N.stats(e[m & ~sale])
            out.append(f"{str(s['med']) + '/' + str(s['p80']) + '/' + str(s['bias']):>18s} {str(s2['med']) + '/' + str(s2['p80']):>12s}")
        print(f"{v:16s} " + " ".join(out))
