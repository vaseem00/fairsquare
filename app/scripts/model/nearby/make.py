"""Constants, golden cases and the worked cases of the nearby method, from the committed snapshot only
(data/open-data/sales.csv.gz, buildings.csv.gz, acs-model.json.gz) and the calibration of final.py (final.json).

  python scripts/model/nearby/make.py            -> scripts/model/nearby/constants.json, golden.json, cases.json
`nearby()` below is the reference implementation, written from SPEC.md with plain loops; it is checked against the
vectorised backtest code (nlib.estimate) on every golden case."""
import csv, gzip, json, math, os, sys
from datetime import date
import numpy as np
import nlib as N

REPO = N.REPO; OD = os.path.join(REPO, "data", "open-data"); HERE = os.path.dirname(os.path.abspath(__file__))
EPOCH = date(2020, 1, 1).toordinal(); MON = 30.4375
dnum = lambda s: date(int(s[:4]), int(s[5:7]), int(s[8:10])).toordinal() - EPOCH
PARAMS = dict(windowDays=730, ageHalfMonths=6.0, sizeHalf=0.25, cap=1.0, areaWeight=0.3, vintageHalfYears=1.0, minCommunityBuildings=3,
              countWeight=0.05, floor=0.05, far=[0.1, 0.2], thinBuildings=6)
RULE = dict(maxBedrooms=3, minBuildings=3, minWeight=1.0, maxSizeDistance=0.5, maxHalfWidth=0.5, rounding=10)

# ---------- the snapshot ----------
M = json.load(gzip.open(os.path.join(OD, "acs-model.json.gz"), "rt", encoding="utf-8"))
T = M["T"]; AREAS = {a: i for i, a in enumerate(M["areas"])}; SEG = M["seg"]; TAU = M["tau"]; THETA = M["theta"]
BK = {}; BLD = []
with gzip.open(os.path.join(OD, "buildings.csv.gz"), "rt", encoding="utf-8", newline="") as h:
    for r in csv.DictReader(h):
        BK[(r["building"], r["area_dld"])] = len(BLD)
        BLD.append(dict(name=r["building"], area=r["area_dld"], master=r["master_project"], project=r["project_number"],
                        launchAge=((T - dnum(r["first_sale"])) / 365.25) if r["first_sale"] else None,
                        handoverAge=((T - dnum(r["first_ready_sale"])) / 365.25) if r["first_ready_sale"] else None))
SALES = []
with gzip.open(os.path.join(OD, "sales.csv.gz"), "rt", encoding="utf-8", newline="") as h:
    for r in csv.DictReader(h):
        SALES.append((r["ref"], dnum(r["date"]), BK[(r["building"], r["area_dld"])], int(r["bedrooms"]), 1 if r["completion"] == "off_plan" else 0, float(r["size_sqft"]), float(r["price_aed"]), r["date"]))
S_day = np.array([s[1] for s in SALES]); S_b = np.array([s[2] for s in SALES]); S_bed = np.array([s[3] for s in SALES]); S_basis = np.array([s[4] for s in SALES])
S_size = np.array([s[5] for s in SALES]); S_price = np.array([s[6] for s in SALES])
B_area = np.array([b["area"] for b in BLD]); B_master = np.array([b["master"] for b in BLD])


def theta(area, basis):
    i = AREAS.get(area); th = THETA.get(f"{i}|{basis}") if i is not None else None
    return th if th is not None else TAU[basis]


def g_of(G, basis, age):
    xs = G["readyAges"] if basis == 0 else G["offPlanAges"]; ys = G["ready"] if basis == 0 else G["offPlan"]
    if age <= xs[0]: return ys[0]
    if age >= xs[-1]: return ys[-1]
    for j in range(1, len(xs)):
        if age <= xs[j]: return ys[j - 1] + (age - xs[j - 1]) / (xs[j] - xs[j - 1]) * (ys[j] - ys[j - 1])


def wq(v, w, p):
    """v ascending (ties: smaller weight first), w > 0."""
    tot = sum(w); c = 0.0; pp = []
    for x in w: c += x; pp.append((c - 0.5 * x) / tot)
    n = len(v)
    if p <= pp[0]: return v[0]
    if p >= pp[n - 1]: return v[n - 1]
    j = next(i for i in range(n) if pp[i] > p)
    return v[j - 1] + (p - pp[j - 1]) / (pp[j] - pp[j - 1]) * (v[j] - v[j - 1])


