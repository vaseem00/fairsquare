"""Stage 5 final tables: the stage 5 rule (ready flats at a nominal 85%), forward in time, and the chain "ACS first, today's answer as
the fallback" computed sale by sale. Writes final5_tables.json into the work folder; prints the tables (redirect them to a file to keep them).
Errors: typical / 80th / 90th percentile of exp(|ln error|) - 1, in percent. A rows are a 12,000 sample per cutoff; shares that mix
scenarios weight them back."""
import sys, os, math, json
import numpy as np
from s5lib import *
import chain as CH
D = cal.load_all(); E4 = evaluate5(D); E = evaluate5(D, nom={0: .85})
w = D["wt"]; e = D["e"]; truth = D["truth"]; b3 = D["bed"] <= 3; AB = D["scen"] != 2
sh = E["shown"] & b3 & AB; cov = E["cov"]; hw = E["hw"]; gn = E["gn"]
e1 = truth - D["t1"]; e2 = truth - D["sc"]; ss = (D["sreason"] == 0) & (D["scen"] == 1)
TEST4 = np.isin(D["cut"], TEST); TUN = np.isin(D["cut"], (2, 3)); LATER = np.isin(D["cut"], (4, 5)); C4 = D["cut"] == 4; LAST = D["cut"] == 5
PARTS = (("all four", TEST4), ("tuning", TUN), ("later", LATER), ("2025-11-16", C4), ("last 2026-05-17", LAST))
BAS = (("all", D["basis"] >= 0), ("ready", D["basis"] == 0), ("off-plan", D["basis"] == 1))
OUT = dict(rule=dict(EC.RULE, nominal={"ready": .85, "offPlan": .80}))
def P(*a): print(*a, flush=True)
def pct(m, of): return round(wmean(m[of], w[of]), 1) if of.sum() else None
def r1(x): return None if x is None else round(x, 1)

P("=== 1. Share answered by ACS and its error, against today's method on the same sales (studio to 3-bed)")
OUT["A"] = []; OUT["B"] = []
for pn, pm in PARTS:
    for bn, bm in BAS:
        m = (D["scen"] == 0) & pm & bm & b3; ms = m & sh
        d = dict(part=pn, basis=bn, sales=int(m.sum()), tier1All=esn(e1[m])[1:], acsAll=esn(e[m])[1:], answeredPct=pct(sh, m), stage4AnsweredPct=pct(E4["shown"] & b3, m), acsOnAnswered=esn(e[ms])[1:], tier1OnSame=esn(e1[ms])[1:], heldPct=pct(cov, ms),
                 belowPct=pct(truth < E["lo"], ms), abovePct=pct(truth > E["hi"], ms), halfWidthPct=round(100 * float(np.median(hw[ms])), 1))
        OUT["A"].append(d); P(f"  A {pn:16s} {bn:8s} n {d['sales']:6d} | tier 1 all {d['tier1All'][:3]} | ACS all {d['acsAll'][:3]} | answered {d['answeredPct']}% (stage 4: {d['stage4AnsweredPct']}%) | ACS {d['acsOnAnswered'][:3]} bias {d['acsOnAnswered'][3]} vs tier 1 on same {d['tier1OnSame'][:3]} | held {d['heldPct']}% (true price under {d['belowPct']}, over {d['abovePct']}) half-width {d['halfWidthPct']}%")
