"""Backtest plumbing for ACS. Forward in time: at cutoff T everything is built from sales with day <= T; targets are single
registered sales in (T, T+183].
  bt.py prep            -> bt/ctx_<cut>.pkl (the artifact at T) and bt/tg_<cut>.npz (targets, scenarios, baselines)
  functions run()/load() are used by tune.py and evalx.py.
Scenarios: A the cell has 5+ sales in the 12 months to T (tier 1 today); B the building is in the data (36 months) but the
cell has 0-4; C the building has no kept sale in the 36 months to T."""
import os, sys, math, pickle, time, json
import numpy as np
import lib as L, acs as A
REPO = L.REPO
# The second tier in Python (scripts/model/vlib.py, vbt.py, rule.py) gives today's answer for scenario B.
os.environ.setdefault("MODEL_WORK", os.path.join(L.HERE, "bt", "vwork"))
sys.path.insert(0, os.path.join(REPO, "scripts", "model"))

OUT = os.path.join(L.HERE, "bt"); os.makedirs(OUT, exist_ok=True)
PRE = ["2023-11-17", "2024-05-18"]
CUTS6 = PRE + L.CUTS
NA = 12000
REASONS = ["shown", "evidence_disagrees", "range_too_wide", "own_sales_only", "no_building_evidence", "bedrooms_not_validated", "no_evidence"]


def prep(cut, S, B):
    import vlib as VL, vbt as V
    from rule import show2
    C = VL.constants(); t0 = time.time(); T = L.dnum(cut)
    c = A.Ctx.build(S, B, T); c.params = dict(A.P0)
    pickle.dump(c, open(os.path.join(OUT, f"ctx_{cut}.pkl"), "wb"), protocol=4)
    print(cut, "ctx built", len(c.day), "pool rows from", c.raw_rows, "| A-batch rows", c.nA, "batches", c.nAb, round(time.time() - t0, 1), flush=True)
    S2 = dict(day=S["day"], b=S["b"], bed=S["bed"], basis=S["basis"], psf=S["psf"], size=S["size"])
    B2 = dict(area=B["area"], master=B["master"], proj=B["proj"], key=None)
    tab = VL.Table(S2, B2, T)
    tt = np.where((S["day"] > T) & (S["day"] <= T + L.HZ))[0]
    rng = np.random.default_rng(20261119 + T)
    n = len(tt); scen = np.zeros(n, np.int8); n12 = np.zeros(n, np.int32); t1 = np.full(n, np.nan)
    for i, ti in enumerate(tt.tolist()):
        b = int(S["b"][ti]); cell = tab.cells.get((b, int(S["bed"][ti]), int(S["basis"][ti])))
        if cell is not None and cell["nRaw12"] >= 5: scen[i] = 0; n12[i] = cell["nRaw12"]; t1[i] = math.log(cell["med12"])
        elif b in tab.by_b: scen[i] = 1; n12[i] = cell["nRaw12"] if cell else 0
        else: scen[i] = 2
    ia = np.where(scen == 0)[0]
    keep = np.ones(n, bool)
    if len(ia) > NA:
        drop = rng.choice(ia, len(ia) - NA, replace=False); keep[drop] = False
    nA_all = int(len(ia)); counts = [int((scen == k).sum()) for k in (0, 1, 2)]
    tt = tt[keep]; scen = scen[keep]; n12 = n12[keep]; t1 = t1[keep]; n = len(tt)
    # shipped tier 2 (scenario B), per cell
    sc = np.full(n, np.nan); slo = np.full(n, np.nan); shi = np.full(n, np.nan); srlo = np.full(n, np.nan); srhi = np.full(n, np.nan); sreason = np.full(n, -1, np.int8)
    cache = {}
    for i in np.where(scen == 1)[0].tolist():
        ti = int(tt[i]); key = (int(S["b"][ti]), int(S["bed"][ti]), int(S["basis"][ti]))
        v = cache.get(key)
        if v is None:
            r = V.ingredients(tab, C, key[1], key[2], b=key[0]); p = V.apply(r, C); ok, why = show2(r, p, C)
            if p:
                st = C["displayRounding"]
                v = (p["centre"], p["low"], p["high"], round(math.exp(p["low"]) / st) * st, round(math.exp(p["high"]) / st) * st, REASONS.index("shown" if ok else why))
            else: v = (np.nan, np.nan, np.nan, np.nan, np.nan, REASONS.index("no_evidence"))
            cache[key] = v
        sc[i], slo[i], shi[i], srlo[i], srhi[i], sreason[i] = v
    # project route (scenario C, off-plan): siblings = comparable cells (3+ sales in 12 months) of the same family, same bedrooms
    pr = np.full(n, np.nan); prn = np.zeros(n, np.int32)
    for i in np.where(scen == 2)[0].tolist():
        ti = int(tt[i]); b = int(S["b"][ti]); bed = int(S["bed"][ti]); fam = int(B["fam"][b])
        if S["basis"][ti] != 1 or fam == 0: continue
        cm = tab.comp.get((int(B["area"][b]), bed, 1))
        if cm is None: continue
        cb, lm, ns = cm; k = (B["fam"][cb] == fam) & (cb != b)
        if k.sum() >= 1 and ns[k].sum() >= 3: pr[i] = float(VL.med_plain(lm[k])); prn[i] = int(k.sum())
    np.savez(os.path.join(OUT, f"tg_{cut}.npz"), ti=tt, scen=scen, n12=n12, t1=t1, sc=sc, slo=slo, shi=shi, srlo=srlo, srhi=srhi, sreason=sreason, pr=pr, prn=prn,
             nA_all=nA_all, counts=np.array(counts))
    print(cut, "targets", n, "A all", nA_all, "counts A/B/C", counts, "B cells", len(cache), round(time.time() - t0, 1), flush=True)