def _estimate(rows, lw, bed, basis, size, kind, own, G, P):
    """One pass over the given sale rows with level weights lw. Returns None when no row has weight."""
    Lz = math.log(size); seg = SEG[basis][min(bed, 4)]; comps = []
    age_t = None; use_v = (kind == "in") or basis == 1; kern = False
    if kind == "in":
        ob = BLD[own]
        if basis == 1: age_t = ob["launchAge"] if ob["launchAge"] is not None else 0.0; kern = True
        else: age_t = ob["handoverAge"] if ob["handoverAge"] is not None else 0.0; kern = ob["handoverAge"] is not None
    elif basis == 1: age_t = 0.0
    gt = g_of(G, basis, age_t) if use_v else 0.0
    for i, w0 in zip(rows, lw):
        b = BLD[S_b[i]]; day = int(S_day[i]); age = (T - day) / MON; mo = min(int(math.floor((T - day) / MON)), 47)
        th = theta(b["area"], basis); tadj = th[0] - th[mo]
        psf = S_price[i] / S_size[i]; lsr = Lz - math.log(S_size[i]); sadj = seg * lsr
        ab = (b["launchAge"] if basis == 1 else b["handoverAge"])
        vadj = (gt - g_of(G, basis, ab if ab is not None else 0.0)) if use_v else 0.0
        u = w0 * 0.5 ** (age / P["ageHalfMonths"]) * 0.5 ** ((lsr / P["sizeHalf"]) ** 2)
        if kern:
            ac = ab if ab is not None else (50.0 if basis == 1 else 0.0)
            u *= 0.5 ** (abs(ac - age_t) / P["vintageHalfYears"])
        if u > 0: comps.append(dict(i=int(i), b=int(S_b[i]), psf=psf, lsr=lsr, age=age, timeLn=tadj, sizeLn=sadj, vintageLn=vadj, a=math.log(psf) + tadj + sadj + vadj, u=u, community=w0 == 1.0))
    if not comps: return None
    tot = {}
    for c in comps: tot[c["b"]] = tot.get(c["b"], 0.0) + c["u"]
    for c in comps:
        if tot[c["b"]] > P["cap"]: c["u"] *= P["cap"] / tot[c["b"]]
    Wb = {b: min(t, P["cap"]) for b, t in tot.items()}
    W = sum(Wb.values()); nb = sum(1 for x in Wb.values() if x >= P["countWeight"] * P["cap"])
    comps.sort(key=lambda c: (c["a"], c["u"]))
    v = [c["a"] for c in comps]; w = [c["u"] for c in comps]; su = sum(w)
    return dict(centre=wq(v, w, 0.5), q10=wq(v, w, 0.1), q90=wq(v, w, 0.9), W=W, nb=nb, n=len(comps), lsr_w=sum(c["u"] * abs(c["lsr"]) for c in comps) / su, su=su, comps=comps)