for pn, pm in PARTS:
    for bn, bm in BAS:
        m = (D["scen"] == 1) & pm & bm & b3; ms = m & sh; mb = ms & ss
        d = dict(part=pn, basis=bn, sales=int(m.sum()), tier2AnsweredPct=pct(ss, m), tier2OnItsAnswers=esn(e2[m & ss])[1:], tier2HeldPct=pct((truth >= D["slo"]) & (truth <= D["shi"]), m & ss), acsAll=esn(e[m])[1:], answeredPct=pct(sh, m), stage4AnsweredPct=pct(E4["shown"] & b3, m),
                 acsOnAnswered=esn(e[ms])[1:], heldPct=pct(cov, ms), belowPct=pct(truth < E["lo"], ms), abovePct=pct(truth > E["hi"], ms), halfWidthPct=round(100 * float(np.median(hw[ms])), 1), bothAnswered=int(mb.sum()), tier2OnBoth=esn(e2[mb])[1:], acsOnBoth=esn(e[mb])[1:],
                 eitherPct=pct(sh | ss, m), acsOnlyPct=pct(sh & ~ss, m), acsOnAcsOnly=esn(e[ms & ~ss])[1:], heldAcsOnlyPct=pct(cov, ms & ~ss))
        OUT["B"].append(d); P(f"  B {pn:16s} {bn:8s} n {d['sales']:6d} | tier 2 answers {d['tier2AnsweredPct']}% {d['tier2OnItsAnswers'][:3]} held {d['tier2HeldPct']}% | ACS answers {d['answeredPct']}% (stage 4: {d['stage4AnsweredPct']}%) {d['acsOnAnswered'][:3]} bias {d['acsOnAnswered'][3]} held {d['heldPct']}% (under {d['belowPct']}, over {d['abovePct']}) half-width {d['halfWidthPct']}% | both {d['bothAnswered']}: tier 2 {d['tier2OnBoth'][:3]} vs ACS {d['acsOnBoth'][:3]} | either {d['eitherPct']}% | ACS only {d['acsOnlyPct']}%: {d['acsOnAcsOnly'][:3]} held {d['heldAcsOnlyPct']}%")

P("\n=== 2. Mondrian groups and scenario cells with 100+ answered sales (weighted back)")
OUT["groups"] = []
for sn, sm in (("A+B", AB), ("A", D["scen"] == 0), ("B", D["scen"] == 1)):
    for u in sorted(set(gn[sm & sh & TEST4].tolist())):
        m = sm & sh & TEST4 & (gn == u)
        if m.sum() < 100: continue
        d = dict(scenario=sn, group=u, answered=int(m.sum()), heldPct=pct(cov, m), tuningPct=pct(cov, m & TUN) if (m & TUN).sum() >= 30 else None, laterPct=pct(cov, m & LATER) if (m & LATER).sum() >= 30 else None, lastPct=pct(cov, m & LAST) if (m & LAST).sum() >= 30 else None,
                 nTuning=int((m & TUN).sum()), nLater=int((m & LATER).sum()), nLast=int((m & LAST).sum()))
        OUT["groups"].append(d); flag = " <-- under 78" if (d["heldPct"] < 78 or (d["laterPct"] is not None and d["nLater"] >= 100 and d["laterPct"] < 78) or (d["tuningPct"] is not None and d["nTuning"] >= 100 and d["tuningPct"] < 78)) else ""
        P(f"  {sn:3s} {u} n {d['answered']:6d} held {d['heldPct']} | tuning {d['tuningPct']} ({d['nTuning']}) | later {d['laterPct']} ({d['nLater']}) | last {d['lastPct']} ({d['nLast']}){flag}")
m = (D["scen"] == 0) & (D["basis"] == 0) & (D["cls"] == 2) & sh
P(f"  the cell 'A, ready, other bedrooms lead': tuning n {(m&TUN).sum()} held {pct(cov, m&TUN)} ACS {es(e[m&TUN], True)} tier 1 {es(e1[m&TUN], True)} | later n {(m&LATER).sum()} held {pct(cov, m&LATER)} ACS {es(e[m&LATER], True)} tier 1 {es(e1[m&LATER], True)}")
OUT["cellAReadyClass2"] = dict(tuning=dict(n=int((m & TUN).sum()), heldPct=pct(cov, m & TUN), acs=esn(e[m & TUN])[1:3], tier1=esn(e1[m & TUN])[1:3]), later=dict(n=int((m & LATER).sum()), heldPct=pct(cov, m & LATER), acs=esn(e[m & LATER])[1:3], tier1=esn(e1[m & LATER])[1:3]))
hz = D["day"] - D["T"][D["cut"]]
for lab, mm in (("days 1-30", hz <= 30), ("days 31-61", (hz > 30) & (hz <= 61)), ("days 62-122", (hz > 61) & (hz <= 122)), ("days 123-183", hz > 122)):
    P(f"  held by days after the data date, {lab}: ready {pct(cov, sh & TEST4 & mm & (D['basis']==0))} off-plan {pct(cov, sh & TEST4 & mm & (D['basis']==1))}")