FEAT = ("centre", "n", "W", "neff", "disp", "W1", "W2", "W3", "W4", "n1", "n2", "n3", "n4", "age_w", "lsr_w", "age1", "beta1", "sadj_w", "tadj_w")


def load(cut):
    c = pickle.load(open(os.path.join(OUT, f"ctx_{cut}.pkl"), "rb")); z = np.load(os.path.join(OUT, f"tg_{cut}.npz"))
    return c, {k: z[k] for k in z.files}


def run(c, S, B, tg, P, sel=None, variants=(("main", {}),)):
    """ACS for the targets (indices `sel` into tg arrays). Returns {variant: {feature: array}} plus info arrays."""
    ti = tg["ti"] if sel is None else tg["ti"][sel]; scen = tg["scen"] if sel is None else tg["scen"][sel]
    n = len(ti); out = {v: {k: np.full(n, np.nan) for k in FEAT} for v, _ in variants}
    typ = np.full(n, np.nan); last = np.full(n, np.inf); nown = np.zeros(n, np.int32)
    for i in range(n):
        t = int(ti[i]); b = int(S["b"][t]); bed = int(S["bed"][t]); basis = int(S["basis"][t]); size = float(S["size"][t])
        if scen[i] == 2:
            ring, rows, lsr, info = A.gather(c, -1, bed, basis, size, P, fam=int(B["fam"][b]), master=int(B["master"][b])); bb = -1
        else:
            ring, rows, lsr, info = A.gather(c, b, bed, basis, size, P); bb = b
        typ[i] = info["typ"]; last[i] = info["last_own"]; nown[i] = info["n_own"]
        if len(ring) == 0: continue
        for v, fl in variants:
            f = A.combine(c, bb, bed, basis, ring, rows, lsr, P, **fl)
            if f is None: continue
            o = out[v]
            for k in FEAT: o[k][i] = f[k]
    return out, dict(typ=typ, last=last, nown=nown)


if __name__ == "__main__":
    S, B, M = L.load()
    for cut in (sys.argv[2:] or CUTS6): prep(cut, S, B)
