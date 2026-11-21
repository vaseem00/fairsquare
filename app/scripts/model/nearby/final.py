"""The chosen method end to end on the result set 'f': rule, range calibration (forward in time), tables.
  python final.py            -> .data/model/nearby/final.json and a printed summary
Kinds: 'in' = the listing's building is in the data (its age is known; targets: buildings known at the cutoff, own sales hidden);
       'out' = it is not (targets: every held-out building, known or new)."""
import json, math, os, sys
import numpy as np
import nlib as N, fin as F
from ana import load

NOM = float(os.environ.get("NEARBY_NOM", "0.80")); BRIEF = bool(os.environ.get("NEARBY_BRIEF"))
RULE = dict(maxBedrooms=3, minBuildings=3, minWeight=1.0, maxSizeDistance=0.5, maxHalfWidth=float(os.environ.get("NEARBY_MAXHW", "0.5")), rounding=10)
FAR = (0.1, 0.2); THIN = 6

d = load("f", N.CUTS); sale = d["ismed"] == 0; truth = d["truth"]; cut = d["cut"]; n = len(truth)
KN = d["known"] == 1
_ci = d["cellidx"] + d["cut"] * 10 ** 6; _u, _inv = np.unique(_ci, return_inverse=True); _last = np.zeros(len(_u), np.int64); _last[_inv] = np.arange(n); lastrow = _last[_inv]   # each row -> its cell's median row


def build(kind, hp=False, inp="both"):
    o = F.combine(d, kind, hp, inp)
    if inp == "both": o["scope"] = np.where(d["master"] == 0, 2, o["scope"])   # 0 community, 1 community too thin: area mixed in, 2 area only
    else: o["scope"] = np.full(n, 2)
    bs = np.where(d["basis"] == 0, "R", "O")
    far = np.where(o["lsr_w"] < FAR[0], "0", np.where(o["lsr_w"] < FAR[1], "1", "2"))
    # group: basis + class. class, first that applies: t = fewer than THIN buildings; b = 3 bedrooms; c0/c1/c2 = community by size distance; a = area (alone or mixed in)
    cls = np.where(o["nb"] < THIN, "t", np.where(d["bed"] == 3, "b", np.where(o["scope"] == 0, np.char.add("c", far), "a")))
    o["group"] = np.char.add(bs, cls)
    lo, hi = F.scales(o); o["q10"] = o["centre"] - np.sqrt(lo); o["q90"] = o["centre"] + np.sqrt(hi)   # scale = sqrt(side spread), see fin.scales
    reason = np.full(n, "shown", dtype="U24")
    reason[~np.isfinite(o["centre"])] = "no_comparables"
    m = reason == "shown"; reason[m & (d["bed"] > RULE["maxBedrooms"])] = "bedrooms_not_validated"
    m = reason == "shown"; reason[m & ((o["nb"] < RULE["minBuildings"]) | (o["W"] < RULE["minWeight"] - 1e-9))] = "too_few_buildings"
    m = reason == "shown"; reason[m & (o["lsr_w"] > RULE["maxSizeDistance"])] = "size_too_far"
    o["reason"] = reason
    return o


def ranges(o, q):
    lo, hi, hw = F.apply_q(o, o["group"], q)
    return lo, hi, hw


def cov_table(o, lo, hi, hw, m, by):
    out = {}
    for gk in np.unique(by[m]):
        mm = m & (by == gk) & np.isfinite(lo)
        if mm.sum() == 0: continue
        out[str(gk)] = dict(n=int(mm.sum()), held=round(100 * float(np.mean((truth[mm] >= lo[mm]) & (truth[mm] <= hi[mm]))), 1),
                            below=round(100 * float(np.mean(truth[mm] < lo[mm])), 1), above=round(100 * float(np.mean(truth[mm] > hi[mm])), 1),
                            hwMed=round(100 * float(np.median(hw[mm])), 1), hwP80=round(100 * float(np.quantile(hw[mm], .8)), 1), hwP95=round(100 * float(np.quantile(hw[mm], .95)), 1),
                            lowSide=round(100 * (1 - math.exp(float(np.median((lo - o["centre"])[mm])))), 1), highSide=round(100 * (math.exp(float(np.median((hi - o["centre"])[mm]))) - 1), 1))
    return out