P("\n=== 3. The chain, sale by sale: ACS first, today's answer where ACS declines (all bedrooms; 4+ bedrooms always fall back)")
V, today_ans, new_ans, ctoday, cnew = CH.verdicts(D, E, sh)
OUT["chain"] = []
for sn, sc in (("A", D["scen"] == 0), ("B", D["scen"] == 1), ("A+B", AB)):
    for pn, pm in PARTS:
        for bn, bm in BAS:
            m = sc & pm & bm; mt = m & today_ans; mn = m & new_ans; S = CH.summary(D, V, m, w)
            d = dict(scenario=sn, part=pn, basis=bn, sales=round(float(w[m].sum())), todayAnsweredPct=pct(today_ans, m), newAnsweredPct=pct(new_ans, m), byAcsPct=pct(sh, m), ofTodaysAnswersByAcsPct=pct(sh, mt),
                     errTodayWhereTodayAnswers=esn((truth - ctoday)[mt])[1:4], errChainWhereTodayAnswers=esn((truth - cnew)[mt])[1:4], errChainAllAnswered=esn((truth - cnew)[mn])[1:4],
                     verdict={str(f): {k: (None if v is None else round(v, 1)) for k, v in S[f].items()} for f in CH.FS})
            OUT["chain"].append(d)
            if bn == "all" or sn != "A+B":
                P(f"  {sn:3s} {pn:16s} {bn:8s} answered today {d['todayAnsweredPct']}% -> chain {d['newAnsweredPct']}% (ACS gives {d['byAcsPct']}%; of today's answers {d['ofTodaysAnswersByAcsPct']}%) | error where today answers: today {d['errTodayWhereTodayAnswers']} chain {d['errChainWhereTodayAnswers']} | chain, all it answers {d['errChainAllAnswered']}")
                for f in CH.FS:
                    x = S[f]; P(f"        price = true x {f}: verdict differs {x['differ']:5.1f}% | right: today {x['todayRight']:5.1f}% chain {x['newRight']:5.1f}% | where they differ: chain right {x['newRightOnly']:5.1f}%, today right {x['todayRightOnly']:5.1f}%, both wrong {x['bothWrong']:4.1f}%" + ("" if x['todayWrongDir'] is None else f" | wrong direction: today {x['todayWrongDir']:4.1f}% chain {x['newWrongDir']:4.1f}%"))

P("\n=== 4. 'About N of 10': the share of answered sales whose true price was inside the range")
OUT["heldOf10"] = {}
for sn, sc in (("A", D["scen"] == 0), ("B", D["scen"] == 1)):
    for bn, bm in BAS[1:]:
        m = sc & bm & sh
        d = dict(allFour=pct(cov, m & TEST4), tuning=pct(cov, m & TUN), later=pct(cov, m & LATER), c2025_11=pct(cov, m & C4), last=pct(cov, m & LAST), nLast=int((m & LAST).sum()))
        OUT["heldOf10"][f"{sn} {bn}"] = d; P(f"  {sn} {bn:8s} {d}")
P("\n=== 5. Registered sales used per answered case (for the list on the page)")
nn = D["main_n"][sh & TEST4]; OUT["compsPerAnswer"] = dict(median=int(np.median(nn)), p90=int(np.quantile(nn, .9)), p99=int(np.quantile(nn, .99)), max=int(nn.max()))
for sn, sc in (("A", 0), ("B", 1)):
    x = D["main_n"][sh & TEST4 & (D["scen"] == sc)]; P(f"  {sn}: median {int(np.median(x))}, 90th pct {int(np.quantile(x, .9))}, 99th pct {int(np.quantile(x, .99))}, max {int(x.max())}; share with 30 or fewer {100*np.mean(x <= 30):.1f}%")
json.dump(OUT, open(os.path.join(L.HERE, "final5_tables.json"), "w"), indent=1)