def nearby(C, bed, basis, size, master=None, area=None, building=None, askingPsf=None, top=8):
    """The reference. building = (name, area_dld) of a building that is in the data (kind 'in'), else None (kind 'out')."""
    P = C["params"]; R = C["rule"]; G = C["vintage"]; own = BK.get(tuple(building)) if building else None
    kind = "in" if own is not None else "out"
    if own is not None: master = master or BLD[own]["master"]; area = area or BLD[own]["area"]
    master = master or ""; area = area or ""
    m = (S_bed == bed) & (S_basis == basis) & (S_day > T - P["windowDays"]) & (S_day <= T)
    if own is not None: m &= S_b != own
    inM = (B_master[S_b] == master) if master else np.zeros(len(S_b), bool); inA = (B_area[S_b] == area) if area else np.zeros(len(S_b), bool)
    out = dict(kind=kind, shown=False, reason=None)
    est = None; scope = None
    if master:
        rows = np.where(m & inM)[0]; est = _estimate(rows, [1.0] * len(rows), bed, basis, size, kind, own, G, P); scope = "community"
        if (est is None or est["nb"] < P["minCommunityBuildings"]) and area:
            rows = np.where(m & (inM | inA))[0]; est = _estimate(rows, [1.0 if inM[i] else P["areaWeight"] for i in rows], bed, basis, size, kind, own, G, P); scope = "community_and_area"
    elif area:
        rows = np.where(m & inA)[0]; est = _estimate(rows, [1.0] * len(rows), bed, basis, size, kind, own, G, P); scope = "area"
    if est is None: out["reason"] = "no_comparables"; return out
    far = "0" if est["lsr_w"] < P["far"][0] else "1" if est["lsr_w"] < P["far"][1] else "2"
    cls = "t" if est["nb"] < P["thinBuildings"] else "b" if bed == 3 else ("c" + far) if scope == "community" else "a"
    group = ("R" if basis == 0 else "O") + cls; q = C["range"][kind].get(group)
    out.update(scope=scope, group=group, centrePsf=math.exp(est["centre"]), buildings=est["nb"], weight=est["W"], comparables=est["n"], sizeDistance=est["lsr_w"])
    if q is not None:
        slo = math.sqrt(max(est["centre"] - est["q10"], P["floor"])); shi = math.sqrt(max(est["q90"] - est["centre"], P["floor"]))
        lo = est["centre"] - q[0] * slo; hi = est["centre"] + q[1] * shi; hw = (math.exp(hi) - math.exp(lo)) / (2 * math.exp(est["centre"]))
        out.update(lowPsf=math.exp(lo), highPsf=math.exp(hi), halfWidth=hw)
    if bed > R["maxBedrooms"]: out["reason"] = "bedrooms_not_validated"
    elif est["nb"] < R["minBuildings"] or est["W"] < R["minWeight"] - 1e-9: out["reason"] = "too_few_buildings"
    elif est["lsr_w"] > R["maxSizeDistance"]: out["reason"] = "size_too_far"
    elif q is None: out["reason"] = "no_calibration"
    elif hw > R["maxHalfWidth"]: out["reason"] = "range_too_wide"
    else:
        st = R["rounding"]; rlo = math.floor(math.exp(lo) / st + 0.5) * st; rhi = math.floor(math.exp(hi) / st + 0.5) * st
        out.update(shown=True, rangeLowPsf=rlo, rangeHighPsf=rhi)
        if askingPsf is not None:
            ask = math.floor(askingPsf + 0.5); out["verdict"] = "above" if ask > rhi else "below" if ask < rlo else "within"
    cs = sorted(est["comps"], key=lambda c: (-c["u"], SALES[c["i"]][0]))[:top]
    out["topComparables"] = [dict(ref=SALES[c["i"]][0], building=BLD[c["b"]]["name"], date=SALES[c["i"]][7], sizeSqft=float(S_size[c["i"]]), registeredPsf=c["psf"], timeLn=c["timeLn"], sizeLn=c["sizeLn"], vintageLn=c["vintageLn"],
                                  adjustedPsf=math.exp(c["a"]), weightShare=c["u"] / est["su"], inCommunity=bool(c["community"])) for c in cs]
    bw = {}
    for c in est["comps"]: bw[c["b"]] = bw.get(c["b"], 0.0) + c["u"]
    out["topBuildings"] = [dict(building=BLD[b]["name"], weightShare=w / est["su"]) for b, w in sorted(bw.items(), key=lambda kv: (-kv[1], BLD[kv[0]]["name"]))[:top]]
    out["_est"] = est
    return out


# ---------- the vintage curve at the data date, with the backtest's own code ----------
class Snap:
    """The snapshot in the shape nlib expects (see nlib.Cut)."""
    def __init__(s):
        s.T = T; s.seg = np.array(SEG); s.b = S_b; s.bed = S_bed; s.basis = S_basis; s.lp = np.log(S_price / S_size); s.ls = np.log(S_size); s.day = S_day; s.age = (T - S_day) / MON
        ua, ai = np.unique(B_area, return_inverse=True); um, mi = np.unique(B_master, return_inverse=True)
        s.area = ai[S_b]; s.master = np.where(B_master[S_b] == "", 0, mi[S_b] + 1); s.proj = np.zeros(len(S_b), np.int64); s.fam = s.proj
        s.vint = np.array([b["launchAge"] if b["launchAge"] is not None else np.nan for b in BLD]); s.rvint = np.array([b["handoverAge"] if b["handoverAge"] is not None else np.nan for b in BLD])
        mo = np.minimum(((T - S_day) / MON).astype(np.int64), 47); s.tadj = np.zeros(len(S_b))
        for a in np.unique(B_area[S_b]):
            for bs in (0, 1):
                mm = (B_area[S_b] == a) & (S_basis == bs)
                if mm.any(): th = np.array(theta(a, bs)); s.tadj[mm] = th[0] - th[mo[mm]]