def err_tables(o, m):
    e = truth - o["centre"]; T = {}; mcell = m[lastrow]   # a cell counts when its median row passes the rule
    def row(lab, mm):
        a = N.stats(e[mm & m & sale]); b = N.stats(e[mm & mcell & ~sale]); T[lab] = dict(sale=a, building=b)
    al = np.ones(n, bool)
    for bs, bl in ((0, "ready"), (1, "offplan")):
        mb = d["basis"] == bs; row(bl, mb)
        row(bl + " | building known at the cutoff", mb & KN); row(bl + " | new building", mb & ~KN)
        for b in range(4): row(f"{bl} | {b} bedrooms", mb & (d["bed"] == b))
        for lab, sc in (("community", 0), ("community thin, area mixed in", 1), ("area only", 2)): row(f"{bl} | scope {lab}", mb & (o["scope"] == sc))
        for lo_, hi_ in ((3, 6), (6, 11), (11, 21), (21, 10 ** 6)): row(f"{bl} | buildings {lo_}-{hi_ - 1 if hi_ < 10 ** 6 else 'up'}", mb & (o["nb"] >= lo_) & (o["nb"] < hi_))
        for lo_, hi_ in ((1, 2), (2, 5), (5, 10), (10, 1e9)): row(f"{bl} | weight {lo_}-{hi_ if hi_ < 1e9 else 'up'}", mb & (o["W"] >= lo_) & (o["W"] < hi_))
        for lo_, hi_ in ((0, 0.1), (0.1, 0.2), (0.2, 0.5)): row(f"{bl} | size distance {lo_}-{hi_}", mb & (o["lsr_w"] >= lo_) & (o["lsr_w"] < hi_))
    return T


def decisions(o, lo, hi, m):
    """Share called below / within / above when the asking price is the true price x (1 + x)."""
    st = RULE["rounding"]; rlo = np.round(np.exp(lo) / st) * st; rhi = np.round(np.exp(hi) / st) * st; out = {}
    for x in (-0.2, -0.1, 0.0, 0.1, 0.2, 0.3):
        ask = np.floor(np.exp(truth) * (1 + x) + 0.5); mm = m & np.isfinite(lo)
        out[f"{x:+.0%}"] = dict(n=int(mm.sum()), below=round(100 * float(np.mean(ask[mm] < rlo[mm])), 1), within=round(100 * float(np.mean((ask[mm] >= rlo[mm]) & (ask[mm] <= rhi[mm]))), 1),
                                above=round(100 * float(np.mean(ask[mm] > rhi[mm])), 1))
    return out


def study(kind, pop, hp=False, inp="both", qsrc=None):
    """qsrc: an `o` whose rows calibrate (default: this one). Rolling forward: cut 2 uses the fit of cuts 0-1, cut 3 the fit of cuts 0-2."""
    o = build(kind, hp, inp); src = qsrc if qsrc is not None else o
    base = pop & sale; ok = base & (o["reason"] == "shown"); oks = (src["pop"] if "pop" in src else pop) & sale & (src["reason"] == "shown")
    lo = np.full(n, np.nan); hi = np.full(n, np.nan); hw = np.full(n, np.nan); qs = {}
    for name, fit, app in (("tune>2", cut <= 1, cut == 2), ("tune+2>3", cut <= 2, cut == 3)):
        q = F.fit_q(src, truth, src["group"], oks & fit, NOM); qs[name] = q
        l, h, w = ranges(o, q); lo[app] = l[app]; hi[app] = h[app]; hw[app] = w[app]
    q01 = qs["tune>2"]; l01, h01, w01 = ranges(o, q01)              # stricter: the tuning fit on both later cutoffs
    qall = F.fit_q(src, truth, src["group"], oks, NOM)              # what ships: all four cutoffs
    lall, hall, wall = ranges(o, qall)
    late = cut >= 2
    shownAny = pop & (o["reason"] == "shown") & ~(np.where(late, hw, wall) > RULE["maxHalfWidth"])   # sales and cell-median rows
    wide = ok & late & (hw > RULE["maxHalfWidth"]); shown = ok & late & ~(hw > RULE["maxHalfWidth"])
    res = dict(kind=kind, hideProject=hp, input=inp,
               targetsLater=int((base & late).sum()),
               answeredLaterPct=round(100 * float(shown.sum() / max((base & late).sum(), 1)), 1),
               answeredLaterPctBeds0to3=round(100 * float(shown.sum() / max((base & late & (d["bed"] <= 3)).sum(), 1)), 1),
               declined={str(r): round(100 * float(((o["reason"] == r) & base & late).sum() / max((base & late).sum(), 1)), 2) for r in np.unique(o["reason"][base & late]) if r != "shown"},
               declinedTooWidePct=round(100 * float(wide.sum() / max((base & late).sum(), 1)), 2),
               errorsLater=err_tables(o, shownAny & late), errorsTuning=err_tables(o, shownAny & (cut <= 1)),
               heldRollingByGroup={c: cov_table(o, lo, hi, hw, shown & (cut == ci), o["group"]) for c, ci in (("2025-11-16", 2), ("2026-05-17", 3))},
               heldTuningFitByGroup={c: cov_table(o, l01, h01, w01, ok & (cut == ci) & ~(w01 > RULE["maxHalfWidth"]), o["group"]) for c, ci in (("2025-11-16", 2), ("2026-05-17", 3))},
               heldRollingByBasis={c: cov_table(o, lo, hi, hw, shown & (cut == ci), np.where(d["basis"] == 0, "ready", "offplan")) for c, ci in (("2025-11-16", 2), ("2026-05-17", 3))},
               heldRollingByPopulation={c: cov_table(o, lo, hi, hw, shown & (cut == ci), np.char.add(np.where(d["basis"] == 0, "ready ", "offplan "), np.where(KN, "known", "new"))) for c, ci in (("2025-11-16", 2), ("2026-05-17", 3))},
               heldRollingByBedrooms=cov_table(o, lo, hi, hw, shown, np.char.add(np.where(d["basis"] == 0, "ready ", "offplan "), d["bed"].astype(str))),
               heldRollingByEvidence=cov_table(o, lo, hi, hw, shown, np.char.add(np.where(d["basis"] == 0, "ready ", "offplan "), np.where(o["nb"] < 6, "3-5 buildings", np.where(o["nb"] < 21, "6-20 buildings", "21+ buildings")))),
               halfWidthLater=dict(p10=round(100 * float(np.quantile(hw[shown], .1)), 1), p50=round(100 * float(np.median(hw[shown])), 1), p80=round(100 * float(np.quantile(hw[shown], .8)), 1),
                                   p95=round(100 * float(np.quantile(hw[shown], .95)), 1), max=round(100 * float(hw[shown].max()), 1)),
               decisionsLater={b: decisions(o, lo, hi, shown & (d["basis"] == bi)) for b, bi in (("ready", 0), ("offplan", 1))},
               qShipped=qall, qTuning=q01)
    return res, o


