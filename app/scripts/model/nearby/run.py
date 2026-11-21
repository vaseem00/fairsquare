"""Run named variants of the nearby method on every target cell of the given cutoffs.
  python scripts/model/nearby/run.py <set> [cut ...]
Writes .data/model/nearby/res/<set>_<cut>.npz : per target row (up to K sampled sales per cell, then the cell median row)
the truth, the cell facts and, per variant, centre / q10 / q25 / q75 / q90 / W / nb / nb_eff / nsale / lsr_w / age_w / comm_w."""
import os, sys, time, json
import numpy as np
import nlib as N
from variants import SETS

FE = ("centre", "q10", "q25", "q75", "q90", "W", "nb", "nb_eff", "nsale", "lsr_w", "age_w", "comm_w")


def run(cut, S, B, variants, K=8):
    t0 = time.time(); C = N.Cut(cut, S, B)
    C.G = N.fit_vintage(C)
    print(cut, "vintage curve ready", [round(x, 3) for x in C.G["ready"]], "off-plan", [round(x, 3) for x in C.G["offplan"]], "vref", round(C.G["vref"], 2), flush=True)
    tg = N.targets(C, S, B, K=K)
    n = sum(len(t["ls"]) + 1 for t in tg)
    info = {k: np.zeros(n, np.int64) for k in ("cellidx", "b", "bed", "basis", "known", "n12", "n_t", "ismed", "area", "master", "proj", "fam")}
    truth = np.zeros(n); dt = np.zeros(n); ls = np.zeros(n); typ = np.zeros(n); tv = np.zeros(n); trv = np.zeros(n)
    res = {v: {k: np.full(n, np.nan) for k in FE} for v in variants}
    p = 0
    for ci, t in enumerate(tg):
        k = len(t["ls"]) + 1; sl = slice(p, p + k)
        Ls = np.append(t["ls"], t["med_ls"]); truth[sl] = np.append(t["lp"], t["med_lp"]); ls[sl] = Ls; dt[sl] = np.append(t["dt"], t["med_dt"])
        for key in ("b", "bed", "basis", "n12", "n_t", "area", "master", "proj", "fam"): info[key][sl] = t[key]
        info["cellidx"][sl] = ci; info["known"][sl] = int(t["known"]); info["ismed"][p + k - 1] = 1; typ[sl] = t["typ_ls"]
        v_ = C.vint[t["b"]]; rv_ = C.rvint[t["b"]]; tv[sl] = v_; trv[sl] = rv_
        cache = {}
        for name, V in variants.items():
            ck = (V.get("hide", "building"), V.get("mode", "both"))
            rows = cache.get(ck)
            if rows is None: rows = cache[ck] = N.comp_rows(C, t, *ck)
            P = dict(N.P0); P.update(V.get("P", {}))
            vk = V.get("vint", "none")  # none | new (assume vintage 0 for off-plan) | known (use the building's own when known at T, else as 'new')
            a_tv = a_trv = None
            if vk in ("new", "known") and t["basis"] == 1: a_tv = 0.0
            if vk == "known":
                if t["basis"] == 1 and v_ == v_: a_tv = float(v_)
                if t["basis"] == 0 and rv_ == rv_: a_trv = float(rv_)
            va = V.get("vadj")  # None | 'known' (the building's own age when it is in the data at T, else as 'blind') | 'blind' (ready: vref, off-plan: 0)
            if va == "offnew":  # not in the data: an off-plan listing is taken as a new launch (age 0); a ready one gets no vintage adjustment
                if t["basis"] == 1: P["vadj"] = 1; P["gt"] = float(N.g_of(C.G, 1, 0.0))
            elif va:
                P["vadj"] = 1
                if t["basis"] == 1: age_t = float(v_) if (va == "known" and v_ == v_) else 0.0
                else: age_t = (float(rv_) if rv_ == rv_ else 0.0) if (va == "known" and t["known"]) else C.G["vref"]
                P["gt"] = float(N.g_of(C.G, t["basis"], age_t))
            master = t["master"] if V.get("mode", "both") != "area" else 0
            proj = t["proj"] if V.get("hide", "building") == "building" else 0
            r = N.estimate(C, rows, t["bed"], t["basis"], Ls, P, master=master, proj=proj, tv=a_tv, trv=a_trv)
            if r is None: continue
            for f in FE: res[name][f][sl] = r[f]
        p += k
    os.makedirs(os.path.join(N.OUT, "res"), exist_ok=True)
    flat = {f"{v}__{f}": res[v][f] for v in variants for f in FE}
    return dict(truth=truth, dt=dt, ls=ls, typ=typ, tv=tv, trv=trv, **info, **flat), len(tg), time.time() - t0


if __name__ == "__main__":
    name = sys.argv[1]; cuts = sys.argv[2:] or N.CUTS
    S, B, M = N.L.load()
    for cut in cuts:
        d, nc, dt = run(cut, S, B, SETS[name])
        np.savez_compressed(os.path.join(N.OUT, "res", f"{name}_{cut}.npz"), **d)
        print(name, cut, "cells", nc, "rows", len(d["truth"]), "variants", len(SETS[name]), "sec", round(dt, 1), flush=True)