def r6(x):
    return float(f"{x:.6g}") if isinstance(x, float) else x


if __name__ == "__main__":
    SN = Snap(); G0 = N.fit_vintage(SN)
    G = dict(readyAges=list(N.RK), ready=G0["ready"], offPlanAges=list(N.OK_), offPlan=G0["offplan"])
    print("vintage curve at", M["dataThrough"], "ready", [round(x, 3) for x in G["ready"]], "off-plan", [round(x, 3) for x in G["offPlan"]])
    for tag, name in (("", "constants.json"), ("_87", "constants-nominal87.json")):
        fp = os.path.join(N.OUT, f"final{tag}.json")
        if not os.path.exists(fp): continue
        F = json.load(open(fp, encoding="utf-8"))
        lows = {}
        for k in ("in", "out", "out_hideProject"):
            v = [g["held"] for c in F[k]["heldRollingByGroup"].values() for g in c.values() if g["n"] >= 400]; lows[k] = min(v)
        C = dict(version=1, kind="nearby-constants", fittedOn=M["dataThrough"], cutoffs=N.CUTS, horizonDays=183, nominal=F["nominal"], params=PARAMS, rule=RULE, vintage=G,
                 range={"in": {g: [v[0], v[1]] for g, v in F["in"]["qShipped"].items()}, "out": {g: [v[0], v[1]] for g, v in F["out"]["qShipped"].items()}},
                 rangeFitRows={"in": {g: v[2] for g, v in F["in"]["qShipped"].items()}, "out": {g: v[2] for g, v in F["out"]["qShipped"].items()}},
                 tested=dict(heldOf10=int(min(lows.values()) // 10), lowestLaterGroupHeld=lows, note="lowest share held on the two later cutoffs among range groups with 400+ test sales; ranges fitted only on earlier cutoffs",
                             answeredPct={k: F[k]["answeredLaterPct"] for k in ("in", "out", "out_hideProject")}, halfWidth={k: F[k]["halfWidthLater"] for k in ("in", "out")}))
        json.dump(C, open(os.path.join(HERE, name), "w", encoding="utf-8"), indent=1)
        print(name, "heldOf10", C["tested"]["heldOf10"], lows)
    C = json.load(open(os.path.join(HERE, "constants.json"), encoding="utf-8")); SN.G = G0

    def strip(o, top=3):
        o = {k: v for k, v in o.items() if k != "_est"}
        o["topComparables"] = [{k: r6(v) for k, v in c.items()} for c in o.get("topComparables", [])[:top]]; o["topBuildings"] = [{k: r6(v) for k, v in c.items()} for c in o.get("topBuildings", [])[:top]]
        return {k: r6(v) for k, v in o.items()}

    # ---------- golden cases ----------
    def typ(master, area, bed, basis):
        m = (S_bed == bed) & (S_basis == basis) & (S_day > T - 730) & (((B_master[S_b] == master) if master else False) | ((B_area[S_b] == area) if area else False))
        return (float(np.median(S_size[m])), float(np.median(S_price[m] / S_size[m]))) if np.any(m) else (800.0, 1500.0)
    comm = [("Jumeirah Village Circle", "Al Barsha South Fourth"), ("Business Bay", "Business Bay"), ("Dubai Science Park", "Al Barshaa South Second"), ("Dubai Maritime City", "Madinat Dubai Almelaheyah"),
            ("Al Barari", "Wadi Al Safa 3"), ("Dubai Hills Estate", "Hadaeq Sheikh Mohammed Bin Rashid"), ("DMCC Master Community", "Al Thanyah Fifth"), ("International City Phase 3", "Warsan Fourth")]
    cases = []; fs = (1.0, 0.8, 1.3); fa = (1.0, 0.75, 1.35); k = 0
    for ci, (ms, ar) in enumerate(comm):                       # not in the data: community and area
        for bed, basis in ((1, 0), (2, 1)) if ci % 2 == 0 else ((0, 1), (3, 0)):
            sz, ps = typ(ms, ar, bed, basis); cases.append(dict(bedrooms=bed, basis=basis, sizeSqft=round(sz * fs[k % 3], 0), master=ms, area=ar, askingPsf=round(ps * fa[(k // 3) % 3], 0))); k += 1
    for ms, ar in comm[:4]:                                    # not in the data: DLD area only
        sz, ps = typ("", ar, 1, 1); cases.append(dict(bedrooms=1, basis=1, sizeSqft=round(sz * fs[k % 3], 0), area=ar, askingPsf=round(ps * fa[k % 3], 0))); k += 1
    for ms, ar in comm[4:]:                                    # community only
        sz, ps = typ(ms, "", 2, 0); cases.append(dict(bedrooms=2, basis=0, sizeSqft=round(sz * fs[k % 3], 0), master=ms, askingPsf=round(ps * fa[k % 3], 0))); k += 1
    inb = [("SEVENTH HEAVEN", "Wadi Al Safa 3", 1, 0), ("E1", "Wadi Al Safa 3", 2, 0), ("BELLA ROSE", "Al Barshaa South Second", 1, 0), ("MONTROSE RESIDENCE A", "Al Barshaa South Second", 2, 0),
           ("Orise Podium", "Madinat Dubai Almelaheyah", 1, 1), ("IL VENTO", "Madinat Dubai Almelaheyah", 2, 1), ("THE ANWA BY OMNIYAT", "Madinat Dubai Almelaheyah", 3, 0), ("Nova Tower", "Al Barshaa South Second", 0, 1),
           ("Three Towers A-1", "Al Barshaa South Second", 2, 0), ("Skyhills Residences - 1", "Al Barshaa South Second", 1, 0), ("Harbour Lights", "Madinat Dubai Almelaheyah", 1, 1), ("ORCHID RESIDENCE", "Al Barshaa South Second", 0, 0)]
    for nm, ar, bed, basis in inb:                             # in the data
        b = BLD[BK[(nm, ar)]]; sz, ps = typ(b["master"], ar, bed, basis); cases.append(dict(bedrooms=bed, basis=basis, sizeSqft=round(sz * fs[k % 3], 0), building=[nm, ar], askingPsf=round(ps * fa[k % 3], 0))); k += 1
    cases += [dict(bedrooms=4, basis=0, sizeSqft=3500.0, master="Business Bay", area="Business Bay", askingPsf=2500.0),                    # refusals
              dict(bedrooms=1, basis=0, sizeSqft=800.0, master="No Such Community", area="No Such Area", askingPsf=1500.0),
              dict(bedrooms=1, basis=0, sizeSqft=2904.0, building=["SEVENTH HEAVEN", "Wadi Al Safa 3"], askingPsf=1412.0),
              dict(bedrooms=1, basis=0, sizeSqft=6000.0, master="Jumeirah Village Circle", area="Al Barsha South Fourth", askingPsf=900.0),
              dict(bedrooms=3, basis=1, sizeSqft=1700.0, master="Al Barari", area="Wadi Al Safa 3", askingPsf=2400.0),
              dict(bedrooms=2, basis=0, sizeSqft=1491.0, master="Dubai Science Park", area="Al Barshaa South Second", askingPsf=2695000 / 1491)]
    gold = []; maxd = 0.0
    for i, c in enumerate(cases):
        o = nearby(C, c["bedrooms"], c["basis"], c["sizeSqft"], c.get("master"), c.get("area"), c.get("building"), c.get("askingPsf"))
        est = o.get("_est")
        if est is not None:   # cross-check the centre and the 10% / 90% points against the vectorised backtest code on the same rows
            own = BK.get(tuple(c["building"])) if c.get("building") else None; kind = o["kind"]; basis = c["basis"]
            rows = np.array(sorted(x["i"] for x in est["comps"])); P = dict(N.P0); P.update(cap=1.0, age_half=6.0, size_half=0.25, win=730, r_area=0.3)
            ms = c.get("master") or (BLD[own]["master"] if own is not None else ""); mcode = int(SN.master[np.where(B_master[S_b] == ms)[0][0]]) if (ms and np.any(B_master[S_b] == ms)) else 0
            tv = trv = None
            if kind == "in":
                P["vint_half"] = 1.0; P["vadj"] = 1
                if basis == 1: tv = BLD[own]["launchAge"] or 0.0; P["gt"] = float(N.g_of(G0, 1, tv))
                else:
                    ha = BLD[own]["handoverAge"]; trv = ha; P["gt"] = float(N.g_of(G0, 0, ha if ha is not None else 0.0))
            elif basis == 1: P["vadj"] = 1; P["gt"] = float(N.g_of(G0, 1, 0.0))
            r = N.estimate(SN, rows, c["bedrooms"], basis, np.array([math.log(c["sizeSqft"])]), P, master=mcode if o["scope"] == "community_and_area" else 0, tv=tv, trv=trv)
            dd = max(abs(r["centre"][0] - est["centre"]), abs(r["q10"][0] - est["q10"]), abs(r["q90"][0] - est["q90"]), abs(r["W"][0] - est["W"])); maxd = max(maxd, dd)
        gold.append(dict(id=i + 1, input=c, expected=strip(o)))
    json.dump(dict(dataThrough=M["dataThrough"], constantsVersion=C["version"], note="expected values to 6 significant figures; inputs read the committed snapshot (data/open-data)", cases=gold),
              open(os.path.join(HERE, "golden.json"), "w", encoding="utf-8"), indent=1)
    from collections import Counter
    print("golden cases", len(gold), Counter(g["expected"]["reason"] or "shown" for g in gold), "| largest difference from the vectorised code (ln):", maxd)

    # ---------- the worked cases ----------
    real = [("Marriott Residences Tower 2, Dubai Science Park (not in the data), ready 2-bed 1,491 sq ft, AED 2,695,000", dict(bedrooms=2, basis=0, sizeSqft=1491.0, master="Dubai Science Park", area="Al Barshaa South Second", askingPsf=2695000 / 1491)),
            ("Chelsea Residences by Damac Tower D, Dubai Maritime City (not in the data), off-plan 1-bed 750 sq ft, asking assumed AED 2,150,000", dict(bedrooms=1, basis=1, sizeSqft=750.0, master="Dubai Maritime City", area="Madinat Dubai Almelaheyah", askingPsf=2150000 / 750)),
            ("SEVENTH HEAVEN, Al Barari (in the data), ready 1-bed 2,904 sq ft, AED 4,100,000", dict(bedrooms=1, basis=0, sizeSqft=2904.0, building=["SEVENTH HEAVEN", "Wadi Al Safa 3"], askingPsf=4100000 / 2904)),
            ("E1 (Seventh Heaven - Ashjar), Al Barari (in the data, 2 sales in 36 months), ready 2-bed 1,600 sq ft, asking assumed AED 2,400,000", dict(bedrooms=2, basis=0, sizeSqft=1600.0, building=["E1", "Wadi Al Safa 3"], askingPsf=2400000 / 1600)),
            ("Orise Podium, Dubai Maritime City (in the data, 8 off-plan sales), off-plan 2-bed 1,200 sq ft, asking assumed AED 3,300,000", dict(bedrooms=2, basis=1, sizeSqft=1200.0, building=["Orise Podium", "Madinat Dubai Almelaheyah"], askingPsf=3300000 / 1200))]
    outc = []
    for title, c in real:
        o = nearby(C, c["bedrooms"], c["basis"], c["sizeSqft"], c.get("master"), c.get("area"), c.get("building"), c.get("askingPsf"), top=8)
        s = strip(o, top=8); outc.append(dict(title=title, input=c, output=s))
        print("\n" + title); print("  ", {k: v for k, v in s.items() if k not in ("topComparables", "topBuildings")})
        if c.get("building"):
            own = BK[tuple(c["building"])]; mm = (S_b == own); print("   own sales in the snapshot:", int(mm.sum()), "| this bedroom type and basis:", int((mm & (S_bed == c["bedrooms"]) & (S_basis == c["basis"])).sum()),
                                                                    "| sizes", sorted(set(np.round(S_size[mm & (S_bed == c["bedrooms"])]).tolist()))[:8])
        for b in s["topBuildings"]: print("     building", b)
        for x in s["topComparables"][:6]: print("     sale", x)
    json.dump(outc, open(os.path.join(HERE, "cases.json"), "w", encoding="utf-8"), indent=1)