if __name__ == "__main__":
    ALL = np.ones(n, bool); out = {}
    r_in, o_in = study("in", KN); out["in"] = r_in
    # A building that is not in the data: its project is unknown too, so the range is fitted on the harder test (whole project hidden).
    r_outhp, o_outhp = study("out", ALL, hp=True); out["out_hideProject"] = r_outhp
    r_out, o_out = study("out", ALL, qsrc=dict(o_outhp, pop=ALL)); out["out"] = r_out
    out["in_hideProject"] = study("in", KN, hp=True, qsrc=dict(o_in, pop=KN))[0]
    out["in_areaOnly"] = study("in", KN, inp="area")[0]
    out["out_areaOnly"] = study("out", ALL, inp="area", qsrc=dict(build("out", True, "area"), pop=ALL))[0]
    out["rule"] = RULE; out["nominal"] = NOM
    out["counts"] = dict(rows=int(n), sales=int(sale.sum()), cells=int((~sale).sum()), noCommunityPct=round(100 * float((d["master"][sale] == 0).mean()), 1))
    tag = "" if NOM == 0.80 else f"_{int(round(NOM * 100))}"
    json.dump(out, open(os.path.join(N.OUT, f"final{tag}.json"), "w", encoding="utf-8"), indent=1)

    def pr(title, r):
        print(f"\n=== {title}: later targets {r['targetsLater']}, answered {r['answeredLaterPct']}% (0-3 bedrooms {r['answeredLaterPctBeds0to3']}%), declined {r['declined']}, too wide {r['declinedTooWidePct']}%")
        print("  half-width later", r["halfWidthLater"])
        for k in ("ready", "offplan", "ready | building known at the cutoff", "ready | new building", "offplan | building known at the cutoff", "offplan | new building"):
            e = r["errorsLater"][k]; print(f"  error later {k:42s} sale {e['sale']} | building {e['building']}")
        for c in r["heldRollingByGroup"]:
            print("  held (rolling)", c, {g: (v["held"], v["n"]) for g, v in r["heldRollingByGroup"][c].items()})
            if not BRIEF: print("  held (tuning fit)", c, {g: (v["held"], v["n"]) for g, v in r["heldTuningFitByGroup"][c].items()})
            print("  held by basis", c, {g: (v["held"], v["below"], v["above"], v["hwMed"], v["lowSide"], v["highSide"]) for g, v in r["heldRollingByBasis"][c].items()})
            print("  held by population", c, {g: (v["held"], v["n"]) for g, v in r["heldRollingByPopulation"][c].items()})
        print("  held by bedrooms", {g: (v["held"], v["n"]) for g, v in r["heldRollingByBedrooms"].items()})
        print("  held by evidence", {g: (v["held"], v["n"]) for g, v in r["heldRollingByEvidence"].items()})
        for b in r["decisionsLater"]: print("  decisions", b, {x: (v["below"], v["within"], v["above"]) for x, v in r["decisionsLater"][b].items()})
    for k in ("in", "out", "in_hideProject", "out_hideProject", "in_areaOnly", "out_areaOnly"): pr(k, out[k])
    print("counts", out["counts"])
