"""Run ACS (the tuned parameters, acs.P0) and its ablations on every target of the six cutoffs. Writes bt/res_<cut>.npz."""
import json, os, sys, time
import numpy as np
import lib as L, acs as A, bt

# The parameters were tuned once (19 Nov 2026) on the two tuning cutoffs; the search script is not in the repository.
# acs.P0 holds its result, value for value.
P = dict(A.P0)
S, B, M = L.load()
VARS = (("main", {}), ("no_size", dict(no_size=True)), ("no_time", dict(no_time=True)), ("no_cross", dict(no_cross=True)), ("equal", dict(equal=True)),
        ("raw", dict(no_size=True, no_time=True)), ("no_size_all", dict(no_size_all=True)))
for cut in (sys.argv[1:] or bt.CUTS6):
    t0 = time.time(); c, tg = bt.load(cut)
    # forward in time, and no same-day one-price sibling of a held-out sale can be a comparable: every pool row is on or before
    # the cutoff, every target after it
    assert int(c.day.max()) <= c.T < int(S["day"][tg["ti"]].min()), "pool / target overlap"
    out, info = bt.run(c, S, B, tg, P, None, VARS)
    d = {f"main_{k}": v for k, v in out["main"].items()}
    for v, _ in VARS[1:]: d[f"{v}_centre"] = out[v]["centre"]
    ti = tg["ti"]
    np.savez(os.path.join(bt.OUT, f"res_{cut}.npz"), **d, **info, **tg, truth=S["lp"][ti], bed=S["bed"][ti], basis=S["basis"][ti], size=S["size"][ti], day=S["day"][ti], b=S["b"][ti],
             blockn=S["blockn"][ti], fam=B["fam"][S["b"][ti]], master=B["master"][S["b"][ti]])
    print(cut, len(ti), round(time.time() - t0, 1), flush=True)
